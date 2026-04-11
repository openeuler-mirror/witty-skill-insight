'use client';

import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import ExecutionFlowComparison from '@/components/ExecutionFlowComparison';
import { SkillLinks } from '@/components/SkillLink';
import { useAuth } from '@/lib/auth-context';
import { useTheme } from '@/lib/theme-context';
import { apiFetch } from '@/lib/api';

const Line = dynamic(() => import('recharts').then(mod => mod.Line), { ssr: false });
const LineChart = dynamic(() => import('recharts').then(mod => mod.LineChart), { ssr: false });
const XAxis = dynamic(() => import('recharts').then(mod => mod.XAxis), { ssr: false });
const YAxis = dynamic(() => import('recharts').then(mod => mod.YAxis), { ssr: false });
const CartesianGrid = dynamic(() => import('recharts').then(mod => mod.CartesianGrid), { ssr: false });
const Tooltip = dynamic(() => import('recharts').then(mod => mod.Tooltip), { ssr: false });
const Legend = dynamic(() => import('recharts').then(mod => mod.Legend), { ssr: false });
const ReferenceLine = dynamic(() => import('recharts').then(mod => mod.ReferenceLine), { ssr: false });
const ResponsiveContainer = dynamic(() => import('recharts').then(mod => mod.ResponsiveContainer), { ssr: false });

const ReactJson = dynamic(() => import('react-json-view'), { ssr: false });

const basePath = process.env.NEXT_PUBLIC_URL_PREFIX || '';

interface SkillIssue {
    id: string;
    type: 'root_cause' | 'key_action';
    content: string;
    match_score: number;
    explanation: string;
    weight: number;
    is_skill_issue: boolean;
    reasoning: string;
    improvement_suggestion?: string;
}

interface Execution {
    timestamp: string;
    framework: string;
    tokens: number;
    latency: number;
    query: string;
    skill?: string;
    skills?: string[];
    model?: string;
    final_result?: string;
    is_skill_correct?: boolean;
    skill_recall_rate?: number | null;
    is_answer_correct?: boolean;
    answer_score?: number;
    judgment_reason?: string;
    skill_score?: number;
    label?: string;
    task_id?: string;
    upload_id?: string;
    version?: string;
    user?: string;
    user_feedback?: {
        type: 'like' | 'dislike' | null;
        comment: string;
    };
    failures?: {
        failure_type: string;
        description: string;
        context: string;
        recovery: string;
    }[];
    skill_issues?: SkillIssue[];
    skill_version?: number;
    tool_call_count?: number;
    llm_call_count?: number;
    tool_call_error_count?: number;
    input_tokens?: number;
    output_tokens?: number;
    cost?: number;
    cost_pricing?: { inputTokenPrice: number; outputTokenPrice: number; cacheReadInputTokenPrice?: number; cacheCreationInputTokenPrice?: number; source?: 'default' | 'custom' } | null;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
    max_single_call_tokens?: number;
    context_window_pct?: number;
    context_window_limit?: number;
    context_window_source?: string;
}

interface Interaction {
    requestMessages: any[];
    responseMessage: any;
    usage?: any;
    timestamp: number;
    latency?: number;
}

interface EvaluationItem {
    id: string;
    type: 'root_cause' | 'key_action';
    content: string;
    match_score: number;
    explanation: string;
    weight: number;
}

function parseEvaluationItemsFromReason(judgmentReason: string): EvaluationItem[] {
    const items: EvaluationItem[] = [];
    if (!judgmentReason) return items;
    
    const lines = judgmentReason.split('\n');
    const itemIndex = { rc: 0, ka: 0 };
    
    for (const line of lines) {
        const rcMatch = line.match(/\*\*Root Cause\*\*\s*\[(.*?)\]\s*.*?:\s*(\d+)%\s*match\.\s*(.+?)\s*\(Weight:\s*([\d.]+)\)/);
        if (rcMatch) {
            items.push({
                id: `RC-${itemIndex.rc++}`,
                type: 'root_cause',
                content: rcMatch[1].replace(/\.{3}$/, ''),
                match_score: parseInt(rcMatch[2]) / 100,
                explanation: rcMatch[3].trim(),
                weight: parseFloat(rcMatch[4])
            });
            continue;
        }
        
        const kaMatch = line.match(/\*\*Key Action\*\*\s*\[(.*?)\]\s*.*?:\s*(\d+)%\s*match\.\s*(.+?)\s*\(Weight:\s*([\d.]+)\)/);
        if (kaMatch) {
            items.push({
                id: `KA-${itemIndex.ka++}`,
                type: 'key_action',
                content: kaMatch[1].replace(/\.{3}$/, ''),
                match_score: parseInt(kaMatch[2]) / 100,
                explanation: kaMatch[3].trim(),
                weight: parseFloat(kaMatch[4])
            });
        }
    }
    
    return items;
}

const CustomTooltip = ({ content }: { content: string }) => {
    const [visible, setVisible] = useState(false);
    return (
        <span
            style={{ position: 'relative', marginLeft: '4px', cursor: 'help', fontSize: '0.8rem', display: 'inline-block' }}
            onMouseEnter={() => setVisible(true)}
            onMouseLeave={() => setVisible(false)}
        >
            ⓘ
            {visible && (
                <div style={{
                    position: 'absolute',
                    bottom: '100%',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    background: 'var(--dropdown-bg)',
                    border: '1px solid var(--border)',
                    color: 'var(--foreground)',
                    padding: '6px 10px',
                    borderRadius: '4px',
                    whiteSpace: 'pre-line',
                    minWidth: '280px',
                    maxWidth: '400px',
                    zIndex: 1000,
                    marginBottom: '6px',
                    fontSize: '0.75rem',
                    boxShadow: '0 4px 6px -1px var(--shadow-color)',
                    pointerEvents: 'none',
                    fontWeight: 'normal',
                    lineHeight: '1.4'
                }}>
                    {content}
                    <div style={{
                        position: 'absolute',
                        top: '100%',
                        left: '50%',
                        marginLeft: '-4px',
                        width: 0,
                        height: 0,
                        borderLeft: '4px solid transparent',
                        borderRight: '4px solid transparent',
                        borderTop: '4px solid var(--border)'
                    }} />
                </div>
            )}
        </span>
    );
};

const findToolResult = (toolCallId: string, interactions: any[], currentMessageId: string): any => {
    let currentId = currentMessageId;
    const visited = new Set<string>();
    let maxDepth = 100;

    while (currentId && maxDepth > 0 && !visited.has(currentId)) {
        visited.add(currentId);

        const children = interactions.filter((i: any) => i.parentId === currentId);

        for (const child of children) {
            const childMsg = child.message;
            if (childMsg && Array.isArray(childMsg.content)) {
                const toolResults = childMsg.content.filter((c: any) =>
                    c.type === 'toolResult' || c.type === 'tool_result'
                );

                for (const tr of toolResults) {
                    if ((tr.toolCallId || tr.tool_use_id) === toolCallId) {
                        return {
                            content: tr.content,
                            isError: tr.isError || tr.is_error,
                            timestamp: childMsg.timestamp || Date.parse(child.timestamp)
                        };
                    }
                }
            }
        }

        if (children.length > 0) {
            currentId = children[0].id;
            maxDepth--;
        } else {
            break;
        }
    }

    return null;
};

const normalizeInteractions = (interactions: any[]) => {
    if (!interactions || interactions.length === 0) return [];

    const firstItem = interactions[0];

    if (firstItem.type && (firstItem.type === 'user' || firstItem.type === 'assistant') && firstItem.message) {
        const toolCallMap = new Map<string, any>();

        interactions.forEach((item: any, index: number) => {
            const msg = item.message;
            if (!msg || !Array.isArray(msg.content)) return;

            const toolCallType = msg.content.some((c: any) => c.type === 'toolCall') ? 'toolCall' : 'tool_use';

            const toolCalls = msg.content.filter((c: any) => c.type === toolCallType);
            toolCalls.forEach((tc: any) => {
                toolCallMap.set(tc.id, {
                    name: tc.name,
                    arguments: tc.arguments || tc.input,
                    messageId: item.id,
                    timestamp: msg.timestamp || Date.parse(item.timestamp)
                });
            });
        });

        return interactions.map((item: any, index: number) => {
            const msg = item.message;
            if (!msg) return null;

            const entryTimestamp = Date.parse(item.timestamp);
            const timestamp = msg.timestamp || (isNaN(entryTimestamp) ? 0 : entryTimestamp);
            const normalized: any = {
                role: msg.role,
                timestamp: timestamp,
                timeInfo: { created: timestamp }
            };

            if (item.latency) {
                normalized.latency = item.latency;
            } else if (msg.role === 'assistant') {
                const prevItem = interactions[index - 1];
                if (prevItem && prevItem.message?.role === 'user') {
                    const prevEntryTimestamp = Date.parse(prevItem.timestamp);
                    const prevTimestamp = prevEntryTimestamp;
                    const currentEntryTimestamp = Date.parse(item.timestamp);

                    if (!isNaN(prevTimestamp) && !isNaN(currentEntryTimestamp) && currentEntryTimestamp > prevTimestamp) {
                        normalized.latency = currentEntryTimestamp - prevTimestamp;
                    }
                }
            }

            if (msg.content) {
                if (typeof msg.content === 'string') {
                    normalized.content = msg.content;
                } else if (Array.isArray(msg.content)) {
                    const textBlocks = msg.content.filter((c: any) => c.type === 'text');
                    if (textBlocks.length > 0) {
                        normalized.content = textBlocks.map((c: any) => c.text).join('\n');
                    }

                    const toolCallType = msg.content.some((c: any) => c.type === 'toolCall') ? 'toolCall' : 'tool_use';

                    const toolCalls = msg.content.filter((c: any) => c.type === toolCallType);
                    if (toolCalls.length > 0) {
                        normalized.tool_calls = toolCalls.map((tc: any) => {
                            const call = toolCallMap.get(tc.id);
                            const result = findToolResult(tc.id, interactions, item.id);

                            let duration_ms = 0;
                            if (call && result) {
                                const callTime = call.timestamp;
                                const resultTime = result.timestamp;
                                if (callTime && resultTime && resultTime > callTime) {
                                    duration_ms = resultTime - callTime;
                                }
                            }

                            return {
                                function: { name: tc.name },
                                arguments: tc.arguments || tc.input,
                                output: result ? result.content : null,
                                timing: { duration_ms }
                            };
                        });
                    }
                }
            }

            if (msg.usage) {
                const totalTokens = msg.usage.totalTokens ||
                    (msg.usage.total_tokens || 0) ||
                    ((msg.usage.input_tokens || 0) + (msg.usage.output_tokens || 0));

                normalized.usage = {
                    total: totalTokens,
                    total_tokens: totalTokens,
                    input: msg.usage.input || msg.usage.input_tokens || 0,
                    output: msg.usage.output || msg.usage.output_tokens || 0
                };
            }

            return normalized;
        }).filter((item: any) => item && (item.role === 'user' || item.role === 'assistant'));
    }

    return interactions;
};

