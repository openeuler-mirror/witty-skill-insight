from enum import Enum
from typing import List, Optional
from pydantic import BaseModel, Field


class Importance(str, Enum):
    HIGH = "HIGH"
    NORMAL = "NORMAL"


class CommandType(str, Enum):
    DIAGNOSIS = "diagnosis"
    WORKAROUND = "workaround"
    ROOT_FIX = "root_fix"


class EvidenceType(str, Enum):
    ERROR_LOG = "error_log"
    CONFIG_ANOMALY = "config_anomaly"
    METRIC_ANOMALY = "metric_anomaly"
    LOG_OUTPUT = "log_output"


class KnowledgeGapType(str, Enum):
    CREDENTIAL_MISSING = "credential_missing"
    IMAGE_MISSING = "image_missing"
    EXTERNAL_DEPENDENCY = "external_dependency"
    VERSION_BOUND = "version_bound"
    COMMAND_INCOMPLETE = "command_incomplete"
    KNOWLEDGE_SILO = "knowledge_silo"


class SkillUsability(str, Enum):
    READY = "READY"
    BLOCKED = "BLOCKED"


class RemediationType(str, Enum):
    WORKAROUND = "workaround"
    ROOT_FIX = "root_fix"
    ROOT_FIX_ALTERNATIVE = "root_fix_alternative"


class Severity(str, Enum):
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"


