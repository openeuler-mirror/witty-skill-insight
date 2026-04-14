"""
Error Analyst (A-) for Trace2Skill Stage 2.

Based on arXiv:2603.25158v3 - Section B.2.1

Multi-turn ReAct-style agentic analysis for failure trajectories.
Each analyst takes a frozen copy of skill S0 and one trajectory, outputs a skill patch.
"""

import logging
import uuid
import json
import pydantic
from pydantic import BaseModel
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

Follow Anthropic's recommendation for skill writing style: conciseness, actionability, and hierarchical disclosure.
"""

OUTPUT_FORMAT_PROMPT = """Output Format:
You MUST output your analysis in the following JSON format. Do not include any additional text outside of this JSON object:
{
  "patch": {
    "edits": [
      {
        "operation": "insert|replace|delete",
        "target": "optional string to search for in the file",
        "target_start_line": optional integer start line (1-indexed),
        "target_end_line": optional integer end line (1-indexed, inclusive),
        "content": "optional string content to insert or replace with",
        "reasoning": "string explaining why this patch addresses the failure",
      }
    ], 
  },
  "root_cause_identified": "true if a root cause was identified, false otherwise",
  "root_cause": "trace failure root cause" 
}
If no patch is needed, set "patch": null.
"""

@dataclass
class AnalystTurn:
    turn_number: int
    observation: str
    is_final: bool = False


@dataclass
class AnalysisResult:
    patch: Optional[SkillPatch] = None
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

        turns: list[AnalystTurn] = []
        current_observation = ""
        turn_count = 0

        logger.info(f"Starting error analysis for trajectory {trajectory.task_id}")

        while turn_count < self.max_turns:  
            turn_count += 1

            logger.info(f"Trajectory: {trajectory.task_id}, Turn # {turn_count}")

            prompt_parts = [
                f"## System\n {system_prompt}\n",
                f"## Current Skill\n{skill_content}",
                f"## Task Query\n{trajectory.query}\n",
                f"## Agent Execution Trace\n{trajectory_context}",
                f"{OUTPUT_FORMAT_PROMPT}"
            ]

            if ground_truth_dir and trajectory.ground_truth:
                gt_file = ground_truth_dir / f"{trajectory.task_id}.txt"
                if gt_file.exists():
                    prompt_parts.extend([
                        f"## Ground Truth\n{gt_file.read_text(encoding='utf-8')}\n"
                    ])

            if current_observation:
                prompt_parts.extend([
                    f"## Previous Analysis Attempt {turn_count - 1}",
                    current_observation,
                ])

            prompt_parts.extend([
                "## Instructions",
                "Continue your analysis. If you have identified the root cause and can propose a valid fix, output your final patch. Otherwise, describe your next analysis steps.",
            ])

            prompt = "\n\n".join(prompt_parts)
            response_str = self.llm_client(prompt)

            response_dict = self._parse_one_turn_response(response_str=response_str)

            turns.append(AnalystTurn(
                turn_number=turn_count,
                observation=response_str,
            ))
            current_observation = response_str

            if self._is_final_response(response_str):
                logger.info(f"Error analysis completed in {turn_count} turns")
                return self._parse_final_response(
                    response_str, trajectory, turns, validated=True
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
        # Extract JSON from the response
        import json
        import re
        
        # Try to find JSON in the response
        json_match = re.search(r'\{[\s\S]*\}', response)
        if not json_match:
            # Fallback to old method if no JSON found
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
        
        try:
            json_str = json_match.group(0)
            data = json.loads(json_str)
            
            reasoning = data.get("reasoning", "")
            patch_data = data.get("patch")
            
            if patch_data is None:
                return reasoning, ""
            
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
                
            return reasoning, "\n".join(patch_lines)
        except (json.JSONDecodeError, Exception) as e:
            logger.warning(f"Failed to parse JSON from response: {e}. Falling back to old method.")
            # Fallback to old method
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
        
    import json

    def _parse_one_turn_response(self, response_str: str):
        """
        Parses a string into the specified patch schema.
        
        Args:
            patch_str (str): A string representing the patch data.
            
        Returns:
            dict: A dictionary representing the patch schema.
        """
        # Parse the input string into a dictionary
        patch_dict = json.loads(response_str)
        
        # Validate and structure the output according to the schema
        result = {
            "patch": {
                "edits": [],
            },
            "root_cause_identified": False,
            "root_cause": ""
        }
        
        # Process each edit in the input
        for edit in patch_dict['patch'].get("edits", []):
            edit_dict = {
                "operation": edit.get("operation", ""),
                "target": edit.get("target", ""),
                "target_start_line": edit.get("target_start_line", None),
                "target_end_line": edit.get("target_end_line", None),
                "content": edit.get("content", ""),
                "reasoning": edit.get("reasoning", "")
            }
            result["patch"]["edits"].append(edit_dict)
        
        # Set the root_cause_identified flag
        result["root_cause_identified"] = patch_dict.get("root_cause_identified", False)
        
        # Set the root_cause
        result["root_cause"] = patch_dict.get("root_cause", "")
        
        return result

    def _parse_patch_content(self, content: str) -> list[PatchEdit]:
        # Handle empty content
        if not content.strip():
            return []

        # Try to parse as JSON first
        import json
        import re
        
        # Look for JSON array or object in the content
        json_match = re.search(r'\[[\s\S]*\]|\{[\s\S]*\}', content)
        if json_match:
            try:
                json_str = json_match.group(0)
                data = json.loads(json_str)
                
                edits = []
                # Handle both array of edits and single edit object
                if isinstance(data, list):
                    edit_list = data
                elif isinstance(data, dict) and "edits" in data:
                    edit_list = data["edits"]
                else:
                    edit_list = [data] if isinstance(data, dict) else []
                
                for edit_data in edit_list:
                    if not isinstance(edit_data, dict):
                        continue
                        
                    # Map operation string to PatchOperation enum
                    op_str = edit_data.get("operation", "insert").lower()
                    try:
                        operation = PatchOperation(op_str)
                    except ValueError:
                        # Default to INSERT if invalid operation
                        operation = PatchOperation.INSERT
                    
                    edit = PatchEdit(
                        file=edit_data.get("file", "SKILL.md"),
                        operation=operation,
                        target=edit_data.get("target"),
                        target_start_line=edit_data.get("target_start_line"),
                        target_end_line=edit_data.get("target_end_line"),
                        content=edit_data.get("content")
                    )
                    edits.append(edit)
                
                return edits
            except (json.JSONDecodeError, Exception) as e:
                logger.warning(f"Failed to parse JSON patch content: {e}. Falling back to old method.")
                # Fall through to old method below
        
        # Fallback to original parsing method
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