import argparse
import datetime
import logging
import os
import re
import sys
from pathlib import Path
from typing import List, Optional

import httpx
from dotenv import load_dotenv
from langchain_openai import ChatOpenAI

# Add project root to sys.path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
sys.path.append(os.path.abspath(os.path.dirname(__file__)))

from architecture.genome import SkillGenome
from constants import ENV_FILE
from engine.report_generator import OptimizationReportGenerator
from optimizer import SkillOptimizer
from skill_insight_api import get_skill_logs
from cli_args import CliArgsError, resolve_human_feedback_content

# Configure logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


# --- LLM Client Setup ---
class RealLLMClient:
    def __init__(self):
        # 优先检查 DEEPSEEK 配置
        deepseek_api_key = os.getenv("DEEPSEEK_API_KEY")
        openai_api_key = os.getenv("OPENAI_API_KEY")

        if deepseek_api_key:
            # 使用 DeepSeek 配置
            base_url = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com/")
            model_name = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")
            api_key = deepseek_api_key
        elif openai_api_key:
            # 使用 OpenAI 配置
            base_url = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
            model_name = os.getenv("OPENAI_MODEL", "gpt-4")
            api_key = openai_api_key
        else:
            from constants import ENV_FILE

            raise ValueError(
                f"\n❌ Error: Neither DEEPSEEK_API_KEY nor OPENAI_API_KEY is set.\n"
                f"Please configure your AI model API key in the environment file:\n"
                f"   -> {ENV_FILE.absolute()}\n"
                f"Alternatively, you can run './scripts/opt.sh --help' to use the interactive setup."
            )

        self.llm = ChatOpenAI(
            model=model_name,
            base_url=base_url,
            api_key=api_key,
            http_client=httpx.Client(verify=False, timeout=300.0),
            http_async_client=httpx.AsyncClient(verify=False, timeout=300.0),
            max_tokens=4096,
            request_timeout=300.0,
        )

    def __call__(self, prompt):
        logger.info(f"\n[RealLLM] Sending Prompt (truncated): {prompt[:100]}...")
        try:
            response = self.llm.invoke(prompt)
            if hasattr(response, "content"):
                return response.content
            return str(response)
        except Exception as e:
            logger.error(f"[RealLLM] Error: {e}")
            return ""


# --- Core Logic Functions ---


def validate_skill_file(file_path: Path) -> tuple[bool, str]:
    """
    验证 SKILL.md 文件的完整性
    
    Returns:
        (is_valid, error_message)
    """
    if not file_path.exists():
        return False, f"文件不存在: {file_path}"
    
    content = file_path.read_text(encoding='utf-8')
    if not content or len(content) < 100:
        return False, f"文件内容过短: {len(content)} 字符"
    
    if not content.startswith('---'):
        return False, "缺少 YAML frontmatter"
    
    frontmatter_match = re.match(r'^---\n(.*?)\n---', content, re.DOTALL)
    if not frontmatter_match:
        return False, "frontmatter 格式错误"
    
    frontmatter = frontmatter_match.group(1)
    if 'name:' not in frontmatter:
        return False, "frontmatter 缺少 name 字段"
    
    return True, ""


def validate_auxiliary_file(file_path: Path) -> tuple[bool, str]:
    """
    验证辅助文件的完整性
    
    Returns:
        (is_valid, error_message)
    """
    if not file_path.exists():
        return False, f"文件不存在: {file_path}"
    
    content = file_path.read_text(encoding='utf-8')
    if not content or len(content.strip()) == 0:
        return False, f"文件内容为空: {file_path}"
    
    return True, ""


