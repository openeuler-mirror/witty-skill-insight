import os
import asyncio
import sys
import pathlib
import time
import json
import yaml
from typing import Any, Dict, List, Tuple, Optional
from rich.console import Console
from rich.prompt import Prompt
from rich.progress import (
    Progress,
    SpinnerColumn,
    TextColumn,
    BarColumn,
    TaskProgressColumn,
)

sys.path.append(
    os.path.join(os.path.dirname(__file__), "third_party", "Skill_Seekers", "src")
)
from .skill_seekers.cli.md_scraper import MarkdownToSkillConverter
from .skill_seekers.cli.pdf_scraper import PDFToSkillConverter
from .skill_name_gen import (
    gen_skill_name_from_text,
    agen_skill_name_from_text,
)
from .markdown_formatter import md_formatter
from .doc_quality_validator import evaluate_doc_source_for_skill
from .deepseek_skill_adapter import DeepSeekAdaptor
from .html_extractor import run_html_extractor
from .doc_reader import read_doc
from .case_extractor import CaseExtractor
from .pattern_merger import PatternMerger
from .skill_formatter import SkillFormatter
from .schema import (
    Skill,
)


async def generate_skill_v2(doc_path: str, output_dir: str) -> Skill:
    """
    Generate a Skill object from a document using the new pipeline (v2).

    Steps:
    1. Read document using doc_reader.
    2. Extract FailureCase using CaseExtractor (Async).
    3. Generate FailurePattern using PatternMerger (Async).
    4. Create Skill object.
    5. Save Skill to output_dir/SKILL.yaml.
    """
    console = Console()
    console.print(f"[bold cyan]开始使用 v2 流程生成 Skill...[/bold cyan]")

    # 1. Read document and extract assets (Scripts & References)
    console.print(f"正在读取文档并提取资产: {doc_path}")

    generated_scripts = []
    reference_files = []

    try:
        # Determine skill name from output_dir
        skill_name = os.path.basename(output_dir)
        parent_dir = os.path.dirname(output_dir)

        # Configure common extractor options
        common_config = {
            "name": skill_name,
            "save_dir": parent_dir,  # Converter appends skill_name
            "description": f"Generated skill for {skill_name}",
            "scripts_config": {
                "line_threshold": 5,  # Lower threshold to capture more scripts
                "min_quality_score": 4.0,
                "max_display_lines": 10,
            },
        }

        # Initialize appropriate converter
        converter = None
        if doc_path.lower().endswith(".pdf"):
            config = {
                **common_config,
                "pdf_path": doc_path,
                "extract_options": {
                    "chunk_size": 10,
                    "min_quality": 5.0,
                    "extract_images": True,  # Enable image extraction
                    "min_image_size": 100,
                },
            }
            converter = PDFToSkillConverter(config)
            converter.extract_pdf()

        elif doc_path.lower().endswith((".md", ".markdown", ".txt")):
            # For TXT, convert to MD first if needed (reuse logic from skill_seekers_gen if complex)
            # Here assuming direct MD support or simple text read
            md_content = None
            if doc_path.lower().endswith(".txt"):
                with open(doc_path, "r", encoding="utf-8") as f:
                    md_content = md_formatter(f.read())

            config = {
                **common_config,
                "md_path": doc_path if not md_content else None,
                "md_content": md_content,
            }
            converter = MarkdownToSkillConverter(config)
            converter.extract_markdown()

        # Build skill assets (creates folders, saves files)
        if converter:
            converter.build_skill()
            # Capture generated assets
            if hasattr(converter, "extracted_scripts"):
                generated_scripts = converter.extracted_scripts

            # Identify reference files
            ref_dir = os.path.join(output_dir, "references")
            if os.path.exists(ref_dir):
                for f in os.listdir(ref_dir):
                    if f.endswith(".md"):
                        reference_files.append(f"references/{f}")

        # Re-read text for LLM (converter might have processed it, but we need raw text for CaseExtractor)
        # Note: converter.build_skill() creates a SKILL.md which we will overwrite later
        text = read_doc(doc_path)

    except Exception as e:
        console.print(f"[bold red]资产提取失败 (非阻塞): {e}[/bold red]")
        # Fallback: just read text
        text = read_doc(doc_path)

    # 2. Extract failure case
    console.print("正在提取故障案例...")
    extractor = CaseExtractor()
    failure_case = await extractor.extract(text)

    # 如果 LLM 提取失败，直接报错并退出
    if not failure_case:
        console.print(
            "[bold red]LLM 提取失败，请检查 API Key 配置或网络连接，无法生成 Skill[/bold red]"
        )
        sys.exit(1)

    console.print(f"[green]成功提取故障案例: {failure_case.title}[/green]")

    # 3. Merge with existing patterns (empty for now)
    console.print("正在生成故障模式...")
    merger = PatternMerger()
    merge_result = await merger.merge(failure_case, existing_patterns=[])

    if not merge_result or not merge_result.failure_pattern:
        error_msg = "无法生成故障模式"
        console.print(f"[bold red]{error_msg}[/bold red]")
        raise ValueError(error_msg)

    console.print(
        f"[green]成功生成故障模式: {merge_result.failure_pattern.pattern_name}[/green]"
    )

    # 4. Create Skill object
    skill = Skill(
        failure_pattern=merge_result.failure_pattern, failure_cases=[failure_case]
    )

    # 5. Save to YAML and Markdown
    if not os.path.exists(output_dir):
        os.makedirs(output_dir, exist_ok=True)

    # Create references directory
    ref_dir = os.path.join(output_dir, "references")
    if not os.path.exists(ref_dir):
        os.makedirs(ref_dir, exist_ok=True)

    # Save separated YAMLs
    try:
        # Save Failure Cases
        cases_file = os.path.join(ref_dir, "failure_cases.yaml")
        console.print(f"正在保存故障案例到: {cases_file}")
        cases_data = [case.model_dump(mode="json") for case in skill.failure_cases]
        with open(cases_file, "w", encoding="utf-8") as f:
            yaml.dump(cases_data, f, allow_unicode=True, sort_keys=False)

        # Save Failure Pattern
        pattern_file = os.path.join(ref_dir, "failure_pattern.yaml")
        console.print(f"正在保存故障模式到: {pattern_file}")
        pattern_data = skill.failure_pattern.model_dump(mode="json")
        with open(pattern_file, "w", encoding="utf-8") as f:
            yaml.dump(pattern_data, f, allow_unicode=True, sort_keys=False)

        console.print(f"[bold green]故障案例和模式保存成功！[/bold green]")
    except Exception as e:
        console.print(f"[bold red]保存 YAML 失败: {e}[/bold red]")
        raise e

    # Save Markdown (Agent Skill)
    output_md = os.path.join(output_dir, "SKILL.md")
    console.print(f"正在生成 Skill 文档: {output_md}")

    try:
        formatter = SkillFormatter()
        md_content = formatter.render(
            skill, generated_scripts=generated_scripts, reference_files=reference_files
        )
        with open(output_md, "w", encoding="utf-8") as f:
            f.write(md_content)
        console.print(f"[bold green]SKILL.md 生成成功！[/bold green]")
    except Exception as e:
        console.print(f"[bold red]生成 Markdown 失败: {e}[/bold red]")
        # We don't raise here to allow partial success (YAML saved) if MD fails

    return skill