class Confidence(str, Enum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class FailurePatternCategory(str, Enum):
    HARDWARE_CONFIG_ERROR = "硬件配置错误"
    OPERATION_ERROR = "操作引发"
    RESOURCE_EXHAUSTION = "资源耗尽"
    DEPENDENCY_FAILURE = "依赖故障"
    CONFIG_ERROR = "配置错误"
    OTHER = "其他"


class Environment(BaseModel):
    hardware: Optional[str] = Field(None, description="硬件型号，无则省略")
    os: str = Field(
        ..., description="操作系统，必须包含具体的版本号（如 EulerOS 2.0 SP8）"
    )
    platform: str = Field(
        ..., description="产品平台和版本，必须包含具体的内核版本或软件版本号"
    )
    scope: str = Field(..., description="影响范围，如'现网多台，必现'")


class TimelineEvent(BaseModel):
    event: str = Field(..., description="事件描述")


class Evidence(BaseModel):
    type: EvidenceType
    content: str = Field(..., description="证据内容，verbatim")
    source: str = Field(..., description="来源位置")
    importance: Importance = Field(..., description="重要性")


class Command(BaseModel):
    command: str = Field(..., description="命令原文，verbatim")
    type: CommandType
    context: str = Field(..., description="该命令在案例中的使用背景")
    verified: bool = Field(..., description="案例中是否有执行结果佐证")
    warning: Optional[str] = Field(None, description="有副作用时填写")


class KnowledgeGap(BaseModel):
    id: str = Field(..., description="GAP-XXX")
    type: KnowledgeGapType
    description: str = Field(..., description="具体描述缺失内容")
    blocking: bool
    location: Optional[str] = Field(None, description="在故障模式的哪个步骤")


class FailureCase(BaseModel):
    case_id: str = Field(..., description="来源文档编号或自动生成")
    title: str = Field(
        ..., description="简洁描述，格式：[组件] + [根因摘要] + [现象摘要]"
    )
    environment: Environment
    trigger_event: str = Field(..., description="触发故障的操作或事件")
    timeline: List[TimelineEvent] = Field(..., description="按时序列出关键事件")
    evidences: List[Evidence] = Field(..., description="所有支撑根因判断的证据")
    root_cause: str = Field(..., description="根因描述，可以有多层")
    commands: List[Command] = Field(..., description="案例中出现的所有命令")
    knowledge_gaps: List[KnowledgeGap]
    source_documents: List[str]

    def generate_id(self) -> str:
        """生成唯一ID: CASE-{hash(title+root_cause)[:8]}"""
        import hashlib

        content = f"{self.title}{self.root_cause}"
        hash_str = hashlib.md5(content.encode("utf-8")).hexdigest()[:8]
        return f"CASE-{hash_str.upper()}"


class ApplicableScope(BaseModel):
    hardware: Optional[str] = Field(None, description="硬件类型，可泛化")
    platform: str = Field(..., description="平台和版本范围")


class TriggerCondition(BaseModel):
    condition: str = Field(..., description="泛化描述，去掉具体实例名")
    # note is handled at pattern level or implicitly


class Symptoms(BaseModel):
    primary: List[str] = Field(..., description="现象描述")
    characteristic_errors: List[str] = Field(
        ..., description="可直接用于匹配的特征报错字符串"
    )


class DiagnosisStep(BaseModel):
    step: int
    action: str = Field(..., description="做什么")
    where: str = Field(..., description="在哪里看")
    command: Optional[str] = Field(None, description="命令，verbatim，无命令则省略")
    expected_output: str = Field(..., description="期望看到什么")
    critical: bool = Field(..., description="false 的步骤可跳过")
    confidence: Confidence
    source: str = Field(..., description="来自哪份文档哪个步骤")


class RemediationStep(BaseModel):
    step: int
    type: RemediationType
    action: str = Field(..., description="做什么")
    prerequisite: Optional[str] = Field(None, description="前置条件，可选")
    command: str = Field(..., description="命令，verbatim")
    condition: Optional[str] = Field(None, description="该命令适用的条件，可选")
    confidence: Confidence
    warning: Optional[str] = Field(
        None, description="可选，有副作用或数据丢失风险时必填"
    )
    rollback: Optional[str] = Field(None, description="可选，如何回滚")
    source: str = Field(..., description="来源")
    workaround_warning: Optional[str] = Field(
        None, description="workaround 必须附加此字段"
    )


class EdgeCase(BaseModel):
    scenario: str = Field(..., description="特殊场景描述")
    action: str = Field(..., description="处理方式")
    commands: List[str] = Field(..., description="命令，verbatim")
    source: str = Field(..., description="来源")
    confidence: Confidence


class Verification(BaseModel):
    action: str = Field(..., description="验证动作")
    expected: str = Field(..., description="期望结果")


class FailurePattern(BaseModel):
    pattern_id: str = Field(..., description="FM-<领域>-<关键词>-<序号>")
    pattern_name: str = Field(..., description="泛化的模式名，不含具体实例名/IP/时间")
    summary: str = Field(
        ...,
        description="故障模式的专业摘要。应包含：1. 诊断手段（如：通过 crash 工具分析 vmcore）；2. 问题分类（如：系统卡死、死锁）；3. 具体模式描述（环境/触发条件 -> 根因 -> 影响）。",
    )
    category: FailurePatternCategory
    severity: Severity
    applicable_scope: ApplicableScope
    trigger_conditions: List[TriggerCondition]
    trigger_condition_note: Optional[str] = Field(
        None, description="多个条件同时满足才触发时，注明 AND 关系"
    )
    symptoms: Symptoms
    diagnosis_steps: List[DiagnosisStep]
    diagnosis_decision: Optional[str] = Field(
        None, description="所有 critical=true 的步骤同时命中 → 确认为此模式"
    )
    remediation_steps: List[RemediationStep]
    edge_cases: List[EdgeCase] = Field(default_factory=list)
    verification: List[Verification] = Field(default_factory=list)
    knowledge_gaps: List[KnowledgeGap] = Field(default_factory=list)
    skill_usability: SkillUsability
    source_cases: List[str] = Field(..., description="关联的 case_id")
    extracted_commands_verbatim: bool = Field(
        True, description="声明所有命令均来自原文，未推断改写"
    )


class MergeDecision(str, Enum):
    CREATE = "CREATE"
    UPDATE = "UPDATE"
    DISCARD = "DISCARD"


class MergeResult(BaseModel):
    failure_pattern: FailurePattern
    decision: MergeDecision
    merge_notes: str


class GeneralExperience(BaseModel):
    id: str = Field(..., description="e.g. EXP-XXX")
    content: str = Field(..., description="The actual text content")
    source: str = Field(..., description='File path or "Manual Input"')


class Skill(BaseModel):
    failure_pattern: FailurePattern
    failure_cases: List[FailureCase]
    general_experiences: List[GeneralExperience] = Field(default_factory=list)
