import argparse
import datetime
import logging
import os
import re
import sys
from pathlib import Path
from typing import List, Optional

import httpx
from dotenv import load_dotenv
from langchain_openai import ChatOpenAI

# Add project root to sys.path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
sys.path.append(os.path.abspath(os.path.dirname(__file__)))

from architecture.genome import SkillGenome
from constants import ENV_FILE
from engine.report_generator import OptimizationReportGenerator
from optimizer import SkillOptimizer
from witty_insight_api import get_skill_logs

# Load environment variables
load_dotenv(ENV_FILE)

# Configure logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


# Langfuse Integration
try:
    from langfuse import Langfuse

    HAS_LANGFUSE = True

except ImportError:
    HAS_LANGFUSE = False

langfuse = None
if (
    HAS_LANGFUSE
    and os.getenv("LANGFUSE_PUBLIC_KEY")
    and os.getenv("LANGFUSE_SECRET_KEY")
):
    try:
        langfuse = Langfuse()
        logger.info("Langfuse initialized for Optimization Loop.")
    except Exception as e:
        logger.error(f"Failed to init Langfuse: {e}")
else:
    HAS_LANGFUSE = False
    logger.warning(
        "Langfuse not initialized. Optimization Loop traces will not be recorded."
    )


# --- LLM Client Setup ---
class RealLLMClient:
    def __init__(self):
        env_base_url = os.getenv("DEEPSEEK_BASE_URL")
        base_url = env_base_url if env_base_url else "https://api.deepseek.com/"

        # Determine model
        model_name = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")

        # Check API Key
        api_key = os.getenv("DEEPSEEK_API_KEY")
        if not api_key:
            # Fallback to OPENAI_API_KEY if DEEPSEEK not set (as per some setups)
            api_key = os.getenv("OPENAI_API_KEY")
            if not api_key:
                from constants import ENV_FILE

                raise ValueError(
                    f"\\n❌ Error: Neither DEEPSEEK_API_KEY nor OPENAI_API_KEY is set.\\n"
                    f"Please configure your AI model API key in the environment file:\\n"
                    f"   -> {ENV_FILE.absolute()}\\n"
                    f"Alternatively, you can run './scripts/opt.sh --help' to use the interactive setup."
                )

        self.llm = ChatOpenAI(
            model=model_name,
            base_url=base_url,
            api_key=api_key,
            http_client=httpx.Client(verify=False, timeout=300.0),
            http_async_client=httpx.AsyncClient(verify=False, timeout=300.0),
            max_tokens=4096,
            request_timeout=300.0,
        )

    def __call__(self, prompt):
        logger.info(f"\n[RealLLM] Sending Prompt (truncated): {prompt[:100]}...")
        try:
            response = self.llm.invoke(prompt)
            if hasattr(response, "content"):
                return response.content
            return str(response)
        except Exception as e:
            logger.error(f"[RealLLM] Error: {e}")
            return ""


# --- Core Logic Functions ---


def update_skill_name_in_md(content: str, new_name: str) -> str:
    """Update skill name in SKILL.md content."""
    # Try YAML frontmatter first
    pattern = r"^name:\s+(.+)$"
    match = re.search(pattern, content, re.MULTILINE)
    if match:
        return re.sub(
            pattern, f"name: {new_name}", content, count=1, flags=re.MULTILINE
        )

    # Fallback to header (only if name is in header)
    pattern = r"^#\s+(.+)$"
    match = re.search(pattern, content, re.MULTILINE)
    if match:
        return re.sub(pattern, f"# {new_name}", content, count=1, flags=re.MULTILINE)

    return content