def skill_seekers_gen(user_case_file, skill_name, quality_threshold: float = 0.5):
    # 检查 CUSTOM_SKILL_PATHS 环境变量是否设置
    custom_skill_paths = os.getenv("CUSTOM_SKILL_PATHS")
    if not custom_skill_paths:
        print("❌ 错误: 环境变量 CUSTOM_SKILL_PATHS 未设置，请先设置该环境变量")
        return False

    # 如果路径不存在，则创建目录
    if not os.path.exists(custom_skill_paths):
        os.makedirs(custom_skill_paths, exist_ok=True)
        print(f"📁 已创建目录: {custom_skill_paths}")

    skill_dir = os.path.join(custom_skill_paths, skill_name)

    # === 统一文档预检：类型自动判断 + 内容抽取（PDF/Markdown/TXT/URL） ===
    try:
        print("🔍 正在评估文档是否适合生成 skill...")
        is_ok, feedback, _ = evaluate_doc_source_for_skill(
            user_case_file, qualify_threshold=quality_threshold
        )
    except Exception as e:
        # 仅捕获评估调用异常（如网络、解析错误），跳过预检直接继续
        print(f"⚠️ 文档预检失败：{e}")
        is_ok = False
    else:
        print(feedback)

    # 评估不通过时询问是否继续（使用 input() 确保在各类终端下都能显示并读取）
    if not is_ok:
        print("")
        print("【预检不通过】需您确认是否仍继续生成 skill。")
        try:
            answer = (
                input("评估分数低于阈值，是否仍继续生成？(y/n) [n]: ").strip().lower()
                or "n"
            )
        except (EOFError, KeyboardInterrupt):
            answer = "n"
        if answer != "y":
            print("❌ 已取消生成，程序结束。")
            return False
        print("⚠️ 用户确认继续，将按当前文档继续生成 skill...")

    if user_case_file.endswith(".pdf"):
        # 处理pdf文件
        config = {
            "name": skill_name,  # skill的名称，用于标识和命名生成的skill
            "pdf_path": user_case_file,  # PDF文件的完整路径，需要提取内容的源文件
            "save_dir": custom_skill_paths,  # skill保存的根目录路径，从环境变量获取
            "description": f"Use when referencing {skill_name} documentation",  # skill的描述信息，说明何时使用该skill
            "extract_options": {  # PDF内容提取的配置选项
                "chunk_size": 10,  # 文本分块大小，每块包含的页面数量
                "min_quality": 5.0,  # 内容质量的最小阈值，低于此值的内容会被过滤
                "extract_images": False,  # 是否从PDF中提取图片内容
                "min_image_size": 100,  # 提取图片的最小尺寸（像素），小于此尺寸的图片会被忽略
            },
            "scripts_config": {  # 脚本提取和处理的配置选项
                "line_threshold": 30,  # 识别为脚本的最小行数阈值，超过此行数的代码块会被提取为脚本
                "min_quality_score": 6.0,  # 脚本质量的最小分数阈值，低于此分数的脚本会被过滤
            },
        }
        # Create converter
        converter = PDFToSkillConverter(config)
        if not converter.extract_pdf():
            print(f"pdf文件提取失败：{config['pdf_path']}")
            return False

    elif user_case_file.endswith((".md", ".markdown")):
        # 处理markdown文件
        # 使用文件路径接口，而不是文本内容接口
        config = {
            "name": skill_name,  # skill的名称，用于标识和命名生成的skill
            "md_path": user_case_file,  # Markdown文件的完整路径，需要提取内容的源文件
            "save_dir": custom_skill_paths,  # skill保存的根目录路径，从环境变量获取
            "description": f"Use when referencing {skill_name} documentation",  # skill的描述信息，说明何时使用该skill
            "scripts_config": {  # 脚本提取和处理的配置选项
                "line_threshold": 30,  # 识别为脚本的最小行数阈值，超过此行数的代码块会被提取为脚本
                "min_quality_score": 6.0,  # 脚本质量的最小分数阈值，低于此分数的脚本会被过滤
                "max_display_lines": 5,  # 在 reference 中显示的最大行数，超过则显示简化格式
            },
        }
        # Create converter
        converter = MarkdownToSkillConverter(config)
        # 使用文件路径接口提取
        if not converter.extract_markdown():
            print(f"❌ Markdown 文件提取失败：{user_case_file}")
            return False

    elif user_case_file.endswith(".txt"):
        print(f"📖 读取 TXT 文件: {user_case_file}")

        # 读取txt文件内容
        with open(user_case_file, "r", encoding="utf-8") as f:
            txt_content = f.read()
        print(f"✅ 已读取文件内容，共 {len(txt_content)} 个字符")

        # 将txt内容转换为markdown格式
        print(f"🔄 正在将 TXT 格式转换为 Markdown 格式...")
        md_content = md_formatter(txt_content)
        print(f"✅ 格式转换完成，Markdown 内容共 {len(md_content)} 个字符")

        # 使用转换后的markdown内容调用md_scraper
        config = {
            "name": skill_name,  # skill的名称，用于标识和命名生成的skill
            "save_dir": custom_skill_paths,  # skill保存的根目录路径，从环境变量获取
            "description": f"Use when referencing {skill_name} documentation",  # skill的描述信息，说明何时使用该skill
            "scripts_config": {  # 脚本提取和处理的配置选项
                "line_threshold": 30,  # 识别为脚本的最小行数阈值，超过此行数的代码块会被提取为脚本
                "min_quality_score": 6.0,  # 脚本质量的最小分数阈值，低于此分数的脚本会被过滤
                "max_display_lines": 5,  # 在 reference 中显示的最大行数，超过则显示简化格式
            },
        }
        # Create converter
        converter = MarkdownToSkillConverter(config)
        # 使用文本内容接口传入转换后的markdown
        if not converter.extract_markdown(md_content=md_content):
            print(f"❌ Markdown 内容提取失败")
            return False

    elif user_case_file.startswith(("http://", "https://")):
        # 处理 URL
        print(f"🌐 读取 URL: {user_case_file}")

        # 使用 html_extractor 抓取 URL 并转为 markdown
        print(f"🔄 正在抓取 URL 内容并转换为 Markdown 格式...")
        try:
            result = asyncio.run(run_html_extractor(user_case_file))
            md_content = result.get("markdown", "")
            extracted_skill_name = result.get("skill_name", "").strip()

            if not md_content:
                print(f"❌ 未能从 URL 获取有效内容（可能被安全拦截或页面为空）")
                return False

            print(f"✅ URL 内容抓取完成，Markdown 内容共 {len(md_content)} 个字符")

            # 处理 skill_name：如果提取到了 skill_name 且用户没有提供，则使用提取的
            if extracted_skill_name and (not skill_name or not skill_name.strip()):
                skill_name = extracted_skill_name
                skill_dir = os.path.join(custom_skill_paths, skill_name)
                print(f"✅ 未提供技能名称，使用从 URL 提取的技能名称: {skill_name}")

            # 使用转换后的markdown内容调用md_scraper
            config = {
                "name": skill_name,  # skill的名称，用于标识和命名生成的skill
                "save_dir": custom_skill_paths,  # skill保存的根目录路径，从环境变量获取
                "description": f"Use when referencing {skill_name} documentation",  # skill的描述信息，说明何时使用该skill
                "scripts_config": {  # 脚本提取和处理的配置选项
                    "line_threshold": 30,  # 识别为脚本的最小行数阈值，超过此行数的代码块会被提取为脚本
                    "min_quality_score": 6.0,  # 脚本质量的最小分数阈值，低于此分数的脚本会被过滤
                    "max_display_lines": 5,  # 在 reference 中显示的最大行数，超过则显示简化格式
                },
            }
            # Create converter
            converter = MarkdownToSkillConverter(config)
            # 使用文本内容接口传入转换后的markdown
            if not converter.extract_markdown(md_content=md_content):
                print(f"❌ Markdown 内容提取失败")
                return False
        except Exception as e:
            print(f"❌ URL 抓取失败: {type(e).__name__}: {e}")
            import traceback

            traceback.print_exc()
            return False

    else:
        raise NotImplementedError(
            f"暂不支持的文件格式: {user_case_file}，当前支持 PDF、Markdown、TXT 和 Html 格式"
        )

    # Build 构建基础skill
    converter.build_skill()

    adaptor = DeepSeekAdaptor()

    if not adaptor.supports_enhancement():
        print(f"❌ Error: {adaptor.PLATFORM_NAME} does not support AI enhancement")
    # Get API key
    api_key = os.environ.get(adaptor.get_env_var_name(), "").strip()
    if not api_key:
        print(f"❌ Error: {adaptor.get_env_var_name()} not set")

    success = adaptor.enhance(pathlib.Path(skill_dir), api_key)

    if success:
        print(f"\n✅ skill生成完成，开始清理中间结果")
        skill_path = pathlib.Path(skill_dir)

        try:
            adaptor.cleanup_intermediate_files(skill_path)
            print("✅ 中间结果清理完成")
        except Exception as e:
            print(f"❌ Error cleaning intermediate files: {e}")
    else:
        print(f"❌ skill生成失败")
    return success


