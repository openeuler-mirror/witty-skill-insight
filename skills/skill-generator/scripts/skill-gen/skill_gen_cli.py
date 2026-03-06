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
    # 将包目录加入 sys.path，以便 skill_seekers 能够被作为顶层包导入 (解决内部绝对导入问题)
    sys.path.append(str(python_package_dir))

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
        required=False,
        action="append",
        help="输入路径：单个文档路径 / 目录路径 / 配置文件路径 / URL (可多次指定)",
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
    parser.add_argument(
        "--mode",
        choices=["single", "merge"],
        default="single",
        help="生成模式：single (默认，单/多文档生成对应数量Skill) / merge (多文档合并生成一个Skill)",
    )

    parser.add_argument(
        "--general-experience",
        "-g",
        dest="general_experience",
        default=None,
        help="通用经验文件路径（可选）",
    )

    parser.add_argument(
        "--pattern-file",
        "-p",
        dest="pattern_file",
        default=None,
        help="故障模式 YAML 文件路径（可选，用于直接生成 Skill）",
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

    if not args.input and not args.pattern_file:
        parser.error("必须提供 --input 或 --pattern-file 其中之一")

    # 如果提供了模型参数，设置到环境变量
    if args.llm_api_key:
        os.environ["LLM_API_KEY"] = args.llm_api_key

    # 兼容 .env 中的配置：如果 LLM_API_KEY 为空，尝试从 DEEPSEEK_API_KEY 复制
    if not os.getenv("LLM_API_KEY") and os.getenv("DEEPSEEK_API_KEY"):
        os.environ["LLM_API_KEY"] = os.getenv("DEEPSEEK_API_KEY")

    if args.llm_model:
        os.environ["LLM_MODEL"] = args.llm_model
    if args.llm_base_url:
        os.environ["LLM_BASE_URL"] = args.llm_base_url

    # 检查API Key配置
    llm_api_key = os.getenv("LLM_API_KEY") or os.getenv("DEEPSEEK_API_KEY")
    if not llm_api_key:
        env_file = project_root / ".env"
        print("❌ 错误: 未找到 LLM API Key 配置")
        print("\n请配置以下环境变量之一：")
        print("  1. LLM_API_KEY (推荐)")
        print("  2. DEEPSEEK_API_KEY (自动回退)")
        print("\n配置方式：")
        print(f"  编辑文件: {env_file}")
        print("  添加以下内容：")
        print("    LLM_API_KEY=your_api_key_here")
        print("    # 或者")
        print("    DEEPSEEK_API_KEY=your_api_key_here")
        print("\n或者通过命令行参数传递：")
        print("  --llm-api-key=your_api_key_here")
        print("\n获取 API Key:")
        print("  DeepSeek: https://platform.deepseek.com/")
        return 1

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
        mode=args.mode,
        general_experience_path=args.general_experience,
        pattern_file_path=args.pattern_file,
    )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
