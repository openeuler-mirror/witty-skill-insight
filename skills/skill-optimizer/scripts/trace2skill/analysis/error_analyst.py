"""
Error Analyst (A-) for Trace2Skill Stage 2.

Based on arXiv:2603.25158v3 - Section B.2.1

Multi-turn ReAct-style agentic analysis for failure trajectories.
Each analyst takes a frozen copy of skill S0 and one trajectory, outputs a skill patch.
"""

import logging
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Optional

from trace2skill.patch import PatchEdit, PatchOperation, SkillPatch
from trace2skill.trajectory import Trajectory, TrajectoryStatus

logger = logging.getLogger(__name__)


ERROR_ANALYST_SYSTEM_PROMPT = """You are an expert failure-analysis agent for AI agent systems.

Mission: Given an agent's execution artifacts (logs + produced files) and the ground-truth solution, diagnose why the agent failed, identify causal failure reasons, and validate your diagnosis by implementing a minimal fix that makes the agent output match the ground truth. Your analysis must be systematic, evidence-driven, and reproducible. Do not guess when you can verify.

Required Workflow (MANDATORY):
1. Understand the task and failure surface — identify exactly what is wrong in the output.
2. Trace the failure to agent behavior — locate the decision or code step that produced the mismatch.
3. Validate the root cause with a minimal fix — write fixed output and re-evaluate against the ground truth.
4. Re-evaluate — if still failing, return to steps 1–3 and revise your diagnosis.

Output: Produce (1) Failure Cause Items — systematic, causal reasons grounded in observable agent behavior; (2) Failure Memory Items (≤3) — generalizable insights the agent should remember to avoid similar failures.

Follow Anthropic's recommendation for skill writing style: conciseness, actionability, and hierarchical disclosure.
"""


@dataclass
class AnalystTurn:
    turn_number: int
    observation: str
    tool_calls: list[dict[str, Any]] = field(default_factory=list)
    is_final: bool = False


@dataclass
class AnalysisResult:
    patch: Optional[SkillPatch] = None
    failure_cause_items: list[str] = field(default_factory=list)
    failure_memory_items: list[str] = field(default_factory=list)
    reasoning: str = ""
    turn_count: int = 0
    validated: bool = False