def _normalize_config_item(item: Any) -> Dict[str, str]:
    """
    将不同形式的配置统一成包含 pdf_path / skill_name 的 dict。

    支持两种 JSON 结构：
    1. 列表：
       [
         {"pdf_path": "test_case/kubernetes_ops_guide.pdf", "skill_name": "k8s_skill"},
         ...
       ]
    2. 映射：
       {
         "k8s_skill": "test_case/kubernetes_ops_guide.pdf",
         "oom_skill": "test_case/OOM相关参数配置与原因排查_常见问题_Huawei Cloud EulerOS-华为云.pdf"
       }
    """
    if isinstance(item, dict):
        # 正常结构：{"pdf_path": "...", "skill_name": "..."}
        if "pdf_path" in item and "skill_name" in item:
            return {
                "pdf_path": str(item["pdf_path"]),
                "skill_name": str(item["skill_name"]),
            }

        # 兜底：如果 dict 只有一对 key/value，当成 {skill_name: pdf_path}
        if len(item) == 1:
            skill_name, pdf_path = next(iter(item.items()))
            return {"pdf_path": str(pdf_path), "skill_name": str(skill_name)}

    raise ValueError(f"无效的配置项: {item}")


def _load_batch_config(config_path: str) -> List[Dict[str, str]]:
    """
    从 JSON 文件中读取批量配置。

    支持的 JSON 格式：
    1. 列表格式：
       [
         {"pdf_path": "path/to/file.pdf", "skill_name": "skill_name"},
         ...
       ]
    2. 字典格式（推荐，如 batch_pdf.json）：
       {
         "skill_name1": "path/to/file1.pdf",
         "skill_name2": "path/to/file2.pdf"
       }
    """
    if not os.path.isfile(config_path):
        raise FileNotFoundError(f"配置文件不存在: {config_path}")

    with open(config_path, "r", encoding="utf-8") as f:
        raw = json.load(f)

    items: List[Dict[str, str]] = []

    # 结构 1：列表格式
    if isinstance(raw, list):
        for entry in raw:
            items.append(_normalize_config_item(entry))
        return items

    # 结构 2：字典格式 {skill_name: pdf_path}（如 batch_pdf.json）
    if isinstance(raw, dict):
        for skill_name, pdf_path in raw.items():
            # 直接构建标准化格式，无需再调用 _normalize_config_item
            items.append(
                {
                    "pdf_path": str(pdf_path),
                    "skill_name": str(skill_name),
                }
            )
        return items

    raise ValueError("配置 JSON 需为列表或对象，请检查文件格式。")


