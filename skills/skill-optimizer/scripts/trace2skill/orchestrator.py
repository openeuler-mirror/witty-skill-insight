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

        return skill_content

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
