/**
 * 基于标准答案提取评估所需的"关键观点"与"关键动作"
 * 
 * - 关键观点 (root_causes)：Agent 回答中必须体现的核心信息和关键判断依据
 * - 关键动作 (key_actions)：Agent 解决问题时必须执行的核心操作步骤
 */
export const generateConfigExtractionPrompt = (query: string, standardAnswer: string) => `
You are an expert in building AI agent evaluation criteria.

Given a user Query and a Standard Answer (the expected correct answer), your task is to extract two sets of evaluation criteria:

1. **Expected Key Points (root_causes)**: The critical information, conclusions, or judgments that the agent MUST mention in its response. These are the "what the answer should contain" — the essential facts, analysis results, or diagnostic conclusions.

2. **Expected Key Actions (key_actions)**: The specific steps, operations, tool calls, or verification actions the agent MUST perform to arrive at the correct answer. These are the "what the agent should do" — the necessary procedures and investigations.

User Query:
"""
${query}
"""

Standard Answer:
"""
${standardAnswer}
"""

Please analyze the standard answer and extract:
- **Key Points**: What critical information/conclusions does the standard answer contain? What must the agent identify or mention?
- **Key Actions**: What operations/steps are described or implied in the standard answer? What must the agent actually do?

Return the result in the following JSON format:
{
  "root_causes": [
    { "content": "Description of key point", "weight": 1.0 }
  ],
  "key_actions": [
    { "content": "Description of key action", "weight": 1.0 }
  ]
}

Guidelines:
- Create 3-5 distinct Key Points.
- Create 3-5 distinct Key Actions.
- Each item's "content" should be concise but descriptive (one sentence).
- Weights should default to 1.0 unless a point is optional (0.5) or critical (2.0).
- **CRITICAL**: Only extract points and actions that are EXPLICITLY present or clearly implied by the Standard Answer. Do not infer extra steps.
- If the Standard Answer describes specific commands, tools, or operations, they MUST appear in Key Actions.
- If the Standard Answer contains specific conclusions or diagnostic results, they MUST appear in Key Points.
- **LANGUAGE RULE**: The "content" field of each Key Point and Key Action MUST be written in the SAME language as the User Query. If the query is in Chinese, write content in Chinese. If the query is in English, write content in English. Match the query language exactly.
`;

export const generateAnswerExtractionPrompt = (query: string, documentContent: string) => `
You are an expert at analyzing technical documents and producing structured diagnostic reports.

Given a user Query and a Case Document (which contains the solution or reference answer), produce a Standard Answer in the form of a structured diagnostic report.

User Query:
"""
${query}
"""

Case Document:
"""
${documentContent}
"""

**Output Requirements:**

1. Produce ONLY the diagnostic report itself — NO preamble, NO introduction like "以下是根据文档生成的..." or "Based on the document...". Start directly with the report content.
2. The report MUST follow this exact structure (adapt section content to the actual case):

# 诊断报告

---

## 1. 高阶结论 ⭐

* **问题现象**：一句话描述
* **问题类型**：实时 / 历史
* **影响范围**：主机 / 业务 / 用户
* **初步根因**：一句话定性

---

## 2. 根因分析（Why）

* **触发因素**：事件、变更或操作
* **瓶颈资源**：CPU / 内存 / IO / 网络 / 应用
* **故障路径**：

\`\`\`
[触发因素] ──> [资源瓶颈] ──> [系统现象]
\`\`\`

---

## 3. 关键证据 ⭐

* 3-6 条关键数据点，用"结论性数据"展示，不贴大段日志
* 保留支持结论的关键指标和异常点

---

## 4. 处置与建议

* **应急措施**：快速隔离或缓解
* **根因修复**：优化配置、防止复发

3. If the document is in Chinese, write the report in Chinese. If in English, write in English. Match the document language.
4. Preserve specific commands, configurations, metrics, and technical details from the document verbatim.
5. If some sections are not applicable (e.g. it's not a diagnostic scenario), adapt the structure to fit the content while maintaining the same level of detail and structure.

Return the result as a JSON object:
{
  "standard_answer": "The full diagnostic report in markdown format..."
}
`;