def update_skill_name_in_md(content: str, new_name: str) -> str:
    """Update skill name in SKILL.md content."""
    # Try YAML frontmatter first
    pattern = r"^name:\s+(.+)$"
    match = re.search(pattern, content, re.MULTILINE)
    if match:
        return re.sub(
            pattern, f"name: {new_name}", content, count=1, flags=re.MULTILINE
        )

    # Fallback to header (only if name is in header)
    pattern = r"^#\s+(.+)$"
    match = re.search(pattern, content, re.MULTILINE)
    if match:
        return re.sub(pattern, f"# {new_name}", content, count=1, flags=re.MULTILINE)

    return content


def integrate_auxiliary_references(skill_content: str, auxiliary_files: dict[str, str]) -> str:
    """
    在 SKILL.md 中自动添加对辅助文件的引用
    
    Args:
        skill_content: SKILL.md 的内容
        auxiliary_files: 辅助文件字典 {相对路径: 内容}
    
    Returns:
        更新后的 SKILL.md 内容
    """
    if not auxiliary_files:
        return skill_content
    
    has_section = any(
        section in skill_content.lower() 
        for section in ['## 辅助文件', '## 相关文件', '## auxiliary files', '## related files']
    )
    
    if has_section:
        return skill_content
    
    section_header = "\n\n## 辅助文件\n\n以下文件由优化器自动创建，用于支持本 Skill 的功能：\n\n"
    
    file_list = ""
    for rel_path in sorted(auxiliary_files.keys()):
        if rel_path.endswith('.py'):
            desc = "Python 脚本"
        elif rel_path.endswith('.sh'):
            desc = "Shell 脚本"
        elif rel_path.endswith('.md'):
            desc = "参考文档"
        else:
            desc = "辅助文件"
        
        file_list += f"- **{rel_path}** - {desc}\n"
    
    return skill_content.rstrip() + section_header + file_list


def print_completion_summary(
    success: bool,
    output_dir: Path,
    skill_name: str,
    diagnoses_count: int,
    auxiliary_files: list[str],
    mode: str
):
    """
    输出清晰明确的完成状态摘要
    """
    print("\n" + "=" * 60)
    
    if success:
        print("✅ 优化完成！")
    else:
        print("⚠️ 优化部分完成")
    
    print("-" * 60)
    print(f"Skill 名称: {skill_name}")
    print(f"优化模式: {mode}")
    print(f"诊断数量: {diagnoses_count}")
    print(f"输出目录: {output_dir}")
    
    if auxiliary_files:
        print(f"\n生成的文件:")
        print(f"  - SKILL.md")
        for f in auxiliary_files:
            print(f"  - {f}")
    
    if diagnoses_count > 0:
        print(f"\n诊断报告:")
        print(f"  - diagnoses.json")
        print(f"  - OPTIMIZATION_REPORT.md")
    
    print("=" * 60)


