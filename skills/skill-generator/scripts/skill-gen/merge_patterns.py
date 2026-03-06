#!/usr/bin/env python3
"""
CLI tool to merge FailureCase objects into a FailurePattern and generate Skill.
"""

import argparse
import asyncio
import os
import sys
import yaml
from pathlib import Path
from rich.console import Console

# Add project root to sys.path
sys.path.append(str(Path(__file__).parent))

try:
    from dotenv import load_dotenv, find_dotenv
    load_dotenv(find_dotenv())
except Exception:
    pass

from skill_gen.skill_generation import generate_pattern_from_cases
from skill_gen.schema import FailureCase, FailurePattern, Skill
from skill_gen.skill_formatter import SkillFormatter

def main():
    parser = argparse.ArgumentParser(description="Merge Failure Cases into a Pattern")
    parser.add_argument(
        "-i",
        "--input",
        required=True,
        help="Input YAML file containing list of FailureCase objects",
    )
    parser.add_argument(
        "--base-pattern",
        help="Optional base FailurePattern YAML to merge into",
    )
    parser.add_argument(
        "-o",
        "--output-dir",
        required=True,
        help="Output directory for SKILL.md and pattern YAML",
    )
    
    args = parser.parse_args()
    console = Console()
    
    input_path = Path(args.input).resolve()
    output_dir = Path(args.output_dir).resolve()
    
    os.makedirs(output_dir, exist_ok=True)
    
    # Load Cases
    console.print(f"Loading cases from {input_path}...")
    with open(input_path, "r", encoding="utf-8") as f:
        cases_data = yaml.safe_load(f)
        
    if not cases_data:
        console.print("[bold red]No cases found in input YAML.[/bold red]")
        sys.exit(1)
        
    failure_cases = [FailureCase(**data) for data in cases_data]
    console.print(f"Loaded {len(failure_cases)} cases.")
    
    # Load Base Pattern if provided
    base_pattern = None
    if args.base_pattern:
        base_path = Path(args.base_pattern).resolve()
        console.print(f"Loading base pattern from {base_path}...")
        with open(base_path, "r", encoding="utf-8") as f:
            pattern_data = yaml.safe_load(f)
            if pattern_data:
                base_pattern = FailurePattern(**pattern_data)
                
    import json
    
    # Try to load asset metadata from same dir as input cases
    metadata_path = input_path.parent / "assets_metadata.json"
    generated_scripts = []
    reference_files = []
    
    if metadata_path.exists():
        console.print(f"Loading asset metadata from {metadata_path}...")
        try:
            with open(metadata_path, "r", encoding="utf-8") as f:
                metadata = json.load(f)
                generated_scripts = metadata.get("generated_scripts", [])
                reference_files = metadata.get("reference_files", [])
        except Exception as e:
            console.print(f"[yellow]Failed to load asset metadata: {e}[/yellow]")

    # Fallback: scan references if not provided
    if not reference_files:
        ref_dir = output_dir / "references"
        if ref_dir.exists():
             reference_files = [f"references/{f.name}" for f in ref_dir.glob("*.md")]

    try:
        # Generate Pattern
        console.print("[bold cyan]Generating Failure Pattern...[/bold cyan]")
        # We need to run async function properly
        # Note: generate_pattern_from_cases is async, defined in skill_generation.py
        # Check if generate_pattern_from_cases is imported correctly.
        # It is imported at top.
        
        failure_pattern = asyncio.run(
            generate_pattern_from_cases(failure_cases, base_pattern)
        )
        
        # Create Skill Object
        skill = Skill(
            failure_pattern=failure_pattern,
            failure_cases=failure_cases
        )
        
        # Save Outputs
        # 1. Pattern YAML
        pattern_file = output_dir / "failure_pattern.yaml"
        console.print(f"Saving pattern to {pattern_file}...")
        with open(pattern_file, "w", encoding="utf-8") as f:
            yaml.dump(
                failure_pattern.model_dump(mode="json"), 
                f, 
                allow_unicode=True, 
                sort_keys=False
            )
            
        # 2. SKILL.md
        skill_file = output_dir / "SKILL.md"
        console.print(f"Saving skill document to {skill_file}...")
        formatter = SkillFormatter()
        
        md_content = formatter.render(
            skill, 
            generated_scripts=generated_scripts, 
            reference_files=reference_files
        )
        with open(skill_file, "w", encoding="utf-8") as f:
            f.write(md_content)
            
        console.print(f"[bold green]Successfully generated Skill in {output_dir}[/bold green]")
        
    except Exception as e:
        console.print(f"[bold red]Error:[/bold red] {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    main()
