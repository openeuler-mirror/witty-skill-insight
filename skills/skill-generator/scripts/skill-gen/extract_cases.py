#!/usr/bin/env python3
"""
CLI tool to extract FailureCase objects from one or more documents.
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

from skill_gen.skill_generation import extract_cases_from_docs
from skill_gen.schema import FailureCase

def main():
    parser = argparse.ArgumentParser(description="Extract Failure Cases from documents")
    parser.add_argument(
        "-i",
        "--input",
        nargs="+",
        required=True,
        help="Input document paths (PDF, MD, TXT)",
    )
    parser.add_argument(
        "-o",
        "--output",
        required=True,
        help="Output YAML file path for failure cases (e.g., output/cases.yaml)",
    )
    parser.add_argument(
        "--asset-dir",
        help="Directory to save extracted assets (default: same directory as output file)",
    )

    args = parser.parse_args()
    console = Console()

    output_path = Path(args.output).resolve()
    asset_dir = Path(args.asset_dir).resolve() if args.asset_dir else output_path.parent
    
    # Ensure asset directory exists
    os.makedirs(asset_dir, exist_ok=True)
    
    # Ensure output directory exists
    os.makedirs(output_path.parent, exist_ok=True)

    console.print(f"[bold cyan]Input files:[/bold cyan] {args.input}")
    console.print(f"[bold cyan]Output file:[/bold cyan] {output_path}")
    console.print(f"[bold cyan]Asset directory:[/bold cyan] {asset_dir}")

    try:
        failure_cases, generated_scripts, reference_files = asyncio.run(
            extract_cases_from_docs(args.input, str(asset_dir))
        )
        
        if not failure_cases:
            console.print("[bold red]No failure cases extracted.[/bold red]")
            sys.exit(1)

        # Save to YAML
        console.print(f"Saving {len(failure_cases)} cases to {output_path}...")
        cases_data = [case.model_dump(mode="json") for case in failure_cases]
        
        with open(output_path, "w", encoding="utf-8") as f:
            yaml.dump(cases_data, f, allow_unicode=True, sort_keys=False)
            
        console.print(f"[bold green]Successfully saved failure cases to {output_path}[/bold green]")
        
        # Save asset metadata
        metadata_path = output_path.parent / "assets_metadata.json"
        metadata = {
            "generated_scripts": generated_scripts,
            "reference_files": reference_files
        }
        import json
        with open(metadata_path, "w", encoding="utf-8") as f:
            json.dump(metadata, f, indent=2, ensure_ascii=False)
        console.print(f"Saved asset metadata to {metadata_path}")
        
    except Exception as e:
        console.print(f"[bold red]Error:[/bold red] {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    main()