def run_optimizer(
    mode: str,
    input_path: Path,
    output_path: Optional[Path] = None,
    human_feedback: Optional[str] = None,
) -> List[Path]:
    """
    Main entry point for function calls.

    Args:
        mode: 'static' or 'dynamic' or 'hybrid'
        input_path: Path to input directory or file
        output_path: Path to output directory (optional)
        human_feedback: Optional human feedback content to guide optimization

    Returns:
        List[Path]: List of paths to the optimized skill directories
    """

    # 1. Initialize Components
    try:
        llm_client = RealLLMClient()
    except ValueError as e:
        logger.error(str(e))
        return []

    # Use Factory Method to create optimizer with all dependencies wired up
    optimizer = SkillOptimizer.from_llm_client(llm_client)
    report_generator = OptimizationReportGenerator(llm_client)

    # 2. Resolve Paths
    input_path = Path(input_path).resolve()
    if output_path:
        output_path = Path(output_path).resolve()
        output_path.mkdir(parents=True, exist_ok=True)
    else:
        # Default output is same as input parent if input is file, or input itself if dir
        output_path = input_path.parent if input_path.is_file() else input_path

    # 3. Locate SKILL.md
    skill_files = []
    if input_path.is_file():
        if input_path.name.lower() == "skill.md":
            skill_files.append(input_path)
    elif input_path.is_dir():
        skill_files = list(input_path.rglob("SKILL.md"))  # Recursive search

    if not skill_files:
        logger.error(f"No SKILL.md found in {input_path}")
        return []

    logger.info(f"Found {len(skill_files)} skill(s) to process.")

    optimized_paths = []

    # 4. Processing Loop
    for skill_file in skill_files:
        logger.info(f"Processing: {skill_file}")

        # Create Trace for this Skill Optimization Run
        trace_id = None
        if langfuse:
            with langfuse.start_as_current_observation(
                as_type="span",
                name=f"Optimize Skill: {skill_file.parent.name}",
                metadata={"skill_file": str(skill_file), "mode": mode},
            ) as root_span:
                trace_id = langfuse.get_current_trace_id()
                print(f"This skill is recording with trace_id: {root_span.trace_id}")
                root_span.update(
                    input={
                        "mode": mode,
                        "skill_path": str(skill_file),
                        "human_feedback": human_feedback,
                    }
                )

        try:
            # Initialize variables
            optimized_genome = None
            diagnoses = []

            # Load Genome initially (try from directory for context)
            try:
                initial_genome = SkillGenome.from_directory(skill_file.parent)
            except Exception as e:
                logger.warning(f"Failed to load from directory: {e}. Fallback to file.")
                with open(skill_file, "r", encoding="utf-8") as f:
                    initial_genome = SkillGenome.from_markdown(f.read())

            if mode == "static":
                logger.info("Mode: Static (Cold Start)")
                optimized_genome, diagnoses = optimizer.optimize_static(
                    skill_file, trace_id=trace_id, human_feedback=human_feedback
                )

            elif mode == "dynamic":
                logger.info("Mode: Dynamic (Experience Crystallization)")

                # try to get history excution report
                report_items = get_skill_logs(skill=initial_genome.name, limit=3)

                # optimize_dynamic takes (genome, report)
                optimized_genome, diagnoses = optimizer.optimize_dynamic(
                    genome=initial_genome, report_items=report_items, trace_id=trace_id
                )

            elif mode == "hybrid":
                logger.info("Mode: Hybrid (Static + Dynamic)")

                # try to get history excution report
                report_items = get_skill_logs(skill=initial_genome.name)

                optimized_genome, diagnoses = optimizer.optimize_hybrid(
                    skill_path=skill_file,
                    report_items=report_items,
                    trace_id=trace_id,
                    human_feedback=human_feedback,
                )

            # 5. Save Result
            # Generate Timestamp
            timestamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")

            # Get Base Skill Name
            skill_name = skill_file.parent.name
            # Remove existing suffix if present
            base_skill_name = re.sub(
                r"[_-]optimized[_-]\d{8}[_-]\d{6}$", "", skill_name
            )

            # New Skill Name
            new_skill_name = f"{base_skill_name}-optimized-{timestamp}"

            # Determine Save Directory
            if output_path == skill_file.parent:
                # Create sibling directory to avoid overwrite/nesting
                outer_save_dir = skill_file.parent.parent / new_skill_name
            else:
                # Save inside output_path
                outer_save_dir = output_path / new_skill_name

            outer_save_dir.mkdir(parents=True, exist_ok=True)

            # The actual skill directory inside the wrapper
            skill_save_dir = outer_save_dir / base_skill_name
            skill_save_dir.mkdir(parents=True, exist_ok=True)

            # Save SKILL.md
            if optimized_genome:
                new_content = optimized_genome.to_markdown()
                if not new_content or len(new_content) < 50:
                    logger.warning(
                        "Optimized SKILL.md content is suspiciously short or empty!"
                    )

                save_file = skill_save_dir / "SKILL.md"
                with open(save_file, "w", encoding="utf-8") as f:
                    f.write(new_content)
                logger.info(f"Optimized skill saved to: {save_file}")

                # Save Auxiliary Files (scripts, references, etc.)
                # optimized_genome.files contains relative paths -> content
                if not optimized_genome.files:
                    logger.warning(
                        "No auxiliary files found in optimized genome! (Scripts/References may be missing)"
                    )

                for rel_path, file_content in optimized_genome.files.items():
                    dest_path = skill_save_dir / rel_path
                    dest_path.parent.mkdir(parents=True, exist_ok=True)
                    with open(dest_path, "w", encoding="utf-8") as f:
                        f.write(file_content)
                    logger.info(f"Saved auxiliary file: {rel_path}")
            else:
                logger.warning("Optimization returned None. Skipping save.")

            # Save Diagnoses
            if diagnoses:
                import json

                diagnoses_file = outer_save_dir / "diagnoses.json"
                diagnoses_data = [
                    {
                        "dimension": d.dimension,
                        "issue_type": d.issue_type,
                        "severity": d.severity,
                        "description": d.description,
                        "suggested_fix": d.suggested_fix,
                    }
                    for d in diagnoses
                ]
                with open(diagnoses_file, "w", encoding="utf-8") as f:
                    json.dump(diagnoses_data, f, indent=2, ensure_ascii=False)
                logger.info(f"Saved diagnoses to: {diagnoses_file}")

                # Report diagnoses to Langfuse
                if langfuse and trace_id:
                    with langfuse.start_as_current_observation(
                        trace_context={
                            "trace_id": trace_id,
                        },
                        name="Diagnoses",
                    ) as root_span:
                        root_span.update(
                            input=len(diagnoses),
                            output=diagnoses,
                        )

            # Generate and Save Optimization Report
            if optimized_genome and diagnoses:
                report_content = report_generator.generate_report(
                    original=initial_genome,
                    optimized=optimized_genome,
                    diagnoses=diagnoses,
                )
                report_file = outer_save_dir / "OPTIMIZATION_REPORT.md"
                with open(report_file, "w", encoding="utf-8") as f:
                    f.write(report_content)
                logger.info(f"Saved optimization report to: {report_file}")

            # Record successful optimization path
            optimized_paths.append(outer_save_dir)

        except Exception as e:
            logger.error(f"Optimization failed for {skill_file}: {e}")
            import traceback

            traceback.print_exc()
            if langfuse and trace_id:
                # Since we don't have the trace object here directly, we rely on flush or manual client usage
                # But trace object is local scope.
                # trace.update(output={"error": str(e)}) # if we had trace object
                pass

        # Flush Langfuse
        if langfuse:
            langfuse.flush()

        logger.info(f"Optimization log uploaded to Langfuse for trace ID: {trace_id}")

    return optimized_paths