async def _build_entries_from_dir(root_path: str) -> List[Dict[str, str]]:
    """
    当用户传入的是目录时：
    - 递归扫描目录下所有 PDF 文件
    - 统计数量并询问用户是否全部转换为 skill
    - 若确认，则为每个 PDF 自动生成 skill name（异步并发）
    """
    console = Console()
    abs_root = os.path.abspath(root_path)

    if not os.path.isdir(abs_root):
        console.print(f"[bold red]目录不存在: {root_path}[/bold red]")
        return []

    pdf_files: List[str] = []
    for dirpath, _, filenames in os.walk(abs_root):
        for filename in filenames:
            if filename.lower().endswith(".pdf"):
                pdf_files.append(os.path.join(dirpath, filename))

    if not pdf_files:
        console.print(
            f"[bold yellow]目录中未找到任何 PDF 文件: {abs_root}[/bold yellow]"
        )
        return []

    console.print("\n[bold cyan]扫描到以下 PDF 文件：[/bold cyan]")
    for idx, pdf_path in enumerate(sorted(pdf_files), 1):
        console.print(f"  {idx}. {pdf_path}")

    console.print(
        f"\n[bold magenta]共发现 {len(pdf_files)} 个 PDF 文件。[/bold magenta]"
    )
    choice = Prompt.ask(
        "[bold cyan]是否将以上所有 PDF 转换为 skill？(y/n)[/bold cyan]",
        choices=["y", "n", "Y", "N"],
        default="n",
    ).lower()

    if choice != "y":
        console.print("[bold yellow]已取消批量处理。[/bold yellow]")
        return []

    console.print(
        "[bold cyan]开始为每个 PDF 自动生成 skill name（异步并发）…[/bold cyan]"
    )

    async def _gen_skill_name_for_pdf(pdf_path: str) -> Dict[str, str]:
        """为单个 PDF 生成 skill name"""
        base_name = os.path.splitext(os.path.basename(pdf_path))[0]
        try:
            skill_name = await agen_skill_name_from_text(base_name)
        except Exception:
            # 兜底：简单清洗文件名
            safe_name = base_name.strip().lower().replace(" ", "-")
            skill_name = safe_name or "skill"

        entry = {
            "pdf_path": pdf_path,
            "skill_name": skill_name,
        }
        console.print(
            f"[green]生成 skill 名称[/green]: [bold]{skill_name}[/bold] "
            f"← {pdf_path}"
        )
        return entry

    # 异步并发处理所有 PDF 文件
    tasks = [_gen_skill_name_for_pdf(pdf_path) for pdf_path in sorted(pdf_files)]
    entries = await asyncio.gather(*tasks)

    console.print(
        f"[bold green]✅ 已为 {len(entries)} 个 PDF 生成 skill name。[/bold green]"
    )
    return entries


