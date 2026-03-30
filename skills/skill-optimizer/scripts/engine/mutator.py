import logging
import os
from typing import List, Optional

from architecture.genome import SkillGenome
from architecture.scoring import Diagnosis
from langchain.agents import create_agent
from langchain_core.messages import HumanMessage
from langchain_core.tools import tool
from prompts.mutation_prompts import (
    GENERAL_FIX_PROMPT,
    HUMAN_FEEDBACK_TEMPLATE,
    MUTATOR_SYSTEM_PROMPT,
)

logger = logging.getLogger(__name__)


class DiagnosticMutator:
    """
    The Causal Mutation Engine.
    Translates Diagnoses into specific Code Modifications.
    """

    def __init__(self, model_client=None):
        self.model_client = (
            model_client  # Should be a callable that takes prompt -> response
        )

    def mutate(
        self,
        parent: SkillGenome,
        diagnoses: List[Diagnosis],
        trace_id: Optional[str] = None,
        reflection: Optional[str] = None,  # New parameter for human feedback/reflection
    ) -> List[SkillGenome]:
        """
        Generate new variants based on the diagnoses.
        Supports both simple LLM calls and Tool-Calling Agent logic.
        """
        if not diagnoses and not reflection:
            print(
                ">>> No diagnoses and no reflection provided. Returning parent genome."
            )
            return [parent]

        # 1. Format Diagnosis List for Prompt
        diagnosis_text = ""
        for i, d in enumerate(diagnoses):
            diagnosis_text += f"{i+1}. [{d.dimension}] {d.description}\n   Fix Suggestion: {d.suggested_fix}\n"

        if not diagnosis_text:
            diagnosis_text = (
                "No automated diagnoses found. Please refer to Human Feedback."
            )

        # 2. Construct Prompt
        current_skill_text = parent.to_markdown()

        # Add list of existing files to context
        existing_files = "\n".join(parent.files.keys())
        file_context = (
            f"\n# Existing Auxiliary Files:\n{existing_files}\n"
            if existing_files
            else ""
        )

        prompt = GENERAL_FIX_PROMPT.format(
            skill_content=current_skill_text + file_context,
            diagnosis_list=diagnosis_text,
        )

        # Inject Human Feedback if available
        if (
            reflection
            and reflection.strip()
            and reflection != "Combined diagnostics..."
        ):
            feedback_section = HUMAN_FEEDBACK_TEMPLATE.format(content=reflection)
            # Append to the end of the prompt or insert before Task
            # Appending to end is usually fine as it's the last thing the LLM reads (Recency Bias)
            prompt += feedback_section
            print(">>> Injected Human Feedback into Prompt.")

        print(
            f">>> Calling Mutator LLM to fix {len(diagnoses)} issues (Feedback present: {bool(reflection)})..."
        )

        # 3. Choose Execution Mode
        if hasattr(self.model_client, "llm"):
            # Agentic Mode (Tool Calling)
            return self._mutate_with_tools(parent, prompt, trace_id=trace_id)
        else:
            # Legacy Mode (String only)
            return self._mutate_legacy(parent, prompt)

    def _mutate_with_tools(
        self, parent: SkillGenome, prompt: str, trace_id: Optional[str] = None
    ) -> List[SkillGenome]:
        """
        Agentic Mutation Loop using LangChain Agents (create_agent).
        """
        # Clone parent
        new_genome = SkillGenome(
            name=parent.name,
            raw_text=parent.raw_text,
            files=parent.files.copy(),
            file_meta=parent.file_meta.copy(),
            changelog=list(parent.changelog),
        )

        # Define Tools as Closures to capture new_genome state
        # The update_skill_content tool has been removed.
        # Massive strings inside JSON tool calls (like a 6KB SKILL.md) cause frequent token errors and infinite agent retry loops (resulting in the 300000ms bash timeout).
        # We now instruct the model to output the updated SKILL.md in plain markdown block in its response.

        @tool
        def record_fix(diagnosis_index: int, description: str, changed_sections: str):
            """
            Record a fix action in the changelog.
            MUST be called whenever you address a diagnosis.

            Args:
                diagnosis_index: The index of the diagnosis (from the provided list, starting at 1).
                description: A brief explanation of what was fixed and why.
                changed_sections: Which sections (e.g., 'Instruction', 'Risk') were modified.
            """
            new_genome.changelog.append(
                {
                    "diagnosis_index": str(diagnosis_index),
                    "description": description,
                    "changed_sections": changed_sections,
                }
            )
            return f"Recorded fix for Diagnosis #{diagnosis_index}."

        @tool
        def write_auxiliary_file(
            path: str,
            content: str,
            summary: str = "",
        ):
            """Create or update a script or reference file (e.g., scripts/monitor.sh)."""
            new_genome.files[path] = content
            if summary:
                new_genome.file_meta[path] = summary
            return f"Successfully wrote {path}."

        @tool
        def delete_auxiliary_file(path: str):
            """Delete an auxiliary file."""
            if path in new_genome.files:
                del new_genome.files[path]
                return f"Successfully deleted {path}."
            return f"File {path} not found."

        tools = [
            write_auxiliary_file,
            delete_auxiliary_file,
            record_fix,
        ]

        def extract_referenced_paths(skill_md: str) -> set[str]:
            import re

            if not skill_md:
                return set()
            matches = re.findall(
                r"\b(?:scripts|references)/[A-Za-z0-9._/\-]+\b", skill_md
            )
            return set(matches)

        def apply_skill_md_from_text(text: str) -> bool:
            extracted = self._extract_markdown(text)
            if len(extracted) > 100 and ("# Role" in extracted or "name:" in extracted):
                new_genome.raw_text = extracted
                try:
                    parsed = SkillGenome.from_markdown(extracted)
                    new_genome.name = parsed.name
                except Exception:
                    pass
                return True
            return False

        def run_agent_round(round_prompt: str) -> tuple[str, object | None]:
            callbacks = []
            ai_messages: list[str] = []
            last_non_tool_msg: object | None = None
            for event in agent_graph.stream(
                {"messages": [HumanMessage(content=round_prompt)]},
                stream_mode="updates",
                config={"callbacks": callbacks},
            ):
                for _, updates in event.items():
                    if "messages" not in updates:
                        continue
                    last_msg = updates["messages"][-1]
                    if getattr(last_msg, "tool_calls", None):
                        print(
                            f"\n[Agent Thought]: Decided to call {len(last_msg.tool_calls)} tools:"
                        )
                        for tc in last_msg.tool_calls:
                            print(f"  - Tool: {tc['name']}")
                            print(f"    Args: {tc['args']}")
                        continue

                    if getattr(last_msg, "tool_call_id", None):
                        print(
                            f"\n[Tool Result]: {last_msg.content[:200]}..."
                            if len(last_msg.content) > 200
                            else f"\n[Tool Result]: {last_msg.content}"
                        )
                        continue

                    if hasattr(last_msg, "content") and last_msg.content:
                        ai_messages.append(last_msg.content)
                        last_non_tool_msg = last_msg
                        print(
                            f"\n[Agent Message]: {last_msg.content[:200]}..."
                            if len(last_msg.content) > 200
                            else f"\n[Agent Message]: {last_msg.content}"
                        )

            if not ai_messages:
                return "", last_non_tool_msg
            return "\n\n".join(ai_messages), last_non_tool_msg

        def extract_headings(md: str) -> list[str]:
            import re

            out: list[str] = []
            for line in (md or "").splitlines():
                m = re.match(r"^(#{1,6})\s+(.+?)\s*$", line)
                if not m:
                    continue
                title = m.group(2).strip()
                if not title:
                    continue
                out.append(f"{m.group(1)} {title}")
            return out

        def looks_truncated(extracted: str) -> bool:
            if self._raw_has_unclosed_markdown_fence(extracted):
                return True
            if self._has_suspicious_colon_leadin(extracted):
                return True
            parent_headings = extract_headings(parent.raw_text)
            if not parent_headings:
                return False
            extracted_headings = set(extract_headings(extracted))
            step_like = [h for h in parent_headings if "步骤" in h]
            required = step_like if step_like else [h for h in parent_headings if h.startswith("## ")]
            required = [h for h in required if h not in {"## File references"}]
            if not required:
                return False
            missing = [h for h in required if h not in extracted_headings]
            if step_like and missing:
                return True
            if len(missing) / max(len(required), 1) >= 0.3:
                return True
            return False

        def retry_for_completeness(previous_extracted: str) -> bool:
            retries = int(os.getenv("SKILL_OPT_MUTATOR_TRUNCATION_RETRY", "1") or "1")
            if retries <= 0:
                return False
            if not looks_truncated(previous_extracted):
                return False
            parent_headings = extract_headings(parent.raw_text)
            required = [h for h in parent_headings if "步骤" in h] or [
                h for h in parent_headings if h.startswith("## ")
            ]
            required = [h for h in required if h not in {"## File references"}]
            required_str = os.linesep.join(f"- {h}" for h in required[:60])
            for _ in range(retries):
                round_prompt = (
                    "Your previous SKILL.md output was incomplete.\n"
                    "Output the COMPLETE updated SKILL.md as a single ```markdown``` code block.\n"
                    "Do not summarize, do not truncate, do not use placeholders.\n"
                    "Keep the original structure and include the following headings:\n"
                    f"{required_str}\n\n"
                    "Use the following as the source of truth:\n\n"
                    f"{prompt}\n"
                )
                agent_text, agent_msg = run_agent_round(round_prompt)
                if not agent_text:
                    continue
                self._log_skill_md_extraction_diagnostics(
                    extracted=self._extract_markdown(agent_text),
                    raw_text=agent_text,
                    last_msg=agent_msg,
                )
                if apply_skill_md_from_text(agent_text) and not looks_truncated(new_genome.raw_text):
                    return True
            return False

        try:
            agent_graph = create_agent(
                model=self.model_client.llm,
                tools=tools,
                system_prompt=MUTATOR_SYSTEM_PROMPT,
            )

            logger.info(">>> Starting Agentic Mutation Loop (Graph)...")

            max_rounds = int(os.getenv("SKILL_OPT_MUTATOR_MAX_ROUNDS", "2") or "2")
            missing: list[str] = []
            last_agent_text = ""

            for round_index in range(max_rounds):
                round_prompt = prompt if round_index == 0 else (
                    "You MUST fix the missing auxiliary files referenced by SKILL.md.\n"
                    "Requirements:\n"
                    "- For EACH missing file, call write_auxiliary_file(path, content, summary).\n"
                    "- Keep SKILL.md content consistent; only adjust references if necessary.\n"
                    "- Output the COMPLETE updated SKILL.md as a ```markdown``` code block.\n\n"
                    f"# Missing files:\n{os.linesep.join(f'- {p}' for p in missing)}\n\n"
                    f"# Current SKILL.md:\n```markdown\n{new_genome.raw_text}\n```\n"
                )

                last_agent_text, last_agent_msg = run_agent_round(round_prompt)
                if not last_agent_text:
                    logger.warning("Mutator agent produced no textual output.")
                    break
                self._log_skill_md_extraction_diagnostics(
                    extracted=self._extract_markdown(last_agent_text),
                    raw_text=last_agent_text,
                    last_msg=last_agent_msg,
                )

                if apply_skill_md_from_text(last_agent_text):
                    retry_for_completeness(new_genome.raw_text)
                    referenced = extract_referenced_paths(new_genome.raw_text)
                    missing = sorted(
                        [p for p in referenced if p not in new_genome.files]
                    )
                    if not missing:
                        break
                    logger.warning(
                        f"Mutator agent referenced missing auxiliary files: {missing}"
                    )
                else:
                    logger.warning(
                        "Mutator agent did not provide a valid SKILL.md markdown block."
                    )
                    break

            if missing:
                logger.warning(
                    f"Mutator failed to repair missing files after {max_rounds} rounds; returning parent genome."
                )
                return [parent]

            print(">>> Agentic Loop Completed.")

        except Exception as e:
            print(f"!!! Agent Execution Error: {e}")
            import traceback

            traceback.print_exc()

        return [new_genome]

    def _mutate_legacy(self, parent: SkillGenome, prompt: str) -> List[SkillGenome]:
        """
        Legacy String-based Mutation.
        """
        if self.model_client:
            try:
                response = self.model_client(prompt)
                raw_text = response.content if hasattr(response, "content") else str(
                    response
                )
                new_content = self._extract_markdown(raw_text)
                self._log_skill_md_extraction_diagnostics(
                    extracted=new_content, raw_text=raw_text, last_msg=response
                )
                new_genome = SkillGenome.from_markdown(new_content)
                new_genome.files = parent.files.copy()
                new_genome.file_meta = parent.file_meta.copy()
                return [new_genome]
            except Exception as e:
                print(f"!!! Mutation failed: {e}")
                return [parent]
        else:
            print("!!! No model_client provided to Mutator. Skipping LLM call.")
            return [parent]

    def _extract_markdown(self, text: str) -> str:
        """
        Extract content from markdown code blocks if present anywhere in the text.
        Handles nested code blocks by extracting the first matching block.
        """
        import re

        text = text.strip()

        def looks_like_skill_md(body: str) -> bool:
            b = body.lstrip()
            if b.startswith("---") and re.search(r"(?m)^name:\s*\S+", b):
                return True
            if "# Role" in body or "# Instruction" in body or "# Workflow" in body:
                return True
            if re.search(r"(?m)^#\s+\S+", body):
                return True
            return False

        def looks_like_plan(body: str) -> bool:
            b = body.lstrip()
            if b.startswith("PLAN\n") or b.startswith("PLAN\r\n"):
                return True
            if "Diagnosis Grouping:" in body and "PLAN" in body.splitlines()[0:3]:
                return True
            return False

        blocks: list[tuple[str, str]] = []
        for m in re.finditer(
            r"```(?P<lang>[A-Za-z0-9_-]+)?\s*\n(?P<body>.*?)(?:\n)?```",
            text,
            re.DOTALL,
        ):
            lang = (m.group("lang") or "").strip().lower()
            body = (m.group("body") or "").strip()
            blocks.append((lang, body))

        best_body = ""
        best_score = -10_000
        for lang, body in blocks:
            if not body:
                continue
            score = 0
            if lang == "markdown":
                score += 20
            if looks_like_skill_md(body):
                score += 15
            if looks_like_plan(body):
                score -= 1000
            if lang in {"bash", "sh", "shell", "zsh", "json", "yaml", "yml"}:
                score -= 5
            score += min(len(body) // 200, 10)
            if score > best_score:
                best_score = score
                best_body = body

        if best_body and looks_like_skill_md(best_body):
            return best_body.strip()

        match = re.search(r"```markdown\s*(.*?)\s*```", text, re.DOTALL | re.IGNORECASE)
        if match:
            return match.group(1).strip()

        return text.strip()

    def _log_skill_md_extraction_diagnostics(
        self,
        *,
        extracted: str,
        raw_text: str,
        last_msg: object | None = None,
    ) -> None:
        if not extracted:
            return

        token_usage = None
        finish_reason = None
        response_metadata = getattr(last_msg, "response_metadata", None)
        if isinstance(response_metadata, dict):
            token_usage = (
                response_metadata.get("token_usage")
                or response_metadata.get("usage")
                or response_metadata.get("tokenUsage")
            )
            finish_reason = (
                response_metadata.get("finish_reason")
                or response_metadata.get("finishReason")
                or response_metadata.get("stop_reason")
                or response_metadata.get("stopReason")
            )

        max_tokens = None
        llm = getattr(self.model_client, "llm", None)
        if llm is not None:
            max_tokens = getattr(llm, "max_tokens", None)

        lines = extracted.strip().splitlines()
        last_line = lines[-1] if lines else ""

        print(f"[Mutator Token Usage]: {token_usage} (max_tokens={max_tokens})")
        if finish_reason is not None:
            print(f"[Mutator Finish Reason]: {finish_reason}")
        print(f"[Last line of extracted SKILL.md]: {last_line!r}")

        if self._raw_has_unclosed_markdown_fence(raw_text):
            logger.warning(
                "Mutator output appears to have an unclosed markdown fence (possible truncation)."
            )

        last = last_line.strip()
        if last.startswith("#") or last.endswith(":"):
            logger.warning(
                "Extracted SKILL.md appears to end at an unstable boundary (possible early stop)."
            )

    @staticmethod
    def _raw_has_unclosed_markdown_fence(raw_text: str) -> bool:
        import re

        if not raw_text:
            return False
        if raw_text.count("```") % 2 == 1:
            return True
        if re.search(r"```markdown\b", raw_text, re.IGNORECASE) and not re.search(
            r"```markdown\b[\s\S]*?```",
            raw_text,
            re.IGNORECASE,
        ):
            return True
        return False

    @staticmethod
    def _has_suspicious_colon_leadin(md: str) -> bool:
        import re

        if not md:
            return False
        lines = md.splitlines()
        for i, line in enumerate(lines):
            if not re.match(r"^\s*(?:\d+\.|-)\s+.+[：:]\s*$", line):
                continue
            j = i + 1
            while j < len(lines) and not lines[j].strip():
                j += 1
            if j >= len(lines) or lines[j].lstrip().startswith("#"):
                return True
        return False
