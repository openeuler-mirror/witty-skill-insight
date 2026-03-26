import fs from 'fs';
import path from 'path';
import { judgeAnswer } from './judge';
import { db, prisma } from './prisma';
import { getModelPricing, calculateCost, getModelContextWindow, DEFAULT_CACHE_READ_RATIO, DEFAULT_CACHE_CREATION_RATIO } from './model-config';

export interface InvokedSkill {
    name: string;
    version: number | null;
}

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
    invokedSkills?: InvokedSkill[];

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
    skill_recall_rate?: number | null;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
    max_single_call_tokens?: number;
    context_window_pct?: number;
    context_window_limit?: number;
    context_window_source?: string;
    [key: string]: any;
}

export interface ConfigItem {
    id: string;
    query: string;
    skill: string; // Legacy
    skillVersion?: number | null; // Legacy
    expectedSkills?: { skill: string; version: number | null }[]; // New field
    standard_answer: string;
    root_causes?: { content: string; weight: number }[];
    key_actions?: { content: string; weight: number }[];
}

export function findBestMatchConfig(configs: ConfigItem[], userQuery: string | undefined): ConfigItem | undefined {
    if (!userQuery) return undefined;
    
    const trimmedUserQuery = userQuery.trim();
    
    const matchingConfigs = configs
        .filter(c => c.query && c.query.trim())
        .filter(c => {
            const trimmedConfigQuery = c.query.trim();
            return trimmedUserQuery.endsWith(trimmedConfigQuery);
        });
    
    if (matchingConfigs.length === 0) return undefined;
    
    return matchingConfigs.reduce((best, current) => {
        const bestLen = best.query.trim().length;
        const currentLen = current.query.trim().length;
        return currentLen > bestLen ? current : best;
    });
}

const DATA_DIR = path.join(process.cwd(), 'data');
const EVALUATION_FILE = path.join(DATA_DIR, 'evaluation_result.json');

