import os
from pathlib import Path
from typing import Optional


class CliArgsError(ValueError):
    pass


def resolve_human_feedback_content(mode: str, feedback_arg: Optional[str]) -> Optional[str]:
    if mode != "feedback":
        if feedback_arg:
            raise CliArgsError("--feedback is only allowed with --mode feedback")
        return None

    feedback_path_str = feedback_arg or os.getenv("HUMAN_FEEDBACK_FILE")
    if not feedback_path_str:
        raise CliArgsError("--feedback is required for --mode feedback")

    feedback_path = Path(feedback_path_str)
    if feedback_path.exists() and feedback_path.is_file():
        content = feedback_path.read_text(encoding="utf-8").strip()
    else:
        content = feedback_path_str.strip()

    if not content:
        raise CliArgsError("--feedback content is empty")

    return content