const RenderInteractionList = ({
    interactions,
    focusedStep,
    onStepClick
}: {
    interactions: any[],
    focusedStep: number | null,
    onStepClick: (index: number) => void
}) => {
    if (!interactions || !Array.isArray(interactions) || interactions.length === 0) return null;

    const [sortMode, setSortMode] = useState<'default' | 'latency_desc' | 'tokens_desc'>('default');
    const [isExpanded, setIsExpanded] = useState(true);

    const [currentPage, setCurrentPage] = useState(0);
    const pageSize = 5;

    const normalizedInteractions = useMemo(() => {
        return normalizeInteractions(interactions);
    }, [interactions]);

    const processedInteractions = useMemo(() => {
        const rows: any[] = [];

        const toMs = (v: any) => {
            if (v == null) return null;
            if (typeof v === 'number' && Number.isFinite(v)) return v;
            if (typeof v === 'string') {
                const s = v.trim();
                if (!s) return null;
                if (/^\d+$/.test(s)) {
                    const n = Number(s);
                    return Number.isFinite(n) ? n : null;
                }
                const t = Date.parse(s);
                return Number.isFinite(t) ? t : null;
            }
            return null;
        };

        normalizedInteractions.forEach((item, index) => {
            let lat = item.latency || 0;
            if (!lat && item.timeInfo && item.timeInfo.completed && item.timeInfo.created) {
                lat = item.timeInfo.completed - item.timeInfo.created;
            }

            const usage = item.usage || item.responseMessage?.usage;
            let tok = usage?.total_tokens || 0;
            if (!tok && usage?.total) {
                tok = usage.total;
            }
            if (!tok && (usage?.input || usage?.output)) {
                tok = (usage.input || 0) + (usage.output || 0);
            }

            rows.push({
                kind: 'llm',
                id: `llm-${index}`,
                order: rows.length,
                original: item,
                parentIndex: index,
                toolIndex: null,
                latency: lat,
                tokens: tok
            });

            const toolCalls = item.tool_calls || item.toolCalls || [];
            if (Array.isArray(toolCalls) && toolCalls.length > 0) {
                toolCalls.forEach((tc: any, tIdx: number) => {
                    let tLat = 0;
                    const timing = tc.timing || tc.timeInfo || {};
                    if (typeof timing.duration_ms === 'number') {
                        tLat = timing.duration_ms;
                    } else if (timing.started_at && timing.completed_at) {
                        const s = toMs(timing.started_at);
                        const e = toMs(timing.completed_at);
                        if (s != null && e != null && e >= s && e - s < 3600000) {
                            tLat = e - s;
                        }
                    }

                    rows.push({
                        kind: 'tool',
                        id: `tool-${index}-${tIdx}`,
                        order: rows.length,
                        original: tc,
                        parentIndex: index,
                        toolIndex: tIdx,
                        latency: tLat,
                        tokens: 0
                    });
                });
            }
        });

        return rows;
    }, [interactions]);

    const topLatencyIndices = useMemo(() => {
        const llmOnly = processedInteractions.filter(x => x.kind === 'llm');
        const sorted = [...llmOnly].sort((a, b) => b.latency - a.latency);
        return new Set(sorted.slice(0, 5).filter(x => x.latency > 0).map(x => x.id));
    }, [processedInteractions]);

    const topTokenIndices = useMemo(() => {
        const llmOnly = processedInteractions.filter(x => x.kind === 'llm');
        const sorted = [...llmOnly].sort((a, b) => b.tokens - a.tokens);
        return new Set(sorted.slice(0, 5).filter(x => x.tokens > 0).map(x => x.id));
    }, [processedInteractions]);

    const mainSteps = processedInteractions.filter(x => x.kind === 'llm');

    const sortedMainSteps = useMemo(() => {
        const data = [...mainSteps];
        if (sortMode === 'latency_desc') {
            data.sort((a, b) => b.latency - a.latency);
        } else if (sortMode === 'tokens_desc') {
            data.sort((a, b) => b.tokens - a.tokens);
        } else {
            data.sort((a, b) => a.order - b.order);
        }
        return data;
    }, [mainSteps, sortMode]);

    const totalPages = Math.ceil(sortedMainSteps.length / pageSize);
    const paginatedMainSteps = useMemo(() => {
        const start = currentPage * pageSize;
        return sortedMainSteps.slice(start, start + pageSize);
    }, [sortedMainSteps, currentPage, pageSize]);

    const paginatedInteractions = useMemo(() => {
        const result: any[] = [];
        paginatedMainSteps.forEach(mainStep => {
            result.push(mainStep);
            const tools = processedInteractions.filter(x => x.kind === 'tool' && x.parentIndex === mainStep.parentIndex);
            result.push(...tools);
        });
        return result;
    }, [paginatedMainSteps, processedInteractions]);

    useEffect(() => {
        setCurrentPage(0);
    }, [sortMode]);

    const headerStyle: React.CSSProperties = {
        color: '#38bdf8',
        fontSize: '0.95rem',
        margin: 0
    };

    return (
        <div style={{ marginBottom: '2rem' }}>
            <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '0.5rem',
                borderBottom: '1px solid #334155',
                paddingBottom: '4px',
                minHeight: '34px'
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button
                        onClick={() => setIsExpanded(!isExpanded)}
                        style={{ background: 'transparent', border: 'none', color: '#38bdf8', cursor: 'pointer', padding: 0 }}
                    >
                        {isExpanded ? '▼' : '▶'}
                    </button>
                    <h4 style={headerStyle}>执行步骤（Trace）</h4>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.8rem', color: 'var(--foreground-muted)' }}>Sort by:</span>
                    <select
                        value={sortMode}
                        onChange={(e) => setSortMode(e.target.value as any)}
                        style={{
                            background: 'var(--input-bg)',
                            color: 'var(--foreground)',
                            border: '1px solid var(--border)',
                            borderRadius: '4px',
                            padding: '2px 8px',
                            fontSize: '0.8rem',
                            outline: 'none'
                        }}
                    >
                        <option value="default">执行顺序</option>
                        <option value="latency_desc">时延</option>
                        <option value="tokens_desc">Tokens</option>
                    </select>
                </div>
            </div>

            {isExpanded && (
                <div style={{ maxHeight: '600px', overflowY: 'auto', paddingRight: '8px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {paginatedInteractions.map((wrapper) => {
                            const { original, kind, parentIndex, toolIndex, latency: latencyVal, tokens } = wrapper;
                            const isTopLatency = topLatencyIndices.has(wrapper.id);
                            const isTopToken = topTokenIndices.has(wrapper.id);
                            const isFocused = focusedStep === parentIndex;
                            const isTool = kind === 'tool';

                            const latencyStr = latencyVal < 1000 ? `${latencyVal.toFixed(0)}ms` : `${(latencyVal / 1000).toFixed(2)}s`;

                            let role = 'unknown';
                            let contentSummary = '';

                            if (kind === 'tool') {
                                const tc = original;
                                role = `tool:${tc.function?.name || tc.name || 'unknown'}`;
                                const out = tc.output ?? (tc.state && tc.state.output);
                                if (typeof out === 'string') contentSummary = out;
                                else if (out != null) contentSummary = JSON.stringify(out);
                                else contentSummary = '';
                            } else {
                                const step = original;
                                if (step.responseMessage) {
                                    role = step.responseMessage.role || 'assistant';
                                    const content = step.responseMessage.content;
                                    if (typeof content === 'string') contentSummary = content;
                                    else if (content) contentSummary = JSON.stringify(content);
                                }
                                if (!contentSummary && step.content) {
                                    const content = step.content;
                                    if (typeof content === 'string') contentSummary = content;
                                    else contentSummary = JSON.stringify(content);
                                }
                                if (step.role && role === 'unknown') {
                                    role = step.role;
                                }
                            }

                            const roleColor =
                                isTool ? '#fbbf24' :
                                    role === 'user' ? '#a78bfa' :
                                        role === 'assistant' ? '#38bdf8' :
                                            role === 'opencode' ? '#ef4444' :
                                                role === 'subagent' ? '#22c55e' :
                                                    '#e2e8f0';

                            const toolAccentColor = isTopLatency ? '#fb923c' : '#fbbf24';
                            const focusShadow = '0 0 0 2px rgba(96, 165, 250, 0.3)';
                            const toolAccentShadow = `inset 3px 0 0 ${toolAccentColor}`;
                            const combinedShadow = isTool
                                ? (isFocused ? `${focusShadow}, ${toolAccentShadow}` : toolAccentShadow)
                                : (isFocused ? focusShadow : 'none');

                            if (contentSummary.length > 150) contentSummary = contentSummary.slice(0, 150) + '...';

                            return (
                                <div
                                    key={wrapper.id}
                                    onClick={() => onStepClick(parentIndex)}
                                    style={{
                                        background: isFocused
                                            ? (isTool ? 'rgba(124, 58, 237, 0.2)' : 'rgba(37, 99, 235, 0.2)')
                                            : (isTool ? 'var(--background-secondary)' : 'var(--card-bg)'),
                                        border: isFocused ? '1px solid var(--primary)' : (isTool ? '1px solid var(--border)' : '1px solid var(--border)'),
                                        borderRadius: '6px',
                                        padding: '0.75rem',
                                        paddingLeft: isTool ? '1.25rem' : '0.75rem',
                                        marginLeft: isTool ? '16px' : 0,
                                        fontSize: '0.9rem',
                                        cursor: 'pointer',
                                        transition: 'all 0.2s',
                                        boxShadow: combinedShadow
                                    }}
                                >
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <span style={{
                                                background: 'var(--background-secondary)', color: 'var(--foreground-secondary)',
                                                padding: '2px 6px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 'bold'
                                            }}>
                                                {kind === 'tool' ? `#${parentIndex}.${toolIndex}` : `#${parentIndex}`}
                                            </span>
                                            <span style={{ fontWeight: 'bold', color: roleColor, textTransform: 'capitalize' }}>
                                                {role}
                                            </span>
                                            {isTool && (
                                                <span style={{
                                                    fontSize: '0.7rem',
                                                    color: '#ffffff',
                                                    background: 'var(--warning)',
                                                    borderRadius: '999px',
                                                    padding: '1px 8px',
                                                    fontWeight: 'bold'
                                                }}>
                                                    TOOL
                                                </span>
                                            )}
                                        </div>
                                        <div style={{ display: 'flex', gap: '1rem', fontSize: '0.85rem' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                <span style={{ color: 'var(--foreground-muted)' }}>Latency:</span>
                                                <span style={{
                                                    color: isTopLatency ? 'var(--warning)' : 'var(--foreground)',
                                                    fontWeight: isTopLatency ? 'bold' : 'normal',
                                                    borderBottom: isTopLatency ? '1px dashed var(--warning)' : 'none'
                                                }}>
                                                    {latencyStr}
                                                </span>
                                                {isTopLatency && <span style={{ fontSize: '0.7rem', color: 'var(--warning)', border: '1px solid var(--warning)', borderRadius: '4px', padding: '0 4px' }}>TOP 5</span>}
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                <span style={{ color: 'var(--foreground-muted)' }}>Tokens:</span>
                                                <span style={{
                                                    color: isTopToken ? 'var(--accent)' : 'var(--foreground)',
                                                    fontWeight: isTopToken ? 'bold' : 'normal',
                                                    borderBottom: isTopToken ? '1px dashed var(--accent)' : 'none'
                                                }}>
                                                    {tokens}
                                                </span>
                                                {isTopToken && <span style={{ fontSize: '0.7rem', color: 'var(--accent)', border: '1px solid var(--accent)', borderRadius: '4px', padding: '0 4px' }}>TOP 5</span>}
                                            </div>
                                        </div>
                                    </div>
                                    <div style={{
                                        color: 'var(--foreground)',
                                        fontFamily: 'monospace',
                                        opacity: 0.9,
                                        wordBreak: 'break-all'
                                    }}>
                                        {contentSummary || <span style={{ color: 'var(--foreground-muted)', fontStyle: 'italic' }}>(No Content)</span>}
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {totalPages > 1 && (
                        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '1rem', marginTop: '1rem' }}>
                            <button
                                onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
                                disabled={currentPage === 0}
                                style={{
                                    padding: '4px 12px',
                                    background: currentPage === 0 ? 'var(--border)' : 'var(--primary)',
                                    color: currentPage === 0 ? 'var(--foreground-muted)' : '#ffffff',
                                    border: 'none',
                                    borderRadius: '4px',
                                    cursor: currentPage === 0 ? 'not-allowed' : 'pointer'
                                }}
                            >
                                Prev
                            </button>
                            <span style={{ color: 'var(--foreground-muted)', fontSize: '0.9rem' }}>
                                Page {currentPage + 1} of {totalPages}
                            </span>
                            <button
                                onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))}
                                disabled={currentPage === totalPages - 1}
                                style={{
                                    padding: '4px 12px',
                                    background: currentPage === totalPages - 1 ? 'var(--border)' : 'var(--primary)',
                                    color: currentPage === totalPages - 1 ? 'var(--foreground-muted)' : '#ffffff',
                                    border: 'none',
                                    borderRadius: '4px',
                                    cursor: currentPage === totalPages - 1 ? 'not-allowed' : 'pointer'
                                }}
                            >
                                Next
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default function DetailPageWrapper() {
    return (
        <Suspense fallback={<div className="p-8 text-white">Loading...</div>}>
            <DetailPage />
        </Suspense>
    )
}

function DetailPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { user } = useAuth();
    const { theme, toggleTheme, isDark } = useTheme();
    const query = searchParams.get('query') || '';
    const framework = searchParams.get('framework') || '';

    const expandTaskId = searchParams.get('expandTaskId');

    const [allData, setAllData] = useState<Execution[]>([]);
    const [loading, setLoading] = useState(true);
    const [sessionData, setSessionData] = useState<Record<string, any>>({});
    const [timeFilter, setTimeFilter] = useState('all');
    const [editingQueryFor, setEditingQueryFor] = useState<string | null>(null);
    const [editQueryValue, setEditQueryValue] = useState('');
    const [querySaveStatus, setQuerySaveStatus] = useState<{ id: string; status: 'saving' | 'ok' | 'error'; msg?: string } | null>(null);

    const [editingResultFor, setEditingResultFor] = useState<string | null>(null);
    const [editResultValue, setEditResultValue] = useState('');
    const [resultSaveStatus, setResultSaveStatus] = useState<{ id: string; status: 'saving' | 'ok' | 'error'; msg?: string } | null>(null);

    const [focusedStep, setFocusedStep] = useState<number | null>(null);
    const [showContextWindowChart, setShowContextWindowChart] = useState(false);
    const [failureFilter, setFailureFilter] = useState<'all' | 'failure' | 'anomaly'>('all');
    const [failureSortBy, setFailureSortBy] = useState<'type' | 'time'>('type');

    const [currentRecord, setCurrentRecord] = useState<Execution | null>(null);

    // 新增状态：控制模块的折叠/展开
    const [isDetailsExpanded, setIsDetailsExpanded] = useState(true);
    const [isSessionJsonExpanded, setIsSessionJsonExpanded] = useState(true);
    const [isAnalysisExpanded, setIsAnalysisExpanded] = useState(true);

    useEffect(() => {
        const tid = currentRecord
            ? (currentRecord.task_id || currentRecord.upload_id || `temp-${currentRecord.timestamp}`)
            : null;
        if (!tid) return;
        if (sessionData[tid]) return;

        const tryIds: string[] = [tid];
        if (/^ses_/.test(tid) && /-\d+$/.test(tid)) {
            tryIds.push(tid.replace(/-\d+$/, ''));
        }

        const fetchOnce = (id: string) =>
            apiFetch(`/api/session?taskId=${encodeURIComponent(id)}`)
                .then(res => res.ok ? res.json() : { error: 'Error' })
                .then(json => {
                    if (json && !json.error) return json;
                    throw new Error(json?.error || 'Error');
                });

        (async () => {
            for (const id of tryIds) {
                try {
                    const json = await fetchOnce(id);
                    setSessionData(prev => ({ ...prev, [tid]: json }));
                    return;
                } catch {}
            }
            setSessionData(prev => ({ ...prev, [tid]: { error: 'Fetch failed' } }));
        })();
    }, [currentRecord]);

    useEffect(() => {
        let url = '/api/data?';
        const params = new URLSearchParams();
        if (user) params.append('user', user);
        if (query) params.append('query', query);
        if (framework) params.append('framework', framework);
        if (expandTaskId) params.append('taskId', expandTaskId);
        apiFetch(url + params.toString(), { cache: 'no-store' })
            .then(res => res.json())
            .then((data: any[]) => {
                let targetQuery = query;
                let targetFramework = framework;

                if (!targetQuery && expandTaskId) {
                    const targetRecord = data.find(d => d.task_id === expandTaskId || d.upload_id === expandTaskId);
                    if (targetRecord) {
                        targetQuery = targetRecord.query;
                        if (!targetFramework) targetFramework = targetRecord.framework;
                        setCurrentRecord(targetRecord);
                    }
                } else if (expandTaskId) {
                    const targetRecord = data.find(d => d.task_id === expandTaskId || d.upload_id === expandTaskId);
                    if (targetRecord) {
                        setCurrentRecord(targetRecord);
                    }
                }

                const filtered = data.filter(d =>
                    d.query === targetQuery &&
                    (!targetFramework || d.framework === targetFramework)
                ).map(x => ({
                    ...x,
                    tokens: Number(x.tokens || x.Token || 0),
                    latency: Number(x.latency || 0),
                    answer_score: x.answer_score !== undefined ? Number(x.answer_score) : (x.is_answer_correct ? 1.0 : 0.0)
                }));
                filtered.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
                setAllData(filtered);
                setLoading(false);
            });
    }, [query, framework, expandTaskId, user]);

    const [selectedLabels, setSelectedLabels] = useState<Set<string>>(new Set());
    const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set());
    const [isLabelMenuOpen, setIsLabelMenuOpen] = useState(false);
    const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
    const [comparisonDim, setComparisonDim] = useState<'label' | 'model'>('label');

    const NO_LABEL_KEY = '__no_label__';

    const uniqueLabels = useMemo(() => {
        const labels = new Set<string>();
        let hasNoLabel = false;
        allData.forEach(d => {
            if (d.label) {
                labels.add(d.label);
            } else {
                hasNoLabel = true;
            }
        });
        const sorted = Array.from(labels).sort();
        if (hasNoLabel) {
            sorted.unshift(NO_LABEL_KEY);
        }
        return sorted;
    }, [allData]);

    const uniqueModels = useMemo(() => {
        const models = new Set<string>();
        let hasNoModel = false;
        allData.forEach(d => {
            if (d.model) {
                models.add(d.model);
            } else {
                hasNoModel = true;
            }
        });
        const sorted = Array.from(models).sort();
        if (hasNoModel) {
            sorted.unshift(NO_LABEL_KEY);
        }
        return sorted;
    }, [allData]);

    const filteredData = useMemo(() => {
        let data = allData;

        if (timeFilter !== 'all') {
            const now = Date.now();
            const map = {
                '1h': 60 * 60 * 1000,
                '12h': 12 * 60 * 60 * 1000,
                '24h': 24 * 60 * 60 * 1000,
            };
            const ms = map[timeFilter as keyof typeof map] || 0;
            const thresh = now - ms;
            data = data.filter(d => new Date(d.timestamp).getTime() > thresh);
        }

        if (selectedLabels.size > 0) {
            data = data.filter(d => {
                if (d.label) {
                    return selectedLabels.has(d.label);
                }
                return selectedLabels.has(NO_LABEL_KEY);
            });
        }

        if (selectedModels.size > 0) {
            data = data.filter(d => {
                if (d.model) {
                    return selectedModels.has(d.model);
                }
                return selectedModels.has(NO_LABEL_KEY);
            });
        }

        const byTask = new Map<string, any>();
        for (const item of data) {
            const key = item.task_id || item.upload_id || '';
            if (!key) continue;

            const prev = byTask.get(key);
            if (!prev) {
                byTask.set(key, item);
                continue;
            }

            const prevTs = new Date(prev.timestamp).getTime();
            const curTs = new Date(item.timestamp).getTime();
            if (curTs > prevTs) {
                byTask.set(key, item);
                continue;
            }
            if (curTs === prevTs) {
                const prevLen = String(prev.final_result || '').length;
                const curLen = String(item.final_result || '').length;
                if (curLen > prevLen) {
                    byTask.set(key, item);
                }
            }
        }

        return Array.from(byTask.values());
    }, [allData, timeFilter, selectedLabels, selectedModels]);

    const compareDimData = useMemo(() => {
        const key = comparisonDim === 'label' ? 'label' : 'model';
        const items = [...new Set(filteredData.map(d => d[key]).filter(v => v))];
        items.sort((a, b) => {
            const getTrailingNumber = (str: string) => {
                const match = String(str).match(/(\d+)$/);
                return match ? parseInt(match[0], 10) : null;
            };

            const numA = getTrailingNumber(String(a));
            const numB = getTrailingNumber(String(b));

            if (numA !== null && numB !== null) {
                return numA - numB;
            }
            return String(a).localeCompare(String(b));
        });

        const latencyData = items.map(item => {
            const records = filteredData.filter(d => d[key] === item);
            const avgLatency = records.reduce((sum, r) => sum + (r.latency || 0), 0) / records.length;
            return {
                name: item,
                latency: avgLatency
            };
        });

        const tokensData = items.map(item => {
            const records = filteredData.filter(d => d[key] === item);
            const avgTokens = records.reduce((sum, r) => sum + (r.tokens || 0), 0) / records.length;
            return {
                name: item,
                tokens: avgTokens
            };
        });

        const accuracyData = items.map(item => {
            const records = filteredData.filter(d => d[key] === item);
            const avgAccuracy = records.reduce((sum, r) => sum + (r.answer_score || 0), 0) / records.length;
            return {
                name: item,
                answer_score: avgAccuracy
            };
        });

        const skillRecallRateData = items.map(item => {
            const records = filteredData.filter(d => d[key] === item);
            const recordsWithRecallRate = records.filter(r => r.skill_recall_rate !== null && r.skill_recall_rate !== undefined);
            const totalCount = recordsWithRecallRate.length;
            const totalRecallRate = recordsWithRecallRate.reduce((sum, r) => sum + (r.skill_recall_rate || 0), 0);
            const avgSkillRecallRate = totalCount > 0 ? (totalRecallRate / totalCount) : 0;
            return {
                name: item,
                skill_recall_rate: avgSkillRecallRate
            };
        });

        const ctxWindowData = items.map(item => {
            const records = filteredData.filter(d => d[key] === item && d.context_window_pct != null);
            const avgPct = records.length > 0
                ? records.reduce((sum, r) => sum + (r.context_window_pct || 0), 0) / records.length
                : undefined;
            return {
                name: item,
                context_window_pct: avgPct
            };
        }).filter(d => d.context_window_pct != null);

        return {
            latency: latencyData,
            tokens: tokensData,
            accuracy: accuracyData,
            skillRecallRate: skillRecallRateData,
            contextWindow: ctxWindowData
        };
    }, [filteredData, comparisonDim]);

    const cpsrTrendData = useMemo(() => {
        if (filteredData.length === 0) return [];

        const sortedData = [...filteredData].sort((a, b) =>
            new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );

        const dataWithCost = sortedData.filter(d => d.cost != null);
        if (dataWithCost.length === 0) return [];

        const result: { timestamp: string; cpsr: number | null; avgCost: number; successRate: number; totalRuns: number }[] = [];

        let cumulativeCost = 0;
        let cumulativeSuccesses = 0;

        dataWithCost.forEach((d, idx) => {
            cumulativeCost += d.cost || 0;
            if (d.is_answer_correct) cumulativeSuccesses++;

            const totalRuns = idx + 1;
            const avgCost = cumulativeCost / totalRuns;
            const successRate = cumulativeSuccesses / totalRuns;
            const cpsr = successRate > 0 ? avgCost / successRate : null;

            if (cpsr !== null) {
                result.push({
                    timestamp: d.timestamp,
                    cpsr,
                    avgCost,
                    successRate,
                    totalRuns
                });
            }
        });

        return result;
    }, [filteredData]);

    const startEditQuery = (taskId: string, currentQuery: string) => {
        setEditingQueryFor(taskId);
        setEditQueryValue(currentQuery || '');
        setQuerySaveStatus(null);
    };

    const cancelEditQuery = () => {
        setEditingQueryFor(null);
        setEditQueryValue('');
        setQuerySaveStatus(null);
    };

    const saveQuery = async (taskId: string, uploadId?: string) => {
        const val = editQueryValue.trim();
        if (!val) return;
        setQuerySaveStatus({ id: taskId, status: 'saving' });
        try {
            const res = await apiFetch('/api/data', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    task_id: taskId,
                    upload_id: uploadId || undefined,
                    query: val
                })
            });
            const json = await res.json();
            if (!res.ok) {
                setQuerySaveStatus({ id: taskId, status: 'error', msg: json.error || '保存失败' });
                return;
            }
            const reason = json.record?.judgment_reason || '';
            const noMatch = reason.includes('未找到匹配的评测配置');
            const msg = noMatch
                ? '已保存，但未找到匹配的评测配置，Score 已归零。请在「数据集管理」中为该 query 添加完全一致的条目。'
                : (json.message || '已保存');
            setQuerySaveStatus({ id: taskId, status: 'ok', msg });
            setEditingQueryFor(null);
            setEditQueryValue('');
            if (val !== query) {
                const params = new URLSearchParams();
                params.set('query', val);
                if (framework) params.set('framework', framework);
                params.set('expandTaskId', taskId);
                router.push(`/details?${params.toString()}`);
            } else {
                const refreshUrl = user ? `/api/data?user=${encodeURIComponent(user)}` : '/api/data';
                const dataRes = await apiFetch(refreshUrl);
                const data: any[] = await dataRes.json();
                const filtered = data.filter(d =>
                    d.query === query &&
                    (!framework || d.framework === framework)
                ).map(x => ({
                    ...x,
                    tokens: Number(x.tokens || x.Token || 0),
                    latency: Number(x.latency || 0),
                    answer_score: x.answer_score !== undefined ? Number(x.answer_score) : (x.is_answer_correct ? 1.0 : 0.0)
                }));
                filtered.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
                setAllData(filtered);
            }
        } catch (e) {
            setQuerySaveStatus({ id: taskId, status: 'error', msg: '网络错误' });
        }
    };

    const startEditResult = (taskId: string, currentResult: string) => {
        setEditingResultFor(taskId);
        setEditResultValue(currentResult || '');
        setResultSaveStatus(null);
    };

    const cancelEditResult = () => {
        setEditingResultFor(null);
        setEditResultValue('');
        setResultSaveStatus(null);
    };

    const saveFinalResult = async (taskId: string, uploadId?: string) => {
        const val = editResultValue.trim();
        if (!val) return;
        setResultSaveStatus({ id: taskId, status: 'saving' });
        try {
            const res = await apiFetch('/api/data', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    task_id: taskId,
                    upload_id: uploadId || undefined,
                    final_result: val
                })
            });
            const json = await res.json();
            if (!res.ok) {
                setResultSaveStatus({ id: taskId, status: 'error', msg: json.error || '保存失败' });
                return;
            }
            const msg = json.message || '已保存，正在后台重新评估';
            setResultSaveStatus({ id: taskId, status: 'ok', msg });
            setEditingResultFor(null);
            setEditResultValue('');

            try {
                setAllData(prev => prev.map(item => {
                    if ((item.task_id || item.upload_id) === taskId) {
                        return {
                            ...item,
                            final_result: val,
                            judgment_reason: '结果评估中...'
                        };
                    }
                    return item;
                }));
            } catch (updateError) {
                console.error('Error updating local data:', updateError);
            }
        } catch (e) {
            setResultSaveStatus({ id: taskId, status: 'error', msg: '网络错误' });
        }
    };

    const handleUploadResult = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const formData = new FormData();
        formData.append('document', file);
        try {
            const res = await apiFetch('/api/parse-document', {
                method: 'POST',
                body: formData
            });
            const json = await res.json();
            if (res.ok) {
                setEditResultValue(json.content || '');
            } else {
                alert('解析文档失败: ' + (json.error || 'Unknown error'));
            }
        } catch (err: any) {
            alert('解析文档异常: ' + err.message);
        }
    };

    const formatTime = (ts: string) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const formatFullTime = (ts: string) => {
        if (!ts) return '-';
        const d = new Date(ts);
        return d.getFullYear() + '/' +
            String(d.getMonth() + 1).padStart(2, '0') + '/' +
            String(d.getDate()).padStart(2, '0') + ' ' +
            String(d.getHours()).padStart(2, '0') + ':' +
            String(d.getMinutes()).padStart(2, '0') + ':' +
            String(d.getSeconds()).padStart(2, '0');
    };

    const formatTimestampForDisplay = (ts: number): string => {
        if (!ts && ts !== 0) return '-';
        const d = new Date(ts);
        return d.getFullYear() + '/' +
            String(d.getMonth() + 1).padStart(2, '0') + '/' +
            String(d.getDate()).padStart(2, '0') + ' ' +
            String(d.getHours()).padStart(2, '0') + ':' +
            String(d.getMinutes()).padStart(2, '0') + ':' +
            String(d.getSeconds()).padStart(2, '0') + '.' +
            String(d.getMilliseconds()).padStart(3, '0');
    };

    const formatSessionForDisplay = (session: any): any => {
        if (!session) return session;
        const formatted = JSON.parse(JSON.stringify(session));

        if (formatted.startTime) {
            formatted.startTime = formatTimestampForDisplay(formatted.startTime);
        }

        if (Array.isArray(formatted.interactions)) {
            formatted.interactions = formatted.interactions.map((interaction: any) => {
                const formattedInteraction = { ...interaction };
                if (formattedInteraction.timestamp) {
                    formattedInteraction.timestamp = formatTimestampForDisplay(formattedInteraction.timestamp);
                }
                if (formattedInteraction.message?.timestamp) {
                    formattedInteraction.message.timestamp = formatTimestampForDisplay(formattedInteraction.message.timestamp);
                }
                if (formattedInteraction.timeInfo?.created) {
                    formattedInteraction.timeInfo.created = formatTimestampForDisplay(formattedInteraction.timeInfo.created);
                }
                return formattedInteraction;
            });
        }

        return formatted;
    };

    const handleExportHtml = () => {
        const clone = document.documentElement.cloneNode(true) as HTMLElement;

        clone.querySelectorAll('script').forEach(s => s.remove());
        clone.querySelectorAll('.export-btn').forEach(b => b.remove());

        const revivalScript = `
        <script>
            (function() {
                const TS_MAP = {
                    '1h': 60 * 60 * 1000,
                    '12h': 12 * 60 * 60 * 1000,
                    '24h': 24 * 60 * 60 * 1000,
                    'all': 0
                };

                let state = {
                    timeFilter: 'all',
                    selectedLabels: new Set()
                };

                const rows = document.querySelectorAll('.record-row');
                const totalCountEl = document.getElementById('total-records-count');
                const labelMenu = document.getElementById('label-menu-dropdown');
                const labelTrigger = document.getElementById('label-menu-trigger');
                const labelTextObj = document.getElementById('label-trigger-text');

                function updateVisibility() {
                    const now = Date.now();
                    const threshold = TS_MAP[state.timeFilter] ? now - TS_MAP[state.timeFilter] : 0;
                    let count = 0;

                    rows.forEach(row => {
                        const ts = parseInt(row.getAttribute('data-timestamp') || '0');
                        const lbl = row.getAttribute('data-label') || '';

                        let visible = true;

                        if (threshold > 0 && ts < threshold) visible = false;

                        if (visible && state.selectedLabels.size > 0) {
                            const checkLbl = lbl || '__no_label__';
                            if (!state.selectedLabels.has(checkLbl)) visible = false;
                        }

                        row.style.display = visible ? '' : 'none';
                        if (visible) count++;
                    });

                    if (totalCountEl) totalCountEl.innerText = count;
                }

                document.querySelectorAll('.filter-time-btn').forEach(btn => {
                    btn.onclick = () => {
                        document.querySelectorAll('.filter-time-btn').forEach(b => {
                            b.style.background = '#1e293b';
                            b.style.color = '#94a3b8';
                        });
                        btn.style.background = '#38bdf8';
                        btn.style.color = '#0f172a';

                        state.timeFilter = btn.getAttribute('data-tf');
                        updateVisibility();
                    };
                });

                if (labelTrigger && labelMenu) {
                    labelTrigger.onclick = (e) => {
                        e.stopPropagation();
                        labelMenu.style.display = labelMenu.style.display === 'none' ? 'block' : 'none';
                    };
                    document.body.onclick = () => {
                         labelMenu.style.display = 'none';
                    };
                    labelMenu.onclick = (e) => e.stopPropagation();
                }

                document.querySelectorAll('.filter-label-checkbox').forEach(chk => {
                    chk.onchange = () => {
                        const val = chk.value;
                        if (chk.checked) state.selectedLabels.add(val);
                        else state.selectedLabels.delete(val);

                        if (labelTextObj) {
                            labelTextObj.innerText = state.selectedLabels.size === 0 ? 'All Filter' : \`\${state.selectedLabels.size} Selected\`;
                        }
                        updateVisibility();
                    };
                });

                const clearBtn = document.getElementById('filter-label-clear');
                if (clearBtn) {
                    clearBtn.onclick = () => {
                        state.selectedLabels.clear();
                        document.querySelectorAll('.filter-label-checkbox').forEach(c => c.checked = false);
                        if (labelTextObj) labelTextObj.innerText = 'All Filter';
                        updateVisibility();
                        if (labelMenu) labelMenu.style.display = 'none';
                    }
                }

                const homeLink = document.getElementById('home-link');
                if (homeLink) {
                    homeLink.onclick = () => {
                        window.location.href = '/';
                    };
                    homeLink.onmouseover = () => { homeLink.style.color = '#7dd3fc'; };
                    homeLink.onmouseout = () => { homeLink.style.color = '#38bdf8'; };
                }

                console.log('Offline Mode: Charts are static snapshots.');
            })();
        </script>
        `;

        const htmlContent = `<!DOCTYPE html>\n${clone.outerHTML}${revivalScript}`;

        const blob = new Blob([htmlContent], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `detail_export_${query || 'all'}_${new Date().toISOString().slice(0, 10)}.html`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    if (loading) return <div style={{ padding: '2rem', color: '#1e293b' }}>Loading...</div>;

    if (!expandTaskId) {
        return (
            <div style={{ minHeight: '100vh', background: '#ffffff', color: '#1e293b', padding: '2rem' }}>
                <div style={{
                    maxWidth: '600px',
                    margin: '4rem auto',
                    textAlign: 'center',
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                    padding: '3rem'
                }}>
                    <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>⚠️</div>
                    <h2 style={{ color: '#d97706', marginBottom: '1rem' }}>缺少必要参数</h2>
                    <p style={{ color: '#64748b', marginBottom: '1.5rem' }}>
                        请通过 <code style={{ background: '#f1f5f9', padding: '2px 8px', borderRadius: '4px' }}>expandTaskId</code> 参数访问此页面
                    </p>
                    <button
                        onClick={() => router.push('/')}
                        style={{
                            padding: '10px 24px',
                            background: '#2563eb',
                            color: '#ffffff',
                            border: 'none',
                            borderRadius: '6px',
                            fontWeight: 'bold',
                            cursor: 'pointer'
                        }}
                    >
                        返回首页
                    </button>
                </div>
            </div>
        );
    }

    if (!currentRecord) {
        return (
            <div style={{ minHeight: '100vh', background: '#ffffff', color: '#1e293b', padding: '2rem' }}>
                <div style={{
                    maxWidth: '600px',
                    margin: '4rem auto',
                    textAlign: 'center',
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                    padding: '3rem'
                }}>
                    <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🔍</div>
                    <h2 style={{ color: '#dc2626', marginBottom: '1rem' }}>未找到记录</h2>
                    <p style={{ color: '#64748b', marginBottom: '1.5rem' }}>
                        未找到 ID 为 <code style={{ background: '#f1f5f9', padding: '2px 8px', borderRadius: '4px' }}>{expandTaskId}</code> 的记录
                    </p>
                    <button
                        onClick={() => router.push('/')}
                        style={{
                            padding: '10px 24px',
                            background: '#2563eb',
                            color: '#ffffff',
                            border: 'none',
                            borderRadius: '6px',
                            fontWeight: 'bold',
                            cursor: 'pointer'
                        }}
                    >
                        返回首页
                    </button>
                </div>
            </div>
        );
    }

    const taskId = currentRecord.task_id || currentRecord.upload_id || `temp-${currentRecord.timestamp}`;
    const session = sessionData[taskId];

    return (
        <div style={{ minHeight: '100vh', background: 'var(--background)', color: 'var(--foreground)', padding: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem' }}>
                <h1 style={{
                    fontSize: '1.5rem',
                    margin: 0,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis'
                }} title={query}>
                    <span
                        id="home-link"
                        style={{ flexShrink: 0, cursor: 'pointer', color: 'var(--primary)', transition: 'color 0.2s' }}
                        onClick={() => router.push('/')}
                        onMouseOver={(e) => e.currentTarget.style.color = 'var(--primary-hover)'}
                        onMouseOut={(e) => e.currentTarget.style.color = 'var(--primary)'}
                    >
                        skill-insight
                    </span>
                    <span style={{ flexShrink: 0, color: 'var(--border-dark)' }}>|</span>
                    <span style={{ color: 'var(--foreground-secondary)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {query}
                    </span>
                </h1>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button
                        className="theme-toggle-btn"
                        onClick={toggleTheme}
                        title={isDark ? '切换到浅色主题' : '切换到深色主题'}
                    >
                        {isDark ? '☀️' : '🌙'}
                    </button>
                    <button
                        className="export-btn"
                        onClick={handleExportHtml}
                        style={{
                            padding: '8px 16px',
                            background: 'var(--primary)',
                            color: '#ffffff',
                            border: 'none',
                            borderRadius: '4px',
                        fontWeight: 'bold',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px'
                    }}
                >
                    <span>📤</span> 导出
                </button>
                </div>
            </div>
            <div style={{ marginBottom: '2rem', color: 'var(--foreground-secondary)' }}>
                框架: <strong style={{ color: 'var(--foreground)' }}>{framework || 'All'}</strong> | 任务 ID: <strong style={{ color: 'var(--foreground)' }}>{taskId}</strong>
            </div>

            {/* 本次执行记录详情 */}
            <div style={{
                background: 'linear-gradient(135deg, var(--background-secondary) 0%, var(--background) 100%)',
                border: `2px solid var(--primary)`,
                borderRadius: '12px',
                padding: '2rem',
                marginBottom: '2rem',
                boxShadow: `0 0 20px var(--shadow-color)`
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: isDetailsExpanded ? '1.5rem' : '0' }}>
                    <h2 style={{
                        fontSize: '1.5rem',
                        margin: 0,
                        color: 'var(--primary)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px'
                    }}>
                        📋 本次执行记录详情
                        <span style={{
                            fontSize: '0.85rem',
                            background: 'var(--primary)',
                            color: '#ffffff',
                            padding: '2px 12px',
                            borderRadius: '999px',
                            fontWeight: 'bold'
                        }}>
                            {formatFullTime(currentRecord.timestamp)}
                        </span>
                    </h2>
                    <button
                        onClick={() => setIsDetailsExpanded(!isDetailsExpanded)}
                        style={{
                            background: 'transparent', border: '1px solid var(--primary)', color: 'var(--primary)',
                            padding: '4px 12px', borderRadius: '6px', cursor: 'pointer',
                            display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.9rem'
                        }}
                    >
                        {isDetailsExpanded ? '▼ 折叠' : '▶ 展开'}
                    </button>
                </div>

                {isDetailsExpanded && (
                    <>
                        {/* 上层区域：原始采集数据 */}
                        <div style={{
                            background: 'var(--background)',
                            border: '1px solid var(--border)',
                            borderRadius: '8px',
                            padding: '1.5rem',
                            marginBottom: '1.5rem'
                        }}>
                            <h3 style={{
                                fontSize: '1.2rem',
                                marginBottom: '1rem',
                                color: 'var(--warning)',
                                borderBottom: '1px solid var(--border)',
                                paddingBottom: '0.5rem'
                            }}>
                                📊 原始采集数据
                            </h3>

                            {/* 使用 Grid 布局：左列 (Query/Skills/Metrics) 和 右列 (Final Result) */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '1.5rem', minHeight: '400px' }}>

                                {/* 左侧单列：Query、Skills Used、Runtime Metrics */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

                                    {/* 1. Query */}
                                    <div>
                                        <h4 style={sectionHeader}>用户输入</h4>
                                        {editingQueryFor === taskId ? (
                                            <div>
                                                <textarea
                                                    value={editQueryValue}
                                                    onChange={(e) => setEditQueryValue(e.target.value)}
                                                    rows={3}
                                                    style={{
                                                        width: '100%',
                                                        padding: '0.75rem',
                                                        background: 'var(--input-bg)',
                                                        border: '1px solid var(--input-border)',
                                                        borderRadius: '6px',
                                                        color: 'var(--foreground)',
                                                        fontFamily: 'monospace',
                                                        fontSize: '0.9rem',
                                                        resize: 'vertical'
                                                    }}
                                                    placeholder="输入 query"
                                                />
                                                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', alignItems: 'center' }}>
                                                    <button
                                                        onClick={() => saveQuery(taskId, currentRecord.upload_id)}
                                                        disabled={querySaveStatus?.id === taskId && querySaveStatus?.status === 'saving'}
                                                        style={{
                                                            padding: '6px 14px',
                                                            background: 'var(--primary)',
                                                            color: '#ffffff',
                                                            border: 'none',
                                                            borderRadius: '4px',
                                                            cursor: querySaveStatus?.id === taskId && querySaveStatus?.status === 'saving' ? 'not-allowed' : 'pointer',
                                                            fontWeight: 'bold'
                                                        }}
                                                    >
                                                        {querySaveStatus?.id === taskId && querySaveStatus?.status === 'saving' ? '保存中...' : '保存'}
                                                    </button>
                                                    <button
                                                        onClick={cancelEditQuery}
                                                        style={{
                                                            padding: '6px 14px',
                                                            background: 'var(--border)',
                                                            color: 'var(--foreground-secondary)',
                                                            border: 'none',
                                                            borderRadius: '4px',
                                                            cursor: 'pointer'
                                                        }}
                                                    >
                                                        取消
                                                    </button>
                                                    {querySaveStatus?.id === taskId && querySaveStatus?.status === 'ok' && (
                                                        <span style={{ color: 'var(--success)', fontSize: '0.9rem' }}>{querySaveStatus.msg}</span>
                                                    )}
                                                    {querySaveStatus?.id === taskId && querySaveStatus?.status === 'error' && (
                                                        <span style={{ color: 'var(--error)', fontSize: '0.9rem' }}>{querySaveStatus.msg}</span>
                                                    )}
                                                </div>
                                            </div>
                                        ) : (
                                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
                                                <div style={codeBlock}>{currentRecord.query || '(空)'}</div>
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); startEditQuery(taskId, currentRecord.query || ''); }}
                                                    style={{
                                                        padding: '4px 10px',
                                                        background: 'transparent',
                                                        color: 'var(--primary)',
                                                        border: '1px solid var(--primary)',
                                                        borderRadius: '4px',
                                                        cursor: 'pointer',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '4px',
                                                        fontSize: '0.8rem',
                                                        whiteSpace: 'nowrap'
                                                    }}
                                                >
                                                    ✏️ 编辑
                                                </button>
                                            </div>
                                        )}
                                    </div>

                                    {/* 2. Skills Used */}
                                    <div>
                                        <h4 style={sectionHeader}>使用 Skills</h4>
                                        <div style={{ ...codeBlock, padding: '0.5rem' }}>
                                            <SkillLinks
                                                skills={currentRecord.skills}
                                                skill={currentRecord.skill}
                                                skillVersion={currentRecord.skill_version}
                                                user={currentRecord.user}
                                            />
                                        </div>
                                    </div>

                                    {/* 3. Runtime Metrics */}
                                    {(currentRecord.llm_call_count != null || currentRecord.tool_call_count != null || currentRecord.input_tokens != null || currentRecord.output_tokens != null || currentRecord.tool_call_error_count != null) && (
                                        <div>
                                            <h4 style={sectionHeader}>运行时指标</h4>
                                            <div style={{
                                                display: 'grid',
                                                gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
                                                gap: '0.75rem',
                                                marginTop: '0.5rem'
                                            }}>
                                                {[
                                                    { label: '大模型调用次数', value: currentRecord.llm_call_count, color: 'var(--primary)' },
                                                    { label: '工具调用次数', value: currentRecord.tool_call_count, color: 'var(--primary)' },
                                                    { label: '工具报错次数', value: currentRecord.tool_call_error_count ?? 0, color: currentRecord.tool_call_error_count ? 'var(--error)' : 'var(--success)' },
                                                    { label: '输入 Tokens', value: currentRecord.input_tokens, color: 'var(--primary)' },
                                                    { label: '输出 Tokens', value: currentRecord.output_tokens, color: 'var(--primary)' },
                                                    {
                                                        label: '上下文窗口 %',
                                                        value: currentRecord.context_window_pct,
                                                        color: currentRecord.context_window_pct != null ? (currentRecord.context_window_pct > 90 ? 'var(--error)' : 'var(--success)') : 'var(--primary)',
                                                        format: (v: number) => `${v.toFixed(1)}%`,
                                                        fallback: (currentRecord.context_window_pct == null && currentRecord.max_single_call_tokens != null) ? 'N/A' : undefined,
                                                        tooltip: currentRecord.context_window_pct != null
                                                            ? `max_single_call_tokens (${currentRecord.max_single_call_tokens?.toLocaleString()}) / context_window_limit (${currentRecord.context_window_limit?.toLocaleString()}) × 100` + (currentRecord.model ? ` (${currentRecord.model})` : '') + `. Source: ${currentRecord.context_window_source || 'default'}.`
                                                            : currentRecord.model
                                                                ? `此模型未配置: ${currentRecord.model}.`
                                                                : 'Model unknown. Context window % cannot be calculated.'
                                                    },
                                                    {
                                                        label: '预估成本',
                                                        value: currentRecord.cost,
                                                        color: 'var(--primary)',
                                                        format: (v: number) => `$${v === 0 ? '0.00' : v < 0.01 ? v.toFixed(4) : v < 1 ? v.toFixed(3) : v.toFixed(2)}`,
                                                        fallback: (currentRecord.cost == null && currentRecord.input_tokens != null) ? 'N/A' : undefined,
                                                        tooltip: currentRecord.cost_pricing
                                                            ? (currentRecord.cache_read_input_tokens || currentRecord.cache_creation_input_tokens
                                                                ? `Cost = base_input × $${currentRecord.cost_pricing.inputTokenPrice}/M + cache_read × $${currentRecord.cost_pricing.cacheReadInputTokenPrice}/M + cache_create × $${currentRecord.cost_pricing.cacheCreationInputTokenPrice}/M + output × $${currentRecord.cost_pricing.outputTokenPrice}/M`
                                                                : `Cost = input_tokens × $${currentRecord.cost_pricing.inputTokenPrice}/M + output_tokens × $${currentRecord.cost_pricing.outputTokenPrice}/M`)
                                                                + (currentRecord.model ? ` (${currentRecord.model})` : '') + `. Estimated from ${currentRecord.cost_pricing.source === 'custom' ? 'custom' : 'default'} pricing.`
                                                            : currentRecord.model
                                                                ? `Pricing not available for model: ${currentRecord.model}.`
                                                                : 'Model unknown. Cost cannot be estimated.'
                                                    },
                                                ].map((metric, idx) => (
                                                    <div key={idx} style={{
                                                        background: 'var(--background-secondary)',
                                                        border: '1px solid var(--border)',
                                                        borderRadius: '6px',
                                                        padding: '0.75rem',
                                                        textAlign: 'center'
                                                    }}>
                                                        <div style={{
                                                            fontSize: '1.3rem',
                                                            fontWeight: 'bold',
                                                            color: metric.color
                                                        }}>
                                                            {metric.value != null ? ('format' in metric && metric.format ? metric.format(metric.value) : metric.value.toLocaleString()) : ('fallback' in metric && metric.fallback ? metric.fallback : '-')}
                                                        </div>
                                                        <div style={{
                                                            fontSize: '0.75rem',
                                                            color: 'var(--foreground-muted)',
                                                            marginTop: '4px'
                                                        }}>
                                                            {metric.label}
                                                            {'tooltip' in metric && metric.tooltip && <CustomTooltip content={metric.tooltip} />}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* 右侧单列：Final Result (高度跟随左侧，最少 400px，内部产生滚动) */}
                                <div style={{ position: 'relative' }}>
                                    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
                                        <h4 style={{ ...sectionHeader, marginBottom: '0.5rem' }}>最终结果</h4>

                                        {editingResultFor === taskId ? (
                                            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                                                <textarea
                                                    value={editResultValue}
                                                    onChange={(e) => setEditResultValue(e.target.value)}
                                                    style={{
                                                        flex: 1, // 占满剩余高度
                                                        width: '100%',
                                                        padding: '0.75rem',
                                                        background: 'var(--input-bg)',
                                                        border: '1px solid var(--input-border)',
                                                        borderRadius: '6px',
                                                        color: 'var(--foreground)',
                                                        fontFamily: 'monospace',
                                                        fontSize: '0.9rem',
                                                        resize: 'none', // 禁用缩放，因为高度已固定
                                                        marginBottom: '0.5rem'
                                                    }}
                                                    placeholder="输入或上传 最终结果"
                                                />
                                                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexShrink: 0 }}>
                                                    <button
                                                        onClick={() => saveFinalResult(taskId, currentRecord.upload_id)}
                                                        disabled={resultSaveStatus?.id === taskId && resultSaveStatus?.status === 'saving'}
                                                        style={{
                                                            padding: '6px 14px',
                                                            background: 'var(--primary)',
                                                            color: '#ffffff',
                                                            border: 'none',
                                                            borderRadius: '4px',
                                                            cursor: resultSaveStatus?.id === taskId && resultSaveStatus?.status === 'saving' ? 'not-allowed' : 'pointer',
                                                            fontWeight: 'bold'
                                                        }}
                                                    >
                                                        {resultSaveStatus?.id === taskId && resultSaveStatus?.status === 'saving' ? '保存中...' : '保存并重评'}
                                                    </button>
                                                    <button
                                                        onClick={cancelEditResult}
                                                        style={{
                                                            padding: '6px 14px',
                                                            background: 'var(--border)',
                                                            color: 'var(--foreground-secondary)',
                                                            border: 'none',
                                                            borderRadius: '4px',
                                                            cursor: 'pointer'
                                                        }}
                                                    >
                                                        取消
                                                    </button>
                                                    <label style={{
                                                        padding: '6px 14px',
                                                        background: 'var(--background-secondary)',
                                                        color: 'var(--warning)',
                                                        border: '1px solid var(--warning)',
                                                        borderRadius: '4px',
                                                        cursor: 'pointer',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '4px',
                                                        fontSize: '0.85rem'
                                                    }}>
                                                        📄 上传报告
                                                        <input
                                                            type="file"
                                                            accept=".md,.txt,.pdf,.markdown"
                                                            style={{ display: 'none' }}
                                                            onChange={handleUploadResult}
                                                        />
                                                    </label>

                                                    {resultSaveStatus?.id === taskId && resultSaveStatus?.status === 'ok' && (
                                                        <span style={{ color: 'var(--success)', fontSize: '0.9rem' }}>{resultSaveStatus.msg}</span>
                                                    )}
                                                    {resultSaveStatus?.id === taskId && resultSaveStatus?.status === 'error' && (
                                                        <span style={{ color: 'var(--error)', fontSize: '0.9rem' }}>{resultSaveStatus.msg}</span>
                                                    )}
                                                </div>
                                            </div>
                                        ) : (
                                            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                                                <div style={{
                                                    ...codeBlock,
                                                    flex: 1, // 撑开中间，挤压操作按钮到底部
                                                    overflowY: 'auto',
                                                    padding: '1rem'
                                                }}>
                                                    {currentRecord.final_result || '(No Result)'}
                                                </div>
                                                <div style={{ marginTop: '0.5rem', flexShrink: 0 }}>
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); startEditResult(taskId, currentRecord.final_result || ''); }}
                                                        style={{
                                                            padding: '4px 10px',
                                                            background: 'transparent',
                                                            color: 'var(--primary)',
                                                            border: '1px solid var(--primary)',
                                                            borderRadius: '4px',
                                                            cursor: 'pointer',
                                                            display: 'inline-flex',
                                                            alignItems: 'center',
                                                            gap: '4px',
                                                            fontSize: '0.8rem'
                                                        }}
                                                    >
                                                        ✏️ 编辑 / 替换结果
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* 5. Session Data & Execution Steps */}
                            {session ? (
                                session.error ? (
                                    <div style={{ color: 'var(--foreground-muted)', fontStyle: 'italic' }}>{session.error}</div>
                                ) : (
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
                                        <div style={{ minWidth: 0 }}>
                                            <div style={{
                                                display: 'flex',
                                                justifyContent: 'flex-start',
                                                alignItems: 'center',
                                                gap: '8px',
                                                marginBottom: '0.5rem',
                                                borderBottom: '1px solid var(--border)',
                                                paddingBottom: '4px',
                                                minHeight: '34px'
                                            }}>
                                                <button
                                                    onClick={() => setIsSessionJsonExpanded(!isSessionJsonExpanded)}
                                                    style={{ background: 'transparent', border: 'none', color: 'var(--primary)', cursor: 'pointer', padding: 0 }}
                                                >
                                                    {isSessionJsonExpanded ? '▼' : '▶'}
                                                </button>
                                                <h4 style={sectionHeader}>会话数据（原始JSON）</h4>
                                            </div>
                                            {isSessionJsonExpanded && (
                                                <div style={{ background: 'var(--code-block-bg)', padding: '1rem', borderRadius: '8px', overflowY: 'auto', maxHeight: '600px', border: '1px solid var(--border)' }}>
                                                    <ReactJson
                                                        key={`json-${focusedStep !== null ? focusedStep : 'default'}`}
                                                        src={formatSessionForDisplay(session)}
                                                        theme={isDark ? 'monokai' : 'rjv-default'}
                                                        groupArraysAfterLength={0}
                                                        shouldCollapse={(field) => {
                                                            const path = [...(field.namespace || []), field.name]
                                                                .filter(key => key != null && String(key).trim() !== '')
                                                                .map(String);
                                                            if (focusedStep === null) {
                                                                if (path[0] === 'interactions' && path.length >= 2) return true;
                                                                return false;
                                                            }

                                                            if (path[0] === 'interactions') {
                                                                const stepStr = path[1];

                                                                if (stepStr !== undefined) {
                                                                    const stepIndex = Number(stepStr);
                                                                    if (!isNaN(stepIndex)) {
                                                                        if (stepIndex !== focusedStep) {
                                                                            return true;
                                                                        }
                                                                        return false;
                                                                    }
                                                                }
                                                            }

                                                            return false;
                                                        }}
                                                        displayDataTypes={false}
                                                        name={null}
                                                        style={{ backgroundColor: 'transparent', fontSize: '0.85rem' }}
                                                        enableClipboard={true}
                                                    />
                                                </div>
                                            )}
                                        </div>
                                        <div style={{ minWidth: 0 }}>
                                            <RenderInteractionList
                                                interactions={session.interactions}
                                                focusedStep={focusedStep}
                                                onStepClick={setFocusedStep}
                                            />
                                        </div>
                                    </div>
                                )
                            ) : (
                                <div style={{ color: 'var(--primary)' }}>Loading session log...</div>
                            )}
                        </div>

                        {/* 下层区域：分析数据 */}
                        <div style={{
                            background: 'var(--background-secondary)',
                            border: '1px solid var(--border)',
                            borderRadius: '8px',
                            padding: '1.5rem',
                            marginTop: '1.5rem'
                        }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: isAnalysisExpanded ? '1rem' : '0', borderBottom: isAnalysisExpanded ? '1px solid var(--border)' : 'none', paddingBottom: isAnalysisExpanded ? '0.5rem' : '0' }}>
                                <h3 style={{ fontSize: '1.2rem', margin: 0, color: 'var(--secondary)' }}>
                                    🔍 分析结果
                                </h3>
                                <button
                                    onClick={() => setIsAnalysisExpanded(!isAnalysisExpanded)}
                                    style={{
                                        background: 'transparent', border: '1px solid var(--secondary)', color: 'var(--secondary)',
                                        padding: '4px 12px', borderRadius: '6px', cursor: 'pointer',
                                        display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.9rem'
                                    }}
                                >
                                    {isAnalysisExpanded ? '▼ 折叠' : '▶ 展开'}
                                </button>
                            </div>

                            {isAnalysisExpanded && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem', marginBottom: '2rem' }}>

                                    {/* 1. 评分详情与分析 (原 Judgment Reason 与 Skill Analysis 合并) */}
                                    <div>
                                        <h4 style={{ ...sectionHeader, marginBottom: '1rem' }}>评分详情与分析</h4>
                                        {(() => {
                                            const evalItems = parseEvaluationItemsFromReason(currentRecord.judgment_reason || '');
                                            if (evalItems.length === 0) {
                                                return (
                                                    <div style={{
                                                        ...codeBlock,
                                                        background: 'var(--code-block-bg)',
                                                        padding: '1rem',
                                                        borderRadius: '6px',
                                                        border: '1px solid var(--border)'
                                                    }}>
                                                        {currentRecord.judgment_reason || '-'}
                                                    </div>
                                                );
                                            }
                                            return (
                                                <div style={{ background: 'var(--card-bg)', borderRadius: '6px', border: '1px solid var(--border)', overflowX: 'visible' }}>
                                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', minWidth: '950px' }}>
                                                        <thead>
                                                            <tr style={{ background: 'var(--background-secondary)' }}>
                                                                <th style={{ padding: '10px 12px', textAlign: 'center', color: 'var(--foreground-secondary)', borderBottom: '1px solid var(--border)', width: '60px', whiteSpace: 'nowrap' }}>ID</th>
                                                                <th style={{ padding: '10px 12px', textAlign: 'left', color: 'var(--foreground-secondary)', borderBottom: '1px solid var(--border)', minWidth: '180px' }}>评分标准</th>
                                                                <th style={{ padding: '10px 12px', textAlign: 'center', color: 'var(--foreground-secondary)', borderBottom: '1px solid var(--border)', width: '60px', whiteSpace: 'nowrap' }}>得分</th>
                                                                <th style={{ padding: '10px 12px', textAlign: 'center', color: 'var(--foreground-secondary)', borderBottom: '1px solid var(--border)', width: '50px', whiteSpace: 'nowrap' }}>权重</th>
                                                                <th style={{ padding: '10px 12px', textAlign: 'center', color: 'var(--foreground-secondary)', borderBottom: '1px solid var(--border)', width: '60px', whiteSpace: 'nowrap' }}>扣分</th>
                                                                <th style={{ padding: '10px 12px', textAlign: 'center', color: 'var(--foreground-secondary)', borderBottom: '1px solid var(--border)', width: '50px', whiteSpace: 'nowrap' }}>关联<CustomTooltip content="表示扣分来源。若与skill相关，则体现在“分析依据”和“改进建议”" /></th>
                                                                <th style={{ padding: '10px 12px', textAlign: 'left', color: 'var(--foreground-secondary)', borderBottom: '1px solid var(--border)', minWidth: '150px' }}>扣分原因</th>
                                                                <th style={{ padding: '10px 12px', textAlign: 'left', color: 'var(--foreground-secondary)', borderBottom: '1px solid var(--border)', minWidth: '150px' }}>分析依据</th>
                                                                <th style={{ padding: '10px 12px', textAlign: 'left', color: 'var(--foreground-secondary)', borderBottom: '1px solid var(--border)', minWidth: '150px' }}>改进建议</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {evalItems.map((evalItem, idx) => {
                                                                // 增强匹配逻辑：不仅匹配 ID，如果 ID 对不上，尝试通过 content (评分标准) 内容匹配
                                                                const relatedSkillIssue = currentRecord.skill_issues?.find(si => {
                                                                    if (si.id === evalItem.id) return true;
                                                                    const siContent = (si.content || '').trim().toLowerCase();
                                                                    const evContent = (evalItem.content || '').trim().toLowerCase();
                                                                    return siContent && evContent && (siContent === evContent || evContent.includes(siContent));
                                                                });

                                                                const deduction = (1 - evalItem.match_score) * evalItem.weight;

                                                                return (
                                                                    <tr
                                                                        key={idx}
                                                                        id={`eval-item-${taskId}-${evalItem.id}`}
                                                                        style={{
                                                                            background: idx % 2 === 0 ? 'var(--card-bg)' : 'var(--background-secondary)',
                                                                            transition: 'background 0.2s'
                                                                        }}
                                                                        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(56, 189, 248, 0.05)'; }}
                                                                        onMouseLeave={(e) => { e.currentTarget.style.background = idx % 2 === 0 ? 'var(--card-bg)' : 'var(--background-secondary)'; }}
                                                                    >
                                                                        <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'center' }}>
                                                                            <span style={{
                                                                                background: evalItem.type === 'root_cause' ? '#f472b6' : '#38bdf8',
                                                                                color: '#0f172a',
                                                                                padding: '2px 8px',
                                                                                borderRadius: '4px',
                                                                                fontSize: '0.75rem',
                                                                                fontWeight: 'bold',
                                                                                whiteSpace: 'nowrap'
                                                                            }}>
                                                                                {evalItem.id}
                                                                            </span>
                                                                        </td>
                                                                        <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', color: 'var(--foreground)' }}>
                                                                            <div style={{ fontWeight: 500, marginBottom: '4px', wordBreak: 'break-word' }}>
                                                                                {relatedSkillIssue?.content || evalItem.content}
                                                                            </div>
                                                                        </td>
                                                                        <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'center' }}>
                                                                            <span style={{
                                                                                color: evalItem.match_score >= 1 ? '#4ade80' : evalItem.match_score >= 0.5 ? '#fbbf24' : '#f87171',
                                                                                fontWeight: 'bold',
                                                                                whiteSpace: 'nowrap'
                                                                            }}>
                                                                                {(evalItem.match_score * 100).toFixed(0)}%
                                                                            </span>
                                                                        </td>
                                                                        <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'center', color: 'var(--foreground-secondary)' }}>
                                                                            {evalItem.weight.toFixed(1)}
                                                                        </td>
                                                                        <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'center' }}>
                                                                            <span style={{
                                                                                color: deduction > 0 ? '#f87171' : '#4ade80',
                                                                                fontWeight: 'bold',
                                                                                whiteSpace: 'nowrap'
                                                                            }}>
                                                                                -{deduction.toFixed(2)}
                                                                            </span>
                                                                        </td>
                                                                        <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', textAlign: 'center' }}>
                                                                            {relatedSkillIssue && (
                                                                                <span style={{
                                                                                    background: '#ef4444',
                                                                                    color: '#fff',
                                                                                    padding: '2px 6px',
                                                                                    borderRadius: '4px',
                                                                                    fontSize: '0.7rem',
                                                                                    whiteSpace: 'nowrap'
                                                                                }}>
                                                                                    Skill
                                                                                </span>
                                                                            )}
                                                                        </td>
                                                                        <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', color: 'var(--foreground)', fontSize: '0.85rem' }}>
                                                                            {relatedSkillIssue?.explanation || evalItem.explanation || '-'}
                                                                        </td>
                                                                        <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', color: 'var(--warning)', fontSize: '0.85rem', fontStyle: 'italic' }}>
                                                                            {relatedSkillIssue?.reasoning || '-'}
                                                                        </td>
                                                                        <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', color: 'var(--success)', fontSize: '0.85rem' }}>
                                                                            {relatedSkillIssue?.improvement_suggestion ? (
                                                                                <div style={{ background: 'rgba(74, 222, 128, 0.1)', padding: '4px 8px', borderRadius: '4px' }}>
                                                                                    {relatedSkillIssue.improvement_suggestion}
                                                                                </div>
                                                                            ) : '-'}
                                                                        </td>
                                                                    </tr>
                                                                );
                                                            })}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            );
                                        })()}
                                    </div>

                                    {/* 2. Failures Section */}
                                    {currentRecord.failures && currentRecord.failures.length > 0 ? (
                                        <div>
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                                                <h4 style={{ ...sectionHeader, color: '#f87171', borderLeft: '3px solid #f87171', paddingLeft: '8px', borderBottom: 'none', margin: 0 }}> 执行异常 </h4>
                                                <div style={{ display: 'flex', gap: '8px' }}>
                                                    <select
                                                        value={failureFilter}
                                                        onChange={(e) => setFailureFilter(e.target.value as 'all' | 'failure' | 'anomaly')}
                                                        style={{
                                                            background: 'var(--input-bg)',
                                                            border: '1px solid var(--input-border)',
                                                            color: 'var(--foreground)',
                                                            borderRadius: '4px',
                                                            padding: '4px 8px',
                                                            fontSize: '0.8rem'
                                                        }}
                                                    >
                                                        <option value="all">全部</option>
                                                        <option value="failure">失败</option>
                                                        <option value="anomaly">异常</option>
                                                    </select>
                                                </div>
                                            </div>
                                            <div style={{ background: 'var(--card-bg)', borderRadius: '6px', border: '1px solid var(--border)', overflow: 'hidden' }}>
                                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                                                    <thead>
                                                        <tr style={{ background: 'var(--background-secondary)' }}>
                                                            <th style={{ padding: '10px 12px', textAlign: 'left', color: 'var(--foreground-secondary)', borderBottom: '1px solid var(--border)', width: '100px' }}>类型</th>
                                                            <th style={{ padding: '10px 12px', textAlign: 'left', color: 'var(--foreground-secondary)', borderBottom: '1px solid var(--border)', width: 'auto' }}>描述</th>
                                                            <th style={{ padding: '10px 12px', textAlign: 'left', color: 'var(--foreground-secondary)', borderBottom: '1px solid var(--border)', width: '500px' }}>恢复措施</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {currentRecord.failures
                                                            .filter(fail => {
                                                                if (failureFilter === 'all') return true;
                                                                const type = fail.failure_type.toLowerCase();
                                                                if (failureFilter === 'failure') return type.includes('fail') || type.includes('error');
                                                                if (failureFilter === 'anomaly') return type.includes('anomaly') || type.includes('warn');
                                                                return true;
                                                            })
                                                            .map((fail, idx) => (
                                                            <tr key={idx} style={{ background: idx % 2 === 0 ? 'var(--card-bg)' : 'var(--background-secondary)' }}>
                                                                <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
                                                                    <span style={{
                                                                        background: fail.failure_type.toLowerCase().includes('error') || fail.failure_type.toLowerCase().includes('fail') ? '#f87171' : '#fbbf24',
                                                                        color: '#0f172a',
                                                                        padding: '2px 8px',
                                                                        borderRadius: '4px',
                                                                        fontSize: '0.75rem',
                                                                        fontWeight: 'bold'
                                                                    }}>
                                                                        {fail.failure_type}
                                                                    </span>
                                                                </td>
                                                                <td style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
                                                                    <div style={{ color: '#fca5a5', fontWeight: 500, marginBottom: '4px' }}>{fail.description}</div>
                                                                    {fail.context && (
                                                                        <div style={{
                                                                            fontSize: '0.8rem',
                                                                            color: 'var(--foreground-secondary)',
                                                                            fontFamily: 'monospace',
                                                                            background: 'var(--code-block-bg)',
                                                                            padding: '6px 8px',
                                                                            borderRadius: '4px',
                                                                            marginTop: '4px',
                                                                            whiteSpace: 'pre-wrap',
                                                                            wordBreak: 'break-all'
                                                                        }}>
                                                                            {fail.context}
                                                                        </div>
                                                                    )}
                                                                </td>
                                                                <td style={{ padding: '10px 12px', borderBottom: '1px solid #334155', color: '#86efac', fontSize: '0.8rem' }}>
                                                                    {fail.recovery || '-'}
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>
                                    ) : (
                                        <div style={{ padding: '1rem', border: '1px dashed #334155', borderRadius: '6px', color: '#64748b', textAlign: 'center', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
                                            No intermediate failures detected.
                                        </div>
                                    )}

                                    {/* Execution Flow Comparison */}
                                    <ExecutionFlowComparison
                                        executionId={taskId}
                                        skillId={(currentRecord.skill && currentRecord.skill.trim()) || (Array.isArray(currentRecord.skills) && currentRecord.skills.length > 0 ? currentRecord.skills[0] : undefined)}
                                        user={currentRecord.user}
                                        onStepClick={setFocusedStep}
                                    />
                                </div>
                            )}
                        </div>
                    </>
                )}
            </div>

            {/* 过滤器 */}
            <div style={{ marginBottom: '2rem', display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                {['all', '24h', '12h', '1h'].map(tf => (
                    <button
                        key={tf}
                        className="filter-time-btn"
                        data-tf={tf}
                        onClick={() => setTimeFilter(tf)}
                        style={{
                            padding: '6px 16px',
                            background: timeFilter === tf ? '#38bdf8' : '#1e293b',
                            color: timeFilter === tf ? '#0f172a' : '#94a3b8',
                            border: '1px solid #334155',
                            borderRadius: '4px',
                            cursor: 'pointer'
                        }}
                    >
                        {tf.toUpperCase()}
                    </button>
                ))}

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem', marginLeft: '1rem', borderLeft: '1px solid #334155', paddingLeft: '1rem' }}>
                    <span style={{ color: '#94a3b8', fontSize: '0.9rem' }}>比较维度:</span>
                    <div style={{ display: 'flex', background: '#1e293b', padding: '2px', borderRadius: '6px', border: '1px solid #334155' }}>
                        <button
                            onClick={() => setComparisonDim('label')}
                            style={{
                                padding: '4px 12px', borderRadius: '4px', fontSize: '0.85rem',
                                background: comparisonDim === 'label' ? '#38bdf8' : 'transparent',
                                color: comparisonDim === 'label' ? '#0f172a' : '#94a3b8',
                                border: 'none', cursor: 'pointer', transition: 'all 0.2s', fontWeight: comparisonDim === 'label' ? 'bold' : 'normal'
                            }}
                        >标签 (Label)</button>
                        <button
                            onClick={() => setComparisonDim('model')}
                            style={{
                                padding: '4px 12px', borderRadius: '4px', fontSize: '0.85rem',
                                background: comparisonDim === 'model' ? '#38bdf8' : 'transparent',
                                color: comparisonDim === 'model' ? '#0f172a' : '#94a3b8',
                                border: 'none', cursor: 'pointer', transition: 'all 0.2s', fontWeight: comparisonDim === 'model' ? 'bold' : 'normal'
                            }}
                        >模型 (Model)</button>
                    </div>
                </div>

                {uniqueLabels.length > 0 && (
                    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: '0.5rem', marginLeft: '1rem', borderLeft: '1px solid #334155', paddingLeft: '1rem' }}>
                        <span style={{ color: '#94a3b8', fontSize: '0.9rem' }}>Label:</span>

                        <div style={{ position: 'relative' }}>
                            <button
                                id="label-menu-trigger"
                                onClick={() => setIsLabelMenuOpen(!isLabelMenuOpen)}
                                style={{
                                    background: '#1e293b',
                                    color: '#f8fafc',
                                    border: '1px solid #334155',
                                    borderRadius: '4px',
                                    padding: '4px 12px',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    fontSize: '0.9rem',
                                    minWidth: '120px',
                                    justifyContent: 'space-between'
                                }}
                            >
                                <span id="label-trigger-text">{selectedLabels.size === 0 ? 'All Filter' : `${selectedLabels.size} Selected`}</span>
                                <span style={{ fontSize: '0.7rem' }}>▼</span>
                            </button>

                            <div
                                id="label-menu-dropdown"
                                style={{
                                    display: isLabelMenuOpen ? 'block' : 'none',
                                    position: 'absolute',
                                    top: '100%',
                                    left: 0,
                                    marginTop: '4px',
                                    background: '#1e293b',
                                    border: '1px solid #334155',
                                    borderRadius: '4px',
                                    padding: '0.5rem',
                                    zIndex: 50,
                                    minWidth: '200px',
                                    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.5)',
                                    flexDirection: 'column',
                                    gap: '0.5rem',
                                    maxHeight: '300px',
                                    overflowY: 'auto'
                                }}
                            >
                                <div
                                    id="filter-label-clear"
                                    onClick={() => { setSelectedLabels(new Set()); setIsLabelMenuOpen(false); }}
                                    style={{ cursor: 'pointer', padding: '4px 8px', fontSize: '0.9rem', color: selectedLabels.size === 0 ? '#38bdf8' : '#94a3b8', borderBottom: '1px solid #334155', marginBottom: '4px' }}
                                >
                                    Show All (Clear Filter)
                                </div>
                                {uniqueLabels.map(label => {
                                    const isSelected = selectedLabels.has(label as string);
                                    const displayLabel = label === NO_LABEL_KEY ? '(None)' : String(label);
                                    const val = label === NO_LABEL_KEY ? '__no_label__' : String(label);
                                    return (
                                        <label key={String(label)} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.9rem', padding: '2px 8px' }}>
                                            <input
                                                type="checkbox"
                                                className="filter-label-checkbox"
                                                value={val}
                                                checked={isSelected}
                                                onChange={() => {
                                                    const newSet = new Set(selectedLabels);
                                                    if (newSet.has(label as string)) {
                                                        newSet.delete(label as string);
                                                    } else {
                                                        newSet.add(label as string);
                                                    }
                                                    setSelectedLabels(newSet);
                                                }}
                                            />
                                            <span style={{ color: isSelected ? '#fff' : '#cbd5e1' }}>{displayLabel}</span>
                                        </label>
                                    );
                                })}
                            </div>

                            {isLabelMenuOpen && (
                                <div
                                    style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 40 }}
                                    onClick={() => setIsLabelMenuOpen(false)}
                                />
                            )}
                        </div>
                    </div>
                )}

                {uniqueModels.length > 0 && (
                    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: '0.5rem', marginLeft: '1rem', borderLeft: '1px solid #334155', paddingLeft: '1rem' }}>
                        <span style={{ color: '#94a3b8', fontSize: '0.9rem' }}>Model:</span>

                        <div style={{ position: 'relative' }}>
                            <button
                                onClick={() => setIsModelMenuOpen(!isModelMenuOpen)}
                                style={{
                                    background: '#1e293b',
                                    color: '#f8fafc',
                                    border: '1px solid #334155',
                                    borderRadius: '4px',
                                    padding: '4px 12px',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    fontSize: '0.9rem',
                                    minWidth: '120px',
                                    justifyContent: 'space-between'
                                }}
                            >
                                <span>{selectedModels.size === 0 ? 'All Models' : `${selectedModels.size} Selected`}</span>
                                <span style={{ fontSize: '0.7rem' }}>▼</span>
                            </button>

                            <div
                                style={{
                                    display: isModelMenuOpen ? 'block' : 'none',
                                    position: 'absolute',
                                    top: '100%',
                                    left: 0,
                                    marginTop: '4px',
                                    background: '#1e293b',
                                    border: '1px solid #334155',
                                    borderRadius: '4px',
                                    padding: '0.5rem',
                                    zIndex: 50,
                                    minWidth: '200px',
                                    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.5)',
                                    flexDirection: 'column',
                                    gap: '0.5rem',
                                    maxHeight: '300px',
                                    overflowY: 'auto'
                                }}
                            >
                                <div
                                    onClick={() => { setSelectedModels(new Set()); setIsModelMenuOpen(false); }}
                                    style={{ cursor: 'pointer', padding: '4px 8px', fontSize: '0.9rem', color: selectedModels.size === 0 ? '#38bdf8' : '#94a3b8', borderBottom: '1px solid #334155', marginBottom: '4px' }}
                                >
                                    Show All (Clear Filter)
                                </div>
                                {uniqueModels.map(model => {
                                    const isSelected = selectedModels.has(model as string);
                                    const displayModel = model === NO_LABEL_KEY ? '(None)' : String(model);
                                    return (
                                        <label key={String(model)} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.9rem', padding: '2px 8px' }}>
                                            <input
                                                type="checkbox"
                                                checked={isSelected}
                                                onChange={() => {
                                                    const newSet = new Set(selectedModels);
                                                    if (newSet.has(model as string)) {
                                                        newSet.delete(model as string);
                                                    } else {
                                                        newSet.add(model as string);
                                                    }
                                                    setSelectedModels(newSet);
                                                }}
                                            />
                                            <span style={{ color: isSelected ? '#fff' : '#cbd5e1' }}>{displayModel}</span>
                                        </label>
                                    );
                                })}
                            </div>

                            {isModelMenuOpen && (
                                <div
                                    style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 40 }}
                                    onClick={() => setIsModelMenuOpen(false)}
                                />
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* Context Window Trend Chart (Collapsible) */}
            {filteredData.some(d => d.context_window_pct != null) && (
                <div style={{ marginBottom: '1rem' }}>
                    <button
                        onClick={() => setShowContextWindowChart(!showContextWindowChart)}
                        style={{
                            background: 'transparent',
                            border: '1px solid var(--border)',
                            color: 'var(--foreground-secondary)',
                            padding: '6px 14px',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '0.9rem',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            marginBottom: '0.5rem'
                        }}
                    >
                        <span style={{ fontSize: '0.7rem' }}>{showContextWindowChart ? '▲' : '▼'}</span>
                        上下文窗口利用率趋势 (%)
                    </button>
                    {showContextWindowChart && (
                        <div className="card" style={cardStyle}>
                            <h3 style={chartTitleStyle}>
                                上下文窗口利用率趋势 (%)
                                <CustomTooltip content="单次 LLM 调用中最大 token 数 / 模型上下文窗口限制 × 100。超过 90% 时推理质量可能下降。" />
                            </h3>
                            <ResponsiveContainer width="100%" height={200}>
                                <LineChart data={filteredData.filter(d => d.context_window_pct != null)}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                                    <XAxis dataKey="timestamp" tickFormatter={formatTime} stroke="var(--foreground-secondary)" fontSize={11} />
                                    <YAxis stroke="var(--foreground-secondary)" fontSize={11} domain={[0, 100]} />
                                    <Tooltip contentStyle={{ background: 'var(--dropdown-bg)', borderColor: 'var(--border)', color: 'var(--foreground)' }} />
                                    <ReferenceLine y={90} stroke="var(--error)" strokeDasharray="4 4" label={{ value: '90%', fill: 'var(--error)', fontSize: 11 }} />
                                    {currentRecord && currentRecord.context_window_pct != null && (
                                        <ReferenceLine
                                            x={currentRecord.timestamp}
                                            stroke="var(--warning)"
                                            strokeDasharray="5 5"
                                            strokeWidth={2}
                                            label={{ value: '本次', fill: 'var(--warning)', fontSize: 11, position: 'insideTopLeft' }}
                                        />
                                    )}
                                    <Line type="monotone" dataKey="context_window_pct" stroke="#a78bfa" dot={true} strokeWidth={2} />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                    )}
                </div>
            )}

            {/* Charts Section */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
                <div className="card" style={cardStyle}>
                    <h3 style={chartTitleStyle}>
                        时延趋势 (秒)
                        <CustomTooltip content="从请求发出到收到最终完整回复的总耗时" />
                    </h3>
                    <ResponsiveContainer width="100%" height={200}>
                        <LineChart data={filteredData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                            <XAxis dataKey="timestamp" tickFormatter={formatTime} stroke="var(--foreground-secondary)" fontSize={11} />
                            <YAxis stroke="var(--foreground-secondary)" fontSize={11} />
                            <Tooltip contentStyle={{ background: 'var(--dropdown-bg)', borderColor: 'var(--border)', color: 'var(--foreground)' }} />
                            {currentRecord && (
                                <ReferenceLine
                                    x={currentRecord.timestamp}
                                    stroke="var(--warning)"
                                    strokeDasharray="5 5"
                                    strokeWidth={2}
                                    label={{ value: '本次', fill: 'var(--warning)', fontSize: 11, position: 'insideTopLeft' }}
                                />
                            )}
                            <Line type="monotone" dataKey="latency" stroke="#38bdf8" dot={true} strokeWidth={2} />
                        </LineChart>
                    </ResponsiveContainer>
                </div>
                <div className="card" style={cardStyle}>
                    <h3 style={chartTitleStyle}>
                        Token 消耗趋势
                        <CustomTooltip content="输入 Prompt 与输出 Completion 的 Token 总和" />
                    </h3>
                    <ResponsiveContainer width="100%" height={200}>
                        <LineChart data={filteredData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                            <XAxis dataKey="timestamp" tickFormatter={formatTime} stroke="var(--foreground-secondary)" fontSize={11} />
                            <YAxis stroke="var(--foreground-secondary)" fontSize={11} />
                            <Tooltip contentStyle={{ background: 'var(--dropdown-bg)', borderColor: 'var(--border)', color: 'var(--foreground)' }} />
                            {currentRecord && (
                                <ReferenceLine
                                    x={currentRecord.timestamp}
                                    stroke="var(--warning)"
                                    strokeDasharray="5 5"
                                    strokeWidth={2}
                                    label={{ value: '本次', fill: 'var(--warning)', fontSize: 11, position: 'insideTopLeft' }}
                                />
                            )}
                            <Line type="monotone" dataKey="tokens" stroke="#f472b6" dot={true} strokeWidth={2} />
                        </LineChart>
                    </ResponsiveContainer>
                </div>
                <div className="card" style={cardStyle}>
                    <h3 style={chartTitleStyle}>
                        准确率趋势 (0-1)
                        <CustomTooltip content="基于 AI 裁判 (LLM) 对执行结果的自动评分 (1.0=通过, 0.0=失败)" />
                    </h3>
                    <ResponsiveContainer width="100%" height={200}>
                        <LineChart data={filteredData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                            <XAxis dataKey="timestamp" tickFormatter={formatTime} stroke="var(--foreground-secondary)" fontSize={11} />
                            <YAxis stroke="var(--foreground-secondary)" fontSize={11} domain={[0, 1]} />
                            <Tooltip contentStyle={{ background: 'var(--dropdown-bg)', borderColor: 'var(--border)', color: 'var(--foreground)' }} />
                            {currentRecord && (
                                <ReferenceLine
                                    x={currentRecord.timestamp}
                                    stroke="var(--warning)"
                                    strokeDasharray="5 5"
                                    strokeWidth={2}
                                    label={{ value: '本次', fill: 'var(--warning)', fontSize: 11, position: 'insideTopLeft' }}
                                />
                            )}
                            <Line type="monotone" dataKey="answer_score" stroke="#4ade80" dot={true} strokeWidth={2} />
                        </LineChart>
                    </ResponsiveContainer>
                </div>
                <div className="card" style={cardStyle}>
                    <h3 style={chartTitleStyle}>
                            技能召回率趋势
                        <CustomTooltip content="基于执行结果是否使用了预期技能计算出的值 (0-1)，表示正确调用技能的比例" />
                    </h3>
                    <ResponsiveContainer width="100%" height={200}>
                        <LineChart data={filteredData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                            <XAxis dataKey="timestamp" tickFormatter={formatTime} stroke="var(--foreground-secondary)" fontSize={11} />
                            <YAxis stroke="var(--foreground-secondary)" fontSize={11} domain={[0, 1]} />
                            <Tooltip contentStyle={{ background: 'var(--dropdown-bg)', borderColor: 'var(--border)', color: 'var(--foreground)' }} />
                            {currentRecord && (
                                <ReferenceLine
                                    x={currentRecord.timestamp}
                                    stroke="var(--warning)"
                                    strokeDasharray="5 5"
                                    strokeWidth={2}
                                    label={{ value: '本次', fill: 'var(--warning)', fontSize: 11, position: 'insideTopLeft' }}
                                />
                            )}
                            <Line type="monotone" dataKey="skill_recall_rate" stroke="#f472b6" dot={true} strokeWidth={2} />
                        </LineChart>
                    </ResponsiveContainer>
                </div>
                {cpsrTrendData.length > 0 && (
                  <div className="card" style={cardStyle}>
                      <h3 style={chartTitleStyle}>
                          CPSR 趋势
                          <CustomTooltip content={"Cost Per Successful Resolution: Average cost per successful task resolution.\nFormula: (total cost) / (number of runs with successful resolutions)"} />
                      </h3>
                      <ResponsiveContainer width="100%" height={200}>
                          <LineChart data={cpsrTrendData}>
                              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                              <XAxis dataKey="timestamp" tickFormatter={formatTime} stroke="var(--foreground-secondary)" fontSize={11} />
                              <YAxis stroke="var(--foreground-secondary)" fontSize={11} tickFormatter={(v) => `$${v.toFixed(3)}`} />
                              <Tooltip
                                  formatter={(val: any, name: any) => {
                                      if (name === 'CPSR') return [`$${val?.toFixed(4) || 'N/A'}`, 'CPSR'];
                                      return [val, String(name)];
                                  }}
                                  contentStyle={{ backgroundColor: 'var(--dropdown-bg)', borderColor: 'var(--border)', color: 'var(--foreground)' }}
                              />
                              {currentRecord && currentRecord.cost != null && (
                                  <ReferenceLine
                                      x={currentRecord.timestamp}
                                      stroke="var(--warning)"
                                      strokeDasharray="5 5"
                                      strokeWidth={2}
                                      label={{ value: '本次', fill: 'var(--warning)', fontSize: 11, position: 'insideTopLeft' }}
                                  />
                              )}
                              <Line type="monotone" dataKey="cpsr" name="CPSR" stroke="#a78bfa" strokeWidth={2} dot={true} />
                          </LineChart>
                      </ResponsiveContainer>
                  </div>
                )}
            </div>

            {/* Comparison Statistics Section */}
            {(compareDimData.latency.length > 0) && (
                <div style={{ marginBottom: '2rem' }}>
                    <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>
                        按 {comparisonDim === 'label' ? '标签 (Label)' : '模型 (Model)'} 对比 (平均值)
                    </h2>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem' }}>
                        <div className="card" style={cardStyle}>
                            <h3 style={chartTitleStyle}>
                                平均时延 - {comparisonDim === 'label' ? '标签' : '模型'}
                                <CustomTooltip content="平均延迟时间" />
                            </h3>
                            <ResponsiveContainer width="100%" height={200}>
                                <LineChart data={compareDimData.latency}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                                    <XAxis dataKey="name" tickFormatter={(v) => String(v)} stroke="#64748b" fontSize={11} />
                                    <YAxis stroke="#64748b" fontSize={11} />
                                    <Tooltip contentStyle={{ background: '#1e292b', borderColor: '#334155' }} />
                                    <Line type="monotone" dataKey="latency" stroke="#38bdf8" dot={true} strokeWidth={2} />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                        <div className="card" style={cardStyle}>
                            <h3 style={chartTitleStyle}>
                                平均 Token - {comparisonDim === 'label' ? '标签' : '模型'}
                                <CustomTooltip content="平均 Token 使用量" />
                            </h3>
                            <ResponsiveContainer width="100%" height={200}>
                                <LineChart data={compareDimData.tokens}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                                    <XAxis dataKey="name" tickFormatter={(v) => String(v)} stroke="#64748b" fontSize={11} />
                                    <YAxis stroke="#64748b" fontSize={11} />
                                    <Tooltip contentStyle={{ background: '#1e292b', borderColor: '#334155' }} />
                                    <Line type="monotone" dataKey="tokens" stroke="#f472b6" dot={true} strokeWidth={2} />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                        <div className="card" style={cardStyle}>
                            <h3 style={chartTitleStyle}>
                                平均准确率 - {comparisonDim === 'label' ? '标签' : '模型'}
                                <CustomTooltip content="平均准确率 (0-1)" />
                            </h3>
                            <ResponsiveContainer width="100%" height={200}>
                                <LineChart data={compareDimData.accuracy}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                                    <XAxis dataKey="name" tickFormatter={(v) => String(v)} stroke="#64748b" fontSize={11} />
                                    <YAxis stroke="#64748b" fontSize={11} domain={[0, 1]} />
                                    <Tooltip contentStyle={{ background: '#1e292b', borderColor: '#334155' }} />
                                    <Line type="monotone" dataKey="answer_score" stroke="#4ade80" dot={true} strokeWidth={2} />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                        <div className="card" style={cardStyle}>
                            <h3 style={chartTitleStyle}>
                                技能召回率 - {comparisonDim === 'label' ? '标签' : '模型'}
                                <CustomTooltip content="基于执行结果是否使用了预期技能计算出的值 (0-1)，表示正确调用技能的比例" />
                            </h3>
                            <ResponsiveContainer width="100%" height={200}>
                                <LineChart data={compareDimData.skillRecallRate}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                                    <XAxis dataKey="name" tickFormatter={(v) => String(v)} stroke="#64748b" fontSize={11} />
                                    <YAxis stroke="#64748b" fontSize={11} domain={[0, 1]} />
                                    <Tooltip contentStyle={{ background: '#1e292b', borderColor: '#334155' }} />
                                    <Line type="monotone" dataKey="skill_recall_rate" stroke="#f472b6" dot={true} strokeWidth={2} />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                </div>
            )}

            {/* 同问题执行记录 */}
            <div className="list-container">
                <div style={{ marginBottom: '1rem' }}>
                    <h2 style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>同问题执行记录</h2>
                    <p style={{ fontSize: '0.9rem', color: '#94a3b8' }}>点击记录可查看详细信息</p>
                </div>
                {/* Headers */}
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr 1fr', padding: '1rem', borderBottom: '1px solid #334155', color: '#94a3b8', fontSize: '0.9rem' }}>
                    <div>时间 / ID</div>
                    <div>标签</div>
                    <div>时延</div>
                    <div>消耗</div>
                    <div>技能召回率</div>
                    <div>窗口%</div>
                    <div>评分</div>
                </div>

                {filteredData.slice().reverse().map(item => {
                    const itemTaskId = item.task_id || item.upload_id || `temp-${item.timestamp}`;
                    const isCurrentRecord = itemTaskId === taskId;

                    return (
                        <div
                            key={item.upload_id || itemTaskId}
                            className="record-row"
                            data-timestamp={new Date(item.timestamp).getTime()}
                            data-label={item.label || '__no_label__'}
                            style={{
                                borderBottom: '1px solid #1e293b',
                                background: isCurrentRecord ? 'rgba(56, 189, 248, 0.15)' : '#1e293b',
                                marginBottom: '1px',
                                cursor: 'pointer',
                                transition: 'background 0.2s'
                            }}
                            onClick={() => {
                                if (!isCurrentRecord) {
                                    const params = new URLSearchParams();
                                    params.set('query', item.query);
                                    if (item.framework) params.set('framework', item.framework);
                                    params.set('expandTaskId', itemTaskId);
                                    window.open(`${basePath}/details?${params.toString()}`, '_blank');
                                }
                            }}
                            onMouseOver={(e) => {
                                if (!isCurrentRecord) {
                                    e.currentTarget.style.background = '#334155';
                                }
                            }}
                            onMouseOut={(e) => {
                                if (!isCurrentRecord) {
                                    e.currentTarget.style.background = '#1e293b';
                                }
                            }}
                        >
                            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr 1fr', padding: '1rem', alignItems: 'center' }}>
                                <div>
                                    <div style={{ fontWeight: 'bold', fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        {formatFullTime(item.timestamp)}
                                        {isCurrentRecord && (
                                            <span style={{
                                                background: '#38bdf8',
                                                color: '#0f172a',
                                                padding: '2px 8px',
                                                borderRadius: '4px',
                                                fontSize: '0.7rem',
                                                fontWeight: 'bold'
                                            }}>
                                                当前
                                            </span>
                                        )}
                                    </div>
                                    <div style={{ fontSize: '0.8rem', color: '#64748b' }}>{itemTaskId}</div>
                                </div>
                                <div style={{ fontSize: '0.9rem', color: '#cbd5e1' }}>
                                    {item.label || '-'}
                                </div>
                                <div>{item.latency ? (item.latency < 1 ? (item.latency * 1000).toFixed(0) + 'ms' : item.latency.toFixed(2) + 's') : '-'}</div>
                                <div>{item.tokens}</div>
                                <div style={{
                                    color: item.skill_recall_rate !== null && item.skill_recall_rate !== undefined ?
                                           (item.skill_recall_rate === 1.0 ? '#4ade80' :
                                            item.skill_recall_rate > 0 ? '#fbbf24' : '#f87171') : '#94a3b8',
                                    fontWeight: 'bold'
                                }}>
                                    {item.skill_recall_rate !== null && item.skill_recall_rate !== undefined ?
                                     (item.skill_recall_rate * 100).toFixed(0) + '%' : '--'}
                                </div>
                                <div style={{ color: item.context_window_pct != null ? (item.context_window_pct > 90 ? '#f87171' : '#4ade80') : '#94a3b8' }}>
                                    {item.context_window_pct != null ? `${item.context_window_pct.toFixed(1)}%` : '-'}
                                </div>
                                <div style={{ color: item.answer_score === null ? '#94a3b8' : ((item.answer_score || 0) > 0.8 ? '#4ade80' : '#f87171') }}>{item.answer_score === null ? '--' : item.answer_score?.toFixed(2)}</div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

const cardStyle: React.CSSProperties = {
    background: 'var(--card-bg)',
    border: '1px solid var(--border)',
    borderRadius: '8px',
    padding: '1rem',
    display: 'flex',
    flexDirection: 'column'
};

const chartTitleStyle: React.CSSProperties = {
    margin: '0 0 1rem 0',
    fontSize: '0.9rem',
    color: 'var(--foreground-secondary)',
    fontWeight: 'normal'
};

const sectionHeader: React.CSSProperties = {
    color: 'var(--primary)',
    margin: 0,
    fontSize: '0.95rem'
};

const codeBlock: React.CSSProperties = {
    fontFamily: 'monospace',
    fontSize: '0.9rem',
    lineHeight: '1.5',
    whiteSpace: 'pre-wrap',
    color: 'var(--foreground)',
    background: 'var(--code-block-bg)',
    padding: '0.75rem',
    borderRadius: '6px',
    border: '1px solid var(--border)'
};
