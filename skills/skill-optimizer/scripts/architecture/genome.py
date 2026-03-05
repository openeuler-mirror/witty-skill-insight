from dataclasses import dataclass, field
from typing import Dict, List, Optional
import json


@dataclass
class SkillGenome:
    """
    The 5-Dimensional Genome of an Agent Skill.
    Decouples the SKILL.md into 5 distinct evolvable components.
    """

    name: str = ""  # Skill Name (from YAML frontmatter or filename)
    role: str = ""  # Dimension 1: Role Definition & Vibe
    structure: str = ""  # Dimension 2: Output Format / Schema
    instruction: str = ""  # Dimension 3: Core Logic / CoT Strategy
    content: str = ""  # Dimension 4: Knowledge / Terminology
    risk: str = ""  # Dimension 5: Safety Guardrails

    # Store original full text for reference or fallback
    raw_text: Optional[str] = None

    # Store auxiliary files (scripts, references, etc.)
    # Path (relative to skill root) -> Content
    files: Dict[str, str] = field(default_factory=dict)

    # Store mutation history/changelog
    # List of Dict: {"diagnosis_id": int, "action": str, "reason": str}
    changelog: List[Dict[str, str]] = field(default_factory=list)

    def to_markdown(self) -> str:
        """
        Reassemble the genome into a valid SKILL.md string.
        If raw_text is available (modified by Mutator), prefer it to preserve structure.
        """
        if self.raw_text and self.raw_text.strip():
            # If we have the raw text, return it directly.
            # This ensures we don't lose sections that failed to parse into specific fields.
            return self.raw_text

        sections = []
        # Add Frontmatter if name is present
        if self.name:
            sections.append(
                f"---\nname: {self.name}\ndescription: Auto-generated skill\n---"
            )

        if self.role:
            sections.append(
                self.role
                if self.role.strip().startswith("#")
                else f"# Role\n{self.role}"
            )
        if self.structure:
            sections.append(
                self.structure
                if self.structure.strip().startswith("#")
                else f"# Structure\n{self.structure}"
            )
        if self.instruction:
            sections.append(
                self.instruction
                if self.instruction.strip().startswith("#")
                else f"# Instruction\n{self.instruction}"
            )
        if self.content:
            sections.append(
                self.content
                if self.content.strip().startswith("#")
                else f"# Content\n{self.content}"
            )
        if self.risk:
            sections.append(
                self.risk
                if self.risk.strip().startswith("#")
                else f"# Risk\n{self.risk}"
            )

        return "\n\n".join(sections)

    @classmethod
    def from_markdown(cls, text: str) -> "SkillGenome":
        """
        Parse an existing SKILL.md into 5 components using regex.
        """
        import re
        import yaml

        genome = cls(raw_text=text)

        # 0. Extract Name from Frontmatter
        frontmatter_match = re.match(r"^---\n(.*?)\n---", text, re.DOTALL)
        if frontmatter_match:
            try:
                fm_data = yaml.safe_load(frontmatter_match.group(1))
                if fm_data and "name" in fm_data:
                    genome.name = fm_data["name"]
            except yaml.YAMLError:
                pass

        # Define regex patterns for standard headers
        # We assume standard headers: # Role, # Structure, # Instruction, # Content, # Risk
        # Case insensitive

        # Split by headers that start with #
        # This regex looks for a line starting with # followed by the section name
        # and captures everything until the next # Header or end of string

        def extract_section(header_name: str, content: str) -> str:
            pattern = re.compile(
                f"^{header_name}(.*?)(?=^# |\\Z)",
                re.MULTILINE | re.DOTALL | re.IGNORECASE,
            )
            match = pattern.search(content)
            if match:
                return f"{header_name}{match.group(1)}".strip()
            return ""

        # Extract specific known sections
        # We map generic headers to our 5 dimensions

        # 1. Role (Role, Profile, Character)
        genome.role = extract_section("# Role", text) or extract_section(
            "# Profile", text
        )

        # 2. Structure (Structure, Format, Output)
        genome.structure = (
            extract_section("# Structure", text)
            or extract_section("# Format", text)
            or extract_section("# Output", text)
        )

        # 3. Instruction (Instruction, Rules, Workflow, Steps)
        genome.instruction = (
            extract_section("# Instruction", text)
            or extract_section("# Rules", text)
            or extract_section("# Workflow", text)
        )

        # 4. Content (Content, Knowledge, Context, Examples)
        genome.content = (
            extract_section("# Content", text)
            or extract_section("# Knowledge", text)
            or extract_section("# Context", text)
        )

        # 5. Risk (Risk, Safety, Constraints, Limitations)
        genome.risk = (
            extract_section("# Risk", text)
            or extract_section("# Safety", text)
            or extract_section("# Constraints", text)
        )

        # Fallback: If parsing failed to find anything (e.g. no standard headers),
        # put everything in instruction to be safe, but try to be smart.
        if not any(
            [
                genome.role,
                genome.structure,
                genome.instruction,
                genome.content,
                genome.risk,
            ]
        ):
            genome.instruction = text

        return genome

    @classmethod
    def from_directory(cls, path: str) -> "SkillGenome":
        """
        Load skill from a directory, including auxiliary files.
        """
        from pathlib import Path

        path = Path(path)
        skill_file = path / "SKILL.md"

        if not skill_file.exists():
            raise FileNotFoundError(f"No SKILL.md found in {path}")

        with open(skill_file, "r", encoding="utf-8") as f:
            content = f.read()

        genome = cls.from_markdown(content)

        # Load auxiliary files (scripts/, references/)
        for item in path.rglob("*"):
            if (
                item.is_file()
                and item.name != "SKILL.md"
                and "__pycache__" not in item.parts
                and not item.name.startswith(".")
            ):
                try:
                    rel_path = str(item.relative_to(path))
                    with open(item, "r", encoding="utf-8", errors="ignore") as f:
                        file_content = f.read()
                        genome.files[rel_path] = file_content
                except Exception as e:
                    print(f"Warning: Could not read {item}: {e}")

        return genome

    def hash(self) -> str:
        """Unique hash for this genome variant."""
        import hashlib

        return hashlib.md5(self.to_markdown().encode()).hexdigest()
