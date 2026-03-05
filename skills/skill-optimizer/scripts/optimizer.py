import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

from architecture.genome import SkillGenome
from engine.crystallizer import ExperienceCrystallizer, ReportParser
from engine.evaluation_adapter import EvaluationAdapter
from engine.mutator import DiagnosticMutator
from langfuse import Langfuse

logger = logging.getLogger(__name__)


class SkillOptimizer:
    """
    The Main Controller for the new "Static/Dynamic" Optimization Strategy.

    Strategy:
    1. Cold Start: Static 5D Evaluation -> Immediate Fix.
    2. Dynamic Run: Trace Analysis -> Experience Crystallization (Injection).
    """

    def __init__(
        self,
        evaluator: EvaluationAdapter,
        mutator: DiagnosticMutator,
        crystallizer: ExperienceCrystallizer,
        langfuse_client: Optional["Langfuse"] = None,
    ):
        self.evaluator = evaluator
        self.mutator = mutator
        self.crystallizer = crystallizer
        self.langfuse = langfuse_client

    @classmethod
    def from_llm_client(cls, llm_client: Any) -> "SkillOptimizer":
        """
        Factory method to create a SkillOptimizer with standard components from an LLM client.
        This encapsulates the wiring logic, keeping main.py clean while preserving Dependency Injection.
        """
        mutator = DiagnosticMutator(model_client=llm_client)
        evaluator = EvaluationAdapter(model_client=llm_client)
        parser = ReportParser(model_client=llm_client)
        crystallizer = ExperienceCrystallizer(parser, mutator)
        return cls(evaluator, mutator, crystallizer)

    def optimize_static(
        self,
        skill_path: Path,
        trace_id: Optional[str] = None,
        human_feedback: Optional[str] = None,
    ):
        """
        [Cold Start]
        Perform a static 5D health check on the skill content and apply fixes.
        Does NOT require running the skill.
        Returns: (optimized_genome, diagnoses)
        """
        logger.info(">>> Starting Static Optimization (Cold Start)...")

        # 1. Parse from Directory (supports files)
        try:
            genome = SkillGenome.from_directory(skill_path.parent)
        except Exception as e:
            logger.warning(
                f"Could not load from directory, falling back to file content. Error: {e}"
            )
            with open(skill_path, "r", encoding="utf-8") as f:
                genome = SkillGenome.from_markdown(f.read())

        # 2. Static Evaluate (Pass empty trace list)
        eval_result = self.evaluator.evaluate(
            genome, traces=[], trace_id=trace_id, human_feedback=human_feedback
        )

        # 3. Diagnose
        # Filter for static issues (exclude execution anomalies if any leak in)
        static_diagnoses = [
            d for d in eval_result.diagnoses if d.dimension != "Execution"
        ]

        # Note: If human feedback is present, we force mutation even if static_diagnoses is empty
        # because the human might be asking for a change that the evaluator didn't catch.
        # So we check if diagnoses exist OR reflection (feedback) is present.

        has_feedback = bool(
            eval_result.reflection
            and eval_result.reflection != "Combined diagnostics..."
        )

        if not static_diagnoses and not has_feedback:
            logger.info(
                ">>> No static issues found and no feedback provided. Skill is healthy."
            )
            return genome, []

        logger.info(
            f">>> Found {len(static_diagnoses)} static issues (and feedback present: {has_feedback}). Applying fixes..."
        )
        for d in static_diagnoses:
            logger.info(f"    - [{d.dimension}] {d.description}")

        if has_feedback:
            logger.info(f"    - [Human Feedback] {eval_result.reflection[:100]}...")

        # 4. Mutate
        variants = self.mutator.mutate(
            genome,
            static_diagnoses,
            trace_id=trace_id,
            reflection=eval_result.reflection,  # Pass the reflection (feedback) here
        )

        if variants:
            best_variant = variants[0]  # In static mode, we trust the repair
            return best_variant, static_diagnoses

        return genome, static_diagnoses

    def optimize_dynamic(
        self,
        genome: SkillGenome,
        report_items: Optional[List[Dict[str, Any]]] = None,
        trace_id: Optional[str] = None,
    ):
        """
        [Dynamic Run]
        Trace Analysis -> Experience Crystallization.
        Returns: (optimized_genome, diagnoses)
        """
        logger.info(">>> Starting Dynamic Optimization (Experience Crystallization)...")

        if report_items:
            return self.crystallizer.crystallize(genome, report_items)
        else:
            logger.warning("No reports found for dynamic run. Skipping.")
            return genome, []

    def optimize_hybrid(
        self,
        skill_path: Path,
        report_items: Optional[List[Dict[str, Any]]] = None,
        trace_id: Optional[str] = None,
        human_feedback: Optional[str] = None,
    ):
        """
        [Hybrid Run]
        Pipeline: Static Optimization -> Dynamic Optimization.
        Ensures the skill is structurally sound before injecting experience.
        Returns: (optimized_genome, all_diagnoses)
        """
        logger.info(">>> Starting Hybrid Optimization (Static + Dynamic)...")

        # 1. Run Static Optimization (Inject Feedback Here)
        genome_after_static, static_diagnoses = self.optimize_static(
            skill_path, trace_id=trace_id, human_feedback=human_feedback
        )

        # 2. Run Dynamic Optimization
        try:
            # We pass the genome from static step
            # Note: We don't pass feedback again to dynamic optimization to avoid double application
            genome_final, dynamic_diagnoses = self.optimize_dynamic(
                genome_after_static, report_items, trace_id=trace_id
            )

            # Merge diagnoses
            all_diagnoses = static_diagnoses + dynamic_diagnoses
            return genome_final, all_diagnoses

        except Exception as e:
            logger.error(f"Dynamic Optimization failed in Hybrid mode: {e}")
            import traceback

            traceback.print_exc()
            # Fallback to static result so we don't lose everything
            return genome_after_static, static_diagnoses
