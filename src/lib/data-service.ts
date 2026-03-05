
import fs from 'fs';
import path from 'path';
import { judgeAnswer } from './judge';
import { prisma } from './prisma';

// Data Types
export interface ExecutionRecord {
  upload_id?: string;
  task_id?: string; // Add task_id alias
  query?: string;
  framework?: string;
  tokens?: number;
  cost?: number;
  latency?: number;
  timestamp?: string | Date;
  final_result?: string;
  skill?: string;
  /** 通过「模仿用户发 query 提取」得到的激活 skills 列表 */
  skills?: string[];

  // Judgment fields
  is_skill_correct?: boolean;
  is_answer_correct?: boolean;
  answer_score?: number | null;
  judgment_reason?: string;

  failures?: {
      failure_type: string;
      description: string;
      context: string;
      recovery: string;
      attribution?: 'SKILL_DEFECT' | 'MODEL_ERROR' | 'ENVIRONMENT';
      attribution_reason?: string;
  }[];

  // Allow other fields
  skill_score?: number | null;
  skill_issues?: any[] | null; 
  skill_version?: number | null;
  label?: string | null;
  user?: string | null; 
  model?: string | null;
  skip_evaluation?: boolean;
  [key: string]: any;
}

export interface ConfigItem {
  id: string;
  query: string;
  skill: string;
  standard_answer: string;
  root_causes?: { content: string; weight: number }[];
  key_actions?: { content: string; weight: number }[];
}

const DATA_DIR = path.join(process.cwd(), 'data');
const EVALUATION_FILE = path.join(DATA_DIR, 'evaluation_result.json');

export async function readRecords(user?: string): Promise<ExecutionRecord[]> {
  const where: any = {};
  if (user) {
    where.OR = [
      { user: user },
      { user: null }
    ];
  }

  const records = await prisma.execution.findMany({
    where,
    orderBy: { timestamp: 'desc' }
  });

  return records.map(r => ({
    ...r,
    upload_id: r.id,
    task_id: r.taskId || undefined,
    query: r.query || undefined,
    framework: r.framework || undefined,
    tokens: r.tokens || undefined,
    cost: r.cost || undefined,
    latency: r.latency || undefined,
    timestamp: r.timestamp.toISOString(),
    final_result: r.finalResult || undefined,
    skill: r.skill || undefined,
    skills: r.skills ? JSON.parse(r.skills) : undefined,
    is_skill_correct: r.isSkillCorrect || false,
    is_answer_correct: r.isAnswerCorrect || false,
    answer_score: r.answerScore !== undefined ? r.answerScore : undefined,
    skill_score: r.skillScore !== undefined ? r.skillScore : undefined,
    judgment_reason: r.judgmentReason || undefined,
    failures: r.failures ? JSON.parse(r.failures) : undefined,
    label: r.label ?? null,
    user: r.user ?? null,
    skill_issues: r.skillIssues ? JSON.parse(r.skillIssues) : [],
    skill_version: r.skillVersion ?? null,
    model: r.model ?? null
  }));
}


export async function readConfig(user?: string | null): Promise<ConfigItem[]> {
  const where: any = {};
  if (user) {
    where.OR = [
      { user: user },
      { user: null }
    ];
  }
  
  const configs = await prisma.config.findMany({
    where,
    orderBy: { id: 'desc' }
  });
  return configs.map(c => {
    let parse = (s: string | null) => {
        if (!s) return undefined;
        try { return JSON.parse(s); } catch (e) { return undefined; }
    };
    return {
        id: c.id,
        query: c.query,
        skill: c.skill,
        standard_answer: c.standardAnswer,
        root_causes: parse(c.rootCauses),
        key_actions: parse(c.keyActions),
        parse_status: c.parseStatus || 'completed',
    };
  });
}

export function readEvaluationResults(): Record<string, string> {
    if (!fs.existsSync(EVALUATION_FILE)) return {};
    try {
        return JSON.parse(fs.readFileSync(EVALUATION_FILE, 'utf-8'));
    } catch {
        return {};
    }
}

