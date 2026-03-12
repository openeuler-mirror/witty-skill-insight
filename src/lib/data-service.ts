import fs from 'fs';
import path from 'path';
import { judgeAnswer } from './judge';
import { db, prisma } from './prisma';

export interface ExecutionRecord {
    upload_id?: string;
    task_id?: string;
    query?: string;
    framework?: string;
    tokens?: number;
    cost?: number;
    latency?: number;
    timestamp?: string | Date;
    final_result?: string;
    skill?: string;
    skills?: string[];

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

    skill_score?: number | null;
    skill_issues?: any[] | null;
    skill_version?: number | null;
    label?: string | null;
    user?: string | null;
    model?: string | null;
    skip_evaluation?: boolean;
    tool_call_count?: number;
    llm_call_count?: number;
    input_tokens?: number;
    output_tokens?: number;
    tool_call_error_count?: number;
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

    const records = await db.findExecutions(where, { timestamp: 'desc' });

    return records.map((r: any) => ({
        ...r,
        upload_id: r.id,
        task_id: r.taskId || undefined,
        query: r.query || undefined,
        framework: r.framework || undefined,
        tokens: r.tokens || undefined,
        cost: r.cost || undefined,
        latency: r.latency || undefined,
        timestamp: r.timestamp?.toISOString?.() || r.timestamp,
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
        model: r.model ?? null,
        tool_call_count: r.toolCallCount ?? undefined,
        llm_call_count: r.llmCallCount ?? undefined,
        input_tokens: r.inputTokens ?? undefined,
        output_tokens: r.outputTokens ?? undefined,
        tool_call_error_count: r.toolCallErrorCount ?? undefined,
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

    const configs = await db.findConfigs(where);
    return configs.map((c: any) => {
        const parse = (s: string | null) => {
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
    const id = data.upload_id || data.task_id;
    const recordId = id || crypto.randomUUID();

    let existingRecord: ExecutionRecord | null = null;
    const dbRecord = await db.findExecutionById(recordId);

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
            timestamp: dbRecord.timestamp?.toISOString?.() || dbRecord.timestamp,
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
            tool_call_count: dbRecord.toolCallCount ?? undefined,
            llm_call_count: dbRecord.llmCallCount ?? undefined,
            input_tokens: dbRecord.inputTokens ?? undefined,
            output_tokens: dbRecord.outputTokens ?? undefined,
            tool_call_error_count: dbRecord.toolCallErrorCount ?? undefined,
        };
    }

    let targetRecord: ExecutionRecord = existingRecord ? { ...existingRecord } : {};
    const isUpdate = !!existingRecord;

    if (!isUpdate && !targetRecord.timestamp && !data.timestamp) {
        targetRecord.timestamp = new Date().toISOString();
    } else if (data.timestamp) {
        targetRecord.timestamp = data.timestamp;
    }

    targetRecord = { ...targetRecord, ...data };
    if (!targetRecord.upload_id && targetRecord.task_id) targetRecord.upload_id = targetRecord.task_id;
    if (!targetRecord.task_id && targetRecord.upload_id) targetRecord.task_id = targetRecord.upload_id;
    targetRecord.upload_id = recordId;

    if ((!targetRecord.label || !targetRecord.model || !targetRecord.user) && targetRecord.task_id) {
        const session = await db.findSessionByTaskId(targetRecord.task_id);
        if (session) {
            if (!targetRecord.label && session.label) targetRecord.label = session.label;
            if (!targetRecord.model && session.model) targetRecord.model = session.model;
            if (!targetRecord.user && session.user) targetRecord.user = session.user;
        }
    }

    if (!targetRecord.user) {
        try {
            const client = db.getClient();
            if ('query' in client) {
                const res = await (client as any).query('SELECT username FROM "User" LIMIT 1');
                if (res.rows[0]) {
                    targetRecord.user = res.rows[0].username;
                    console.log(`[Data-Service] Fallback resolved user for task ${targetRecord.task_id} to: ${targetRecord.user}`);
                }
            }
        } catch (e) {
            console.warn('[Data-Service] Fallback user lookup failed:', e);
        }
    }

    const incomingTokens = data.Token || data.token || data.tokens;
    if (incomingTokens !== undefined) targetRecord.tokens = Number(incomingTokens);

    if (data.tool_call_count !== undefined) targetRecord.tool_call_count = Number(data.tool_call_count);
    if (data.llm_call_count !== undefined) targetRecord.llm_call_count = Number(data.llm_call_count);
    if (data.input_tokens !== undefined) targetRecord.input_tokens = Number(data.input_tokens);
    if (data.output_tokens !== undefined) targetRecord.output_tokens = Number(data.output_tokens);
    if (data.tool_call_error_count !== undefined) targetRecord.tool_call_error_count = Number(data.tool_call_error_count);

    const NO_MATCH_REASON = '未找到匹配的评测配置';

    let isSkillCorrect = targetRecord.is_skill_correct || false;
    let isAnswerCorrect = targetRecord.is_answer_correct || false;
    let judgmentReason = targetRecord.judgment_reason || NO_MATCH_REASON;

    const configs = await readConfig(targetRecord.user);
    if (targetRecord.query && configs.length > 0) {
        const matchedConfig = configs.find(c => c.query.trim() === targetRecord.query?.trim());

        if (matchedConfig) {
            const expectedSkill = (matchedConfig.skill || '').trim();
            if (targetRecord.skills !== undefined && Array.isArray(targetRecord.skills)) {
                isSkillCorrect = targetRecord.skills.some(
                    (s) => (String(s || '').trim()) === expectedSkill
                );
            }

            if (targetRecord.final_result !== undefined) {
                let needsJudgment = true;

                if (isUpdate && !data.force_judgment) {
                    if (existingRecord && existingRecord.query === targetRecord.query && existingRecord.final_result === targetRecord.final_result) {
                        needsJudgment = false;
                    }
                }

                if (needsJudgment && !targetRecord.skip_evaluation) {
                    let skillDefinition: string | undefined = undefined;
                    const skillName = (targetRecord.skill || matchedConfig.skill || '').trim();

                    if (skillName) {
                        try {
                            const skill = await db.findSkill(skillName, targetRecord.user || null);
                            if (skill) {
                                const targetVersion = skill.activeVersion || 0;
                                const sv = skill.versions?.find((v: any) => v.version === targetVersion);
                                if (sv && sv.content) {
                                    skillDefinition = sv.content;
                                    targetRecord.skill_version = sv.version;
                                } else if (skill.versions && skill.versions.length > 0) {
                                    const latestSv = skill.versions[0];
                                    if (latestSv && latestSv.content) {
                                        skillDefinition = latestSv.content;
                                        targetRecord.skill_version = latestSv.version;
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
            if ((!isUpdate || data.force_judgment) && !targetRecord.answer_score) {
                isAnswerCorrect = false;
                judgmentReason = NO_MATCH_REASON;
                targetRecord.answer_score = null;
            }
        }
    } else if (targetRecord.query) {
        if ((!isUpdate || data.force_judgment) && !targetRecord.answer_score) {
            isAnswerCorrect = false;
            judgmentReason = NO_MATCH_REASON;
            targetRecord.answer_score = null;
        }
    }

    if (data.skip_evaluation) {
        targetRecord.answer_score = null;
        judgmentReason = '结果评估中...';
    }

    targetRecord.is_skill_correct = isSkillCorrect;
    targetRecord.is_answer_correct = isAnswerCorrect;
    targetRecord.judgment_reason = judgmentReason;

    const skillForScore = Array.isArray(targetRecord.skills) && targetRecord.skills.length > 0 ? targetRecord.skills[0] : undefined;
    if (skillForScore) {
        const evalResults = readEvaluationResults();
        const scoreStr = evalResults[skillForScore];
        if (scoreStr) targetRecord.skill_score = parseFloat(scoreStr);
    }

    await db.upsertExecution({
        where: { id: recordId },
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
            model: targetRecord.model,
            toolCallCount: targetRecord.tool_call_count,
            llmCallCount: targetRecord.llm_call_count,
            inputTokens: targetRecord.input_tokens,
            outputTokens: targetRecord.output_tokens,
            toolCallErrorCount: targetRecord.tool_call_error_count,
        },
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
            model: targetRecord.model,
            toolCallCount: targetRecord.tool_call_count,
            llmCallCount: targetRecord.llm_call_count,
            inputTokens: targetRecord.input_tokens,
            outputTokens: targetRecord.output_tokens,
            toolCallErrorCount: targetRecord.tool_call_error_count,
        }
    });

    if (targetRecord.task_id && targetRecord.interactions) {
        await db.upsertSession(
            targetRecord.task_id,
            {
                taskId: targetRecord.task_id,
                query: targetRecord.query,
                label: targetRecord.label,
                user: targetRecord.user,
                model: targetRecord.model,
                interactions: typeof targetRecord.interactions === 'string' ? targetRecord.interactions : JSON.stringify(targetRecord.interactions)
            },
            {
                query: targetRecord.query,
                label: targetRecord.label,
                user: targetRecord.user,
                model: targetRecord.model,
                interactions: typeof targetRecord.interactions === 'string' ? targetRecord.interactions : JSON.stringify(targetRecord.interactions)
            }
        );
    }

    return { success: true, record: targetRecord };
}
