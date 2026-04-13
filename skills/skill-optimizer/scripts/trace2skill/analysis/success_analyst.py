"""
Success Analyst (A+) for Trace2Skill Stage 2.

Based on arXiv:2603.25158v3 - Section B.2.2

Single-pass pattern extraction for successful trajectories.
Identifies generalizable behavior patterns that contributed to the correct answer.
"""

import logging
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Optional

from trace2skill.patch import PatchEdit, PatchOperation, SkillPatch
from trace2skill.trajectory import Trajectory, TrajectoryStatus

logger = logging.getLogger(__name__)


SUCCESS_ANALYST_SYSTEM_PROMPT = """You are an expert in success pattern analysis for AI agent systems.

Mission: Given a successful agent trajectory, identify generalizable behavior patterns that contributed to the correct answer.

Requirements:
- Broad Coverage — every effective behavior in the trajectory must be captured by a pattern.
- Frequency Awareness — patterns covering more instances should be listed first; rare behaviors should be absorbed into the nearest broader pattern.
- Generalization — each pattern must describe a general mechanism, not a single task-specific detail.

Output: A compact set of Success Memory Items with title, description, and concrete examples of the effective behaviors observed.

Follow Anthropic's recommendation for skill writing style: conciseness, actionability, and hierarchical disclosure.
"""


@dataclass
class SuccessAnalysisResult:
    patch: Optional[SkillPatch] = None
    success_memory_items: list[dict[str, str]] = None
    reasoning: str = ""

    def __post_init__(self):
        if self.success_memory_items is None:
            self.success_memory_items = []


class SuccessAnalyst:
    def __init__(self, llm_client: Callable[[str], str]):
        self.llm_client = llm_client

    def analyze(
        self,
        trajectory: Trajectory,
        skill_content: str,
    ) -> SuccessAnalysisResult:
        if trajectory.status != TrajectoryStatus.SUCCESS:
            logger.warning(f"Trajectory {trajectory.task_id} is not a success, skipping success analysis")
            return SuccessAnalysisResult()

        logger.info(f"Analyzing success pattern for trajectory {trajectory.task_id}")

        system_prompt = SUCCESS_ANALYST_SYSTEM_PROMPT
        trajectory_context = trajectory.format_for_analyst()

        skill_context = f"## Current Skill\n{skill_content}"

        prompt = "\n\n".join([
            f"## System",
            system_prompt,
            f"",
            f"## Task Query",
            trajectory.query,
            f"",
            f"## Successful Execution Trace",
            trajectory_context,
            f"",
            f"## Current Skill (reference)",
            skill_context,
            f"",
            f"## Instructions",
            "Identify the generalizable behavior patterns that led to success. Output a skill patch if patterns can be extracted.",
        ])

        response = self.llm_client(prompt)

        return self._parse_response(response, trajectory)

    def _parse_response(
        self,
        response: str,
        trajectory: Trajectory,
    ) -> SuccessAnalysisResult:
        reasoning_parts = []
        success_items = []
        patch_content = ""
        in_patch_section = False

        for line in response.split("\n"):
            line_lower = line.lower().strip()
            if any(line_lower.startswith(indicator) for indicator in ["patch:", "success patch:", "proposed patch:"]):
                in_patch_section = True
                continue
            if in_patch_section:
                patch_content += line + "\n"
            elif line.startswith("### ") or line.startswith("## "):
                continue
            else:
                reasoning_parts.append(line)

        for line in response.split("\n"):
            if line.startswith("**Pattern") or line.startswith("### "):
                parts = line.split(":", 1)
                if len(parts) == 2:
                    success_items.append({
                        "title": parts[1].strip(),
                        "description": "",
                    })

        reasoning = "\n".join(reasoning_parts).strip()

        edits = self._parse_patch_content(patch_content) if patch_content.strip() else []

        patch = None
        if edits or success_items:
            patch = SkillPatch(
                patch_id=str(uuid.uuid4())[:8],
                source_trajectory_id=trajectory.task_id,
                is_from_error=False,
                reasoning=reasoning,
                edits=edits,
            )

        return SuccessAnalysisResult(
            patch=patch,
            success_memory_items=success_items,
            reasoning=reasoning,
        )

    def _parse_patch_content(self, content: str) -> list[PatchEdit]:
        if not content.strip():
            return []

        edits = []
        lines = content.split("\n")
        current_file = "SKILL.md"
        current_op = PatchOperation.INSERT
        current_target = None
        current_content_lines = []

        for line in lines:
            if line.startswith("===") or line.startswith("---") or line.startswith("+++"):
                if current_content_lines:
                    edits.append(PatchEdit(
                        file=current_file,
                        operation=current_op,
                        target=current_target,
                        content="\n".join(current_content_lines),
                    ))
                    current_content_lines = []
                if line.startswith("---"):
                    current_file = line[3:].strip().lstrip("abc/")
                elif line.startswith("+++"):
                    current_file = line[3:].strip().lstrip("abc/")
                continue
            current_content_lines.append(line)

        if current_content_lines:
            edits.append(PatchEdit(
                file=current_file,
                operation=current_op,
                target=current_target,
                content="\n".join(current_content_lines),
            ))

        return edits


class BatchSuccessAnalyst:
    def __init__(
        self,
        llm_client: Callable[[str], str],
        max_concurrent: int = 16,
    ):
        self.analyst = SuccessAnalyst(llm_client)
        self.max_concurrent = max_concurrent

    def analyze_batch(
        self,
        trajectories: list[Trajectory],
        skill_content: str,
    ) -> list[SuccessAnalysisResult]:
        import concurrent.futures

        success_trajectories = [
            t for t in trajectories if t.status == TrajectoryStatus.SUCCESS
        ]

        logger.info(f"Analyzing {len(success_trajectories)} success trajectories")

        results = []
        with concurrent.futures.ThreadPoolExecutor(max_workers=self.max_concurrent) as executor:
            futures = {
                executor.submit(
                    self.analyst.analyze,
                    t,
                    skill_content,
                ): t
                for t in success_trajectories
            }

            for future in concurrent.futures.as_completed(futures):
                trajectory = futures[future]
                try:
                    result = future.result()
                    results.append(result)
                except Exception as e:
                    logger.error(f"Error analyzing {trajectory.task_id}: {e}")
                    results.append(SuccessAnalysisResult())

        return results