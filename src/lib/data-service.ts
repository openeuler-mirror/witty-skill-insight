import fs from 'fs';
import path from 'path';
import { judgeAnswer } from './judge';
import { db } from './prisma';
import { getModelPricing, calculateCost, getModelContextWindow, DEFAULT_CACHE_READ_RATIO, DEFAULT_CACHE_CREATION_RATIO } from './model-config';
import {
    configSupportsDatasetType,
    getDatasetTypePriority,
    normalizeExpectedSkills,
    normalizeConfigDatasetType,
    type ConfigDatasetType,
} from './config-dataset';
import {
    getConfigSubjectLabel,
    normalizeConfigQuery,
    normalizeConfigSkillName,
} from './config-target';
import {
    matchRoutingSignature,
    matchQueryToStoredRoutingSignature,
    type RoutingSemanticSignature,
} from './routing-signature';
import { deriveOpencodeExecutionFields } from './opencode-derived-metrics';
import { chooseExecutionLabel } from './label-utils';
import { parseLabelSkillVersionBinding } from './label-skill-binding';
import { extractKeyActionsFromFlow, mergeKeyActionsFromMultipleSkills, type ExtractedKeyAction, type ParsedFlowResult } from './flow-parser';
import { mergeSessionInteractionsMonotonic } from './session-interactions-merge';

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
    reasoning_tokens?: number;
    context_window_pct?: number;
    context_window_limit?: number;
    context_window_source?: string;
    routing_evaluation?: RoutingEvaluationSnapshot;
    outcome_evaluation?: OutcomeEvaluationSnapshot;
    [key: string]: any;
}

export interface RoutingMatchedSkill {
    skill: string;
    expected_version: number | null;
    invoked_version: number | null;
}

export interface RoutingSkillBreakdown {
    skill: string;
    expected: boolean;
    invoked: boolean;
    matched: boolean;
    status: 'matched' | 'missed' | 'unexpected' | 'not_applicable';
    expected_version: number | null;
    invoked_version: number | null;
}

export interface RoutingEvaluationSnapshot {
    status: 'available' | 'missing';
    matched_config_id?: string;
    matched_query?: string;
    matched_intent?: string;
    matched_anchors?: string[];
    dataset_type?: ConfigDatasetType;
    expected_skills: { skill: string; version: number | null }[];
    invoked_skills: InvokedSkill[];
    matched_skills: RoutingMatchedSkill[];
    expected_count: number;
    matched_count: number;
    is_correct: boolean;
    recall_rate: number | null;
    skill_breakdown: RoutingSkillBreakdown[];
}

export interface OutcomeSkillBreakdown {
    skill: string;
    version: number | null;
    role: 'primary' | 'invoked' | 'expected_only' | 'context_only';
    is_primary: boolean;
    is_invoked: boolean;
    is_expected: boolean;
    routing_status: RoutingSkillBreakdown['status'] | 'missing_dataset';
    shares_execution_outcome: true;
    score: number | null;
    is_correct: boolean | null;
}

export interface OutcomeEvaluationSnapshot {
    status: 'available' | 'missing' | 'pending';
    matched_config_id?: string;
    matched_query?: string;
    matched_skill?: string;
    matched_skill_version?: number | null;
    dataset_type?: ConfigDatasetType;
    is_correct: boolean | null;
    score: number | null;
    reason?: string;
    standard_answer_present: boolean;
    root_cause_count: number;
    key_action_count: number;
    skill_breakdown: OutcomeSkillBreakdown[];
}

export interface ConfigItem {
    id: string;
    query?: string | null;
    dataset_type?: ConfigDatasetType;
    skill: string;
    skillVersion?: number | null;
    routing_intent?: string;
    routing_anchors?: string[];
    expectedSkills?: { skill: string; version: number | null }[];
    standard_answer: string;
    root_causes?: { content: string; weight: number }[];
    key_actions?: { content: string; weight: number }[];
    parse_status?: string;
    extractedKeyActions?: { id: string; content: string; weight: number; controlFlowType: string; condition?: string; branchLabel?: string; loopCondition?: string; expectedMinCount?: number; expectedMaxCount?: number; skillSource?: string; groupId?: string }[];
}

type ConfigMatchMode = 'any' | 'routing' | 'outcome';

const NO_OUTCOME_MATCH_REASON = '未找到匹配的效果评测配置';

