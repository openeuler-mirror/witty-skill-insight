"""
Skill patch data structures for Trace2Skill.
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Optional


class PatchOperation(Enum):
    INSERT = "insert"
    INSERT_AFTER = "insert_after"
    INSERT_BEFORE = "insert_before"
    REPLACE = "replace"
    REPLACE_RANGE = "replace_range"
    DELETE = "delete"
    CREATE = "create"


@dataclass
class PatchEdit:
    file: str
    operation: PatchOperation
    target: Optional[str] = None
    target_start_line: Optional[int] = None
    target_end_line: Optional[int] = None
    content: Optional[str] = None

    def to_dict(self) -> dict:
        result = {
            "file": self.file,
            "op": self.operation.value,
        }
        if self.target:
            result["target"] = self.target
        if self.target_start_line is not None:
            result["target_start_line"] = self.target_start_line
        if self.target_end_line is not None:
            result["target_end_line"] = self.target_end_line
        if self.content:
            result["content"] = self.content
        return result

    @classmethod
    def from_dict(cls, data: dict) -> "PatchEdit":
        return cls(
            file=data["file"],
            operation=PatchOperation(data["op"]),
            target=data.get("target"),
            target_start_line=data.get("target_start_line"),
            target_end_line=data.get("target_end_line"),
            content=data.get("content"),
        )

    def to_unified_diff(self, old_prefix: str = "a/", new_prefix: str = "b/") -> str:
        lines = []
        if self.operation == PatchOperation.INSERT:
            lines.append(f"--- {old_prefix}{self.file}")
            lines.append(f"+++ {new_prefix}{self.file}")
            if self.target:
                lines.append(f"@@ -0,0 +1,{len(self.content.splitlines())} @@")
            lines.append(self.content or "")
        elif self.operation == PatchOperation.INSERT_AFTER:
            lines.append(f"--- {old_prefix}{self.file}")
            lines.append(f"+++ {new_prefix}{self.file}")
            lines.append(f"@@ +{self.target_start_line or 1},{len((self.content or '').splitlines())} @@")
            lines.append(self.content or "")
        elif self.operation == PatchOperation.REPLACE:
            lines.append(f"--- {old_prefix}{self.file}")
            lines.append(f"+++ {new_prefix}{self.file}")
            lines.append(f"@@ -{self.target_start_line or 1},{self.target_end_line or 1} +{self.target_start_line or 1},{len((self.content or '').splitlines())} @@")
            lines.append(self.content or "")
        return "\n".join(lines)


@dataclass
class SkillPatch:
    patch_id: str
    source_trajectory_id: Optional[str] = None
    is_from_error: bool = False
    edits: list[PatchEdit] = field(default_factory=list)
    reasoning: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "patch_id": self.patch_id,
            "source_trajectory_id": self.source_trajectory_id,
            "is_from_error": self.is_from_error,
            "edits": [e.to_dict() for e in self.edits],
            "reasoning": self.reasoning,
            "metadata": self.metadata,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "SkillPatch":
        return cls(
            patch_id=data["patch_id"],
            source_trajectory_id=data.get("source_trajectory_id"),
            is_from_error=data.get("is_from_error", False),
            edits=[PatchEdit.from_dict(e) for e in data.get("edits", [])],
            reasoning=data.get("reasoning", ""),
            metadata=data.get("metadata", {}),
        )

    def add_edit(self, edit: PatchEdit) -> None:
        self.edits.append(edit)

    def references_file(self, filepath: str) -> bool:
        return any(edit.file == filepath for edit in self.edits)

    def get_line_ranges(self, filepath: str) -> list[tuple[int, int]]:
        ranges = []
        for edit in self.edits:
            if edit.file == filepath and edit.target_start_line and edit.target_end_line:
                ranges.append((edit.target_start_line, edit.target_end_line))
        return ranges
    
    def save_to_file(self)->None:
        pass


@dataclass
class PatchPool:
    patches: list[SkillPatch] = field(default_factory=list)

    @property
    def error_patches(self) -> list[SkillPatch]:
        return [p for p in self.patches if p.is_from_error]

    @property
    def success_patches(self) -> list[SkillPatch]:
        return [p for p in self.patches if not p.is_from_error]

    @property
    def total_count(self) -> int:
        return len(self.patches)

    def add_patch(self, patch: SkillPatch) -> None:
        self.patches.append(patch)

    def to_dict(self) -> dict:
        return {
            "patches": [p.to_dict() for p in self.patches],
            "summary": {
                "total": self.total_count,
                "error": len(self.error_patches),
                "success": len(self.success_patches),
            },
        }

    @classmethod
    def from_dict(cls, data: dict) -> "PatchPool":
        return cls(
            patches=[SkillPatch.from_dict(p) for p in data.get("patches", [])]
        )