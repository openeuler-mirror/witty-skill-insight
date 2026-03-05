import asyncio
import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import fitz  # PyMuPDF

from .utils import get_llm
from .markdown_formatter import md_formatter
from .html_extractor import run_html_extractor


class DocQualityValidator:
    """
    文档质量预检：根据输入源（文件路径或 URL）自动抽取内容，
    并使用 LLM 基于 operability_score / reasoning / suggestions 评估是否适合生成 skill。
    """

    DEFAULT_MAX_CHARS = 20000

    _SYSTEM_PROMPT = """你是一名 SRE/运维领域的技术文档评审专家，负责评估给定故障处理文档
是否具备沉淀为自动化 skill 的条件。请从可操作性和信息完备性角度进行审查。

需要检查的关键要素：
1. 是否有故障问题描述
2. 是否有定位故障的过程、工具、脚本

输出只允许为一个 JSON 对象，结构为：
{
  "operability_score": float,  # 0-1 之间，可操作性主观打分
  "reasoning": string,         # 用中文简要说明判断依据
  "suggestions": [string]      # 若认为当前不适合作为 skill 基础，给出需要补充或修改的建议
}

判断标准：
- 请综合上述信息要素与可操作性，给出合理的 operability_score，并在 reasoning 中说明原因；
- 如果信息基本齐全但表达略有不足，可以给出改进建议，但 operability_score 仍可保持在较高水平。"""

    @staticmethod
    def _extract_json_block(text: str) -> Optional[str]:
        if not text:
            return None
        start = text.find("{")
        end = text.rfind("}")
        if start == -1 or end == -1 or end <= start:
            return None
        return text[start : end + 1]

    @staticmethod
    def _read_pdf(path: str) -> str:
        doc = fitz.open(path)
        try:
            parts: List[str] = []
            for page in doc:
                parts.append(page.get_text("text"))
            return "\n".join(parts)
        finally:
            doc.close()

    @staticmethod
    def _read_markdown(path: str) -> str:
        with open(path, "r", encoding="utf-8") as f:
            return f.read()

    @staticmethod
    def _read_url(url: str) -> str:
        result = asyncio.run(run_html_extractor(url))
        return result.get("markdown", "") or ""

    def _extract_content(self, source: str) -> Tuple[Optional[str], Optional[str]]:
        """
        根据 source 类型抽取正文。返回 (content, error_message)。
        若 error_message 非空则 content 无效。
        """
        if source.startswith(("http://", "https://")):
            content = self._read_url(source)
            if not content.strip():
                return None, "无法从 URL 中提取用于评估的内容，建议检查页面是否可访问且包含正文。"
            return content, None

        path = Path(source)
        if not path.is_file():
            return None, f"待评估的文档不存在：{source}"

        suffix = path.suffix.lower()
        if suffix == ".pdf":
            content = self._read_pdf(str(path))
        elif suffix in {".md", ".markdown"}:
            content = self._read_markdown(str(path))
        elif suffix == ".txt":
            raw_txt = path.read_text(encoding="utf-8")
            content = md_formatter(raw_txt)
        else:
            return None, f"暂不支持的文档类型用于质量评估：{suffix}，当前仅支持 PDF / Markdown / TXT / URL。"

        if not content or not content.strip():
            return None, "无法从文档中提取有效文本内容，建议检查文档是否包含可读取的正文。"
        return content, None

    def _evaluate_text(
        self,
        doc_text: str,
        max_chars: int = DEFAULT_MAX_CHARS,
        qualify_threshold: float = 0.5,
    ) -> Tuple[bool, str, Dict[str, Any]]:
        """对已抽取的文档文本做 LLM 评估，返回 (is_qualified, feedback, result)。"""
        if not doc_text or not doc_text.strip():
            return False, "文档内容为空，无法生成 skill。", {}

        snippet = doc_text[:max_chars]
        user_prompt = f"""请根据系统提示中的评估规则与 JSON 输出格式，
仅阅读并评估下面给出的文档内容（可能已被截断，只看可见部分做判断），
并严格只返回一个符合要求的 JSON 对象，不要添加任何多余文字。

文档内容如下：
{snippet}
"""
        llm = get_llm()
        try:
            message = llm.invoke(
                [
                    {"role": "system", "content": self._SYSTEM_PROMPT},
                    {"role": "user", "content": user_prompt},
                ],
            )
            raw_text = getattr(message, "content", str(message)).strip()
        except Exception as e:
            return False, f"调用文档评估模型失败：{type(e).__name__}: {e}", {}

        json_block = self._extract_json_block(raw_text)
        if not json_block:
            return (
                False,
                "文档评估结果解析失败：未找到有效 JSON 内容，建议先人工检查文档是否包含故障场景、问题描述、定位过程和工具脚本信息。",
                {"raw": raw_text},
            )

        try:
            result: Dict[str, Any] = json.loads(json_block)
        except json.JSONDecodeError as e:
            return (
                False,
                f"文档评估结果解析失败：JSON 格式错误（{e}），建议先人工检查文档是否包含关键字段。",
                {"raw": raw_text},
            )

        raw_score = result.get("operability_score", None)
        try:
            operability_score: Optional[float] = float(raw_score) if raw_score is not None else None
        except (TypeError, ValueError):
            operability_score = None

        reasoning = str(result.get("reasoning") or "").strip()
        suggestions: List[str] = list(result.get("suggestions") or [])

        if operability_score is None:
            is_qualified = False
        else:
            is_qualified = operability_score >= qualify_threshold

        lines: List[str] = []
        if is_qualified:
            if operability_score is not None:
                lines.append(
                    f"✅ 文档通过预检，适合作为 skill 生成基础（可操作性评分：{operability_score:.2f}）。"
                )
            else:
                lines.append("✅ 文档通过预检，适合作为 skill 生成基础。")
            if reasoning:
                lines.append(f"评估说明：{reasoning}")
            if suggestions:
                lines.append("改进建议（可选）：")
                for idx, s in enumerate(suggestions, 1):
                    lines.append(f"  {idx}. {s}")
        else:
            if operability_score is not None:
                lines.append(
                    f"❌ 文档当前不满足自动生成 skill 的条件（可操作性评分：{operability_score:.2f}）。"
                )
            else:
                lines.append("❌ 文档当前不满足自动生成 skill 的条件。")
            if reasoning:
                lines.append(f"评估说明：{reasoning}")
            if suggestions:
                lines.append("建议补充：")
                for idx, s in enumerate(suggestions, 1):
                    lines.append(f"  {idx}. {s}")

        feedback = "\n".join(lines)
        return is_qualified, feedback, result

    def evaluate(
        self,
        source: str,
        max_chars: int = DEFAULT_MAX_CHARS,
        qualify_threshold: float = 0.5,
    ) -> Tuple[bool, str, Dict[str, Any]]:
        """
        统一入口：根据 source（文件路径或 URL）自动抽取内容并做质量评估。
        qualify_threshold：通过阈值，operability_score >= qualify_threshold 判定为通过。

        返回：(is_qualified, feedback_text, raw_result_dict)
        """
        content, err = self._extract_content(source)
        if err is not None:
            return False, err, {}
        return self._evaluate_text(
            content,
            max_chars=max_chars,
            qualify_threshold=qualify_threshold,
        )


def evaluate_doc_source_for_skill(
    source: str,
    max_chars: int = 20000,
    qualify_threshold: float = 0.5,
) -> Tuple[bool, str, Dict[str, Any]]:
    """
    根据输入源（文件路径或 URL）自动判断类型、抽取内容并评估是否适合生成 skill。
    qualify_threshold：通过阈值，评估分数低于该值判定为不通过。
    """
    return DocQualityValidator().evaluate(
        source,
        max_chars=max_chars,
        qualify_threshold=qualify_threshold,
    )