function normalizeQueryForMatch(input: string): string {
    let s = input.trim();
    const pairs: Array<[string, string]> = [
        ['"', '"'],
        ["'", "'"],
        ['“', '”'],
        ['‘', '’'],
        ['`', '`'],
        ['《', '》'],
        ['（', '）'],
        ['(', ')'],
        ['【', '】'],
        ['[', ']'],
        ['{', '}'],
        ['<', '>'],
    ];

    for (let i = 0; i < 6; i++) {
        const before = s;
        s = s.trim();
        for (const [l, r] of pairs) {
            if (s.startsWith(l) && s.endsWith(r) && s.length >= l.length + r.length + 1) {
                s = s.slice(l.length, -r.length);
            }
        }
        if (s === before) break;
    }

    s = s.replace(/[\s"'“”‘’`。.]/g, '');
    s = s.replace(/^[\s.,，。!?！？;；:：、·…]+|[\s.,，。!?！？;；:：、·…]+$/g, '');
    s = s.replace(/\s+/g, ' ').trim();
    return s;
}

export function findBestMatchConfig(
    configs: ConfigItem[],
    userQuery: string | null | undefined,
    matchMode: ConfigMatchMode = 'any'
): ConfigItem | undefined {
    if (!userQuery) return undefined;
    
    const trimmedUserQuery = normalizeQueryForMatch(userQuery);
    if (!trimmedUserQuery) return undefined;
    
    const matchingConfigs = configs
        .filter(c => c.query && c.query.trim())
        .filter(c => {
            const trimmedConfigQuery = normalizeQueryForMatch(c.query || '');
            if (!trimmedConfigQuery) return false;
            return trimmedUserQuery.endsWith(trimmedConfigQuery);
        })
        .filter(c => {
            if (matchMode === 'any') {
                return true;
            }
            return configSupportsDatasetType(c.dataset_type, matchMode);
        });
    
    if (matchingConfigs.length === 0) return undefined;
    
    return matchingConfigs.reduce((best, current) => {
        const bestLen = normalizeQueryForMatch(best.query || '').length;
        const currentLen = normalizeQueryForMatch(current.query || '').length;
        if (currentLen !== bestLen) {
            return currentLen > bestLen ? current : best;
        }

        const bestPriority = getDatasetTypePriority(best.dataset_type, matchMode);
        const currentPriority = getDatasetTypePriority(current.dataset_type, matchMode);
        return currentPriority > bestPriority ? current : best;
    });
}

function getStoredRoutingSignature(config: ConfigItem): RoutingSemanticSignature | null {
    const existingAnchors = Array.isArray(config.routing_anchors)
        ? config.routing_anchors.filter(anchor => typeof anchor === 'string' && anchor.trim())
        : [];

    if (config.routing_intent?.trim() && existingAnchors.length > 0) {
        return {
            intent: config.routing_intent.trim(),
            anchors: existingAnchors,
        };
    }

    return null;
}

export async function findBestRoutingConfig(
    configs: ConfigItem[],
    userQuery: string | null | undefined,
    _user?: string | null
): Promise<ConfigItem | undefined> {
    const normalizedQuery = normalizeConfigQuery(userQuery);
    if (!normalizedQuery) return undefined;

    const candidates = configs.filter(config => configSupportsDatasetType(config.dataset_type, 'routing'));
    const scored: Array<{
        config: ConfigItem;
        signature: RoutingSemanticSignature;
        matchedAnchors: string[];
        anchorCoverage: number;
        intentMatched: boolean;
    }> = [];

    for (const candidate of candidates) {
        const signature = getStoredRoutingSignature(candidate);
        if (!signature) continue;

        const match = matchQueryToStoredRoutingSignature(normalizedQuery, signature);
        if (match.matchedAnchors.length === 0 && !match.intentMatched) {
            continue;
        }

        scored.push({
            config: candidate,
            signature,
            matchedAnchors: match.matchedAnchors,
            anchorCoverage: match.anchorCoverage,
            intentMatched: match.intentMatched,
        });
    }

    if (scored.length === 0) return undefined;

    scored.sort((a, b) => {
        if (b.matchedAnchors.length !== a.matchedAnchors.length) {
            return b.matchedAnchors.length - a.matchedAnchors.length;
        }

        if (b.anchorCoverage !== a.anchorCoverage) {
            return b.anchorCoverage - a.anchorCoverage;
        }

        if (Number(b.intentMatched) !== Number(a.intentMatched)) {
            return Number(b.intentMatched) - Number(a.intentMatched);
        }

        const aPriority = getDatasetTypePriority(a.config.dataset_type, 'routing');
        const bPriority = getDatasetTypePriority(b.config.dataset_type, 'routing');
        if (bPriority !== aPriority) {
            return bPriority - aPriority;
        }

        const aAnchorChars = a.signature.anchors.join('').length;
        const bAnchorChars = b.signature.anchors.join('').length;
        return bAnchorChars - aAnchorChars;
    });

    const best = scored[0];
    best.config.routing_intent = best.signature.intent;
    best.config.routing_anchors = best.signature.anchors;
    return best.config;
}

interface OutcomeTarget {
    skill: string;
    version: number | null;
}

function resolveOutcomeTarget(
    record: Pick<ExecutionRecord, 'skill' | 'skill_version' | 'invokedSkills' | 'skills'>
): OutcomeTarget | undefined {
    const primarySkill = normalizeConfigSkillName(record.skill);
    if (primarySkill) {
        return {
            skill: primarySkill,
            version: record.skill_version ?? null,
        };
    }

    const invokedSkills = getEffectiveInvokedSkills(record);
    const uniqueInvoked = Array.from(
        new Map(
            invokedSkills
                .filter(item => item.name?.trim())
                .map(item => [`${item.name.trim()}::${item.version ?? 'any'}`, item])
        ).values()
    );

    if (uniqueInvoked.length === 1) {
        return {
            skill: uniqueInvoked[0].name.trim(),
            version: uniqueInvoked[0].version ?? null,
        };
    }

    return undefined;
}

export function findBestOutcomeConfig(
    configs: ConfigItem[],
    record: Pick<ExecutionRecord, 'query' | 'skill' | 'skill_version' | 'invokedSkills' | 'skills'>
): ConfigItem | undefined {
    const target = resolveOutcomeTarget(record);
    if (!target) return undefined;
    const normalizedQuery = normalizeConfigQuery(record.query);

    const matchingConfigs = configs
        .filter(config => configSupportsDatasetType(config.dataset_type, 'outcome'))
        .filter(config => normalizeConfigSkillName(config.skill) === target.skill)
        .filter(config => {
            const configVersion = config.skillVersion ?? null;
            return configVersion === null || configVersion === target.version;
        })
        .filter(config => {
            const scenarioQuery = normalizeConfigQuery(config.query);
            if (!scenarioQuery) {
                return true;
            }
            return scenarioQuery === normalizedQuery;
        });

    if (matchingConfigs.length === 0) {
        return undefined;
    }

    return matchingConfigs.reduce((best, current) => {
        const bestExactVersion = (best.skillVersion ?? null) !== null && best.skillVersion === target.version;
        const currentExactVersion = (current.skillVersion ?? null) !== null && current.skillVersion === target.version;
        if (bestExactVersion !== currentExactVersion) {
            return currentExactVersion ? current : best;
        }

        const bestExactScenario = normalizeConfigQuery(best.query) === normalizedQuery;
        const currentExactScenario = normalizeConfigQuery(current.query) === normalizedQuery;
        if (bestExactScenario !== currentExactScenario) {
            return currentExactScenario ? current : best;
        }

        const bestIsCanonical = !normalizeConfigQuery(best.query);
        const currentIsCanonical = !normalizeConfigQuery(current.query);
        if (bestIsCanonical !== currentIsCanonical) {
            return currentIsCanonical ? current : best;
        }

        const bestPriority = getDatasetTypePriority(best.dataset_type, 'outcome');
        const currentPriority = getDatasetTypePriority(current.dataset_type, 'outcome');
        return currentPriority > bestPriority ? current : best;
    });
}

function getEvaluationContextLabel(
    record: Pick<ExecutionRecord, 'query' | 'skill' | 'skill_version'>,
    outcomeConfig?: Pick<ConfigItem, 'query' | 'skill' | 'skillVersion'>
): string {
    return getConfigSubjectLabel({
        query: record.query,
        skill: record.skill || outcomeConfig?.skill || null,
        skillVersion: record.skill_version ?? outcomeConfig?.skillVersion ?? null,
    }, 'Skill execution benchmark');
}

function getRoutingExpectedSkills(config?: ConfigItem): { skill: string; version: number | null }[] {
    if (!config) return [];

    const expectedSkills = normalizeExpectedSkills(config.expectedSkills);

    if (expectedSkills.length > 0) {
        return expectedSkills;
    }

    if (config.skill?.trim()) {
        return [{ skill: config.skill.trim(), version: config.skillVersion ?? null }];
    }

    return [];
}

function getEffectiveInvokedSkills(record: Pick<ExecutionRecord, 'invokedSkills' | 'skills'>): InvokedSkill[] {
    if (Array.isArray(record.invokedSkills) && record.invokedSkills.length > 0) {
        return record.invokedSkills
            .filter(item => item?.name?.trim())
            .map(item => ({ name: item.name.trim(), version: item.version ?? null }));
    }

    if (Array.isArray(record.skills) && record.skills.length > 0) {
        return record.skills
            .filter(name => typeof name === 'string' && name.trim())
            .map(name => ({ name: name.trim(), version: null }));
    }

    return [];
}

interface SkillContext {
    skill: string;
    expected_version: number | null;
    invoked_version: number | null;
    primary_version: number | null;
    is_expected: boolean;
    is_invoked: boolean;
    is_primary: boolean;
    is_outcome_anchor: boolean;
}

function collectSkillContexts(
    record: Pick<ExecutionRecord, 'skill' | 'skill_version' | 'invokedSkills' | 'skills'>,
    routingConfig?: ConfigItem,
    outcomeConfig?: ConfigItem
): SkillContext[] {
    const contexts = new Map<string, SkillContext>();

    const upsertContext = (skillName: string | undefined, patch: Partial<SkillContext>) => {
        const trimmed = skillName?.trim();
        if (!trimmed) return;

        const existing = contexts.get(trimmed) || {
            skill: trimmed,
            expected_version: null,
            invoked_version: null,
            primary_version: null,
            is_expected: false,
            is_invoked: false,
            is_primary: false,
            is_outcome_anchor: false,
        };

        contexts.set(trimmed, {
            ...existing,
            ...patch,
            expected_version: patch.expected_version !== undefined ? patch.expected_version : existing.expected_version,
            invoked_version: patch.invoked_version !== undefined ? patch.invoked_version : existing.invoked_version,
            primary_version: patch.primary_version !== undefined ? patch.primary_version : existing.primary_version,
            is_expected: patch.is_expected ?? existing.is_expected,
            is_invoked: patch.is_invoked ?? existing.is_invoked,
            is_primary: patch.is_primary ?? existing.is_primary,
            is_outcome_anchor: patch.is_outcome_anchor ?? existing.is_outcome_anchor,
        });
    };

    upsertContext(record.skill, {
        is_primary: true,
        primary_version: record.skill_version ?? null,
    });

    for (const expected of getRoutingExpectedSkills(routingConfig)) {
        upsertContext(expected.skill, {
            is_expected: true,
            expected_version: expected.version ?? null,
        });
    }

    for (const invoked of getEffectiveInvokedSkills(record)) {
        upsertContext(invoked.name, {
            is_invoked: true,
            invoked_version: invoked.version ?? null,
        });
    }

    if (outcomeConfig?.skill?.trim()) {
        upsertContext(outcomeConfig.skill, {
            is_outcome_anchor: true,
        });
    }

    return Array.from(contexts.values()).sort((a, b) => {
        const aWeight = Number(a.is_primary) * 4 + Number(a.is_invoked) * 2 + Number(a.is_expected);
        const bWeight = Number(b.is_primary) * 4 + Number(b.is_invoked) * 2 + Number(b.is_expected);
        if (aWeight !== bWeight) return bWeight - aWeight;
        return a.skill.localeCompare(b.skill);
    });
}

function getKeyActionFlowTargets(config: ConfigItem): { skill: string; version: number | null }[] {
    const targets = new Map<string, { skill: string; version: number | null }>();

    const addTarget = (rawSkill: string | undefined, rawVersion: number | null | undefined) => {
        const skill = normalizeConfigSkillName(rawSkill);
        if (!skill) return;
        const version = rawVersion ?? null;
        targets.set(`${skill}::${version ?? 'any'}`, { skill, version });
    };

    addTarget(config.skill, config.skillVersion ?? null);

    for (const expected of normalizeExpectedSkills(config.expectedSkills)) {
        addTarget(expected.skill, expected.version ?? null);
    }

    return Array.from(targets.values());
}

async function fillConfigKeyActionsFromParsedFlows(
    config: ConfigItem,
    user?: string | null
): Promise<void> {
    if (!config || (Array.isArray(config.key_actions) && config.key_actions.length > 0)) {
        return;
    }

    const targets = getKeyActionFlowTargets(config);
    if (targets.length === 0) {
        return;
    }

    const allActions: { name: string; actions: ExtractedKeyAction[] }[] = [];

    for (const target of targets) {
        const skill = await db.findSkill(target.skill, user || null);
        if (!skill) {
            continue;
        }

        const resolvedVersion = target.version
            ?? skill.activeVersion
            ?? skill.versions?.[0]?.version
            ?? null;
        if (resolvedVersion == null) {
            continue;
        }

        const parsedFlow = await db.findParsedFlow(skill.id, resolvedVersion, user || null);
        if (!parsedFlow?.flowJson) {
            continue;
        }

        const flow: ParsedFlowResult = JSON.parse(parsedFlow.flowJson);
        const actions = extractKeyActionsFromFlow(flow).map(action => ({
            ...action,
            skillSource: action.skillSource || target.skill,
        }));

        if (actions.length > 0) {
            allActions.push({ name: target.skill, actions });
        }
    }

    if (allActions.length === 0) {
        return;
    }

    const extractedActions = allActions.length === 1
        ? allActions[0].actions
        : mergeKeyActionsFromMultipleSkills(allActions);

    config.key_actions = extractedActions.map(action => ({
        content: action.content,
        weight: action.weight,
        ...(action.controlFlowType !== 'required' ? { controlFlowType: action.controlFlowType } : {}),
        ...(action.condition ? { condition: action.condition } : {}),
        ...(action.branchLabel ? { branchLabel: action.branchLabel } : {}),
        ...(action.loopCondition ? { loopCondition: action.loopCondition } : {}),
        ...(action.expectedMinCount !== undefined ? { expectedMinCount: action.expectedMinCount } : {}),
        ...(action.expectedMaxCount !== undefined ? { expectedMaxCount: action.expectedMaxCount } : {}),
        ...(action.groupId ? { groupId: action.groupId } : {}),
    }));
    config.extractedKeyActions = extractedActions;

    try {
        await db.updateConfig(config.id, {
            keyActions: JSON.stringify(config.key_actions),
            extractedKeyActions: JSON.stringify(extractedActions),
        });
        console.log(`[AutoExtract] Auto-filled key_actions for config ${config.id} from ${targets.map(target => target.skill).join(', ')}`);
    } catch (err) {
        console.error('[AutoExtract] Error updating config with extracted key_actions:', err);
    }
}

async function buildRoutingEvaluationSnapshot(
    record: Pick<ExecutionRecord, 'query' | 'skill' | 'skill_version' | 'invokedSkills' | 'skills' | 'user'>,
    routingConfig?: ConfigItem,
    evaluationUser?: string | null
): Promise<RoutingEvaluationSnapshot> {
    const invokedSkills = getEffectiveInvokedSkills(record);
    const skillContexts = collectSkillContexts(record, routingConfig);

    if (!routingConfig) {
        return {
            status: 'missing',
            expected_skills: [],
            invoked_skills: invokedSkills,
            matched_skills: [],
            matched_anchors: [],
            expected_count: 0,
            matched_count: 0,
            is_correct: false,
            recall_rate: null,
            skill_breakdown: skillContexts.map(context => ({
                skill: context.skill,
                expected: context.is_expected,
                invoked: context.is_invoked,
                matched: false,
                status: context.is_invoked ? 'unexpected' : 'not_applicable',
                expected_version: context.expected_version,
                invoked_version: context.invoked_version,
            })),
        };
    }

    const expectedSkills = getRoutingExpectedSkills(routingConfig);
    const matchedSkills: RoutingMatchedSkill[] = [];

    let correctInvokedSkills = 0;
    const skillsMap = new Map<string, { activeVersion?: number | null }>();

    const skillNamesForLookup = expectedSkills
        .filter(expected =>
            expected.version !== null
            && !invokedSkills.some(invoked => invoked.name === expected.skill && invoked.version !== null)
        )
        .map(expected => expected.skill);

    if (skillNamesForLookup.length > 0) {
        try {
            const skills = await db.findSkills({
                name: { in: skillNamesForLookup },
                user: evaluationUser || null,
            });

            for (const skill of skills) {
                skillsMap.set(skill.name, skill);
            }
        } catch (err) {
            console.error('[RoutingEvaluation] Error fetching skills for version check:', err);
        }
    }

    for (const expected of expectedSkills) {
        const matchingInvoked = invokedSkills.find(item => item.name === expected.skill);
        if (!matchingInvoked) continue;

        let isVersionMatch = false;
        if (expected.version === null) {
            isVersionMatch = true;
        } else if (matchingInvoked.version !== null) {
            isVersionMatch = matchingInvoked.version === expected.version;
        } else {
            const skill = skillsMap.get(expected.skill);
            const actualVersion = skill ? (skill.activeVersion || 0) : null;
            isVersionMatch = actualVersion === expected.version;
        }

        if (isVersionMatch) {
            correctInvokedSkills += 1;
            matchedSkills.push({
                skill: expected.skill,
                expected_version: expected.version,
                invoked_version: matchingInvoked.version ?? null,
            });
        }
    }

    const skillBreakdown: RoutingSkillBreakdown[] = skillContexts.map(context => {
        const matched = matchedSkills.some(item => item.skill === context.skill);
        let status: RoutingSkillBreakdown['status'] = 'not_applicable';

        if (context.is_expected) {
            status = matched ? 'matched' : 'missed';
        } else if (context.is_invoked) {
            status = 'unexpected';
        }

        return {
            skill: context.skill,
            expected: context.is_expected,
            invoked: context.is_invoked,
            matched,
            status,
            expected_version: context.expected_version,
            invoked_version: context.invoked_version,
        };
    });

    return {
        status: 'available',
        matched_config_id: routingConfig.id,
        matched_query: normalizeConfigQuery(routingConfig.query) || undefined,
        matched_intent: routingConfig.routing_intent || undefined,
        matched_anchors: routingConfig.routing_anchors || [],
        dataset_type: normalizeConfigDatasetType(routingConfig.dataset_type),
        expected_skills: expectedSkills,
        invoked_skills: invokedSkills,
        matched_skills: matchedSkills,
        expected_count: expectedSkills.length,
        matched_count: correctInvokedSkills,
        is_correct: correctInvokedSkills > 0,
        recall_rate: expectedSkills.length > 0 ? correctInvokedSkills / expectedSkills.length : null,
        skill_breakdown: skillBreakdown,
    };
}

function buildOutcomeEvaluationSnapshot(
    record: Pick<ExecutionRecord, 'skill' | 'skill_version' | 'invokedSkills' | 'skills' | 'answer_score' | 'is_answer_correct' | 'judgment_reason'>,
    outcomeConfig?: ConfigItem,
    routingConfig?: ConfigItem,
    routingEvaluation?: RoutingEvaluationSnapshot
): OutcomeEvaluationSnapshot {
    const skillContexts = collectSkillContexts(record, routingConfig, outcomeConfig);
    const buildSkillBreakdown = (score: number | null, isCorrect: boolean | null): OutcomeSkillBreakdown[] =>
        skillContexts.map(context => {
            let role: OutcomeSkillBreakdown['role'] = 'context_only';
            if (context.is_primary) {
                role = 'primary';
            } else if (context.is_invoked) {
                role = 'invoked';
            } else if (context.is_expected) {
                role = 'expected_only';
            }

            const routingStatus = routingEvaluation?.status === 'available'
                ? (routingEvaluation.skill_breakdown.find(item => item.skill === context.skill)?.status || 'not_applicable')
                : 'missing_dataset';

            return {
                skill: context.skill,
                version: context.invoked_version ?? context.primary_version ?? context.expected_version ?? null,
                role,
                is_primary: context.is_primary,
                is_invoked: context.is_invoked,
                is_expected: context.is_expected,
                routing_status: routingStatus,
                shares_execution_outcome: true,
                score,
                is_correct: isCorrect,
            };
        });

    if (!outcomeConfig) {
        return {
            status: 'missing',
            is_correct: null,
            score: null,
            reason: record.judgment_reason || NO_OUTCOME_MATCH_REASON,
            standard_answer_present: false,
            root_cause_count: 0,
            key_action_count: 0,
            skill_breakdown: buildSkillBreakdown(null, null),
        };
    }

    const status = record.judgment_reason === '结果评估中...' ? 'pending' : 'available';
    const score = status === 'pending' ? null : (record.answer_score ?? null);
    const isCorrect = status === 'pending' ? null : (record.is_answer_correct ?? null);

    return {
        status,
        matched_config_id: outcomeConfig.id,
        matched_query: normalizeConfigQuery(outcomeConfig.query) || undefined,
        matched_skill: normalizeConfigSkillName(outcomeConfig.skill) || undefined,
        matched_skill_version: outcomeConfig.skillVersion ?? null,
        dataset_type: normalizeConfigDatasetType(outcomeConfig.dataset_type),
        is_correct: isCorrect,
        score,
        reason: record.judgment_reason || undefined,
        standard_answer_present: Boolean(outcomeConfig.standard_answer),
        root_cause_count: outcomeConfig.root_causes?.length ?? 0,
        key_action_count: outcomeConfig.key_actions?.length ?? 0,
        skill_breakdown: buildSkillBreakdown(score, isCorrect),
    };
}

async function attachEvaluationSnapshots(
    record: ExecutionRecord,
    configs: ConfigItem[],
    evaluationUser?: string | null
): Promise<ExecutionRecord> {
    const routingConfig = record.query ? await findBestRoutingConfig(configs, record.query, evaluationUser ?? record.user ?? null) : undefined;
    const outcomeConfig = findBestOutcomeConfig(configs, record);
    const routingEvaluation = await buildRoutingEvaluationSnapshot(record, routingConfig, evaluationUser ?? record.user ?? null);

    return {
        ...record,
        routing_evaluation: routingEvaluation,
        outcome_evaluation: buildOutcomeEvaluationSnapshot(record, outcomeConfig, routingConfig, routingEvaluation),
    };
}

const DATA_DIR = path.join(process.cwd(), 'data');
const EVALUATION_FILE = path.join(DATA_DIR, 'evaluation_result.json');
const AUDIT_DATA_MUTATIONS = process.env.AUDIT_DATA_MUTATIONS === '1' || process.env.AUDIT_DATA_MUTATIONS === 'true';

interface ReadRecordFilters {
    query?: string;
    taskId?: string;
    framework?: string;
    skill?: string;
    skillVersion?: number;
}

interface ReadRecordsOptions {
    attachEvaluations?: boolean;
}

export async function readRecords(
    user?: string,
    filters?: ReadRecordFilters,
    options?: ReadRecordsOptions
): Promise<ExecutionRecord[]> {
    const attachEvaluations = options?.attachEvaluations ?? true;
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
    const byTaskId = new Map<string, any[]>();
    for (const r of records) {
        const tid = r.taskId || null;
        if (!tid) continue;
        if (!byTaskId.has(tid)) byTaskId.set(tid, []);
        byTaskId.get(tid)!.push(r);
    }

    const keepIds = new Set<string>();
    for (const [tid, group] of byTaskId.entries()) {
        if (group.length === 1) {
            keepIds.add(group[0].id);
            continue;
        }

        const canonical = group.find((x: any) => x.id === tid);
        if (canonical) {
            keepIds.add(canonical.id);
            continue;
        }

        const sorted = group.slice().sort((a: any, b: any) => {
            const ta = new Date(a.timestamp).getTime();
            const tb = new Date(b.timestamp).getTime();
            if (tb !== ta) return tb - ta;
            const la = String(a.finalResult || '').length;
            const lb = String(b.finalResult || '').length;
            return lb - la;
        });
        keepIds.add(sorted[0].id);
    }

    const filtered = records.filter((r: any) => {
        if (!r.taskId) return true;
        return keepIds.has(r.id);
    });

    for (const [tid, group] of byTaskId.entries()) {
        if (group.length <= 1) continue;
        for (const r of group) {
            if (!keepIds.has(r.id)) {
                if (AUDIT_DATA_MUTATIONS) {
                    const keepId = group.find(x => keepIds.has(x.id))?.id ?? 'unknown';
                    console.warn(`[Data-Audit] deleteExecution (read dedup): taskId=${tid} deleteId=${r.id} keepId=${keepId}`);
                }
                db.deleteExecution(r.id).catch(() => {});
            }
        }
    }

    const configCache = new Map<string, Promise<ConfigItem[]>>();
    const getConfigsForEvaluationUser = (evaluationUser?: string | null) => {
        const key = evaluationUser || '__global__';
        if (!configCache.has(key)) {
            configCache.set(key, readConfig(evaluationUser || undefined));
        }
        return configCache.get(key)!;
    };

    return Promise.all(filtered.map(async (r: any) => {
        const model = r.model ?? null;
        const pricingResult = model ? getModelPricing(model) : null;
        const pricing = pricingResult?.pricing ?? null;
        const cwResult = (model && r.maxSingleCallTokens != null) ? getModelContextWindow(model) : null;
        const normalizedRecord: ExecutionRecord = {
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
            reasoning_tokens: r.reasoningTokens ?? undefined,
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
        if (!attachEvaluations) {
            return normalizedRecord;
        }
        const evaluationUser = normalizedRecord.user ?? user ?? null;
        const configs = await getConfigsForEvaluationUser(evaluationUser);
        return attachEvaluationSnapshots(normalizedRecord, configs, evaluationUser);
    }));
}


export async function readConfig(
    user?: string | null,
    datasetType: ConfigMatchMode = 'any'
): Promise<ConfigItem[]> {
    const where: any = {};
    if (user) {
        where.OR = [
            { user: user },
            { user: null }
        ];
    }

    const configs = await db.findConfigs(where);
    const normalizedConfigs = configs.map((c: any) => {
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
            query: c.query ?? null,
            dataset_type: normalizeConfigDatasetType(c.datasetType),
            skill: c.skill,
            skillVersion: c.skillVersion,
            routing_intent: c.routingIntent || undefined,
            routing_anchors: parse(c.routingAnchors, 'routingAnchors'),
            expectedSkills: normalizeExpectedSkills(parse(c.expectedSkills, 'expectedSkills')),
            standard_answer: c.standardAnswer || '',
            root_causes: parse(c.rootCauses, 'rootCauses'),
            key_actions: parse(c.keyActions, 'keyActions'),
            extractedKeyActions: parse(c.extractedKeyActions, 'extractedKeyActions'),
            parse_status: c.parseStatus || 'completed',
        };
    });

    if (datasetType === 'any') {
        return normalizedConfigs;
    }

    return normalizedConfigs.filter(config => configSupportsDatasetType(config.dataset_type, datasetType));
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
    let recordId = id || crypto.randomUUID();

    if (data.task_id) {
        try {
            const where: any = { taskId: data.task_id };
            if (data.framework) where.framework = data.framework;
            const existingByTask = await db.findExecutions(where, { timestamp: 'desc' });
            if (existingByTask && existingByTask.length > 0 && existingByTask[0]?.id) {
                const exact = existingByTask.find((x: any) => x.id === data.task_id);
                const canonicalId = (exact && exact.id) ? exact.id : existingByTask[0].id;
                if (canonicalId !== recordId) {
                    recordId = canonicalId;
                }
            }
        } catch {}
    }

    let existingRecord: ExecutionRecord | null = null;
    const dbRecord = await db.findExecutionById(recordId);

    if (dbRecord) {
        existingRecord = {
            ...dbRecord,
            upload_id: dbRecord.id,
            task_id: dbRecord.taskId || undefined,
            query: dbRecord.query || undefined,
            framework: dbRecord.framework || undefined,
            tokens: dbRecord.tokens ?? undefined,
            cost: dbRecord.cost ?? undefined,
            latency: dbRecord.latency ?? undefined,
            timestamp: dbRecord.timestamp?.toISOString?.() || dbRecord.timestamp,
            final_result: dbRecord.finalResult || undefined,
            skill: dbRecord.skill || undefined,
            skills: dbRecord.skills ? JSON.parse(dbRecord.skills) : undefined,
            invokedSkills: dbRecord.invokedSkills ? (() => { try { return JSON.parse(dbRecord.invokedSkills); } catch { return undefined; } })() : undefined,
            is_skill_correct: dbRecord.isSkillCorrect || false,
            is_answer_correct: dbRecord.isAnswerCorrect || false,
            answer_score: dbRecord.answerScore ?? undefined,
            skill_score: dbRecord.skillScore ?? undefined,
            judgment_reason: dbRecord.judgmentReason || undefined,
            failures: dbRecord.failures ? JSON.parse(dbRecord.failures) : undefined,
            skill_issues: dbRecord.skillIssues ? JSON.parse(dbRecord.skillIssues) : undefined,
            label: dbRecord.label || undefined,
            user: dbRecord.user || undefined,
            skill_version: dbRecord.skillVersion ?? undefined,
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

    const allowQueryOverwrite = !!data.force_query_update;
    const existingQuery = typeof existingRecord?.query === 'string' ? existingRecord.query.trim() : '';
    const incomingQuery = typeof data.query === 'string' ? data.query.trim() : '';

    if (typeof data.label === 'string') {
        const b = parseLabelSkillVersionBinding(data.label);
        if (b) {
            data.skill = b.skill;
            data.skill_version = b.skill_version;
            data.skills = b.skills;
            data.invokedSkills = b.invokedSkills;
        }
    }

    targetRecord = { ...targetRecord, ...data };
    if (existingQuery && !allowQueryOverwrite) {
        targetRecord.query = existingQuery;
    } else if (!existingQuery && incomingQuery) {
        targetRecord.query = incomingQuery;
    } else if (typeof targetRecord.query === 'string' && !targetRecord.query.trim()) {
        targetRecord.query = undefined;
    } else if (typeof targetRecord.query === 'string') {
        targetRecord.query = targetRecord.query.trim();
    }
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
    if (data.reasoning_tokens !== undefined) targetRecord.reasoning_tokens = Number(data.reasoning_tokens);

    let mergedInteractionsForSession: any[] | null = null;
    if (targetRecord.task_id && targetRecord.interactions) {
        const incomingInteractions = typeof targetRecord.interactions === 'string'
            ? (() => { try { return JSON.parse(targetRecord.interactions); } catch { return []; } })()
            : targetRecord.interactions;

        mergedInteractionsForSession = incomingInteractions;
        try {
            const existingSession = await db.findSessionByTaskId(targetRecord.task_id);
            const existingInteractions = existingSession?.interactions
                ? (() => { try { return JSON.parse(existingSession.interactions as string); } catch { return []; } })()
                : [];

            if (Array.isArray(existingInteractions) && existingInteractions.length > 0) {
                mergedInteractionsForSession = mergeSessionInteractionsMonotonic(existingInteractions, incomingInteractions);
            }
        } catch {}

        targetRecord.interactions = mergedInteractionsForSession;

        if (targetRecord.framework === 'opencode' && Array.isArray(mergedInteractionsForSession)) {
            const derived = deriveOpencodeExecutionFields(mergedInteractionsForSession);
            if (derived.model) targetRecord.model = derived.model;
            if (derived.final_result) targetRecord.final_result = derived.final_result;
            targetRecord.tokens = derived.tokens;
            targetRecord.latency = derived.latency;
            targetRecord.input_tokens = derived.input_tokens;
            targetRecord.output_tokens = derived.output_tokens;
            targetRecord.tool_call_count = derived.tool_call_count;
            targetRecord.tool_call_error_count = derived.tool_call_error_count;
            targetRecord.llm_call_count = derived.llm_call_count;
            targetRecord.cache_read_input_tokens = derived.cache_read_input_tokens;
            targetRecord.cache_creation_input_tokens = derived.cache_creation_input_tokens;
            targetRecord.max_single_call_tokens = derived.max_single_call_tokens;
            targetRecord.reasoning_tokens = derived.reasoning_tokens;
        }
    }
    let isSkillCorrect = false; // Reset to false and recalculate based on current config
    let isAnswerCorrect = targetRecord.is_answer_correct || false;
    let judgmentReason = targetRecord.judgment_reason || NO_OUTCOME_MATCH_REASON;
    targetRecord.skill_recall_rate = null;

    const configs = await readConfig(targetRecord.user);
    if (configs.length > 0) {
        const routingConfig = await findBestRoutingConfig(configs, targetRecord.query, targetRecord.user);
        const outcomeConfig = findBestOutcomeConfig(configs, targetRecord);

        if (routingConfig) {
            const invokedSkillsWithVersion = Array.isArray(targetRecord.invokedSkills) ? targetRecord.invokedSkills : [];
            const skillsFallback = Array.isArray(targetRecord.skills) ? targetRecord.skills : [];
            const invokedSkillsFallback = skillsFallback.map(name => ({ name, version: null as number | null }));

            const expectedSkillsList = getRoutingExpectedSkills(routingConfig);
            
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
        }

        if (outcomeConfig) {
            await fillConfigKeyActionsFromParsedFlows(outcomeConfig, targetRecord.user);
            if (targetRecord.final_result !== undefined) {
                let needsJudgment = true;

                if (isUpdate && !data.force_judgment) {
                    if (existingRecord && existingRecord.query === targetRecord.query && existingRecord.final_result === targetRecord.final_result) {
                        needsJudgment = false;
                    }
                }

                if (needsJudgment && !targetRecord.skip_evaluation) {
                    let skillDefinition: string | undefined = undefined;
                    const skillName = (
                        targetRecord.skill
                        || outcomeConfig.skill
                        || routingConfig?.skill
                        || ''
                    ).trim();

                    if (skillName) {
                        try {
                            const skill = await db.findSkill(skillName, targetRecord.user || null);
                            if (skill) {
                                const targetVersion = outcomeConfig.skillVersion
                                    ?? targetRecord.skill_version
                                    ?? skill.activeVersion
                                    ?? 0;
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

                    let executionSteps: { name: string; description: string; type: string }[] | null = null;
                    try {
                        const matchRecord = await db.findExecutionMatch(targetRecord.task_id || targetRecord.upload_id || '');
                        if (matchRecord?.extractedSteps) {
                            executionSteps = typeof matchRecord.extractedSteps === 'string' 
                                ? JSON.parse(matchRecord.extractedSteps) 
                                : matchRecord.extractedSteps;
                        }
                    } catch (e) {
                        console.warn('[Judgment] Failed to load execution steps for KA evaluation:', e);
                    }

                    const judgment = await judgeAnswer(
                        getEvaluationContextLabel(targetRecord, outcomeConfig),
                        {
                            standard_answer_example: outcomeConfig.standard_answer,
                            root_causes: outcomeConfig.root_causes,
                            key_actions: outcomeConfig.key_actions,
                            skill_definition: skillDefinition
                        },
                        targetRecord.final_result,
                        targetRecord.user,
                        executionSteps
                    );
                    isAnswerCorrect = judgment.is_correct;
                    targetRecord.answer_score = judgment.score;
                    judgmentReason = judgment.reason || 'Judged by Evaluation Model';
                }
            }
        } else {
            if (!isUpdate || data.force_judgment) {
                isAnswerCorrect = false;
                judgmentReason = NO_OUTCOME_MATCH_REASON;
                targetRecord.answer_score = null;
            }
        }
    }

    if (data.skip_evaluation) {
        targetRecord.answer_score = null;
        isAnswerCorrect = false;
        judgmentReason = '结果评估中...';
    }

    targetRecord.is_skill_correct = isSkillCorrect;
    targetRecord.is_answer_correct = isAnswerCorrect;
    targetRecord.judgment_reason = judgmentReason;
    targetRecord = await attachEvaluationSnapshots(targetRecord, configs, targetRecord.user);

    const skillForScore = Array.isArray(targetRecord.skills) && targetRecord.skills.length > 0 ? targetRecord.skills[0] : undefined;
    if (skillForScore) {
        const evalResults = readEvaluationResults();
        const scoreStr = evalResults[skillForScore];
        if (scoreStr) targetRecord.skill_score = parseFloat(scoreStr);
    }

    targetRecord.label = chooseExecutionLabel({
        existingLabel: existingRecord?.label,
        incomingLabel: data.label,
        skill: targetRecord.skill,
        skillVersion: targetRecord.skill_version ?? null
    });

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
            reasoningTokens: targetRecord.reasoning_tokens,
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
            reasoningTokens: targetRecord.reasoning_tokens,
        }
    });

    if (data.upload_id && data.task_id && data.upload_id !== recordId) {
        try {
            const dup = await db.findExecutionById(data.upload_id);
            if (dup && dup.taskId === data.task_id) {
                if (AUDIT_DATA_MUTATIONS) {
                    console.warn(`[Data-Audit] deleteExecution (dedup on save): upload_id=${data.upload_id} task_id=${data.task_id} recordId=${recordId}`);
                }
                await db.deleteExecution(data.upload_id);
            }
        } catch {}
    }

    if (targetRecord.task_id && mergedInteractionsForSession) {
        await db.upsertSession(
            targetRecord.task_id,
            {
                taskId: targetRecord.task_id,
                query: targetRecord.query,
                label: targetRecord.label,
                user: targetRecord.user,
                model: targetRecord.model,
                interactions: JSON.stringify(mergedInteractionsForSession)
            },
            {
                query: targetRecord.query,
                label: targetRecord.label,
                user: targetRecord.user,
                model: targetRecord.model,
                interactions: JSON.stringify(mergedInteractionsForSession)
            }
        );
    }

    return { success: true, record: targetRecord };
}
