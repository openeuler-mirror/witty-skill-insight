import os
import sys
import glob
import asyncio
import argparse

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
if CURRENT_DIR not in sys.path:
    sys.path.insert(0, CURRENT_DIR)

try:
    from dotenv import load_dotenv, find_dotenv

    load_dotenv(find_dotenv())
except Exception:
    pass

from skill_gen.skill_generation import generate_skill_v2


def find_default_input() -> str:
    test_dir = os.path.join(CURRENT_DIR, "test_case")
    pdfs = sorted(glob.glob(os.path.join(test_dir, "*.pdf")))
    return pdfs[0] if pdfs else ""


def main():
    parser = argparse.ArgumentParser(
        description="从文档生成 Skill（支持 PDF/Markdown/TXT）"
    )
    parser.add_argument(
        "-i",
        "--input",
        dest="input_path",
        help="案例文档路径（pdf/md/txt）或 URL；若不提供，将尝试使用 test_case 下的示例文件",
        default=None,
    )
    parser.add_argument(
        "-o",
        "--output",
        dest="output_dir",
        help="输出目录，默认为当前目录下的 ./output_skills",
        default=os.path.join(CURRENT_DIR, "output_skills"),
    )

    args = parser.parse_args()

    input_path = args.input_path or find_default_input()
    if not input_path:
        print("未提供输入文档，且 test_case/ 未找到示例 PDF。请通过 -i 指定输入文件。")
        sys.exit(1)

    input_path = (
        os.path.abspath(
            input_path
            if os.path.isabs(input_path)
            else os.path.join(os.getcwd(), input_path)
        )
        if not args.input_path
        else os.path.abspath(input_path)
    )
    output_dir = os.path.abspath(args.output_dir)

    os.makedirs(output_dir, exist_ok=True)

    try:
        _ = asyncio.run(generate_skill_v2(input_path, output_dir))
        print("Skill 生成完成")
    except Exception as e:
        print(f"运行失败：{type(e).__name__}: {e}")
        sys.exit(2)


if __name__ == "__main__":
    main()
