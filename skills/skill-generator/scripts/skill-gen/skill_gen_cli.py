#!/usr/bin/env python3
"""
项目级 Skill-Gen 命令行入口

用法:
    python skill_gen_cli.py --input document.pdf --output ./output --name my-skill
"""

import argparse
import os
import sys
from pathlib import Path

from dotenv import load_dotenv


def main() -> int:
    # 当前文件：<project_root>/skill_gen_cli.py
    this_file = Path(__file__).resolve()
    # 项目根目录：skill-gen/
    project_root = this_file.parent

    # 优先加载项目根目录下的 .env
    load_dotenv(dotenv_path=project_root / ".env")

    # Python 包根目录：<project_root>/skill_gen
    python_module_root = project_root
    python_package_dir = python_module_root / "skill_gen"
    if not python_package_dir.exists():
        raise SystemExit(
            f"找不到 Skill-Gen Python 包目录: {python_package_dir}\n"
            "请确认已正确迁移 skill-gen 模块（包含 skill_gen 包目录）。"
        )

    # 将项目根目录加入 sys.path，以便导入 skill_gen 包
    sys.path.append(str(python_module_root))

    try:
        from skill_gen.skill_generation import run_skill_generation
    except ImportError as e:
        raise SystemExit(
            f"无法导入 skill_generation 模块（项目根目录: {python_module_root}）：{e}"
        )

    parser = argparse.ArgumentParser(
        description="Skill-Gen 命令行工具",
    )
    parser.add_argument(
        "--input",
        "-i",
        required=True,
        help="输入路径：单个文档路径 / 目录路径 / 配置文件路径 / URL",
    )
    parser.add_argument(
        "--output",
        "-o",
        required=False,
        default=None,
        help="输出目录路径（将作为 CUSTOM_SKILL_PATHS 使用）。"
        "若未指定，将从环境变量 CUSTOM_SKILL_PATHS 中读取。",
    )
    parser.add_argument(
        "--concurrency",
        "-c",
        type=int,
        default=3,
        help="批量生成时的并发数（默认: 3）",
    )
    parser.add_argument(
        "--name",
        "-n",
        dest="skill_name",
        default=None,
        help="Skill 名称（仅单文件模式可选）",
    )
    parser.add_argument(
        "--quality-threshold",
        "-q",
        type=float,
        default=0.5,
        help="文档质量评估阈值 (0~1)，默认 0.5",
    )

    # 模型配置参数（AI 平台传递）
    parser.add_argument(
        "--llm-api-key",
        help="LLM API Key（由 AI 平台传递）",
    )
    parser.add_argument(
        "--llm-model",
        help="LLM 模型名称（由 AI 平台传递）",
    )
    parser.add_argument(
        "--llm-base-url",
        help="LLM API 基础 URL（由 AI 平台传递）",
    )

    args = parser.parse_args()

    # 如果提供了模型参数，设置到环境变量
    if args.llm_api_key:
        os.environ["LLM_API_KEY"] = args.llm_api_key
    if args.llm_model:
        os.environ["LLM_MODEL"] = args.llm_model
    if args.llm_base_url:
        os.environ["LLM_BASE_URL"] = args.llm_base_url

    # 如果没有通过参数指定 output，则尝试从环境变量 CUSTOM_SKILL_PATHS 读取
    output_path = args.output or os.getenv("CUSTOM_SKILL_PATHS")
    if not output_path:
        raise SystemExit(
            "未指定输出目录路径。\n"
            "请通过 --output 参数或环境变量 CUSTOM_SKILL_PATHS 指定输出目录路径。"
        )

    run_skill_generation(
        input_path=args.input,
        output_path=output_path,
        concurrency=args.concurrency,
        skill_name=args.skill_name,
        quality_threshold=args.quality_threshold,
    )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())


