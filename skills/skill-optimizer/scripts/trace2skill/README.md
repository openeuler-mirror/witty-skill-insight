# Trace2Skill Architecture

Based on arXiv:2603.25158v3

## Pipeline Overview

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                        Trace2Skill Pipeline                                    │
│                  Based on arXiv:2603.25158v3                               │
└─────────────────────────────────────────────────────────────────────────────────────────────┘

Stage 1: Input          Stage 2: Analysis           Stage 3: Output
┌──────────────┐      ┌──────────────────┐      ┌──────────────────┐
│ TrajectorySet │─────▶│Error Analyst (A-)│      │ Hierarchical    │
│ (T⁻ + T⁺)  │      │ Success Analyst │─────▶│ Merge (M)      │─────▶ Skill S*
│              │      │ (A+)          │      │               │
└──────────────┘      └──────────────────┘      └──────────────────┘
       │                       │                        │
       │              ┌───────┴───────┐           │
       │              ▼               ▼           │
       │        ┌──────────┐   ┌──────────┐       │
       │        │P⁻ patches│   │P⁺ patches│       │
       │        └──────────┘   └──────────┘       │
       │              │               │           │
       └──────────────┴───────────────┘           │
                      │                     │
                      ▼                     ▼
              ┌──────────────────────────────────┐
              │      PatchPool (P = P⁻ ∪ P⁺)      │
              │   + Prevalence Weighting           │
              │   + Conflict Detection          │
              └──────────────────────────────────┘
```

---

## Core Primitives & Classes

### 1. Trajectory Data (`trajectory.py`)

```
┌─────────────────────────────────────────────┐
│ Trajectory                               │
├─────────────────────────────────────────────┤
│ task_id: str                            │
│ query: str                            │
│ steps: list[TrajectoryStep]             │
│ final_output: str                     │
│ status: TrajectoryStatus (SUCCESS/FAILURE/UNKNOWN)│
│ ground_truth: Optional[str]           │
│ metadata: dict                       │
│                                      │
│ Methods:                             │
│   .is_success() → bool               │
│   .is_failure() → bool               │
│   .format_for_analyst() → str         │
└─────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────┐
│ TrajectoryStep                           │
├─────────────────────────────────────────────┤
│ step_number: int                        │
│ reasoning: str   ← LLM thought process │
│ tool_call: str   ← function call      │
│ observation: str ← tool result        │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│ TrajectorySet                            │
├─────────────────────────────────────────────┤
│ trajectories: list[Trajectory]         │
│ source_skill: Optional[str]            │
│ metadata: dict                       │
│                                      │
│ Properties:                         │
│   .success_set → TrajectorySet       │
│   .failure_set → TrajectorySet       │
│   .success_count → int              │
│   .failure_count → int             │
│   .total_count → int               │
│   .success_rate → float           │
│                                      │
│ Class Methods:                       │
│   .load_from_directory(Path)         │
│   .from_dict(dict)                 │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│ TrajectoryStatus (Enum)               │
├─────────────────────────────────────────────┤
│ SUCCESS                              │
│ FAILURE                              │
│ UNKNOWN                              │
└─────────────────────────────────────────────┘
```

### 2. Patch Data (`patch.py`)

```
┌─────────────────────────────────────────────┐
│ SkillPatch                              │
├─────────────────────────────────────────────┤
│ patch_id: str                          │
│ source_trajectory_id: Optional[str]    │
│ is_from_error: bool    ← True=Error Analyst│
│ edits: list[PatchEdit]               │
│ reasoning: str                    │
│ metadata: dict                    │
└─────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────┐
│ PatchEdit                              │
├─────────────────────────────────────────────┤
│ file: str (relative path)           │
│ operation: PatchOperation         │
│   - INSERT, INSERT_AFTER          │
│   - INSERT_BEFORE, REPLACE         │
���   - REPLACE_RANGE, DELETE         │
│ target: Optional[str]              │
│ target_start_line: Optional[int]   │
│ target_end_line: Optional[int]     │
│ content: Optional[str]           │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│ PatchPool                              │
├─────────────────────────────────────────────┤
│ patches: list[SkillPatch]           │
│                                      │
│ Properties:                         │
│   .error_patches → list[SkillPatch]│
│   .success_patches → list[SkillPatch]│
│   .total_count → int              │
└─────────────────────────────────────────────┘
```

### 3. Analysts (`analysts/`)

#### Error Analyst (A-)

```
┌──────────────────────────────────────────────────────────────┐
│ Error Analyst (A-)                              Stage 2a     │
│ ─────────────────────────────────────────────────────── │
│                                                         │
│ Extends: ReAct-style multi-turn agentic loop                  │
│                                                         │
│ Required Workflow (MANDATORY):                           │
│   1. Understand task & failure surface                   │
│   2. Trace failure to agent behavior                   │
│   3. Validate root cause with minimal fix            │
│   4. Re-evaluate (repeat if needed)                       │
│                                                         │
│ Key Features:                                         │
│   - Quality gate: excludes unverified patches            │
│   - Max turns: configurable (default: 10)              │
│   - Parallel execution via BatchErrorAnalyst              │
│                                                         │
│ Output: AnalysisResult with:                         │
│   - patch: Optional[SkillPatch]                     │
│   - failure_cause_items: list[str]                 │
│   - failure_memory_items: list[str] (≤3)          │
│   - reasoning: str                               │
│   - turn_count: int                             │
│   - validated: bool                            │
└──────────────────────────────────────────────────────────────┘
```

#### Success Analyst (A+)

```
┌──────────────────────────────────────────────────────────────┐
│ Success Analyst (A+)                             Stage 2b    │
│ ─────────────────────────────────────────────────────── │
│                                                         │
│ Single-pass pattern extraction                         │
│                                                         │
│ Required Workflow:                                 │
│   1. Clean trajectory                             │
│   2. Identify generalizable behavior patterns      │
│   3. Propose skill patch                        │
│                                                         │
│ Requirements:                                    │
│   - Broad Coverage: every effective behavior       │
│   - Frequency Awareness: common patterns first │
│   - Generalization: not task-specific           │
│                                                         │
│ Output: SuccessAnalysisResult with:               │
│   - patch: Optional[SkillPatch]                     │
│   - success_memory_items: list[dict]            │
│   - reasoning: str                               │
└──────────────────────────────────────────────────────────────┘
```

### 4. Hierarchical Merge (`merge/`)

```
┌──────────────────────────────────────────────────────────────┐
│ Hierarchical Merge (M)                           Stage 3      │
│ ─────────────────────────────────────────────────────── │
│                                                         │
│ Batches patches in groups of B_merge (default: 32)        │
│                                                         │
│ Levels: L = ceil(log_B(|P|)) (max 4)                     │
│                                                         │
│ At each level ℓ:                                     │
│   1. Deduplicate similar edits                    │
│   2. Resolve conflicts                         │
│   3. Preserve unique insights                 │
│   4. Prevalence-weighted consolidation      │
│                                                         │
│ Guardrails (Triple Check):                              │
│   1. File existence: reject non-existent files    │
│   2. Conflict detection: same line range       │
│   3. SKILL.md format validation          │
└──────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│ MergeConfig                          │
├─────────────────────────────────────────────┤
│ batch_size: int = 32              │
│ max_levels: int = 4             │
│ enable_prevalence_weighting: bool│
│ reference_dir: Optional[Path]    │
│ check_file_existence: bool      │
│ check_conflicts: bool         │
│ validate_format: bool         │
│ skill_root: Optional[Path]     │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│ MergeResult                         │
├─────────────────────────────────────────────┤
│ final_patch: Optional[SkillPatch]│
│ reasoning: str              │
│ levels_completed: int         │
│ patches_merged: int          │
│ conflicts_detected: list[str] │
│ unique_patterns: list[str]   │
│ metadata: dict            │
└─────────────────────────────────────────────┘
```

### 5. Orchestrator (`orchestrator.py`)

```
┌──────────────────────────────────────────────────────────────┐
│ Trace2SkillOrchestrator                              │
│ ─────────────────────────────────────────────────────── │
│ Main entry point for trace-driven optimization            │
│                                                         │
│ run() → Trace2SkillResult                            │
│       │                                            │
│       ▼                                            │
│   1. Load TrajectorySet from trajectory_dir            │
│   2. Run Error Analysts in parallel (A-)            │
│   3. Run Success Analysts in parallel (A+)           │
│   4. Build PatchPool from results                  │
│   5. Hierarchical Merge                         │
│   6. Apply final patch to skill                 │
│   7. Save evolved skill to output_dir          │
└──────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│ Trace2SkillConfig                      │
├─────────────────────────────────────────────┤
│ trajectory_dir: Optional[Path]     │
│ skill_path: Path             │
│ output_dir: Optional[Path]      │
│ max_concurrent: int = 8       │
│ max_error_turns: int = 10     │
│ merge_batch_size: int = 32    │
│ merge_max_levels: int = 4   │
│ enable_success_analyst: bool │
│ enable_error_analyst: bool   │
│ save_snapshots: bool       │
└─────────────────────────────���─���─────────────┘

