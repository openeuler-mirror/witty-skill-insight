import logging
from typing import Optional
from langchain_core.prompts import ChatPromptTemplate
from .schema import FailureCase
from .utils import get_llm

logger = logging.getLogger(__name__)


class CaseExtractor:
    """
    Extracts structured FailureCase objects from unstructured text using LLM.
    """

    def __init__(self):
        self.llm = get_llm()

    async def extract(self, text: str) -> Optional[FailureCase]:
        """
        Extracts a FailureCase from the provided text.

        Args:
            text: The unstructured text describing a failure case.

        Returns:
            A FailureCase object if extraction is successful, None otherwise.
        """
        if not text or not text.strip():
            logger.warning("Empty text provided for extraction.")
            return None

        prompt = ChatPromptTemplate.from_messages(
            [
                (
                    "system",
                    """You are an expert SRE (Site Reliability Engineer). 
Your task is to analyze the provided text and extract a structured failure case.
Pay close attention to the environment, trigger events, symptoms, root cause, and remediation steps.
Ensure all fields in the FailureCase schema are populated accurately based on the text.
If information is missing, use reasonable defaults or mark as unknown/not specified where appropriate, 
but try to infer from context if possible without hallucinating.

IMPORTANT: Output the result strictly as a valid JSON object matching the FailureCase schema. Do not include any markdown formatting (like ```json).""",
                ),
                ("user", "Text to analyze:\n{text}\n\n{format_instructions}"),
            ]
        )

        try:
            from langchain_core.output_parsers import PydanticOutputParser

            parser = PydanticOutputParser(pydantic_object=FailureCase)

            chain = prompt | self.llm | parser
            result = await chain.ainvoke(
                {"text": text, "format_instructions": parser.get_format_instructions()}
            )
            return result
        except Exception as e:
            logger.error(f"Failed to extract FailureCase: {e}")
            return None