def run_optimizer(
    mode: str,
    input_path: Path,
    output_path: Optional[Path] = None,
    human_feedback: Optional[str] = None,
) -> List[Path]:
    """
    Main entry point for function calls.

    Args:
        mode: 'static' or 'dynamic' or 'hybrid'
        input_path: Path to input directory or file
        output_path: Path to output directory (optional)
        human_feedback: Optional human feedback content to guide optimization

    Returns:
        List[Path]: List of paths to the optimized skill directories
    """

    load_dotenv(ENV_FILE)

    # 1. Initialize Components
    try:
        llm_client = RealLLMClient()
    except ValueError as e:
        logger.error(str(e))
        return []

    # Use Factory Method to create optimizer with all dependencies wired up
    optimizer = SkillOptimizer.from_llm_client(llm_client)
    report_generator = OptimizationReportGenerator(llm_client)

    # 2. Resolve Paths
    input_path = Path(input_path).resolve()
    input_dir = input_path.parent if input_path.is_file() else input_path

    if output_path:
        workspace_dir = Path(output_path).resolve()
    else:
        # If no output_path is provided:
        # Check if input_dir already looks like a workspace (has snapshots)
        if (input_dir / "snapshots").exists():
            workspace_dir = input_dir
        else:
            # Otherwise, create a new timestamped directory next to input_dir
            timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
            workspace_dir = input_dir.parent / f"{input_dir.name}-optimized-{timestamp}"

    # Initialize workspace if it's new
    if workspace_dir != input_dir and not workspace_dir.exists():
        import shutil
        def ignore_patterns(d, contents):
            return ['snapshots', '.git', '__pycache__', 'node_modules', '.venv', 'venv', '.opt']
        shutil.copytree(input_dir, workspace_dir, ignore=ignore_patterns)
        logger.info(f"Created new workspace: {workspace_dir}")

    # 3. Locate SKILL.md
    skill_files = []
    if input_path.is_file() and input_path.name.lower() == "skill.md":
        try:
            rel_path = input_path.relative_to(input_dir)
            skill_files.append(workspace_dir / rel_path)
        except ValueError:
            skill_files.append(workspace_dir / "SKILL.md")
    else:
        skill_files = list(workspace_dir.rglob("SKILL.md"))  # Recursive search

    skill_files = [f for f in skill_files if f.exists()]

    if not skill_files:
        logger.error(f"No SKILL.md found in {workspace_dir}")
        return []

    logger.info(f"Found {len(skill_files)} skill(s) to process in workspace {workspace_dir}.")

    optimized_paths = []

    # 4. Processing Loop
    for skill_file in skill_files:
        logger.info(f"Processing: {skill_file}")
        logger.info(f"Mode: {mode}")

        try:
            # Initialize variables
            optimized_genome = None
            diagnoses = []

            # Load Genome initially (try from directory for context)
            try:
                initial_genome = SkillGenome.from_directory(skill_file.parent)
            except Exception as e:
                logger.warning(f"Failed to load from directory: {e}. Fallback to file.")
                with open(skill_file, "r", encoding="utf-8") as f:
                    initial_genome = SkillGenome.from_markdown(f.read())

            if mode == "static":
                logger.info("Mode: Static (Cold Start)")
                print("\n⏳ [进度] 正在执行静态评估...")
                print("⏳ [进度] 预计需要 1-3 分钟，请耐心等待...")
                print("⏳ [进度] LLM 调用中...\n")
                optimized_genome, diagnoses = optimizer.optimize_static(
                    skill_file
                )

            elif mode == "feedback":
                logger.info("Mode: Feedback (User Revision)")
                print("\n⏳ [进度] 正在执行反馈优化（基于你的修改意见）...")
                print("⏳ [进度] 预计需要 1-3 分钟，请耐心等待...")
                print("⏳ [进度] LLM 调用中...\n")
                optimized_genome, diagnoses = optimizer.optimize_static(
                    skill_file, human_feedback=human_feedback
                )

            elif mode == "dynamic":
                logger.info("Mode: Dynamic (Experience Crystallization)")
                print("\n⏳ [进度] 正在获取历史执行记录...")
                report_items = get_skill_logs(skill=initial_genome.name, limit=3)
                print("⏳ [进度] 正在执行动态优化（经验结晶）...")
                print("⏳ [进度] 预计需要 3-5 分钟，请耐心等待...")
                print("⏳ [进度] LLM 调用中...\n")
                optimized_genome, diagnoses = optimizer.optimize_dynamic(
                    genome=initial_genome, report_items=report_items
                )

            elif mode == "hybrid":
                logger.info("Mode: Hybrid (Static + Dynamic)")
                print("\n⏳ [进度] 正在获取历史执行记录...")
                report_items = get_skill_logs(skill=initial_genome.name)
                print("⏳ [进度] 正在执行混合优化（静态 + 动态）...")
                print("⏳ [进度] 预计需要 5-8 分钟，请耐心等待...")
                print("⏳ [进度] LLM 调用中...\n")
                optimized_genome, diagnoses = optimizer.optimize_hybrid(
                    skill_path=skill_file,
                    report_items=report_items,
                )

            # 5. Save Result
            from snapshot_manager import SnapshotManager
            sm = SnapshotManager(skill_file.parent)
            sm.create_v0_if_needed()
            base_for_diff = sm.get_latest_base_version() or "v0"
            
            is_feedback = mode == "feedback"
            if is_feedback:
                reason = f"用户反馈: {human_feedback[:50]}..."
                source = "user"
            else:
                reason = f"自动优化: {mode} mode"
                source = "auto"
                
            new_version = sm.create_snapshot(
                mode=mode,
                reason=reason,
                source=source,
                is_feedback=is_feedback
            )
            
            skill_save_dir = sm.snapshots_dir / new_version

            # Save SKILL.md
            if optimized_genome:
                new_content = optimized_genome.to_markdown()
                if not new_content or len(new_content) < 50:
                    logger.warning(
                        "Optimized SKILL.md content is suspiciously short or empty!"
                    )
                
                new_content = integrate_auxiliary_references(new_content, optimized_genome.files)

                save_file = skill_save_dir / "SKILL.md"
                with open(save_file, "w", encoding="utf-8") as f:
                    f.write(new_content)
                logger.info(f"Optimized skill saved to: {save_file}")
                
                is_valid, error_msg = validate_skill_file(save_file)
                if not is_valid:
                    logger.warning(f"SKILL.md 验证失败: {error_msg}")
                else:
                    logger.info(f"SKILL.md 验证通过: {save_file}")

                # Save Auxiliary Files (scripts, references, etc.)
                # optimized_genome.files contains relative paths -> content
                if not optimized_genome.files:
                    logger.warning(
                        "No auxiliary files found in optimized genome! (Scripts/References may be missing)"
                    )

                for rel_path, file_content in optimized_genome.files.items():
                    dest_path = skill_save_dir / rel_path
                    dest_path.parent.mkdir(parents=True, exist_ok=True)
                    with open(dest_path, "w", encoding="utf-8") as f:
                        f.write(file_content)
                    logger.info(f"Saved auxiliary file: {rel_path}")
                    
                    is_valid, error_msg = validate_auxiliary_file(dest_path)
                    if not is_valid:
                        logger.warning(f"辅助文件验证失败: {error_msg}")
                    else:
                        logger.info(f"辅助文件验证通过: {rel_path}")
            else:
                logger.warning("Optimization returned None. Skipping save.")

            # Save Diagnoses
            if diagnoses:
                import json

                diagnoses_file = skill_save_dir / "diagnoses.json"
                diagnoses_data = [
                    {
                        "dimension": d.dimension,
                        "issue_type": d.issue_type,
                        "severity": d.severity,
                        "description": d.description,
                        "suggested_fix": d.suggested_fix,
                    }
                    for d in diagnoses
                ]
                with open(diagnoses_file, "w", encoding="utf-8") as f:
                    json.dump(diagnoses_data, f, indent=2, ensure_ascii=False)
                logger.info(f"Saved diagnoses to: {diagnoses_file}")
                logger.info(f"Total diagnoses: {len(diagnoses)}")

            # Generate and Save Optimization Report
            if optimized_genome and diagnoses:
                report_content = report_generator.generate_report(
                    original=initial_genome,
                    optimized=optimized_genome,
                    diagnoses=diagnoses,
                )
                report_file = skill_save_dir / "OPTIMIZATION_REPORT.md"
                with open(report_file, "w", encoding="utf-8") as f:
                    f.write(report_content)
                logger.info(f"Saved optimization report to: {report_file}")

            # Also update the actual skill directory to match the latest snapshot
            sm.revert_to(new_version)

            # Generate and open diff
            base_version = sm.get_latest_base_version()
            if base_version:
                try:
                    import subprocess
                    diff_script = Path(__file__).parent / "diff_viewer.py"
                    subprocess.run([
                        sys.executable, str(diff_script),
                        "--snapshots", str(sm.snapshots_dir),
                        "--title", initial_genome.name,
                        "--default-base", base_version
                    ])
                except Exception as e:
                    logger.error(f"Failed to open diff viewer: {e}")

            # Record successful optimization path
            optimized_paths.append(skill_save_dir)
            logger.info(f"Optimization completed for: {skill_file}. New version: {new_version}")
            
            print("\n" + "=" * 60)
            print(f"✅ 优化完成！已生成新版本: {new_version}")
            print(f"👉 请在弹出的 Diff 页面查看更改。")
            print("👉 下一步选择：满意就继续下一步 / 不满意先改 / 到此为止")
            print("=" * 60 + "\n")

        except Exception as e:
            logger.error(f"Optimization failed for {skill_file}: {e}")
            import traceback

            traceback.print_exc()

    return optimized_paths


