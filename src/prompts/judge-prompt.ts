
interface CriteriaItem {
  id: string;
  weight: number;
  content: string;
}

export function generateJudgePrompt(
  userQuery: string,
  actualAnswer: string,
  rcList: CriteriaItem[],
  kaList: CriteriaItem[],
  skillDefinition?: string
): string {
  const skillSection = skillDefinition 
    ? `Reference Skill Definition (Using this skill as the context for evaluation):\n${skillDefinition}\n\n` 
    : '';

  return `
You are an objective and strict judge. Your task is to evaluate a "User Answer" against a set of weighted criteria for a given "User Query".

${skillSection}User Query: ${userQuery}
User Answer: ${actualAnswer}

Evaluation Criteria (Score strictly based on these weighted items):
1. Root Causes (Must identify these issues):
${rcList.map(rc => `   - [ID: ${rc.id}] [Weight: ${rc.weight}] ${rc.content}`).join('\n') || '   (None)'}

2. Key Actions (Must perform these actions):
${kaList.map(ka => `   - [ID: ${ka.id}] [Weight: ${ka.weight}] ${ka.content}`).join('\n') || '   (None)'}

Evaluation Steps:
1. For each item listed above (marked with [ID: ...]), determine the degree of match (0.0 to 1.0).
   - 0.0 = Not mentioned or completely wrong.
   - 0.5 = Partially mentioned or vague.
   - 1.0 = Clearly and correctly addressed.
   **CRITICAL**: For Key Actions involving specific operations (e.g., "backup", "modify", "restart"), you must find EXPLICT EVIDENCE in the User Answer that these actions were performed (checking/reading is NOT the same as backing up).
2. Provide a brief explanation (in Chinese) for your evaluation of each item.
3. If a Reference Skill Definition is provided, consider whether the answer aligns with the skill's capabilities and instructions, but primarily score based on the specific Root Causes and Key Actions listed above.

Respond ONLY with a JSON object in the following format:
{
  "evaluations": [
    { "id": "RC-0", "match_score": 0.5, "explanation": "此处用中文简要解释评分理由..." },
    { "id": "KA-0", "match_score": 1.0, "explanation": "..." }
    ...
  ]
}
`;
}
