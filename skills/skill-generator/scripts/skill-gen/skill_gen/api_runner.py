#!/usr/bin/env python3
"""
Skill-Gen API 入口（供 Node/Next.js 内部调用）

设计目标：
- 不依赖 CLI 脚本 `cli/skill_gen.py`
- 直接调用库函数 `run_skill_generation`
- 通过命令行参数接收最小必要信息（与 TS 服务层保持一致）
"""

import argparse

from skill_generation import run_skill_generation


def main() -> int:
  parser = argparse.ArgumentParser(
      description="Skill-Gen API runner（内部调用用）",
  )
  parser.add_argument(
      "--input",
      "-i",
      required=True,
      help="输入路径：单个文档路径 / 目录路径 / 配置文件路径",
  )
  parser.add_argument(
      "--output",
      "-o",
      required=True,
      help="输出目录路径（将作为 CUSTOM_SKILL_PATHS 使用）",
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

  args = parser.parse_args()

  run_skill_generation(
      input_path=args.input,
      output_path=args.output,
      concurrency=args.concurrency,
      skill_name=args.skill_name,
      quality_threshold=args.quality_threshold,
  )
  return 0


if __name__ == "__main__":
  raise SystemExit(main())