# --- CLI Entry Point ---


def main():
    parser = argparse.ArgumentParser(description="Skill Optimizer CLI")

    parser.add_argument(
        "--action",
        choices=["optimize", "accept", "revert"],
        default="optimize",
        help="Action to perform. Default is 'optimize'.",
    )
    parser.add_argument(
        "--mode",
        choices=["static", "dynamic", "feedback", "hybrid"],
        help="Optimization mode: static (cold) or dynamic (trace-based) or feedback (human revision) or hybrid (static+dynamic). Required for 'optimize' action.",
    )
    parser.add_argument(
        "--input",
        "-i",
        type=str,
        required=True,
        help="Input path (directory containing SKILL.md or file path)",
    )
    parser.add_argument(
        "--output",
        "-o",
        type=str,
        help="Output directory (optional, defaults to input dir)",
    )
    parser.add_argument(
        "--feedback",
        "-f",
        type=str,
        help="Path to feedback file or inline feedback text. Only allowed with --mode feedback.",
    )
    parser.add_argument(
        "--target-version",
        type=str,
        help="Target version to revert to (e.g. 'v1'). Required for 'revert' action.",
    )

    args = parser.parse_args()

    input_path = Path(args.input)
    
    if args.action == "accept":
        from snapshot_manager import SnapshotManager
        skill_dir = input_path.parent if input_path.is_file() else input_path
        if not (skill_dir / "snapshots").exists():
            logger.error(f"❌ 目录 {skill_dir} 中没有 snapshots。请确保你在已优化的工作区中执行 accept。")
            return
        sm = SnapshotManager(skill_dir)
        new_ver = sm.accept_latest()
        if new_ver:
            sm.revert_to(new_ver)
            logger.info(f"✅ 成功接受优化，已保存为新基线版本: {new_ver}")
        else:
            logger.error("❌ 没有可接受的版本。")
        return
        
    if args.action == "revert":
        if not args.target_version:
            parser.error("--target-version is required for 'revert' action")
        from snapshot_manager import SnapshotManager
        skill_dir = input_path.parent if input_path.is_file() else input_path
        if not (skill_dir / "snapshots").exists():
            logger.error(f"❌ 目录 {skill_dir} 中没有 snapshots。请确保你在已优化的工作区中执行 revert。")
            return
        sm = SnapshotManager(skill_dir)
        if sm.revert_to(args.target_version):
            logger.info(f"✅ 成功回滚到版本: {args.target_version}")
        else:
            logger.error(f"❌ 找不到指定的版本: {args.target_version}")
        return

    if not args.mode:
        parser.error("--mode is required for 'optimize' action")

    output_path = Path(args.output) if args.output else None

    try:
        human_feedback_content = resolve_human_feedback_content(args.mode, args.feedback)
    except CliArgsError as e:
        parser.error(str(e))
    except OSError as e:
        parser.error(f"Failed to read feedback file: {e}")

    optimized_paths = run_optimizer(
        args.mode, input_path, output_path, human_feedback=human_feedback_content
    )

    if optimized_paths:
        logger.info(
            f"Optimization completed. Modified skill paths: {[str(p) for p in optimized_paths]}"
        )


if __name__ == "__main__":
    main()