class ErrorAnalyst:
    def __init__(
        self,
        llm_client: Callable[[str], str],
        max_turns: int = 3,
    ):
        self.llm_client = llm_client
        self.max_turns = max_turns

    def analyze(
        self,
        trajectory: Trajectory,
        skill_content: str,
        input_dir: Optional[Path] = None,
        output_dir: Optional[Path] = None,
        ground_truth_dir: Optional[Path] = None,
    ) -> AnalysisResult:
        if trajectory.status != TrajectoryStatus.FAILURE:
            logger.warning(f"Trajectory {trajectory.task_id} is not a failure, skipping error analysis")
            return AnalysisResult()

        system_prompt = ERROR_ANALYST_SYSTEM_PROMPT
        trajectory_context = trajectory.format_for_analyst()

        skill_context = f"## Current Skill (frozen copy)\n{skill_content}"

        turns: list[AnalystTurn] = []
        current_observation = ""
        turn_count = 0

        logger.info(f"Starting error analysis for trajectory {trajectory.task_id}")

        while turn_count < self.max_turns:
            turn_count += 1

            prompt_parts = [
                f"## System",
                system_prompt,
                f"",
                f"## Task Query",
                trajectory.query,
                f"",
                f"## Agent Execution Trace",
                trajectory_context,
                f"",
            ]

            if ground_truth_dir and trajectory.ground_truth:
                gt_file = ground_truth_dir / f"{trajectory.task_id}.txt"
                if gt_file.exists():
                    prompt_parts.extend([
                        f"## Ground Truth",
                        gt_file.read_text(encoding="utf-8"),
                    ])

            if current_observation:
                prompt_parts.extend([
                    f"",
                    f"## Previous Analysis Attempt {turn_count - 1}",
                    current_observation,
                ])

            prompt_parts.extend([
                f"",
                f"## Instructions",
                "Continue your analysis. If you have identified the root cause and can propose a valid fix, output your final patch. Otherwise, describe your next analysis steps.",
            ])

            prompt = "\n\n".join(prompt_parts)
            response = self.llm_client(prompt)

            turns.append(AnalystTurn(
                turn_number=turn_count,
                observation=response,
            ))
            current_observation = response

            if self._is_final_response(response):
                logger.info(f"Error analysis completed in {turn_count} turns")
                return self._parse_final_response(
                    response, trajectory, turns, validated=True
                )

        logger.warning(f"Error analysis exhausted {turn_count} turns without resolution")
        return self._parse_final_response(
            current_observation, trajectory, turns, validated=False
        )

    def _is_final_response(self, response: str) -> bool:
        response_lower = response.lower().strip()
        final_indicators = [
            "final patch:",
            "proposed patch:",
            "patch:",
            "root cause identified:",
        ]
        return any(response_lower.startswith(indicator) for indicator in final_indicators)

    def _parse_final_response(
        self,
        response: str,
        trajectory: Trajectory,
        turns: list[AnalystTurn],
        validated: bool,
    ) -> AnalysisResult:
        patch = None
        failure_cause_items = []
        failure_memory_items = []

        failure_reasoning, patch_content = self._extract_reasoning_and_patch(response)

        if patch_content:
            patch = SkillPatch(
                patch_id=str(uuid.uuid4())[:8],
                source_trajectory_id=trajectory.task_id,
                is_from_error=True,
                reasoning=failure_reasoning,
                edits=self._parse_patch_content(patch_content),
                metadata={
                    "turn_count": len(turns),
                    "validated": validated,
                },
            )

        return AnalysisResult(
            patch=patch,
            failure_cause_items=failure_cause_items,
            failure_memory_items=failure_memory_items,
            reasoning=failure_reasoning,
            turn_count=len(turns),
            validated=validated,
        )

    def _extract_reasoning_and_patch(self, response: str) -> tuple[str, str]:
        lines = response.split("\n")
        reasoning_parts = []
        patch_parts = []
        in_patch_section = False

        for line in lines:
            line_lower = line.lower().strip()
            if any(line_lower.startswith(indicator) for indicator in ["patch:", "final patch:", "proposed patch:"]):
                in_patch_section = True
                continue
            if in_patch_section:
                patch_parts.append(line)
            else:
                reasoning_parts.append(line)

        return (
            "\n".join(reasoning_parts).strip(),
            "\n".join(patch_parts).strip(),
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


class BatchErrorAnalyst:
    def __init__(
        self,
        llm_client: Callable[[str], str],
        max_concurrent: int = 8,
        max_turns: int = 3,
    ):
        self.analyst = ErrorAnalyst(llm_client, max_turns)
        self.max_concurrent = max_concurrent

    def analyze_batch(
        self,
        trajectories: list[Trajectory],
        skill_content: str,
        input_dir: Optional[Path] = None,
        output_dir: Optional[Path] = None,
        ground_truth_dir: Optional[Path] = None,
    ) -> list[AnalysisResult]:
        import concurrent.futures

        failure_trajectories = [
            t for t in trajectories if t.status == TrajectoryStatus.FAILURE
        ]

        logger.info(f"Analyzing {len(failure_trajectories)} failure trajectories")

        results = []
        with concurrent.futures.ThreadPoolExecutor(max_workers=self.max_concurrent) as executor:
            futures = {
                executor.submit(
                    self.analyst.analyze,
                    t,
                    skill_content,
                    input_dir,
                    output_dir,
                    ground_truth_dir,
                ): t
                for t in failure_trajectories
            }

            for future in concurrent.futures.as_completed(futures):
                trajectory = futures[future]
                try:
                    result = future.result()
                    results.append(result)
                except Exception as e:
                    logger.error(f"Error analyzing {trajectory.task_id}: {e}")
                    results.append(AnalysisResult())

        return results