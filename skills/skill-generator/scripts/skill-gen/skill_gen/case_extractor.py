import ast
import asyncio
import json
import logging
import pathlib
import re
import os
from typing import List
from langchain_core.prompts import ChatPromptTemplate
from pydantic import BaseModel
from .schema import FailureCase
from .utils import get_llm

logger = logging.getLogger(__name__)


class CaseExtractor:
    """
    Extracts structured FailureCase objects from unstructured text using LLM.
    """

    def __init__(self):
        self.llm = get_llm()

    async def extract(self, text: str) -> List[FailureCase]:
        """
        Extracts FailureCases from the provided text.
        Supports extracting multiple cases if present.

        Args:
            text: The unstructured text describing failure case(s).

        Returns:
            A list of FailureCase objects.
        """
        if not text or not text.strip():
            logger.warning("Empty text provided for extraction.")
            return []

        # 分段处理逻辑：这里简化为整体输入，要求 LLM 返回列表
        # 如果文档非常长，可以考虑先 split text

        prompt = ChatPromptTemplate.from_messages(
            [
                (
                    "system",
                    """You are an expert SRE (Site Reliability Engineer). 
Your task is to analyze the provided text and extract structured failure cases.
The text may contain one or more independent failure cases. 
You must identify each distinct case and extract it as a separate object. Do NOT merge different cases into one.

Pay close attention to the environment, trigger events, symptoms, root cause, and remediation steps.
CRITICAL: You MUST extract specific version numbers (e.g., kernel versions, software versions) into the environment fields. Do not generalize them.
Ensure all fields in the FailureCase schema are populated accurately based on the text.
If information is missing, use reasonable defaults or mark as unknown/not specified where appropriate, 
but try to infer from context if possible without hallucinating.

For the `case_id` field, please generate a placeholder like "CASE-001", "CASE-002", etc. The system will regenerate a unique ID later.

IMPORTANT: Output the result strictly as a valid JSON object matching the List[FailureCase] schema. Do not include any markdown formatting (like ```json).""",
                ),
                (
                    "user",
                    "Text to analyze:\n{text}\n\n{output_constraints}\n\n{format_instructions}",
                ),
            ]
        )

        try:
            from langchain_core.output_parsers import PydanticOutputParser

            # 定义一个包装类来解析列表，或者直接使用 List[FailureCase]
            # PydanticOutputParser 有时对 List 支持不好，使用 Pydantic wrapper
            class FailureCaseList(BaseModel):
                cases: List[FailureCase]

            parser = PydanticOutputParser(pydantic_object=FailureCaseList)

            chain = prompt | self.llm

            def _extract_first_json(text: str) -> str:
                m = re.search(
                    r"```json\s*(.*?)\s*```", text, re.DOTALL | re.IGNORECASE
                )
                if m:
                    return m.group(1).strip()
                start = text.find("{")
                if start == -1:
                    start = text.find("[")
                if start == -1:
                    return text.strip()
                in_str = False
                esc = False
                depth_obj = 0
                depth_arr = 0
                for i in range(start, len(text)):
                    ch = text[i]
                    if in_str:
                        if esc:
                            esc = False
                        elif ch == "\\":
                            esc = True
                        elif ch == '"':
                            in_str = False
                        continue
                    if ch == '"':
                        in_str = True
                        continue
                    if ch == "{":
                        depth_obj += 1
                    elif ch == "}":
                        depth_obj -= 1
                    elif ch == "[":
                        depth_arr += 1
                    elif ch == "]":
                        depth_arr -= 1
                    if (depth_obj == 0 and depth_arr == 0) and ch in ("}", "]"):
                        return text[start : i + 1].strip()
                return text[start:].strip()

            def _strip_json_comments(s: str) -> str:
                s = re.sub(r"/\*.*?\*/", "", s, flags=re.DOTALL)
                s = re.sub(r"//.*?$", "", s, flags=re.MULTILINE)
                return s

            def _repair_json_common(s: str) -> str:
                s = s.strip().lstrip("\ufeff")
                s = (
                    s.replace("“", '"')
                    .replace("”", '"')
                    .replace("’", "'")
                    .replace("‘", "'")
                )
                s = _strip_json_comments(s)
                s = re.sub(r",\s*([}\]])", r"\1", s)
                s = re.sub(r"\bTrue\b", "true", s)
                s = re.sub(r"\bFalse\b", "false", s)
                s = re.sub(r"\bNone\b", "null", s)
                return s

            def _loads_relaxed(s: str):
                last_err: Exception | None = None
                candidates = [s, _repair_json_common(s)]
                for cand in candidates:
                    try:
                        return json.loads(cand)
                    except Exception as e:
                        last_err = e

                ast_candidate = s.strip().lstrip("\ufeff")
                ast_candidate = _strip_json_comments(ast_candidate)
                ast_candidate = re.sub(r",\s*([}\]])", r"\1", ast_candidate)
                ast_candidate = re.sub(r"\bnull\b", "None", ast_candidate)
                ast_candidate = re.sub(r"\btrue\b", "True", ast_candidate)
                ast_candidate = re.sub(r"\bfalse\b", "False", ast_candidate)
                try:
                    return ast.literal_eval(ast_candidate)
                except Exception as e:
                    if last_err:
                        raise last_err
                    raise e

            try:
                timeout_s = float(os.getenv("LLM_REQUEST_TIMEOUT_S", "180"))
            except Exception:
                timeout_s = 180.0

            content = ""
            last_error: Exception | None = None
            result: FailureCaseList | None = None
            for attempt in range(2):
                output_constraints = (
                    "IMPORTANT: Return ONLY a complete valid JSON object. No markdown. No code fences."
                )
                if attempt == 1:
                    output_constraints += (
                        "\nIf the output would be long, keep long text fields concise (<500 chars each). "
                        "Ensure all strings escape newlines as \\n."
                    )

                inputs = {
                    "text": text,
                    "output_constraints": output_constraints,
                    "format_instructions": parser.get_format_instructions(),
                }
                try:
                    response_msg = await asyncio.wait_for(
                        chain.ainvoke(inputs), timeout=timeout_s
                    )
                except Exception as e:
                    last_error = e
                    continue

                content = response_msg.content
                json_str = _extract_first_json(content)
                try:
                    data = _loads_relaxed(json_str)
                    if isinstance(data, list):
                        data = {"cases": data}
                    result = FailureCaseList.model_validate(data)
                    break
                except Exception as e:
                    last_error = e
                    continue

            if not result:
                debug_dir = pathlib.Path("output_skills") / "_debug"
                debug_dir.mkdir(parents=True, exist_ok=True)
                raw_path = debug_dir / "extract_cases_llm_raw.txt"
                raw_path.write_text(
                    content if isinstance(content, str) else str(content), encoding="utf-8"
                )
                if last_error:
                    raise last_error
                return []

            # Regenerate IDs
            cases = result.cases
            for case in cases:
                case.case_id = case.generate_id()

            return cases
        except Exception as e:
            logger.error(f"Failed to extract FailureCases: {e}")
            return []
