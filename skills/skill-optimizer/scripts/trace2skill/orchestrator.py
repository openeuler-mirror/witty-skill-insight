"""
Trace2Skill Orchestrator - Main entry point for trace-driven skill optimization.

Based on arXiv:2603.25158v3

Three-stage pipeline:
1. Trajectory Generation (Stage 1)
2. Parallel Multi-Agent Patch Proposal (Stage 2: A- + A+)
3. Hierarchical Merge (Stage 3)
"""

import json
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Optional

from .analysis import BatchErrorAnalyst, BatchSuccessAnalyst
from .merge import HierarchicalMerge, MergeConfig, MergeResult
from .patch import PatchPool, SkillPatch
from .trajectory import TrajectorySet

logger = logging.getLogger(__name__)


@dataclass
class Trace2SkillConfig:
    trajectory_dir: Optional[Path] = None
    skill_path: Path = None
    output_dir: Optional[Path] = None
    max_concurrent: int = 8
    max_error_turns: int = 3
    merge_batch_size: int = 32
    merge_max_levels: int = 4
    enable_success_analyst: bool = True
    enable_error_analyst: bool = True
    save_snapshots: bool = True


@dataclass
class Trace2SkillResult:
    evolved_skill_content: str = ""
    evolved_files: dict[str, str] = field(default_factory=dict)
    error_patches_count: int = 0
    success_patches_count: int = 0
    merge_result: Optional[MergeResult] = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "evolved_skill_content": self.evolved_skill_content,
            "evolved_files": self.evolved_files,
            "error_patches_count": self.error_patches_count,
            "success_patches_count": self.success_patches_count,
            "merge_result": self.merge_result.to_dict() if self.merge_result else None,
            "metadata": self.metadata,
        }