export async function readRecords(user?: string, filters?: { query?: string; taskId?: string; framework?: string; skill?: string; skillVersion?: number }): Promise<ExecutionRecord[]> {
    const where: any = {};
    if (user) {
        where.OR = [
            { user: user },
            { user: null }
        ];
    }

    if (!filters?.query && filters?.taskId) {
        const dbRecord = await db.findExecutionById(filters.taskId);
        if (dbRecord && dbRecord.query) {
            where.query = dbRecord.query;
            if (filters.framework) where.framework = filters.framework;
        } else {
            // fallback exact match
            where.id = filters.taskId;
        }
    } else if (filters?.query) {
        where.query = filters.query;
        if (filters.framework) where.framework = filters.framework;
    }

    if (filters?.skill !== undefined) {
        where.skill = filters.skill;
    }

    if (filters?.skillVersion !== undefined) {
        where.skillVersion = filters.skillVersion;
    }

    const records = await db.findExecutions(where, { timestamp: 'desc' });

    return records.map((r: any) => {
        const model = r.model ?? null;
        const pricingResult = model ? getModelPricing(model) : null;
        const pricing = pricingResult?.pricing ?? null;
        const cwResult = (model && r.maxSingleCallTokens != null) ? getModelContextWindow(model) : null;
        return {
            ...r,
            upload_id: r.id,
            task_id: r.taskId || undefined,
            query: r.query || undefined,
            framework: r.framework || undefined,
            tokens: r.tokens || undefined,
            cost: (pricing && r.inputTokens != null && r.outputTokens != null)
                ? calculateCost(r.inputTokens, r.outputTokens, pricing, r.cacheReadInputTokens ?? undefined, r.cacheCreationInputTokens ?? undefined)
                : undefined,
            latency: r.latency || undefined,
            timestamp: r.timestamp?.toISOString?.() || r.timestamp,
            final_result: r.finalResult || undefined,
            skill: r.skill || undefined,
            skills: r.skills ? JSON.parse(r.skills) : undefined,
            invokedSkills: r.invokedSkills ? JSON.parse(r.invokedSkills) : undefined,
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
            model,
            tool_call_count: r.toolCallCount ?? undefined,
            llm_call_count: r.llmCallCount ?? undefined,
            input_tokens: r.inputTokens ?? undefined,
            output_tokens: r.outputTokens ?? undefined,
            tool_call_error_count: r.toolCallErrorCount ?? undefined,
            cache_read_input_tokens: r.cacheReadInputTokens ?? undefined,
            cache_creation_input_tokens: r.cacheCreationInputTokens ?? undefined,
            max_single_call_tokens: r.maxSingleCallTokens ?? undefined,
            expected_skill_version: r.expectedSkillVersion ?? null,
            skill_recall_rate: r.skillRecallRate ?? null,
            context_window_pct: (r.maxSingleCallTokens != null && cwResult)
                ? Math.round((r.maxSingleCallTokens / cwResult.contextWindow) * 1000) / 10
                : undefined,
            context_window_limit: cwResult?.contextWindow,
            context_window_source: cwResult?.source,
            cost_pricing: pricing ? {
                inputTokenPrice: pricing.inputTokenPrice,
                outputTokenPrice: pricing.outputTokenPrice,
                cacheReadInputTokenPrice: pricing.cacheReadInputTokenPrice ?? pricing.inputTokenPrice * DEFAULT_CACHE_READ_RATIO,
                cacheCreationInputTokenPrice: pricing.cacheCreationInputTokenPrice ?? pricing.inputTokenPrice * DEFAULT_CACHE_CREATION_RATIO,
                source: pricingResult?.source ?? 'default',
            } : null,
        };
    });
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
        const parse = (s: string | null, fieldName: string) => {
            if (!s) return undefined;
            try { 
                return JSON.parse(s); 
            } catch (e) { 
                console.error(`[readConfig] Failed to parse ${fieldName} for config ${c.id}:`, e);
                return undefined; 
            }
        };
        return {
            id: c.id,
            query: c.query,
            skill: c.skill, // Legacy
            skillVersion: c.skillVersion, // Legacy
            expectedSkills: parse(c.expectedSkills, 'expectedSkills'), // New field
            standard_answer: c.standardAnswer,
            root_causes: parse(c.rootCauses, 'rootCauses'),
            key_actions: parse(c.keyActions, 'keyActions'),
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
            expected_skill_version: dbRecord.expectedSkillVersion ?? null,
            skill_recall_rate: dbRecord.skillRecallRate ?? null,
            model: dbRecord.model || undefined,
            tool_call_count: dbRecord.toolCallCount ?? undefined,
            llm_call_count: dbRecord.llmCallCount ?? undefined,
            input_tokens: dbRecord.inputTokens ?? undefined,
            output_tokens: dbRecord.outputTokens ?? undefined,
            tool_call_error_count: dbRecord.toolCallErrorCount ?? undefined,
            cache_read_input_tokens: dbRecord.cacheReadInputTokens ?? undefined,
            cache_creation_input_tokens: dbRecord.cacheCreationInputTokens ?? undefined,
            max_single_call_tokens: dbRecord.maxSingleCallTokens ?? undefined,
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
    if (data.cache_read_input_tokens !== undefined) targetRecord.cache_read_input_tokens = Number(data.cache_read_input_tokens);
    if (data.cache_creation_input_tokens !== undefined) targetRecord.cache_creation_input_tokens = Number(data.cache_creation_input_tokens);
    if (data.max_single_call_tokens !== undefined) targetRecord.max_single_call_tokens = Number(data.max_single_call_tokens);

    const NO_MATCH_REASON = '未找到匹配的评测配置';

    let isSkillCorrect = false; // Reset to false and recalculate based on current config
    let isAnswerCorrect = targetRecord.is_answer_correct || false;
    let judgmentReason = targetRecord.judgment_reason || NO_MATCH_REASON;

    const configs = await readConfig(targetRecord.user);
    if (targetRecord.query && configs.length > 0) {
        const matchedConfig = findBestMatchConfig(configs, targetRecord.query);

        if (matchedConfig) {
            const invokedSkillsWithVersion = targetRecord.invokedSkills || [];
            const invokedSkillsFallback = (targetRecord.skills || []).map(name => ({ name, version: null as number | null }));

            const expectedSkillsList = matchedConfig.expectedSkills || [];
            
            if (expectedSkillsList.length > 0) {
                const skillsToCheck = invokedSkillsWithVersion.length > 0 
                    ? invokedSkillsWithVersion 
                    : invokedSkillsFallback;
                
                if (skillsToCheck.length > 0) {
                    let correctInvokedSkills = 0;
                    
                    const validExpectedSkills = expectedSkillsList.filter(e => e.skill?.trim());
                    
                    const skillNames = validExpectedSkills.map(e => e.skill.trim());
                    let skillsMap = new Map<string, any>();
                    
                    if (skillNames.length > 0) {
                        try {
                            const skills = await db.findSkills({
                                name: { in: skillNames },
                                user: targetRecord.user || null
                            });
                            
                            for (const skill of skills) {
                                skillsMap.set(skill.name, skill);
                            }
                        } catch (err) {
                            console.error('[Judgment] Error fetching skills for version check:', err);
                        }
                    }
                    
                    for (const expected of validExpectedSkills) {
                        const expectedName = expected.skill.trim();
                        const expectedVer = expected.version ?? null;
                        
                        const matchingInvoked = skillsToCheck.find(
                            (s) => s.name === expectedName
                        );
                        
                        if (matchingInvoked) {
                            let isVersionMatch = false;
                            
                            if (expectedVer === null) {
                                isVersionMatch = true;
                            } else if (matchingInvoked.version !== null) {
                                isVersionMatch = matchingInvoked.version === expectedVer;
                            } else {
                                const skill = skillsMap.get(expectedName);
                                if (skill) {
                                    const actualVersion = skill.activeVersion || 0;
                                    isVersionMatch = actualVersion === expectedVer;
                                } else {
                                    isVersionMatch = false;
                                }
                            }
                            
                            if (isVersionMatch) {
                                correctInvokedSkills++;
                                if (!isSkillCorrect) {
                                    isSkillCorrect = true;
                                }
                            }
                        }
                    }
                    
                    if (validExpectedSkills.length > 0) {
                        targetRecord.skill_recall_rate = correctInvokedSkills / validExpectedSkills.length;
                    }
                }
            }
            targetRecord.is_skill_correct = isSkillCorrect;

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

    if (targetRecord.skill && targetRecord.skill_version !== undefined && targetRecord.skill_version !== null) {
        targetRecord.label = `${targetRecord.skill}-v${targetRecord.skill_version}`;
    } else if (targetRecord.skill) {
        targetRecord.label = `${targetRecord.skill}-v1`;
    } else {
        targetRecord.label = 'without-skill';
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
            invokedSkills: targetRecord.invokedSkills ? JSON.stringify(targetRecord.invokedSkills) : null,
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
            skillRecallRate: targetRecord.skill_recall_rate,
            cacheReadInputTokens: targetRecord.cache_read_input_tokens,
            cacheCreationInputTokens: targetRecord.cache_creation_input_tokens,
            maxSingleCallTokens: targetRecord.max_single_call_tokens,
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
            invokedSkills: targetRecord.invokedSkills ? JSON.stringify(targetRecord.invokedSkills) : null,
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
            skillRecallRate: targetRecord.skill_recall_rate,
            cacheReadInputTokens: targetRecord.cache_read_input_tokens,
            cacheCreationInputTokens: targetRecord.cache_creation_input_tokens,
            maxSingleCallTokens: targetRecord.max_single_call_tokens,
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