async def _process_one(
    entry: Dict[str, str],
    semaphore: asyncio.Semaphore,
    quality_threshold: float = 0.5,
) -> Tuple[bool, str, str, Optional[str]]:
    """
    处理单个 PDF → skill 任务，使用线程池封装同步代码，实现整体异步。

    Returns:
        Tuple[bool, str, str, Optional[str]]:
            (是否成功, skill_name, pdf_path, 错误信息)
    """
    console = Console()
    pdf_path = entry["pdf_path"]
    skill_name = entry["skill_name"]

    if not pdf_path.lower().endswith(".pdf"):
        error_msg = f"跳过非 PDF 文件: {pdf_path}"
        console.print(
            f"[bold yellow]跳过非 PDF 文件: {pdf_path} (skill: {skill_name})[/bold yellow]"
        )
        return False, skill_name, pdf_path, error_msg

    if not os.path.isfile(pdf_path):
        error_msg = f"PDF 文件不存在: {pdf_path}"
        console.print(
            f"[bold red]PDF 文件不存在，已跳过: {pdf_path} (skill: {skill_name})[/bold red]"
        )
        return False, skill_name, pdf_path, error_msg

    async with semaphore:
        console.print(
            f"[bold cyan]开始生成 skill[/bold cyan]: [green]{skill_name}[/green] "
            f"← {pdf_path}"
        )
        try:
            # skill_seekers_gen 是同步函数，用 to_thread 包装，使其在异步环境下运行
            result = await asyncio.to_thread(
                skill_seekers_gen,
                user_case_file=pdf_path,
                skill_name=skill_name,
                quality_threshold=quality_threshold,
            )
            if not result:
                error_msg = "skill_seekers_gen 返回 False，生成失败"
                console.print(
                    f"[bold red]❌ skill 生成失败[/bold red]: {skill_name}, "
                    f"pdf: {pdf_path}, error: {error_msg}"
                )
                return False, skill_name, pdf_path, error_msg
            console.print(f"[bold green]✅ skill 生成完成[/bold green]: {skill_name}")
            return True, skill_name, pdf_path, None
        except Exception as e:
            error_msg = str(e)
            console.print(
                f"[bold red]❌ skill 生成失败[/bold red]: {skill_name}, "
                f"pdf: {pdf_path}, error: {e}"
            )
            return False, skill_name, pdf_path, error_msg


