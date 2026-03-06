import logging
from typing import List, Optional
from langchain_core.prompts import ChatPromptTemplate
from pydantic import BaseModel, Field
from .schema import (
    FailureCase,
    MergeResult,
    MergeDecision,
    FailurePattern,
    GeneralExperience,
)
from .utils import get_llm

logger = logging.getLogger(__name__)


class MatchResponse(BaseModel):
    pattern_id: Optional[str] = Field(
        None, description="The ID of the matching pattern, or None if no match found."
    )
    reason: str = Field(..., description="Reason for the match or non-match.")


class PatternGenerationResponse(BaseModel):
    pattern: FailurePattern
    merge_notes: str


class PatternMerger:
    """
    Merges a new FailureCase into existing FailurePatterns or creates a new one.
    """

    def __init__(self):
        self.llm = get_llm()

    async def merge(
        self,
        new_case: FailureCase,
        existing_patterns: List[FailurePattern] = [],
        general_experiences: List[GeneralExperience] = [],
    ) -> MergeResult:
        """
        Merges a new FailureCase into existing patterns or creates a new one.

        Args:
            new_case: The new FailureCase to process.
            existing_patterns: List of existing FailurePatterns.
            general_experiences: List of GeneralExperience items to enrich the pattern.

        Returns:
            A MergeResult containing the updated/new pattern, decision, and notes.
        """
        if not existing_patterns:
            return await self._create_new_pattern(new_case, general_experiences)

        best_match = await self._find_best_match(new_case, existing_patterns)

        if best_match:
            return await self._merge_case_into_pattern(
                new_case, best_match, general_experiences
            )
        else:
            return await self._create_new_pattern(new_case, general_experiences)

    async def _find_best_match(
        self, new_case: FailureCase, patterns: List[FailurePattern]
    ) -> Optional[FailurePattern]:
        # Summarize patterns to save tokens
        patterns_summary = [
            {
                "pattern_id": p.pattern_id,
                "title": p.pattern_name,
                "category": p.category,
                "symptoms": p.symptoms.primary,
                "characteristic_errors": p.symptoms.characteristic_errors,
            }
            for p in patterns
        ]

        from langchain_core.output_parsers import PydanticOutputParser

        parser = PydanticOutputParser(pydantic_object=MatchResponse)

        prompt = ChatPromptTemplate.from_messages(
            [
                (
                    "system",
                    """You are an expert SRE. Analyze the new FailureCase and the list of existing FailurePatterns.
Determine if the new case belongs to any of the existing patterns based on root cause, symptoms, and environment.
Focus on the root cause and characteristic errors.
If a match is found, return the pattern_id.
If no match is found, return null.

IMPORTANT: Output strictly in valid JSON format matching the schema. No markdown.""",
                ),
                (
                    "user",
                    "New Case:\n{new_case}\n\nExisting Patterns Summary:\n{patterns_summary}\n\n{format_instructions}",
                ),
            ]
        )

        try:
            chain = prompt | self.llm | parser
            response = await chain.ainvoke(
                {
                    "new_case": new_case.model_dump_json(indent=2),
                    "patterns_summary": str(patterns_summary),
                    "format_instructions": parser.get_format_instructions(),
                }
            )

            if response and response.pattern_id:
                for p in patterns:
                    if p.pattern_id == response.pattern_id:
                        logger.info(f"Match found: {p.pattern_id} - {response.reason}")
                        return p

            logger.info(
                f"No match found: {response.reason if response else 'No response'}"
            )
            return None
        except Exception as e:
            logger.error(f"Failed to find match: {e}")
            return None

    async def _merge_case_into_pattern(
        self,
        new_case: FailureCase,
        pattern: FailurePattern,
        general_experiences: List[GeneralExperience] = [],
    ) -> MergeResult:
        from langchain_core.output_parsers import PydanticOutputParser

        parser = PydanticOutputParser(pydantic_object=PatternGenerationResponse)

        # Prepare general experience text
        general_experience_text = ""
        if general_experiences:
            general_experience_text = "\n".join(
                [f"- {exp.content}" for exp in general_experiences]
            )

        system_prompt = """You are an expert SRE. Update the existing FailurePattern by merging information from the new FailureCase.
Rules:
1. Preserve existing robust information, especially specific version constraints in applicable_scope.
2. Add new symptoms, trigger conditions, or evidences from the new case if they provide new value.
3. Update frequency/confidence if applicable.
4. If there are conflicts, resolve them or note them in merge_notes.
5. Ensure the output is a valid FailurePattern object.
6. Generate a `summary` that mentions the tools (e.g. crash, vmcore), problem category (e.g. deadlock, hang)"
"""

        if general_experiences:
            system_prompt += (
                '\nUse the provided "General Experience Context" (domain knowledge, operational patterns) '
                "to enrich the FailurePattern, especially in diagnosis steps, remediation steps, and decision logic."
            )

        user_prompt_template = "Existing Pattern:\n{existing_pattern}\n\nNew Case:\n{new_case}\n\n{format_instructions}"

        if general_experiences:
            user_prompt_template += (
                "\n\nGeneral Experience Context:\n{general_experience_text}"
            )

        prompt = ChatPromptTemplate.from_messages(
            [
                (
                    "system",
                    system_prompt,
                ),
                (
                    "user",
                    user_prompt_template,
                ),
            ]
        )

        try:
            chain = prompt | self.llm | parser
            inputs = {
                "existing_pattern": pattern.model_dump_json(indent=2),
                "new_case": new_case.model_dump_json(indent=2),
                "format_instructions": parser.get_format_instructions(),
            }
            if general_experiences:
                inputs["general_experience_text"] = general_experience_text

            response = await chain.ainvoke(inputs)

            if response:
                return MergeResult(
                    failure_pattern=response.pattern,
                    decision=MergeDecision.UPDATE,
                    merge_notes=response.merge_notes,
                )

            return MergeResult(
                failure_pattern=pattern,
                decision=MergeDecision.DISCARD,
                merge_notes="Failed to generate merged pattern.",
            )
        except Exception as e:
            logger.error(f"Failed to merge pattern: {e}")
            return MergeResult(
                failure_pattern=pattern,
                decision=MergeDecision.DISCARD,
                merge_notes=f"Error during merge: {str(e)}",
            )

    async def _create_new_pattern(
        self, new_case: FailureCase, general_experiences: List[GeneralExperience] = []
    ) -> MergeResult:
        from langchain_core.output_parsers import PydanticOutputParser

        parser = PydanticOutputParser(pydantic_object=PatternGenerationResponse)

        # Prepare general experience text
        general_experience_text = ""
        if general_experiences:
            general_experience_text = "\n".join(
                [f"- {exp.content}" for exp in general_experiences]
            )

        system_prompt = """You are an expert SRE. Create a generalized FailurePattern from this FailureCase.
Rules:
1. Generalize specific values (IPs, IDs, dates, hostnames) to placeholders.
2. CRITICAL: PRESERVE specific version numbers (e.g. kernel version, software version) in applicable_scope. Do NOT generalize versions unless they are irrelevant.
3. Extract clear symptoms, root cause, and steps.
4. Generate a unique pattern_id (e.g., FM-<Category>-<Keywords>-001).
5. Ensure the output is a valid FailurePattern object.
6. Generate a `summary` that mentions the tools (e.g. crash, vmcore), problem category (e.g. deadlock, hang)"
"""

        if general_experiences:
            system_prompt += (
                '\nUse the provided "General Experience Context" (domain knowledge, operational patterns) '
                "to enrich the FailurePattern, especially in diagnosis steps, remediation steps, and decision logic."
            )

        user_prompt_template = "New Case:\n{new_case}\n\n{format_instructions}"

        if general_experiences:
            user_prompt_template += (
                "\n\nGeneral Experience Context:\n{general_experience_text}"
            )

        prompt = ChatPromptTemplate.from_messages(
            [
                (
                    "system",
                    system_prompt,
                ),
                ("user", user_prompt_template),
            ]
        )

        try:
            chain = prompt | self.llm | parser
            inputs = {
                "new_case": new_case.model_dump_json(indent=2),
                "format_instructions": parser.get_format_instructions(),
            }
            if general_experiences:
                inputs["general_experience_text"] = general_experience_text

            response = await chain.ainvoke(inputs)

            if response:
                return MergeResult(
                    failure_pattern=response.pattern,
                    decision=MergeDecision.CREATE,
                    merge_notes=response.merge_notes,
                )
            # If failed, raise exception or return None
            raise ValueError("Failed to create new pattern")
        except Exception as e:
            logger.error(f"Failed to create pattern: {e}")
            raise e