export async function saveExecutionRecord(data: ExecutionRecord): Promise<{ success: boolean; record: ExecutionRecord }> {
  // Identify record by upload_id OR task_id
  const id = data.upload_id || data.task_id;
  // Use provided ID or fallback to randomly generated one if creating new
  const recordId = id || crypto.randomUUID(); 
  
  // Try to find existing record first to merge
  let existingRecord: ExecutionRecord | null = null;
  const dbRecord = await prisma.execution.findUnique({ where: { id: recordId } });
  
  if (dbRecord) {
     existingRecord = {
        ...dbRecord,
        upload_id: dbRecord.id,
        task_id: dbRecord.taskId || undefined,
        query: dbRecord.query || undefined,
        framework: dbRecord.framework || undefined,
        tokens: dbRecord.tokens || undefined,
        cost: dbRecord.cost || undefined,
        latency: dbRecord.latency || undefined,
        timestamp: dbRecord.timestamp.toISOString(),
        final_result: dbRecord.finalResult || undefined,
        skill: dbRecord.skill || undefined,
        skills: dbRecord.skills ? JSON.parse(dbRecord.skills) : undefined,
        is_skill_correct: dbRecord.isSkillCorrect || false,
        is_answer_correct: dbRecord.isAnswerCorrect || false,
        answer_score: dbRecord.answerScore || undefined,
        skill_score: dbRecord.skillScore || undefined,
        judgment_reason: dbRecord.judgmentReason || undefined,
        failures: dbRecord.failures ? JSON.parse(dbRecord.failures) : undefined,
        skill_issues: dbRecord.skillIssues ? JSON.parse(dbRecord.skillIssues) : undefined,
        label: dbRecord.label || undefined,
        user: dbRecord.user || undefined,
        skill_version: dbRecord.skillVersion || undefined,
        model: dbRecord.model || undefined,
     };
  }

  let targetRecord: ExecutionRecord = existingRecord ? { ...existingRecord } : {};
  const isUpdate = !!existingRecord;

  // Merge Data
  if (!isUpdate && !targetRecord.timestamp && !data.timestamp) {
    targetRecord.timestamp = new Date().toISOString();
  } else if (data.timestamp) {
      targetRecord.timestamp = data.timestamp;
  }
  
  targetRecord = { ...targetRecord, ...data };
  // Ensure IDs are consistent
  if (!targetRecord.upload_id && targetRecord.task_id) targetRecord.upload_id = targetRecord.task_id;
  if (!targetRecord.task_id && targetRecord.upload_id) targetRecord.task_id = targetRecord.upload_id;
  targetRecord.upload_id = recordId; // Ensure primary ID is set

  // Attempt to fetch label/model/user from session if missing (Try DB first)
  if ((!targetRecord.label || !targetRecord.model || !targetRecord.user) && targetRecord.task_id) {
       const session = await prisma.session.findUnique({ where: { taskId: targetRecord.task_id }});
       if (session) {
           if (!targetRecord.label && session.label) targetRecord.label = session.label;
           if (!targetRecord.model && session.model) targetRecord.model = session.model;
           if (!targetRecord.user && session.user) targetRecord.user = session.user;
       }
  }

  // Final fallback for missing user: check if there is any user
  if (!targetRecord.user) {
      const anyUser = await prisma.user.findFirst({
        select: { username: true }
      });
      if (anyUser) {
          targetRecord.user = anyUser.username;
          console.log(`[Data-Service] Fallback resolved user for task ${targetRecord.task_id} to: ${targetRecord.user}`);
      }
  }

  // Normalize Tokens
  const incomingTokens = data.Token || data.token || data.tokens;
  if (incomingTokens !== undefined) targetRecord.tokens = Number(incomingTokens);

  // 无匹配配置时的固定提示（便于前端判断并展示）
  const NO_MATCH_REASON = '未找到匹配的评测配置，分数已归零';

  // Judgment Logic
  let isSkillCorrect = targetRecord.is_skill_correct || false;
  let isAnswerCorrect = targetRecord.is_answer_correct || false;
  let judgmentReason = targetRecord.judgment_reason || NO_MATCH_REASON;

  // Try to find config
  const configs = await readConfig(targetRecord.user);
  // Match by query (仅完全一致)
  if (targetRecord.query && configs.length > 0) {
      const matchedConfig = configs.find(c => c.query.trim() === targetRecord.query?.trim());
      
      if (matchedConfig) {
          // Check Skill：仅用 skills 列表
          const expectedSkill = (matchedConfig.skill || '').trim();
          if (targetRecord.skills !== undefined && Array.isArray(targetRecord.skills)) {
              isSkillCorrect = targetRecord.skills.some(
                  (s) => (String(s || '').trim()) === expectedSkill
              );
          }

          // Check Answer
          if (targetRecord.final_result !== undefined) {
               let needsJudgment = true;
               
               if (isUpdate && !data.force_judgment) {
                   // If Query and Result match the old record, assume no need to re-judge
                   if (existingRecord && existingRecord.query === targetRecord.query && existingRecord.final_result === targetRecord.final_result) {
                       needsJudgment = false;
                   }
               }

               // Re-judge if new result or explicitly requested, AND evaluation is not disabled
               if (needsJudgment && !targetRecord.skip_evaluation) {
                    // 1. Fetch Skill Definition if valid skill name exists
                    let skillDefinition: string | undefined = undefined;
                    const skillName = (targetRecord.skill || matchedConfig.skill || '').trim();

                    if (skillName) {
                        try {
                            const skill = await prisma.skill.findFirst({ 
                                where: { 
                                    name: skillName,
                                    OR: [
                                        { user: targetRecord.user || null },
                                        { user: null }
                                    ]
                                } as any
                            });
                            if (skill) {
                                const targetVersion = skill.activeVersion || 0;
                                const sv = await prisma.skillVersion.findFirst({
                                    where: { skillId: skill.id, version: targetVersion }
                                });
                                if (sv && sv.content) {
                                    skillDefinition = sv.content;
                                    targetRecord.skill_version = sv.version; // Capture version
                                } else {
                                    const latestSv = await prisma.skillVersion.findFirst({
                                        where: { skillId: skill.id },
                                        orderBy: { version: 'desc' }
                                    });
                                    if (latestSv && latestSv.content) {
                                        skillDefinition = latestSv.content;
                                        targetRecord.skill_version = latestSv.version; // Capture inferred version
                                    }
                                }
                            }
                        } catch (err) {
                            console.error('[Judgment] Error fetching skill definition:', err);
                        }
                    }

                    const judgment = await judgeAnswer(
                        targetRecord.query || '',
                        {
                            standard_answer_example: matchedConfig.standard_answer,
                            root_causes: matchedConfig.root_causes,
                            key_actions: matchedConfig.key_actions,
                            skill_definition: skillDefinition
                        },
                        targetRecord.final_result,
                        targetRecord.user
                    );
                    isAnswerCorrect = judgment.is_correct;
                    targetRecord.answer_score = judgment.score;
                    judgmentReason = judgment.reason || 'Judged by Evaluation Model';
               }
          }
      } else {
          // No matched config found for this query
          // IMPORTANT: If this is an update and we already have a score, don't wipe it out 
          // unless user specifically requested a re-judgment.
          if ((!isUpdate || data.force_judgment) && !targetRecord.answer_score) {
              isAnswerCorrect = false;
              judgmentReason = NO_MATCH_REASON;
              targetRecord.answer_score = 0;
          }
      }
  } else if (targetRecord.query) {
      if ((!isUpdate || data.force_judgment) && !targetRecord.answer_score) {
          isAnswerCorrect = false;
          judgmentReason = NO_MATCH_REASON;
          targetRecord.answer_score = 0;
      }
  }

  if (data.skip_evaluation) {
      targetRecord.answer_score = null;
      judgmentReason = '结果评估中...';
  }

  targetRecord.is_skill_correct = isSkillCorrect;
  targetRecord.is_answer_correct = isAnswerCorrect;
  targetRecord.judgment_reason = judgmentReason;

  // Skill Score Lookup
  const skillForScore = Array.isArray(targetRecord.skills) && targetRecord.skills.length > 0 ? targetRecord.skills[0] : undefined;
  if (skillForScore) {
      const evalResults = readEvaluationResults();
      const scoreStr = evalResults[skillForScore];
      if (scoreStr) targetRecord.skill_score = parseFloat(scoreStr);
  }

  // Write Back to DB
  await prisma.execution.upsert({
      where: { id: recordId },
      update: {
          taskId: targetRecord.task_id,
          query: targetRecord.query,
          framework: targetRecord.framework,
          tokens: targetRecord.tokens,
          cost: targetRecord.cost,
          latency: targetRecord.latency,
          timestamp: targetRecord.timestamp ? new Date(targetRecord.timestamp) : new Date(),
          finalResult: targetRecord.final_result,
          skill: targetRecord.skill,
          skills: targetRecord.skills ? JSON.stringify(targetRecord.skills) : null,
          isSkillCorrect: targetRecord.is_skill_correct,
          isAnswerCorrect: targetRecord.is_answer_correct,
          answerScore: targetRecord.answer_score,
          skillScore: targetRecord.skill_score,
          judgmentReason: targetRecord.judgment_reason,
          failures: targetRecord.failures ? JSON.stringify(targetRecord.failures) : null,
          skillIssues: targetRecord.skill_issues ? JSON.stringify(targetRecord.skill_issues) : null,
          label: targetRecord.label,
          user: targetRecord.user,
          skillVersion: targetRecord.skill_version,
          model: targetRecord.model
      },
      create: {
          id: recordId,
          taskId: targetRecord.task_id,
          query: targetRecord.query,
          framework: targetRecord.framework,
          tokens: targetRecord.tokens,
          cost: targetRecord.cost,
          latency: targetRecord.latency,
          timestamp: targetRecord.timestamp ? new Date(targetRecord.timestamp) : new Date(),
          finalResult: targetRecord.final_result,
          skill: targetRecord.skill,
          skills: targetRecord.skills ? JSON.stringify(targetRecord.skills) : null,
          isSkillCorrect: targetRecord.is_skill_correct,
          isAnswerCorrect: targetRecord.is_answer_correct,
          answerScore: targetRecord.answer_score,
          skillScore: targetRecord.skill_score,
          judgmentReason: targetRecord.judgment_reason,
          failures: targetRecord.failures ? JSON.stringify(targetRecord.failures) : null,
          skillIssues: targetRecord.skill_issues ? JSON.stringify(targetRecord.skill_issues) : null,
          label: targetRecord.label,
          user: targetRecord.user,
          skillVersion: targetRecord.skill_version,
          model: targetRecord.model
      }
  });
  
  // Also sync with Session table if interactions are provided
  if (targetRecord.task_id && targetRecord.interactions) {
      await prisma.session.upsert({
          where: { taskId: targetRecord.task_id },
          update: {
              query: targetRecord.query,
              label: targetRecord.label,
              user: targetRecord.user,
              model: targetRecord.model,
              interactions: typeof targetRecord.interactions === 'string' ? targetRecord.interactions : JSON.stringify(targetRecord.interactions)
          },
          create: {
              taskId: targetRecord.task_id,
              query: targetRecord.query,
              label: targetRecord.label,
              user: targetRecord.user,
              model: targetRecord.model,
              interactions: typeof targetRecord.interactions === 'string' ? targetRecord.interactions : JSON.stringify(targetRecord.interactions)
          }
      });
  }

  return { success: true, record: targetRecord };
}

