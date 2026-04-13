"""
Hierarchical Merge for Trace2Skill Stage 3.

Based on arXiv:2603.25158v3 - Section 2.4

Hierarchical merging with programmatic conflict prevention:
- Groups of up to B_merge patches are synthesized at each level
- L = ceil(log_B(|P|)) levels total
- Merge operator: dedup, resolve conflicts, preserve unique insights
- Prevalence-weighted consolidation for inductive reasoning
"""

import logging
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Optional

from trace2skill.patch import PatchEdit, PatchOperation, PatchPool, SkillPatch

logger = logging.getLogger(__name__)


MERGE_OPERATOR_SYSTEM_PROMPT = """You are a skill edit coordinator. You receive multiple independently-proposed patches that each suggest changes to a skill folder. Your job is to merge them into one coherent, non-redundant patch.

Guidelines:
1. Deduplicate: When multiple patches propose the same or very similar edits, keep the best version (most specific, best worded).
2. Resolve conflicts: If patches propose contradictory edits to the same section, choose the one with stronger justification or synthesize both into a better edit.
3. Preserve unique insights: Different patches address different failures — include all unique, non-redundant edits.
4. Maintain conciseness: The merged patch should have ≤ the sum of unique edits across all input patches. Remove redundancy.
5. Ensure independence: Edits in the merged patch MUST be line-level independent — no two edits may target overlapping lines or the same passage of text, even across different operations.
6. Atomic create/link pairs: A create operation for references/*.md and the SKILL.md edit that inserts a link to it are an inseparable pair — keep both or drop both.

Prevalent pattern bias: When multiple patches independently propose similar edits addressing the same class of failure or success pattern, treat this recurrence as evidence of a systematic property of the task. Preserve such prevalent edits with higher priority and express them as general principles rather than instance-specific fixes.
"""


@dataclass
class MergeConfig:
    batch_size: int = 32
    max_levels: int = 4
    enable_prevalence_weighting: bool = True
    reference_dir: Optional[Path] = None
    check_file_existence: bool = True
    check_conflicts: bool = True
    validate_format: bool = True
    skill_root: Optional[Path] = None


@dataclass
class MergeResult:
    final_patch: Optional[SkillPatch] = None
    reasoning: str = ""
    levels_completed: int = 0
    patches_merged: int = 0
    conflicts_detected: list[str] = field(default_factory=list)
    unique_patterns: list[str] = field(default_factory=list)
    low_frequency_patches: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "final_patch": self.final_patch.to_dict() if self.final_patch else "",
            "reasoning": self.reasoning,
            "levels_completed": self.levels_completed,
            "patches_merged": self.patches_merged,
            "conflicts_detected": self.conflicts_detected,
            "unique_patterns": self.unique_patterns,
            "low_frequency_patches": self.low_frequency_patches,
            "metadata": self.metadata
        }


