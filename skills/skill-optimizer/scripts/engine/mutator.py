from typing import List, Optional
import os
from architecture.genome import SkillGenome
from architecture.scoring import Diagnosis
from prompts.mutation_prompts import GENERAL_FIX_PROMPT, HUMAN_FEEDBACK_TEMPLATE
from langchain_core.messages import HumanMessage
from langchain.agents import create_agent
from langchain_core.tools import tool

try:
    from langfuse.langchain import CallbackHandler

    HAS_LANGFUSE = True
except ImportError:
    HAS_LANGFUSE = False


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
        reflection: Optional[str] = None # New parameter for human feedback/reflection
    ) -> List[SkillGenome]:
        """
        Generate new variants based on the diagnoses.
        Supports both simple LLM calls and Tool-Calling Agent logic.
        """
        if not diagnoses and not reflection:
            print(">>> No diagnoses and no reflection provided. Returning parent genome.")
            return [parent]

        # 1. Format Diagnosis List for Prompt
        diagnosis_text = ""
        for i, d in enumerate(diagnoses):
            diagnosis_text += f"{i+1}. [{d.dimension}] {d.description}\n   Fix Suggestion: {d.suggested_fix}\n"
        
        if not diagnosis_text:
            diagnosis_text = "No automated diagnoses found. Please refer to Human Feedback."

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
        if reflection and reflection.strip() and reflection != "Combined diagnostics...":
            feedback_section = HUMAN_FEEDBACK_TEMPLATE.format(content=reflection)
            # Append to the end of the prompt or insert before Task
            # Appending to end is usually fine as it's the last thing the LLM reads (Recency Bias)
            prompt += feedback_section
            print(">>> Injected Human Feedback into Prompt.")

        print(f">>> Calling Mutator LLM to fix {len(diagnoses)} issues (Feedback present: {bool(reflection)})...")

        # 3. Choose Execution Mode
        if hasattr(self.model_client, "llm"):
            # Agentic Mode (Tool Calling)
            return self._mutate_with_tools(parent, prompt, trace_id=trace_id)
        else:
            # Legacy Mode (String only)
            return self._mutate_legacy(parent, prompt)

    def _mutate_with_tools(self, parent: SkillGenome, prompt: str, trace_id: Optional[str] = None) -> List[SkillGenome]:
        """
        Agentic Mutation Loop using LangChain Agents (create_agent).
        """
        # Clone parent
        new_genome = SkillGenome(
            role=parent.role,
            structure=parent.structure,
            instruction=parent.instruction,
            content=parent.content,
            risk=parent.risk,
            raw_text=parent.raw_text,
            files=parent.files.copy(),
        )

        # Define Tools as Closures to capture new_genome state
        @tool
        def update_skill_content(content: str):
            """Update the main SKILL.md content."""
            new_genome.raw_text = content
            # Re-parse to keep dimensions in sync
            try:
                parsed = SkillGenome.from_markdown(content)
                new_genome.role = parsed.role
                new_genome.structure = parsed.structure
                new_genome.instruction = parsed.instruction
                new_genome.content = parsed.content
                new_genome.risk = parsed.risk
                return "Successfully updated SKILL.md content."
            except Exception as e:
                return f"Error parsing SKILL.md content: {e}"

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
        def write_auxiliary_file(path: str, content: str):
            """Create or update a script or reference file (e.g., scripts/monitor.sh)."""
            new_genome.files[path] = content
            return f"Successfully wrote {path}."

        @tool
        def delete_auxiliary_file(path: str):
            """Delete an auxiliary file."""
            if path in new_genome.files:
                del new_genome.files[path]
                return f"Successfully deleted {path}."
            return f"File {path} not found."

        tools = [
            update_skill_content,
            write_auxiliary_file,
            delete_auxiliary_file,
            record_fix,
        ]

        # Setup Agent Graph
        try:
            agent_graph = create_agent(
                model=self.model_client.llm,
                tools=tools,
                system_prompt=(
                    "You are an expert developer optimization assistant.\n"
                    "You MUST fix the issues identified in the diagnosis list.\n"
                    "CRITICAL: For EACH diagnosis you address, you MUST call the `record_fix` tool to log your action.\n"
                    "1. Read the provided SKILL.md and auxiliary files.\n"
                    "2. Use `update_skill_content` or file tools to apply fixes.\n"
                    "3. Use `record_fix` to document what you did for specific diagnoses.\n"
                    "If a diagnosis requires no action or is invalid, you can skip it, but prefer fixing if possible."
                ),
            )

            # Setup Langfuse Callback
            callbacks = []
            if (
                HAS_LANGFUSE
                and os.getenv("LANGFUSE_PUBLIC_KEY")
                and os.getenv("LANGFUSE_SECRET_KEY")
            ):
                print(">>> Initializing Langfuse CallbackHandler...")
                langfuse_handler = CallbackHandler(trace_context={"trace_id": trace_id})
                callbacks.append(langfuse_handler)

            # Run Agent
            print(">>> Starting Agentic Mutation Loop (Graph)...")

            # Use stream() instead of invoke() to capture events
            for event in agent_graph.stream(
                {"messages": [HumanMessage(content=prompt)]},
                stream_mode="updates",
                config={"callbacks": callbacks},
            ):
                for node, updates in event.items():
                    if "messages" in updates:
                        # Extract latest message
                        last_msg = updates["messages"][-1]

                        # Log based on message type
                        if hasattr(last_msg, "tool_calls") and last_msg.tool_calls:
                            # It's an AI Message deciding to call tools
                            print(
                                f"\n[Agent Thought]: Decided to call {len(last_msg.tool_calls)} tools:"
                            )
                            for tc in last_msg.tool_calls:
                                print(f"  - Tool: {tc['name']}")
                                print(f"    Args: {tc['args']}")

                        elif hasattr(last_msg, "content") and last_msg.content:
                            # It's a standard text response or final answer
                            print(
                                f"\n[Agent Message]: {last_msg.content[:200]}..."
                                if len(last_msg.content) > 200
                                else f"\n[Agent Message]: {last_msg.content}"
                            )

                        elif hasattr(last_msg, "tool_call_id"):
                            # It's a Tool Message (Result of tool execution)
                            print(
                                f"\n[Tool Result]: {last_msg.content[:200]}..."
                                if len(last_msg.content) > 200
                                else f"\n[Tool Result]: {last_msg.content}"
                            )

            print(">>> Agentic Loop Completed.")

        except Exception as e:
            print(f"!!! Agent Execution Error: {e}")
            # Fallback? Or just log error.
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
                new_content = self._extract_markdown(response)
                new_genome = SkillGenome.from_markdown(new_content)
                # Preserve existing files since legacy mode can't edit them
                new_genome.files = parent.files.copy()
                return [new_genome]
            except Exception as e:
                print(f"!!! Mutation failed: {e}")
                return [parent]
        else:
            print("!!! No model_client provided to Mutator. Skipping LLM call.")
            return [parent]

    def _extract_markdown(self, text: str) -> str:
        """
        Extract content from markdown code blocks if present.
        Handles nested code blocks by stripping only the outermost delimiters.
        """
        text = text.strip()

        # Check for standard markdown block
        if text.startswith("```markdown"):
            content = text[len("```markdown") :].strip()
            if content.endswith("```"):
                content = content[:-3].strip()
            return content

        # Check for generic code block
        elif text.startswith("```"):
            # Find the end of the first line (language identifier)
            first_newline = text.find("\n")
            if first_newline != -1:
                content = text[first_newline:].strip()
                if content.endswith("```"):
                    content = content[:-3].strip()
                return content

        return text.strip()