async def batch_generate_from_config(
    config_path: str,
    concurrency: int = 3,
    quality_threshold: float = 0.5,
) -> None:
    """
    依据 JSON 配置文件，批量从 PDF 生成 skill。

    :param config_path: JSON 配置文件路径，或包含 PDF 的目录路径
    :param concurrency: 最大并发任务数
    :param quality_threshold: 文档质量评估通过阈值
    """
    console = Console()
    # 支持两种输入：
    # 1. JSON 配置文件（原有逻辑）
    # 2. 目录路径：自动扫描目录下所有 PDF，并为其生成 skill name
    if os.path.isdir(config_path):
        console.print(
            f"[bold cyan]检测到目录输入，将扫描目录下的 PDF 文件：[/bold cyan]{config_path}"
        )
        entries = await _build_entries_from_dir(config_path)
    else:
        entries = _load_batch_config(config_path)

    if not entries:
        console.print("[bold yellow]未发现需要处理的任务。[/bold yellow]")
        return

    semaphore = asyncio.Semaphore(concurrency)

    console.print(
        f"[bold magenta]共读取到 {len(entries)} 个 PDF → skill 任务，"
        f"并发数: {concurrency}[/bold magenta]"
    )

    tasks = [_process_one(entry, semaphore, quality_threshold) for entry in entries]

    # 收集结果
    results: List[Tuple[bool, str, str, Optional[str]]] = []

    # 增强的进度展示
    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        BarColumn(),
        TaskProgressColumn(),
        console=console,
        transient=True,
    ) as progress:
        task_id = progress.add_task(
            description="批量生成 skill 中...",
            total=len(tasks),
        )

        for coro in asyncio.as_completed(tasks):
            result = await coro
            results.append(result)
            progress.update(task_id, advance=1)

    # 统计成功和失败
    success_count = sum(1 for success, _, _, _ in results if success)
    failure_count = len(results) - success_count
    failed_items = [
        (skill_name, pdf_path, error_msg)
        for success, skill_name, pdf_path, error_msg in results
        if not success
    ]

    # 输出统计报告
    console.print("\n" + "=" * 60)
    console.print("[bold cyan]📊 批量处理统计报告[/bold cyan]")
    console.print("=" * 60)
    console.print(f"[bold green]✅ 成功: {success_count} 个[/bold green]")
    console.print(f"[bold red]❌ 失败: {failure_count} 个[/bold red]")
    console.print(f"[bold]📝 总计: {len(results)} 个[/bold]")

    if failed_items:
        console.print("\n[bold red]失败的文件列表:[/bold red]")
        for idx, (skill_name, pdf_path, error_msg) in enumerate(failed_items, 1):
            console.print(
                f"  {idx}. [yellow]Skill:[/yellow] {skill_name}\n"
                f"     [yellow]PDF:[/yellow] {pdf_path}\n"
                f"     [yellow]错误:[/yellow] {error_msg}"
            )

    console.print("=" * 60)

    if failure_count == 0:
        console.print("[bold green]🎉 所有任务处理完成！[/bold green]")
    else:
        console.print(
            f"[bold yellow]⚠️  处理完成，但有 {failure_count} 个任务失败，请检查上述失败列表。[/bold yellow]"
        )