┌─────────────────────────────────────────────┐
│ Trace2SkillResult                 │
├─────────────────────────────────────────────┤
│ evolved_skill_content: str       │
│ evolved_files: dict          │
│ error_patches_count: int     │
│ success_patches_count: int  │
│ merge_result: MergeResult   │
│ metadata: dict           │
└─────────────────────────────────────────────┘
```

---

## Entry Point (CLI)

```bash
# From trajectory directory
./scripts/opt.sh --action optimize --mode trace \
  --input /path/to/skill_dir \
  --trajectories /path/to/trajectories_dir
```

---

## Data Flow Summary

```
Input                          Processing                         Output
───────                        ──────────                         ─────
trajectory/*.json    ───▶ TrajectorySet     ───▶ Analysts (A-, A+) ───▶ PatchPool
                                              │              │
                                              │              ▼
                                              │         Patches
                                              │              │
                                              ▼              ▼
skill/SKILL.md ──────▶  skill_content  ─────────▶ HierarchicalMerge ──▶ SKILL.md*
                                              M                 
                                              │
                                              ▼
                                         Evolved Skill

Legend:
  T⁻ = Failure trajectories
  T⁺ = Success trajectories
  P⁻ = Error patches (from A-)
  P⁺ = Success patches (from A+)
  S* = Evolved skill (final output)
```

---

## File Structure

```
trace2skill/
├── __init__.py          # Module exports
├── trajectory.py        # Trajectory, TrajectoryStep, TrajectorySet
├── patch.py           # SkillPatch, PatchEdit, PatchPool
├── orchestrator.py     # Trace2SkillOrchestrator, Config, Result
├── analysts/
│   ├── __init__.py
│   ├── error_analyst.py    # ErrorAnalyst, BatchErrorAnalyst
│   └── success_analyst.py # SuccessAnalyst, BatchSuccessAnalyst
└── merge/
    ├── __init__.py
    └── hierarchical_merge.py # HierarchicalMerge, MergeConfig
```

---

## References

- Trace2Skill Paper: arXiv:2603.25158v3
- Section B.2.1: Error Analyst Prompt
- Section B.2.2: Success Analyst Prompt  
- Section B.3.1: Merge Operator Prompt