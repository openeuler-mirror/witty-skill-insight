import asyncio
import json
import logging
import os
import pathlib
import re
from typing import List

import ast
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import PydanticOutputParser

from .schema import FailureCase, FailurePattern, GeneralExperience, KnownInstance
from .utils import get_llm

logger = logging.getLogger(__name__)


class PatternInducer:
    def __init__(self):
        self.llm = get_llm()

    async def induce(
        self,
        cases: List[FailureCase],
        general_experiences: List[GeneralExperience] = [],
    ) -> FailurePattern:
        if not cases:
            raise ValueError("cases 不能为空")

        parser = PydanticOutputParser(pydantic_object=FailurePattern)

        prompt_path = pathlib.Path(__file__).parent / "prompts" / "pattern_induction.md"
        if not prompt_path.exists():
            raise FileNotFoundError(f"Prompt file not found at {prompt_path}")
        system_prompt = prompt_path.read_text(encoding="utf-8")

        general_experience_text = ""
        if general_experiences:
            general_experience_text = "\n".join(
                [f"- {exp.content}" for exp in general_experiences]
            )

        cases_list = [json.loads(c.model_dump_json()) for c in cases]
        cases_json = json.dumps(cases_list, indent=2, ensure_ascii=False)

        final_prompt_template = (
            system_prompt + "\n\n{output_constraints}\n\n{format_instructions}"
        )
        prompt = ChatPromptTemplate.from_messages([("user", final_prompt_template)])
        chain = prompt | self.llm

        def _extract_first_json_object(text: str) -> str:
            m = re.search(r"```json\s*(.*?)\s*```", text, re.DOTALL | re.IGNORECASE)
            if m:
                return m.group(1).strip()
            start = text.find("{")
            if start == -1:
                return text.strip()
            in_str = False
            esc = False
            depth = 0
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
                    depth += 1
                elif ch == "}":
                    depth -= 1
                    if depth == 0:
                        return text[start : i + 1].strip()
            return text[start:].strip()

        def _is_balanced_json_object(text: str) -> bool:
            s = text.strip()
            if not s.startswith("{"):
                return False
            in_str = False
            esc = False
            depth = 0
            for ch in s:
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
                    depth += 1
                elif ch == "}":
                    depth -= 1
                    if depth < 0:
                        return False
            return (not in_str) and depth == 0 and s.endswith("}")

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

        def _default_known_instances(items: List[FailureCase]) -> List[KnownInstance]:
            rows: List[KnownInstance] = []
            for c in items:
                params = {
                    "os": c.environment.os,
                    "platform": c.environment.platform,
                    "scope": c.environment.scope,
                    "trigger_event": c.trigger_event,
                }
                if c.environment.hardware:
                    params["hardware"] = c.environment.hardware
                rows.append(
                    KnownInstance(
                        case_id=c.case_id, title=c.title, parameter_values=params
                    )
                )
            return rows

        content = ""
        last_error: Exception | None = None
        try:
            timeout_s = float(os.getenv("LLM_REQUEST_TIMEOUT_S", "180"))
        except Exception:
            timeout_s = 180.0
        for attempt in range(2):
            output_constraints = "IMPORTANT: Return ONLY a complete valid JSON object. No markdown. No code fences."
            if attempt == 1:
                output_constraints += (
                    "\nIf the output would be long, keep all long text fields concise (<500 chars each) "
                    "and you may omit optional fields. Ensure all strings escape newlines as \\n."
                )

            inputs = {
                "cases_json": cases_json,
                "n": len(cases),
                "general_experience_text": general_experience_text,
                "output_constraints": output_constraints,
                "format_instructions": parser.get_format_instructions(),
            }

            try:
                response_msg = await asyncio.wait_for(
                    chain.ainvoke(inputs), timeout=timeout_s
                )
                content = response_msg.content
            except Exception as e:
                last_error = e
                continue
            json_str = _extract_first_json_object(content)

            if not _is_balanced_json_object(json_str):
                last_error = ValueError(
                    "LLM output does not contain a complete JSON object."
                )
                continue

            try:
                data = _loads_relaxed(json_str)
                break
            except Exception as e:
                last_error = e
                continue

        if last_error and "data" not in locals():
            debug_dir = pathlib.Path("output_skills") / "_debug"
            debug_dir.mkdir(parents=True, exist_ok=True)
            raw_path = debug_dir / f"induce_llm_raw_{cases[0].case_id}.txt"
            raw_path.write_text(
                content if isinstance(content, str) else str(content), encoding="utf-8"
            )
            raise last_error

        if "source_cases" not in data:
            data["source_cases"] = [c.case_id for c in cases]
        else:
            data["source_cases"] = [str(x) for x in data["source_cases"]]
            seen = set()
            ordered = []
            for cid in data["source_cases"] + [c.case_id for c in cases]:
                if cid not in seen:
                    seen.add(cid)
                    ordered.append(cid)
            data["source_cases"] = ordered

        if "known_instances" not in data or not data["known_instances"]:
            data["known_instances"] = [
                ki.model_dump(mode="json") for ki in _default_known_instances(cases)
            ]

        pattern = FailurePattern.model_validate(data)
        return pattern
