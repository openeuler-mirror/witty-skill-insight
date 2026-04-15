"""
Success Analyst (A+) for Trace2Skill Stage 2.

Based on arXiv:2603.25158v3 - Section B.2.2

Single-pass pattern extraction for successful trajectories.
Identifies generalizable behavior patterns that contributed to the correct answer.
"""

import logging
import json
import uuid
from dataclasses import dataclass
from typing import Callable, Optional, List

from trace2skill.patch import PatchEdit, SkillPatch
from trace2skill.trajectory import Trajectory, TrajectoryStatus

logger = logging.getLogger(__name__)


SUCCESS_ANALYST_SYSTEM_PROMPT = """You are an expert in success pattern analysis for AI agent systems.

Mission: Given a successful agent trajectory, identify generalizable behavior patterns that contributed to the correct answer.

Requirements:
- Broad Coverage — every effective behavior in the trajectory must be captured by a pattern.
- Frequency Awareness — patterns covering more instances should be listed first; rare behaviors should be absorbed into the nearest broader pattern.
- Generalization — each pattern must describe a general mechanism, not a single task-specific detail.

Follow Anthropic's recommendation for skill writing style: conciseness, actionability, and hierarchical disclosure."""


OUTPUT_FORMAT_PROMPT = """Output Format:
You MUST output your analysis in the following JSON format. Do not include any additional text outside of this JSON object:
{
    "reasoning": "string explaining your success pattern analysis",
    "edits": [
        {
        "file": "path/to/file.md",
        "operation": "insert|replace|delete",
        "target": "optional string to search for in the file",
        "target_start_line": optional integer start line (1-indexed),
        "target_end_line": optional integer end line (1-indexed, inclusive),
        "content": "optional string content to insert or replace with"
        }
    ],
    "success_memory_items": [
        {
            "title": "pattern title",
            "description": "pattern description"
        }
    ]
}
If no patch is needed, set "edits": [] and "success_memory_items": []."""


@dataclass
class SuccessResponseModel:
    reasoning: str
    edits: List[PatchEdit]
    success_memory_items: List[dict]

    @staticmethod
    def from_json(json_str: str) -> "SuccessResponseModel":
        # Strip markdown code fences if present
        cleaned_str = json_str.strip()
        if cleaned_str.startswith("```json"):
            cleaned_str = cleaned_str[7:]  # Remove ```json
        if cleaned_str.endswith("```"):
            cleaned_str = cleaned_str[:-3]  # Remove ```
        cleaned_str = cleaned_str.strip()
        
        data = json.loads(cleaned_str)
        
        # Convert edits to PatchEdit objects
        edits = []
        for edit_data in data.get("edits", []):
            edit = PatchEdit(
                file=edit_data.get("file", "SKILL.md"),
                operation=edit_data.get("operation", "insert"),
                target=edit_data.get("target"),
                target_start_line=edit_data.get("target_start_line"),
                target_end_line=edit_data.get("target_end_line"),
                content=edit_data.get("content"),
                reasoning=edit_data.get("reasoning", "")
            )
            edits.append(edit)
        
        # Convert success_memory_items
        success_memory_items = []
        for item_data in data.get("success_memory_items", []):
            item = {
                "title": item_data.get("title", ""),
                "description": item_data.get("description", "")
            }
            success_memory_items.append(item)
        
        return SuccessResponseModel(
            reasoning=data.get("reasoning", ""),
            edits=edits,
            success_memory_items=success_memory_items
        )


class SuccessAnalyst:
    def __init__(self, llm_client: Callable[[str], str]):
        self.llm_client = llm_client

    def analyze(
        self,
        trajectory: Trajectory,
        skill_content: str,
    ) -> "SuccessAnalysisResult":
        if trajectory.status != TrajectoryStatus.SUCCESS:
            logger.warning(
                f"Trajectory {trajectory.task_id} is not a success, skipping success analysis"
            )
            return SuccessAnalysisResult()

        logger.info(f"Analyzing success pattern for trajectory {trajectory.task_id}")

        system_prompt = SUCCESS_ANALYST_SYSTEM_PROMPT
        trajectory_context = trajectory.format_for_analyst()

        skill_context = f"## Current Skill\n{skill_content}"

        prompt = "\n\n".join([
            "## System",
            system_prompt,
            "",
            "## Task Query",
            trajectory.query,
            "",
            "## Successful Execution Trace",
            trajectory_context,
            "",
            "## Current Skill (reference)",
            skill_context,
            "",
            OUTPUT_FORMAT_PROMPT
        ])

        response = self.llm_client(prompt)
        return self._create_analysis_result(response, trajectory)

    def _create_analysis_result(
        self, 
        response_str: str, 
        trajectory: Trajectory
    ) -> "SuccessAnalysisResult":
        response_model = SuccessResponseModel.from_json(response_str)
        
        patch = None
        if response_model.edits:
            patch = SkillPatch(
                patch_id=str(uuid.uuid4())[:8],
                source_trajectory_id=trajectory.task_id,
                is_from_error=False,
                reasoning=response_model.reasoning,
                edits=response_model.edits,
            )

        return SuccessAnalysisResult(
            patch=patch,
            success_memory_items=response_model.success_memory_items,
            reasoning=response_model.reasoning
        )


@dataclass
class SuccessAnalysisResult:
    patch: Optional[SkillPatch] = None
    success_memory_items: List[dict] = None
    reasoning: str = ""

    def __post_init__(self):
        if self.success_memory_items is None:
            self.success_memory_items = []


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
        with concurrent.futures.ThreadPoolExecutor(
            max_workers=self.max_concurrent
        ) as executor:
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