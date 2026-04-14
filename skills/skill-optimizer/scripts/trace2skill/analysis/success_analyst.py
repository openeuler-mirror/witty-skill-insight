"""
Success Analyst (A+) for Trace2Skill Stage 2.

Based on arXiv:2603.25158v3 - Section B.2.2

Single-pass pattern extraction for successful trajectories.
Identifies generalizable behavior patterns that contributed to the correct answer.
"""

import logging
import uuid
import json
import re
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

Output Format:
You MUST output your analysis in the following JSON format. Do not include any additional text outside of this JSON object:
{
  "reasoning": "string explaining your success pattern analysis",
  "patch": {
    "patch_id": "unique identifier for this patch (e.g., 'success_patch_001')",
    "source_trajectory_id": "ID of the trajectory this patch is derived from",
    "is_from_error": false,
    "edits": [
      {
        "file": "path/to/file.md",
        "operation": "insert|insert_after|insert_before|replace|replace_range|delete|create",
        "target": "optional string to search for in the file",
        "target_start_line": optional integer start line (1-indexed),
        "target_end_line": optional integer end line (1-indexed, inclusive),
        "content": "optional string content to insert or replace with"
      }
    ],
    "reasoning": "string explaining why this patch captures the success pattern",
    "metadata": {}
  }
}

If no patch is needed, set "patch": null.

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
        # Extract JSON from the response
        import json
        import re
        
        # Try to find JSON in the response
        json_match = re.search(r'\{[\s\S]*\}', response)
        if not json_match:
            # Fallback to old method if no JSON found
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
        
        try:
            json_str = json_match.group(0)
            data = json.loads(json_str)
            
            reasoning = data.get("reasoning", "")
            patch_data = data.get("patch")
            
            # Process success items from reasoning (keeping old method for compatibility)
            success_items = []
            for line in reasoning.split("\n"):
                if line.startswith("**Pattern") or line.startswith("### "):
                    parts = line.split(":", 1)
                    if len(parts) == 2:
                        success_items.append({
                            "title": parts[1].strip(),
                            "description": "",
                        })
            
            edits = []
            if patch_data is not None:
                # Convert patch data to the expected format for _parse_patch_content
                patch_lines = []
                if isinstance(patch_data, dict):
                    # Handle single patch
                    patch_lines.append("---")
                    patch_lines.append("+++")
                    for key, value in patch_data.items():
                        if key == "edits" and isinstance(value, list):
                            for edit in value:
                                if isinstance(edit, dict):
                                    patch_lines.append(f"file: {edit.get('file', 'SKILL.md')}")
                                    patch_lines.append(f"op: {edit.get('operation', 'insert')}")
                                    if edit.get('target'):
                                        patch_lines.append(f"target: {edit['target']}")
                                    if edit.get('target_start_line') is not None:
                                        patch_lines.append(f"target_start_line: {edit['target_start_line']}")
                                    if edit.get('target_end_line') is not None:
                                        patch_lines.append(f"target_end_line: {edit['target_end_line']}")
                                    if edit.get('content'):
                                        patch_lines.append(f"content: {edit['content']}")
                        elif key not in ["patch_id", "source_trajectory_id", "is_from_error", "reasoning", "metadata"]:
                            patch_lines.append(f"{key}: {value}")
                else:
                    patch_lines.append(str(patch_data))
                    
                edits = self._parse_patch_content("\n".join(patch_lines))
            else:
                edits = []

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
        except (json.JSONDecodeError, Exception) as e:
            logger.warning(f"Failed to parse JSON from response: {e}. Falling back to old method.")
            # Fallback to old method
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