class HierarchicalMerge:
    def __init__(
        self,
        llm_client: Callable[[str], str],
        config: Optional[MergeConfig] = None,
    ):
        self.llm_client = llm_client
        self.config = config or MergeConfig()

    def merge(
        self,
        patch_pool: PatchPool,
        skill_content: str,
    ) -> MergeResult:
        patches = self._apply_guardrails(patch_pool.patches)

        if not patches:
            logger.warning("No patches to merge after guardrails")
            return MergeResult(
                final_patch=None,
                reasoning="No patches to merge",
            )

        logger.info(f"Starting hierarchical merge with {len(patches)} patches")

        current_patches = patches
        levels_completed = 0

        while len(current_patches) > 1 and levels_completed < self.config.max_levels:
            batch_size = self.config.batch_size
            next_patches = []

            for i in range(0, len(current_patches), batch_size):
                batch = current_patches[i:i + batch_size]
                if len(batch) == 1 and i + batch_size >= len(current_patches):
                    next_patches.extend(batch)
                    break

                merged = self._merge_batch(batch, skill_content)
                if merged:
                    next_patches.append(merged)

            current_patches = next_patches
            levels_completed += 1

            logger.info(
                f"Level {levels_completed}: {len(current_patches)} patches remaining"
            )

        if not current_patches:
            logger.warning("All patches eliminated during merging")
            return MergeResult(
                final_patch=None,
                reasoning="All patches eliminated",
            )

        final_patch = current_patches[0]
        return MergeResult(
            final_patch=final_patch,
            reasoning=final_patch.reasoning,
            levels_completed=levels_completed,
            patches_merged=len(patches),
        )

    def _apply_guardrails(self, patches: list[SkillPatch]) -> list[SkillPatch]:
        valid_patches = []
        conflicts = []

        for patch in patches:
            is_valid = True

            if self.config.check_file_existence and self.config.skill_root:
                for edit in patch.edits:
                    file_path = self.config.skill_root / edit.file
                    if str(edit.file).startswith("references/"):
                        continue
                    if not file_path.exists() and not edit.file.startswith("references/"):
                        logger.warning(
                            f"Patch {patch.patch_id} references non-existent file: {edit.file}"
                        )
                        is_valid = False

            if self.config.check_conflicts:
                for i, other in enumerate(patches):
                    if other.patch_id == patch.patch_id:
                        continue
                    if self._has_conflict(patch, other):
                        conflicts.append(f"{patch.patch_id} <-> {other.patch_id}")

            if is_valid:
                valid_patches.append(patch)

        logger.info(
            f"Guardrails: {len(patches)} -> {len(valid_patches)} patches, "
            f"{len(conflicts)} conflicts detected"
        )

        return valid_patches

    def _has_conflict(self, patch_a: SkillPatch, patch_b: SkillPatch) -> bool:
        for edit_a in patch_a.edits:
            for edit_b in patch_b.edits:
                if edit_a.file != edit_b.file:
                    continue
                if edit_a.target_start_line and edit_a.target_end_line:
                    if edit_b.target_start_line and edit_b.target_end_line:
                        if (
                            edit_a.target_start_line <= edit_b.target_end_line
                            and edit_a.target_end_line >= edit_b.target_start_line
                        ):
                            return True
        return False

    def _merge_batch(
        self,
        patches: list[SkillPatch],
        skill_content: str,
    ) -> Optional[SkillPatch]:
        patch_summaries = []
        for patch in patches:
            summary = f"### Patch {patch.patch_id}"
            if patch.source_trajectory_id:
                summary += f" (from {patch.source_trajectory_id})"
            summary += f"\n{patch.reasoning}\n"
            if patch.edits:
                summary += "\nEdits:\n"
                for edit in patch.edits:
                    summary += f"- {edit.operation.value} {edit.file}"
                    if edit.target:
                        summary += f" @ {edit.target}"
                    summary += "\n"
            patch_summaries.append(summary)

        prompt = "\n\n".join([
            "## System",
            MERGE_OPERATOR_SYSTEM_PROMPT,
            "",
            "## Skill Content",
            skill_content[:5000],
            "",
            f"## Patches to Merge ({len(patches)} patches)",
            "\n\n".join(patch_summaries),
            "",
            "## Instructions",
            "Merge these patches into a single coherent patch following the guidelines. "
            "Output the merged patch in diff format.",
        ])

        response = self.llm_client(prompt)

        return self._parse_merged_patch(response, len(patches))

    def _parse_merged_patch(
        self,
        response: str,
        source_count: int,
    ) -> Optional[SkillPatch]:
        edits = []
        reasoning_parts = []
        in_patch_section = False
        current_file = "SKILL.md"
        current_content_lines = []

        for line in response.split("\n"):
            line_lower = line.lower().strip()
            if any(line_lower.startswith(indicator) for indicator in ["patch:", "merged patch:", "final patch:"]):
                in_patch_section = True
                continue
            if in_patch_section:
                current_content_lines.append(line)
            else:
                if line.strip() and not line.startswith("#"):
                    reasoning_parts.append(line)

        if current_content_lines:
            edits = self._parse_edits_from_diff("\n".join(current_content_lines))

        if not edits and current_content_lines:
            edits.append(PatchEdit(
                file="SKILL.md",
                operation=PatchOperation.INSERT,
                content="\n".join(current_content_lines),
            ))

        return SkillPatch(
            patch_id=str(uuid.uuid4())[:8],
            is_from_error=False,
            reasoning="\n".join(reasoning_parts).strip(),
            edits=edits,
            metadata={"source_count": source_count},
        )

    def _parse_edits_from_diff(self, diff_content: str) -> list[PatchEdit]:
        edits = []
        lines = diff_content.split("\n")
        current_file = None
        current_op = None
        current_content = []

        for line in lines:
            if line.startswith("---"):
                current_file = line[3:].strip().lstrip("abc/")
            elif line.startswith("+++"):
                continue
            elif line.startswith("@@"):
                current_content = []
            elif line.startswith("+") and not line.startswith("+++"):
                current_content.append(line[1:])
            elif line.startswith("-") and not line.startswith("---"):
                pass
            elif current_file and current_content:
                edits.append(PatchEdit(
                    file=current_file,
                    operation=PatchOperation.INSERT,
                    content="\n".join(current_content),
                ))
                current_content = []

        if current_file and current_content:
            edits.append(PatchEdit(
                file=current_file,
                operation=PatchOperation.INSERT,
                content="\n".join(current_content),
            ))

        return edits


class PrevalenceAnalyzer:
    def __init__(self):
        self.pattern_threshold = 2

    def analyze(self, patches: list[SkillPatch]) -> dict[str, Any]:
        pattern_counts: dict[str, int] = {}
        file_edits: dict[str, list[str]] = {}

        for patch in patches:
            for edit in patch.edits:
                key = f"{edit.file}:{edit.operation.value}"
                pattern_counts[key] = pattern_counts.get(key, 0) + 1

                if edit.file not in file_edits:
                    file_edits[edit.file] = []
                file_edits[edit.file].append(edit.operation.value)

        prevalent_patterns = [
            pattern for pattern, count in pattern_counts.items()
            if count >= self.pattern_threshold
        ]

        return {
            "pattern_counts": pattern_counts,
            "file_edits": file_edits,
            "prevalent_patterns": prevalent_patterns,
            "total_patterns": len(pattern_counts),
        }