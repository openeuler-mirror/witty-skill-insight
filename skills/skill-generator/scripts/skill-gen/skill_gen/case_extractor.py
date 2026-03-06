import logging
from typing import Optional, List
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
                ("user", "Text to analyze:\n{text}\n\n{format_instructions}"),
            ]
        )

        try:
            from langchain_core.output_parsers import PydanticOutputParser
            from typing import List

            # 定义一个包装类来解析列表，或者直接使用 List[FailureCase]
            # PydanticOutputParser 有时对 List 支持不好，使用 Pydantic wrapper
            class FailureCaseList(BaseModel):
                cases: List[FailureCase]

            parser = PydanticOutputParser(pydantic_object=FailureCaseList)

            chain = prompt | self.llm | parser
            result = await chain.ainvoke(
                {"text": text, "format_instructions": parser.get_format_instructions()}
            )

            # Regenerate IDs
            cases = result.cases
            for case in cases:
                case.case_id = case.generate_id()

            return cases
        except Exception as e:
            logger.error(f"Failed to extract FailureCases: {e}")
            return []
