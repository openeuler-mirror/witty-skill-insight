"""
Trace2Skill: Distill Trajectory-Local Lessons into Transferable Agent Skills

Based on arXiv:2603.25158v3

Three-stage pipeline:
1. Trajectory Generation - Collect execution traces with pass/fail labels
2. Parallel Multi-Agent Patch Proposal - Error (A-) and Success (A+) analysts
3. Hierarchical Merge - Conflict-free consolidation via inductive reasoning
"""

from .orchestrator import Trace2SkillOrchestrator, Trace2SkillConfig, run_trace2skill

__all__ = [
    "Trace2SkillOrchestrator",
    "Trace2SkillConfig",
    "run_trace2skill",
]