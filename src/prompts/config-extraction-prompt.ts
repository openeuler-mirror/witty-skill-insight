export const generateConfigExtractionPrompt = (query: string, skillName: string, skillContent: string) => `
You are an expert in analyzing AI skills and defining evaluation criteria.
Your task is to extract "Expected Key Points" (formerly Root Causes) and "Expected Key Actions" (formerly Key Actions) that an AI agent should demonstrate when answering the user's query, based STRICTLY on the provided Skill Definition.

User Query:
"""
${query}
"""

Skill Name: ${skillName}

Skill Definition (Content):
"""
${skillContent}
"""

Please analyze the skill definition and the user query to determine:
1. **Expected Key Points (root_causes)**: The critical information, concepts, or factors that the agent MUST mention or analyze in its reasoning or final answer.
2. **Expected Key Actions (key_actions)**: The specific steps, tool calls, or verifying actions the agent MUST perform to correctly answer the query.

Return the result in the following JSON format:
{
  "root_causes": [
    { "content": "Description of key point 1", "weight": 1.0 },
    { "content": "Description of key point 2", "weight": 1.0 }
  ],
  "key_actions": [
    { "content": "Description of action 1", "weight": 1.0 },
    { "content": "Description of action 2", "weight": 1.0 }
  ]
}

Guidelines:
- Create 3-5 distinct Root Causes.
- Create 3-5 distinct Key Actions.
- Ensure the content is concise but descriptive.
- Weights should default to 1.0 unless a point is optional (0.5) or critical (2.0).
- **CRITICAL**: Be factual. Only extract actions that are EXPLICITLY mentioned in the Skill Definition.
- If the Skill Definition includes specific operations like "backup", "verify", or "check", you MUST extract them as Key Actions.
- If the Skill Definition does NOT mention an operation (e.g., backup), DO NOT include it, even if it is a general best practice.
- Do not infer steps that are not present in the Skill Definition.
`;
