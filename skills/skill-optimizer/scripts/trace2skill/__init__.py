"""
Trace2Skill: Distill Trajectory-Local Lessons into Transferable Agent Skills

Based on arXiv:2603.25158v3

Three-stage pipeline:
1. Trajectory Generation - Collect execution traces with pass/fail labels
2. Parallel Multi-Agent Patch Proposal - Error (A-) and Success (A+) analysts
3. Hierarchical Merge - Conflict-free consolidation via inductive reasoning
"""

from .trajectory import Trajectory, TrajectoryStep, TrajectorySet
from .patch import SkillPatch, PatchOperation, PatchEdit, PatchPool
from .orchestrator import Trace2SkillOrchestrator, Trace2SkillConfig, run_trace2skill
from .analysis.error_analyst import ErrorAnalyst
from .analysis.success_analyst import SuccessAnalyst
from .merge.hierarchical_merge import HierarchicalMerge, MergeConfig, MergeResult

__all__ = [
    "Trajectory",
    "TrajectoryStep", 
    "TrajectorySet",
    "SkillPatch",
    "PatchOperation",
    "PatchEdit",
    "PatchPool",
    "Trace2SkillOrchestrator",
    "Trace2SkillConfig",
    "run_trace2skill",
    "ErrorAnalyst",
    "SuccessAnalyst",
    "HierarchicalMerge",
    "MergeConfig",
    "MergeResult",
]