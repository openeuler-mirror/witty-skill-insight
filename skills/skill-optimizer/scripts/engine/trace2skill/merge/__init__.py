"""
Merge modules for Trace2Skill Stage 3.

Hierarchical patch merging with programmatic conflict prevention.
"""

from .hierarchical_merge import HierarchicalMerge, MergeConfig, MergeResult

__all__ = [
    "HierarchicalMerge",
    "MergeConfig",
    "MergeResult",
]