# --- CLI Entry Point ---


def main():
    parser = argparse.ArgumentParser(description="Skill Optimizer CLI")

    parser.add_argument(
        "--mode",
        choices=["static", "dynamic", "hybrid"],
        required=True,
        help="Optimization mode: static (cold) or dynamic (trace-based) or hybrid (both)",
    )
    parser.add_argument(
        "--input",
        "-i",
        type=str,
        help="Input path (directory containing SKILL.md or file path)",
    )
    parser.add_argument(
        "--output",
        "-o",
        type=str,
        help="Output directory (optional, defaults to input dir)",
    )
    parser.add_argument(
        "--feedback",
        "-f",
        type=str,
        help="Path to human feedback file (optional). If not provided, will check HUMAN_FEEDBACK_FILE env var.",
    )

    args = parser.parse_args()

    if not args.input:
        parser.error("--input is required for static/dynamic modes")

    input_path = Path(args.input)
    output_path = Path(args.output) if args.output else None

    # Resolve Feedback Path (CLI > Env)
    feedback_path_str = args.feedback
    if not feedback_path_str:
        feedback_path_str = os.getenv("HUMAN_FEEDBACK_FILE")

    # Read Human Feedback if provided
    human_feedback_content = None
    if feedback_path_str:
        feedback_path = Path(feedback_path_str)
        if feedback_path.exists() and feedback_path.is_file():
            try:
                with open(feedback_path, "r", encoding="utf-8") as f:
                    human_feedback_content = f.read().strip()
                logger.info(f"Loaded human feedback from {feedback_path}")
            except Exception as e:
                logger.error(f"Failed to read feedback file: {e}")
        else:
            logger.warning(f"Feedback file not found or invalid: {feedback_path}")

    optimized_paths = run_optimizer(
        args.mode, input_path, output_path, human_feedback=human_feedback_content
    )

    if optimized_paths:
        logger.info(
            f"Optimization completed. Modified skill paths: {[str(p) for p in optimized_paths]}"
        )


if __name__ == "__main__":
    main()
