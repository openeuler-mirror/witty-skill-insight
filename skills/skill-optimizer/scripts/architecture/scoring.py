from dataclasses import dataclass
from typing import List, Dict, Optional

@dataclass
class Diagnosis:
    """
    A structured diagnosis of what went wrong (or right).
    """
    dimension: str  # Role, Structure, Instruction, Content, Risk, or Execution
    issue_type: str # e.g., "Hallucination", "SchemaError", "Loop"
    severity: str   # Critical, Major, Minor
    description: str
    evidence: str   # Snippet from Trace supporting this diagnosis
    suggested_fix: Optional[str] = None

@dataclass
class ScoreVector:
    """
    The 5-Dimensional Fitness Score.
    Range 0.0 - 5.0 for each dimension.
    """
    role: float = 0.0
    structure: float = 0.0
    instruction: float = 0.0
    content: float = 0.0
    risk: float = 0.0

    def to_list(self) -> List[float]:
        return [self.role, self.structure, self.instruction, self.content, self.risk]

    def average(self) -> float:
        return sum(self.to_list()) / 5.0

    @property
    def is_perfect(self) -> bool:
        return all(s >= 4.8 for s in self.to_list())

@dataclass
class EvaluationResult:
    """
    Final output of the Evaluator phase.
    """
    scores: ScoreVector
    diagnoses: List[Diagnosis]
    
    # Raw feedback text from LLM Judge
    reflection: str = "" 