def run_skill_generation(
    input_path: str,
    output_path: Optional[str] = None,
    concurrency: int = 3,
    skill_name: Optional[str] = None,
    quality_threshold: float = 0.5,
) -> None:
    """
    统一入口函数，供外部（如 app.py）调用：

    - 如果 input_path 是单个案例文档路径（pdf/txt/markdown），则进行单个 skill 生成
    - 如果 input_path 是 JSON 配置文件路径或目录路径，则调度批量处理

    :param input_path: 输入路径（案例文档或批量配置路径）
    :param output_path: 输出目录路径，如果提供则设置 CUSTOM_SKILL_PATHS 环境变量
    :param concurrency: 批量生成时的并发数，默认为 3
    :param skill_name: skill 名称，如果提供则使用该名称，否则交互式获取或自动生成
    :param quality_threshold: 文档质量评估通过阈值（0~1），低于该值判定不通过并询问是否继续，默认 0.5
    """
    console = Console()

    # 如果提供了 output_path，设置环境变量
    if output_path:
        os.environ["CUSTOM_SKILL_PATHS"] = output_path
        console.print(f"[bold cyan]输出目录设置为:[/bold cyan] {output_path}")

    # 单文件模式：既不是目录，也不是 .json，当作单个案例文档处理
    # 支持文件路径和 URL
    is_file = os.path.isfile(input_path) and not input_path.lower().endswith(".json")
    is_url = input_path.startswith(("http://", "https://"))

    if is_file or is_url:
        user_case_file = input_path

        # 获取/生成 skill 名称
        if skill_name:
            # 使用提供的 skill 名称
            console.print(
                f"[bold green]使用提供的 skill 名称：[/bold green]{skill_name}"
            )
        else:
            if is_url:
                # URL 模式：提示将从 URL 中提取技能名称
                console.print(
                    "[bold yellow]未提供 skill 名称，将从 URL 内容中自动提取技能名称…[/bold yellow]"
                )
                # URL 模式下，skill_name 将在 skill_seekers_gen 中从 URL 内容提取
                # 这里先设置为空字符串，让 skill_seekers_gen 处理
                skill_name = ""
            else:
                # 文件模式：自动生成 skill 名称
                console.print(
                    "[bold yellow]未提供 skill 名称，将根据案例文档名称自动生成名称…[/bold yellow]"
                )
                # 使用文件路径作为输入文本，由大模型提取关键信息生成 name
                skill_name = gen_skill_name_from_text(user_case_file)
                console.print(
                    f"[bold green]自动生成的 skill 名称为：[/bold green]{skill_name}"
                )

        print("========== 开始基于案例文档生成Skill ============")
        start_time = time.time()

        try:
            skill_seekers_gen(
                user_case_file=user_case_file,
                skill_name=skill_name,
                quality_threshold=quality_threshold,
            )
        finally:
            end_time = time.time()
            elapsed_time = end_time - start_time
            print(
                f"========== 完成Skill生成任务 (耗时: {elapsed_time:.2f}秒) ============"
            )
    else:
        # 批量模式：目录或 JSON 配置文件
        concurrency = max(1, concurrency)

        console.print(
            f"[bold cyan]使用路径[/bold cyan]: {input_path}  "
            f"[bold cyan]并发数[/bold cyan]: {concurrency}"
        )

        asyncio.run(
            batch_generate_from_config(
                input_path,
                concurrency=concurrency,
                quality_threshold=quality_threshold,
            )
        )
