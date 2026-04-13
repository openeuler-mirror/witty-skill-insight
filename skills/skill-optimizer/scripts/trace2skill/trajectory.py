"""
Trace data structures for Trace2Skill.
"""

import json
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Optional


class TrajectoryStatus(Enum):
    SUCCESS = "success"
    FAILURE = "failure"
    UNKNOWN = "unknown"


@dataclass
class TrajectoryStep:
    step_number: int
    reasoning: str
    tool_call: str
    observation: str

    def to_dict(self) -> dict:
        return {
            "step_number": self.step_number,
            "reasoning": self.reasoning,
            "tool_call": self.tool_call,
            "observation": self.observation,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "TrajectoryStep":
        return cls(
            step_number=data["step_number"],
            reasoning=data["reasoning"],
            tool_call=data["tool_call"],
            observation=data["observation"],
        )


@dataclass
class Trajectory:
    task_id: str
    query: str
    steps: list[TrajectoryStep] = field(default_factory=list)
    final_output: str = ""
    status: TrajectoryStatus = TrajectoryStatus.UNKNOWN
    ground_truth: Optional[str] = None
    input_files: list[Path] = field(default_factory=list)
    output_files: list[Path] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)

    @classmethod
    

    def to_dict(self) -> dict:
        return {
            "task_id": self.task_id,
            "query": self.query,
            "steps": [s.to_dict() for s in self.steps],
            "final_output": self.final_output,
            "status": self.status.value,
            "ground_truth": self.ground_truth,
            "input_files": [str(p) for p in self.input_files],
            "output_files": [str(p) for p in self.output_files],
            "metadata": self.metadata,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "Trajectory":
        # Convert interactions to steps if steps not provided
        steps = data.get("steps", [])
        if not steps and "interactions" in data:
            steps = []
            for i, interaction in enumerate(data["interactions"]):
                if interaction.get("role") == "assistant":
                    # Assistant messages with tool_calls are reasoning steps
                    reasoning = interaction.get("content", "")
                    tool_call = ""
                    observation = ""
                    if "tool_calls" in interaction and interaction["tool_calls"]:
                        # Extract tool call info
                        tool_call = str(interaction["tool_calls"][0]) if interaction["tool_calls"] else ""
                    steps.append(TrajectoryStep(
                        step_number=len(steps) + 1,
                        reasoning=reasoning,
                        tool_call=tool_call,
                        observation=observation
                    ))
                elif interaction.get("role") == "tool":
                    # Tool messages are observations
                    if steps:
                        # Update the last step with observation from tool
                        steps[-1] = TrajectoryStep(
                            step_number=steps[-1].step_number,
                            reasoning=steps[-1].reasoning,
                            tool_call=steps[-1].tool_call,
                            observation=interaction.get("content", "")
                        )
                    else:
                        # Orphan tool observation, create a step for it
                        steps.append(TrajectoryStep(
                            step_number=len(steps) + 1,
                            reasoning="",
                            tool_call="",
                            observation=interaction.get("content", "")
                        ))
        
        return cls(
            task_id=data["task_id"],
            query=data["query"],
            steps=steps,
            final_output=data.get("final_output", ""),
            status=TrajectoryStatus(data.get("status", "unknown")),
            ground_truth=data.get("ground_truth"),
            input_files=[Path(p) for p in data.get("input_files", [])],
            output_files=[Path(p) for p in data.get("output_files", [])],
            metadata=data.get("metadata", {}),
        )

    def is_success(self) -> bool:
        return self.status == TrajectoryStatus.SUCCESS

    def is_failure(self) -> bool:
        return self.status == TrajectoryStatus.FAILURE

    def format_for_analyst(self) -> str:
        lines = [
            f"## Task: {self.task_id}",
            f"### Query",
            self.query,
            f"### Execution Trace ({len(self.steps)} steps)",
        ]
        for step in self.steps:
            lines.extend([
                f"#### Step {step.step_number} ({step.tool_call})",
                f"**Reasoning:** {step.reasoning[:300] if step.reasoning else '(none)'}",
                f"**Observation:** {step.observation[:500] if step.observation else '(none)'}",
            ])
        lines.extend([
            f"### Final Output",
            self.final_output[:1000] if self.final_output else "(empty)",
        ])
        if self.metadata.get("framework"):
            lines.append(f"### Framework: {self.metadata['framework']}")
        if self.ground_truth:
            lines.extend([
                f"### Ground Truth",
                self.ground_truth,
            ])
        return "\n\n".join(lines)


@dataclass
class TrajectorySet:
    trajectories: list[Trajectory] = field(default_factory=list)
    source_skill: Optional[str] = None
    metadata: dict[str, Any] = field(default_factory=dict)

    @property
    def success_set(self) -> "TrajectorySet":
        return TrajectorySet(
            trajectories=[t for t in self.trajectories if t.is_success()],
            source_skill=self.source_skill,
        )

    @property
    def failure_set(self) -> "TrajectorySet":
        return TrajectorySet(
            trajectories=[t for t in self.trajectories if t.is_failure()],
            source_skill=self.source_skill,
        )

    @property
    def success_count(self) -> int:
        return len([t for t in self.trajectories if t.is_success()])

    @property
    def failure_count(self) -> int:
        return len([t for t in self.trajectories if t.is_failure()])

    @property
    def total_count(self) -> int:
        return len(self.trajectories)

    @property
    def success_rate(self) -> float:
        if self.total_count == 0:
            return 0.0
        return self.success_count / self.total_count

    def to_dict(self) -> dict:
        return {
            "trajectories": [t.to_dict() for t in self.trajectories],
            "source_skill": self.source_skill,
            "metadata": self.metadata,
            "summary": {
                "total": self.total_count,
                "success": self.success_count,
                "failure": self.failure_count,
                "success_rate": self.success_rate,
            },
        }

    @classmethod
    def from_dict(cls, data: dict) -> "TrajectorySet":
        return cls(
            trajectories=[Trajectory.from_dict(t) for t in data.get("trajectories", [])],
            source_skill=data.get("source_skill"),
            metadata=data.get("metadata", {}),
        )

    @classmethod
    def load_from_directory(cls, trajectory_dir: Path) -> "TrajectorySet":
        trajectories = []
        for json_file in sorted(trajectory_dir.glob("*.json")):
            with open(json_file, encoding="utf-8") as f:
                data = json.load(f)
                trajectories.append(Trajectory.from_dict(data))

        return cls(trajectories=trajectories)

    

    def save_to_directory(self, trajectory_dir: Path) -> None:
        import json

        trajectory_dir.mkdir(parents=True, exist_ok=True)
        for trajectory in self.trajectories:
            output_file = trajectory_dir / f"{trajectory.task_id}.json"
            with open(output_file, "w", encoding="utf-8") as f:
                json.dump(trajectory.to_dict(), f, ensure_ascii=False, indent=2)