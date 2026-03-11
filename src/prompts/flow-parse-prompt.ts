export function generateFlowParsePrompt(skillContent: string): string {
  return `
你是一个专家，擅长分析 Skill 定义并提取执行流程模式。

给定一个 Skill 定义文档（SKILL.md），你的任务是：
1. 提取预期的执行流程/步骤序列
2. 识别每个步骤应该完成什么（不一定是具体工具）
3. 注意任何条件分支或可选步骤

Skill 定义：
---
${skillContent}
---

请分析 skill 并提取结构化的执行流程。关注：
- 应该执行哪些步骤（按顺序）
- 每个步骤完成什么（目的/目标，不是具体工具名称）
- 步骤是必需的还是可选的
- 任何决策点或分支

请只用 JSON 对象回复，格式如下：
{
  "steps": [
    {
      "id": "step-1",
      "name": "简短的步骤名称（用中文）",
      "description": "这个步骤完成什么",
      "type": "action",
      "isOptional": false
    }
  ],
  "branches": [
    {
      "condition": "条件的描述",
      "trueStepId": "step-x",
      "falseStepId": "step-y"
    }
  ],
  "summary": "整体流程的简要总结"
}

指南：
- "type" 可以是: "action"（做某事）, "decision"（做出选择）, "output"（产生结果）
- 步骤名称要简洁（2-5个字），必须用中文
- 描述应该解释目的，而不是实现方式
- 如果 skill 没有清晰的顺序流程，提取逻辑阶段/阶段
- 如果有工具推荐，在描述中提及但不要作为步骤名称
- 最多10个步骤（如果需要可以合并相关操作）
`;
}

interface FlowStep {
  id: string;
  name: string;
  description: string;
  type: 'action' | 'decision' | 'output';
  isOptional?: boolean;
}

interface FlowBranch {
  condition: string;
  trueStepId: string;
  falseStepId: string;
}

interface ParsedFlow {
  steps: FlowStep[];
  branches?: FlowBranch[];
  summary?: string;
}

export function generateExecutionMatchPrompt(
  expectedFlow: ParsedFlow,
  actualInteractions: string,
  skillName: string
): string {
  return `
你是一个专家，擅长分析 Agent 执行轨迹并将其与预期工作流程进行比较。

Skill "${skillName}" 的预期流程：
---
${JSON.stringify(expectedFlow, null, 2)}
---

实际执行轨迹：
---
${actualInteractions}
---

你的任务是：
1. 将每个实际执行步骤与预期流程匹配
2. 识别匹配、部分匹配或意外的步骤
3. 检查执行顺序是否正确
4. 提供整体分析

请只用 JSON 对象回复，格式如下：
{
  "matches": [
    {
      "expectedStepId": "step-1",
      "expectedStepName": "预期流程中的步骤名称",
      "actualStepIndex": 0,
      "actualAction": "实际执行的操作描述（用中文）",
      "matchStatus": "matched",
      "matchReason": "简要解释"
    }
  ],
  "summary": {
    "totalSteps": 5,
    "matchedSteps": 3,
    "partialSteps": 0,
    "unexpectedSteps": 1,
    "skippedSteps": 1,
    "orderViolations": 0,
    "overallScore": 0.75
  },
  "analysis": "详细分析，解释比较结果，突出任何偏差或意外行为，并提出改进建议。"
}

匹配状态值：
- "matched": 步骤与预期流程匹配良好（符合预期）
- "partial": 步骤部分匹配，意图正确但执行方式有问题（部分偏离）
- "unexpected": 步骤完全不在预期流程中（非预期调用）
- "skipped": 预期步骤未执行（跳过）

评分指南：
- matched: 贡献 1.0 分
- partial: 贡献 0.5 分  
- unexpected: 贡献 -0.2 分（惩罚）
- skipped: 贡献 0 分
- orderViolations: 每个 -0.1 分惩罚

分析应该用中文解释：
1. 整体执行质量
2. 哪些做得好
3. 哪些偏离了预期
4. 为什么出现意外步骤（如果有）
5. 改进建议
`;
}