class Trace2SkillOrchestrator:
    def __init__(
        self,
        llm_client: Callable[[str], str],
        config: Trace2SkillConfig,
    ):
        self.llm_client = llm_client
        self.config = config

    def run(self) -> Trace2SkillResult:
        logger.info("Starting Trace2Skill optimization")

        trajectory_set = self._load_trajectories()

        logger.info(
            f"Loaded {trajectory_set.total_count} trajectories "
            f"({trajectory_set.success_count} success, {trajectory_set.failure_count} failure)"
        )

        skill_content = self._load_skill()

        patch_pool = PatchPool()

        if self.config.enable_error_analyst and trajectory_set.failure_count > 0:
            logger.info("Running Error Analysts (Stage 2)")
            error_results = self._run_error_analysts(trajectory_set, skill_content)
            for result in error_results:
                if result.patch:
                    patch_pool.add_patch(result.patch)
            logger.info(f"Generated {len(error_results)} error patches")

        if self.config.enable_success_analyst and trajectory_set.success_count > 0:
            logger.info("Running Success Analysts (Stage 2)")
            success_results = self._run_success_analysts(trajectory_set, skill_content)
            for result in success_results:
                if result.patch:
                    patch_pool.add_patch(result.patch)
            logger.info(f"Generated {len(success_results)} success patches")

        logger.info(f"Total patches: {patch_pool.total_count}")

        merge_config = MergeConfig(
            batch_size=self.config.merge_batch_size,
            max_levels=self.config.merge_max_levels,
            skill_root=self.config.skill_path,
        )
        merge = HierarchicalMerge(self.llm_client, merge_config)

        merge_result = merge.merge(patch_pool, skill_content)
        logger.info(
            f"Hierarchical merge completed: {merge_result.levels_completed} levels"
        )

        evolved_content = self._apply_patch(skill_content, merge_result.final_patch)

        if self.config.output_dir:
            self._save_output(evolved_content, merge_result)

        return Trace2SkillResult(
            evolved_skill_content=evolved_content,
            evolved_files={},
            error_patches_count=len(patch_pool.error_patches),
            success_patches_count=len(patch_pool.success_patches),
            merge_result=merge_result,
            metadata={
                "trajectory_count": trajectory_set.total_count,
                "success_rate": trajectory_set.success_rate,
            },
        )

    def _load_trajectories(self) -> TrajectorySet:
        if self.config.trajectory_dir:
            trajectory_dir = self.config.trajectory_dir if isinstance(self.config.trajectory_dir, Path) else Path(self.config.trajectory_dir)
            return TrajectorySet.load_from_directory(trajectory_dir)

        return TrajectorySet(
            trajectories=[],
            source_skill=self.config.skill_path.name,
        )

    def _load_skill(self) -> str:
        skill_path = self.config.skill_path if isinstance(self.config.skill_path, Path) else Path(self.config.skill_path)
        skill_md = skill_path / "SKILL.md"
        return skill_md.read_text(encoding="utf-8")

    def _run_error_analysts(self, trajectory_set: TrajectorySet, skill_content: str):
        analyst = BatchErrorAnalyst(
            self.llm_client,
            max_concurrent=self.config.max_concurrent,
            max_turns=self.config.max_error_turns,
        )
        return analyst.analyze_batch(
            trajectory_set.trajectories,
            skill_content,
        )

    def _run_success_analysts(self, trajectory_set: TrajectorySet, skill_content: str):
        analyst = BatchSuccessAnalyst(
            self.llm_client,
            max_concurrent=self.config.max_concurrent,
        )
        return analyst.analyze_batch(
            trajectory_set.trajectories,
            skill_content,
        )

    def _apply_patch(
        self,
        skill_content: str,
        final_patch: Optional[SkillPatch],
    ) -> str:
        if not final_patch:
            return skill_content

        logger.info("Applying final patch to skill")

        # Create prompt for LLM to apply the patch
        edits_description = []
        for i, edit in enumerate(final_patch.edits):
            edit_desc = f"{i+1}. Operation: {edit.operation}"
            if edit.target:
                edit_desc += f", Target: '{edit.target}'"
            if edit.target_start_line is not None:
                edit_desc += f", Start line: {edit.target_start_line}"
            if edit.target_end_line is not None:
                edit_desc += f", End line: {edit.target_end_line}"
            if edit.content:
                edit_desc += f", Content: {repr(edit.content)}"
            if edit.reasoning:
                edit_desc += f", Reasoning: {edit.reasoning}"
            edits_description.append(edit_desc)

        prompt = f"""You are a precise code editor. Your task is to apply a series of edits to a skill file based on the instructions below.

        SKILL FILE CONTENT:
        {skill_content}

        EDITS TO APPLY:
        {chr(10).join(edits_description)}

        INSTRUCTIONS:
        1. Apply each edit in the order listed
        2. For 'insert' operations: Insert the content at the specified location
        3. For 'replace' operations: Replace the target text with the new content
        4. For 'delete' operations: Remove the target text
        5. If target_start_line and target_end_line are provided, use those line numbers (1-indexed) to locate the text
        6. If target is provided, find and operate on that exact text
        7. Make sure to preserve the overall structure and formatting of the skill file
        8. Return ONLY the modified skill file content, with no additional explanations or formatting

        Modified skill file content:"""

        # Apply the patch using LLM
        modified_content = self.llm_client(prompt)
        return modified_content

    def _save_output(
        self,
        evolved_content: str,
        merge_result: MergeResult,
    ) -> None:
        output_dir = self.config.output_dir
        output_dir.mkdir(parents=True, exist_ok=True)

        skill_path = output_dir / "SKILL.md"
        skill_path.write_text(evolved_content, encoding="utf-8")
        logger.info(f"Saved evolved skill to {skill_path}")

        if merge_result:
            result_path = output_dir / "trace2skill_result.json"
            with open(result_path, "w", encoding="utf-8") as f:
                json.dump(merge_result.to_dict(), f, ensure_ascii=False, indent=2)
            logger.info(f"Saved merge result to {result_path}")


def run_trace2skill(
    llm_client: Callable[[str], str],
    config: Optional[Trace2SkillConfig] = None,
    skill_path: Optional[Path] = None,
    trajectory_path: Optional[Path] = None,
    output_path: Optional[Path] = None,
    max_concurrent: int = 8,
    max_error_turns: int = 3,
) -> Trace2SkillResult:
    if config is None:
        config = Trace2SkillConfig(
            trajectory_dir=trajectory_path,
            skill_path=skill_path,
            output_dir=output_path,
            max_concurrent=max_concurrent,
            max_error_turns=max_error_turns,
        )

    if config.skill_path is None and skill_path:
        config.skill_path = skill_path

    orchestrator = Trace2SkillOrchestrator(llm_client, config)
    return orchestrator.run()
