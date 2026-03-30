import os
import logging
from typing import List


def check_environment_variables(required_vars: List[str]) -> None:
    missing_vars = [var for var in required_vars if not os.getenv(var)]
    if missing_vars:
        logging.error(f"错误: 缺少必要的环境变量: {', '.join(missing_vars)}")
        raise SystemExit(1)


def format_header(
    title: str, width: int = 60, min_width: int = 20, char: str = "="
) -> str:
    lines = []
    final_width = max(width, min_width, len(title) + 4)
    lines.append(char * final_width)
    padding = (final_width - len(title)) // 2
    lines.append(" " * padding + title)
    lines.append(char * final_width)
    return "\n".join(lines)

