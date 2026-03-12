'use client';

import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';

const Line = dynamic(() => import('recharts').then(mod => mod.Line), { ssr: false });
const LineChart = dynamic(() => import('recharts').then(mod => mod.LineChart), { ssr: false });
const XAxis = dynamic(() => import('recharts').then(mod => mod.XAxis), { ssr: false });
const YAxis = dynamic(() => import('recharts').then(mod => mod.YAxis), { ssr: false });
const CartesianGrid = dynamic(() => import('recharts').then(mod => mod.CartesianGrid), { ssr: false });
const Tooltip = dynamic(() => import('recharts').then(mod => mod.Tooltip), { ssr: false });
const Legend = dynamic(() => import('recharts').then(mod => mod.Legend), { ssr: false });
const ResponsiveContainer = dynamic(() => import('recharts').then(mod => mod.ResponsiveContainer), { ssr: false });

const ReactJson = dynamic(() => import('react-json-view'), { ssr: false });

// --- Types Reuse ---
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
    is_answer_correct?: boolean;
    answer_score?: number;
    judgment_reason?: string;
    skill_score?: number;
    label?: string;
    task_id?: string;
    upload_id?: string;
    version?: string;
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
}

interface Interaction {
    requestMessages: any[];
    responseMessage: any;
    usage?: any;
    timestamp: number;
    latency?: number;
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
                    background: '#0f172a',
                    border: '1px solid #334155',
                    color: '#f1f5f9',
                    padding: '6px 10px',
                    borderRadius: '4px',
                    whiteSpace: 'nowrap',
                    zIndex: 1000,
                    marginBottom: '6px',
                    fontSize: '0.75rem',
                    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.5)',
                    pointerEvents: 'none',
                    fontWeight: 'normal',
                    lineHeight: '1.2'
                }}>
                    {content}
                    {/* Arrow */}
                    <div style={{
                        position: 'absolute',
                        top: '100%',
                        left: '50%',
                        marginLeft: '-4px',
                        width: 0,
                        height: 0,
                        borderLeft: '4px solid transparent',
                        borderRight: '4px solid transparent',
                        borderTop: '4px solid #334155'
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

    // Sort state
    const [sortMode, setSortMode] = useState<'default' | 'latency_desc' | 'tokens_desc'>('default');

    // Pagination state
    const [currentPage, setCurrentPage] = useState(0);
    const pageSize = 5;

    // Normalize interactions for different frameworks
    const normalizedInteractions = useMemo(() => {
        return normalizeInteractions(interactions);
    }, [interactions]);

    // Prepare data with calculated metrics
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
            // LLM 调用行
            let lat = item.latency || 0;
            if (!lat && item.timeInfo && item.timeInfo.completed && item.timeInfo.created) {
                lat = item.timeInfo.completed - item.timeInfo.created;
            }

            let tok = item.usage?.total_tokens || 0;
            if (!tok && item.usage?.total) {
                tok = item.usage.total;
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

            // 工具调用行（与 LLM 同级展示）
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

    // Calculate Top 5 Latency rows (LLM + Tool)
    const topLatencyIndices = useMemo(() => {
        const sorted = [...processedInteractions].sort((a, b) => b.latency - a.latency);
        return new Set(sorted.slice(0, 5).filter(x => x.latency > 0).map(x => x.id));
    }, [processedInteractions]);

    // Calculate Top 5 Token Indices (based on original order)
    const topTokenIndices = useMemo(() => {
        const sorted = [...processedInteractions].sort((a, b) => b.tokens - a.tokens);
        return new Set(sorted.slice(0, 5).filter(x => x.tokens > 0).map(x => x.id));
    }, [processedInteractions]);

    // Apply sorting for display
    const displayedInteractions = useMemo(() => {
        const data = [...processedInteractions];
        if (sortMode === 'latency_desc') {
            data.sort((a, b) => b.latency - a.latency);
        } else if (sortMode === 'tokens_desc') {
            data.sort((a, b) => b.tokens - a.tokens);
        } else {
            data.sort((a, b) => a.order - b.order);
        }
        return data;
    }, [processedInteractions, sortMode]);

    // Pagination Logic
    const totalPages = Math.ceil(displayedInteractions.length / pageSize);
    const paginatedInteractions = useMemo(() => {
        const start = currentPage * pageSize;
        return displayedInteractions.slice(start, start + pageSize);
    }, [displayedInteractions, currentPage, pageSize]);

    // Reset page when sort mode changes
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
                <h4 style={headerStyle}>Execution Steps (Trace)</h4>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Sort by:</span>
                    <select
                        value={sortMode}
                        onChange={(e) => setSortMode(e.target.value as any)}
                        style={{
                            background: '#1e293b',
                            color: '#e2e8f0',
                            border: '1px solid #334155',
                            borderRadius: '4px',
                            padding: '2px 8px',
                            fontSize: '0.8rem',
                            outline: 'none'
                        }}
                    >
                        <option value="default">Default (Chronological)</option>
                        <option value="latency_desc">Latency (High to Low)</option>
                        <option value="tokens_desc">Tokens (High to Low)</option>
                    </select>
                </div>
            </div>

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
                                    '#e2e8f0';

                    const toolAccentColor = isTopLatency ? '#fb923c' : '#fbbf24';
                    const focusShadow = '0 0 0 2px rgba(96, 165, 250, 0.3)';
                    const toolAccentShadow = `inset 3px 0 0 ${toolAccentColor}`;
                    const combinedShadow = isTool
                        ? (isFocused ? `${focusShadow}, ${toolAccentShadow}` : toolAccentShadow)
                        : (isFocused ? focusShadow : 'none');

                    // Truncate
                    if (contentSummary.length > 150) contentSummary = contentSummary.slice(0, 150) + '...';

                    return (
                        <div
                            key={wrapper.id}
                            onClick={() => onStepClick(parentIndex)}
                            style={{
                                background: isFocused
                                    ? (isTool ? '#3730a3' : '#1e3a8a')
                                    : (isTool ? '#111827' : '#1e293b'),
                                border: isFocused ? '1px solid #60a5fa' : (isTool ? '1px solid #374151' : '1px solid #334155'),
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
                                        background: '#334155', color: '#94a3b8',
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
                                            color: '#0f172a',
                                            background: '#fbbf24',
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
                                        <span style={{ color: '#94a3b8' }}>Latency:</span>
                                        <span style={{
                                            color: isTopLatency ? '#fb923c' : '#cbd5e1',
                                            fontWeight: isTopLatency ? 'bold' : 'normal',
                                            borderBottom: isTopLatency ? '1px dashed #fb923c' : 'none'
                                        }}>
                                            {latencyStr}
                                        </span>
                                        {isTopLatency && <span style={{ fontSize: '0.7rem', color: '#fb923c', border: '1px solid #fb923c', borderRadius: '4px', padding: '0 4px' }}>TOP 5</span>}
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        <span style={{ color: '#94a3b8' }}>Tokens:</span>
                                        <span style={{
                                            color: isTopToken ? '#f472b6' : '#cbd5e1',
                                            fontWeight: isTopToken ? 'bold' : 'normal',
                                            borderBottom: isTopToken ? '1px dashed #f472b6' : 'none'
                                        }}>
                                            {tokens}
                                        </span>
                                        {isTopToken && <span style={{ fontSize: '0.7rem', color: '#f472b6', border: '1px solid #f472b6', borderRadius: '4px', padding: '0 4px' }}>TOP 5</span>}
                                    </div>
                                </div>
                            </div>
                            <div style={{
                                color: '#cbd5e1',
                                fontFamily: 'monospace',
                                opacity: 0.9,
                                wordBreak: 'break-all'
                            }}>
                                {contentSummary || <span style={{ color: '#64748b', fontStyle: 'italic' }}>(No Content)</span>}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Pagination Controls */}
            {totalPages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '1rem', marginTop: '1rem' }}>
                    <button
                        onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
                        disabled={currentPage === 0}
                        style={{
                            padding: '4px 12px',
                            background: currentPage === 0 ? '#334155' : '#38bdf8',
                            color: currentPage === 0 ? '#94a3b8' : '#0f172a',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: currentPage === 0 ? 'not-allowed' : 'pointer'
                        }}
                    >
                        Prev
                    </button>
                    <span style={{ color: '#94a3b8', fontSize: '0.9rem' }}>
                        Page {currentPage + 1} of {totalPages}
                    </span>
                    <button
                        onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))}
                        disabled={currentPage === totalPages - 1}
                        style={{
                            padding: '4px 12px',
                            background: currentPage === totalPages - 1 ? '#334155' : '#38bdf8',
                            color: currentPage === totalPages - 1 ? '#94a3b8' : '#0f172a',
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
    );
};

// Ensure Suspense boundary for useSearchParams in Next.js App Router
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
    const query = searchParams.get('query') || '';
    const framework = searchParams.get('framework') || '';

    const expandTaskId = searchParams.get('expandTaskId');

    const [allData, setAllData] = useState<Execution[]>([]);
    const [loading, setLoading] = useState(true);
    const [sessionData, setSessionData] = useState<Record<string, any>>({});
    const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set(expandTaskId ? [expandTaskId] : []));
    const [timeFilter, setTimeFilter] = useState('all');
    const [editingQueryFor, setEditingQueryFor] = useState<string | null>(null);
    const [editQueryValue, setEditQueryValue] = useState('');
    const [querySaveStatus, setQuerySaveStatus] = useState<{ id: string; status: 'saving' | 'ok' | 'error'; msg?: string } | null>(null);

    const [editingResultFor, setEditingResultFor] = useState<string | null>(null);
    const [editResultValue, setEditResultValue] = useState('');
    const [resultSaveStatus, setResultSaveStatus] = useState<{ id: string; status: 'saving' | 'ok' | 'error'; msg?: string } | null>(null);

    const [feedbackComments, setFeedbackComments] = useState<Record<string, string>>({});
    const [focusedStep, setFocusedStep] = useState<number | null>(null);

    const submitDetailFeedback = async (item: Execution, type: 'like' | 'dislike' | null, comment?: string) => {
        const taskId = item.task_id || item.upload_id || '';
        const currentComment = feedbackComments[taskId] || item.user_feedback?.comment || '';
        const newFeedback = { type, comment: comment !== undefined ? comment : currentComment };

        // Optimistic Update
        const newData = allData.map(d =>
            (d.task_id === item.task_id || d.upload_id === item.upload_id)
                ? { ...d, user_feedback: newFeedback }
                : d
        );
        setAllData(newData);

        try {
            await fetch('/api/data', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    task_id: item.task_id,
                    upload_id: item.upload_id,
                    user_feedback: newFeedback
                })
            });
            alert('保存成功');
        } catch (e) { console.error(e); }
    };

    // Auto-fetch expanded session
    useEffect(() => {
        if (expandTaskId && !sessionData[expandTaskId]) {
            fetch(`/api/session?taskId=${expandTaskId}`)
                .then(res => res.ok ? res.json() : { error: 'Error' })
                .then(json => setSessionData(prev => ({ ...prev, [expandTaskId]: json })))
                .catch(() => setSessionData(prev => ({ ...prev, [expandTaskId]: { error: 'Fetch failed' } })));
        }
    }, [expandTaskId]);

    // Fetch executions list
    useEffect(() => {
        fetch('/api/data', { cache: 'no-store' })
            .then(res => res.json())
            .then((data: any[]) => {
                // Filter immediately by Query & Framework
                let targetQuery = query;
                let targetFramework = framework;

                if (!targetQuery && expandTaskId) {
                    const targetRecord = data.find(d => d.task_id === expandTaskId || d.upload_id === expandTaskId);
                    if (targetRecord) {
                        targetQuery = targetRecord.query;
                        if (!targetFramework) targetFramework = targetRecord.framework;
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
                // Sort by time ascending for charts
                filtered.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
                setAllData(filtered);
                setLoading(false);
            });
    }, [query, framework, expandTaskId]);

    // Derived Data with Time Filter & Label Filter & Model Filter
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

        // Time Filter
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

        // Label Filter
        if (selectedLabels.size > 0) {
            data = data.filter(d => {
                if (d.label) {
                    return selectedLabels.has(d.label);
                }
                return selectedLabels.has(NO_LABEL_KEY);
            });
        }

        // Model Filter
        if (selectedModels.size > 0) {
            data = data.filter(d => {
                if (d.model) {
                    return selectedModels.has(d.model);
                }
                return selectedModels.has(NO_LABEL_KEY);
            });
        }

        return data;
    }, [allData, timeFilter, selectedLabels, selectedModels]);

    // Calculate statistics based on comparison dimension
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

        return {
            latency: latencyData,
            tokens: tokensData,
            accuracy: accuracyData
        };
    }, [filteredData, comparisonDim]);

    // Toggle Expand
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
            const res = await fetch('/api/data', {
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
            // 若修改后的 query 与当前页不同，跳转到新 query 的详情页以便用户继续查看该记录
            if (val !== query) {
                const params = new URLSearchParams();
                params.set('query', val);
                if (framework) params.set('framework', framework);
                params.set('expandTaskId', taskId);
                router.push(`/details?${params.toString()}`);
            } else {
                // Refresh data
                const dataRes = await fetch('/api/data');
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
            const res = await fetch('/api/data', {
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
            const msg = json.message || '已保存并重评';
            setResultSaveStatus({ id: taskId, status: 'ok', msg });
            setEditingResultFor(null);
            setEditResultValue('');

            // Refresh data
            const dataRes = await fetch('/api/data');
            const data: any[] = await dataRes.json();
            const filtered = data.filter(d =>
                d.query === query &&
                (!framework || d.framework === framework)
            ).map(x => ({
                ...x,
                tokens: Number(x.tokens || x.Token || 0),
                latency: Number(x.latency || 0),
                answer_score: x.answer_score !== null ? Number(x.answer_score) : (x.is_answer_correct ? 1.0 : 0.0)
            }));
            filtered.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
            setAllData(filtered);
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
            const res = await fetch('/api/parse-document', {
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


    const toggleExpand = async (taskId: string) => {
        const newSet = new Set(expandedIds);
        if (newSet.has(taskId)) {
            newSet.delete(taskId);
        } else {
            newSet.add(taskId);
            // Fetch session if not present
            if (!sessionData[taskId]) {
                try {
                    const res = await fetch(`/api/session?taskId=${taskId}`);
                    if (res.ok) {
                        const json = await res.json();
                        setSessionData(prev => ({ ...prev, [taskId]: json }));
                    } else {
                        setSessionData(prev => ({ ...prev, [taskId]: { error: 'No session log found' } }));
                    }
                } catch (e) {
                    setSessionData(prev => ({ ...prev, [taskId]: { error: 'Fetch error' } }));
                }
            }
        }
        setExpandedIds(newSet);
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

    const handleExportHtml = () => {
        const clone = document.documentElement.cloneNode(true) as HTMLElement;

        // Cleanup
        clone.querySelectorAll('script').forEach(s => s.remove());
        clone.querySelectorAll('.export-btn').forEach(b => b.remove());

        // Revival Script
        const revivalScript = `
        <script>
            (function() {
                // Constants
                const TS_MAP = {
                    '1h': 60 * 60 * 1000,
                    '12h': 12 * 60 * 60 * 1000,
                    '24h': 24 * 60 * 60 * 1000,
                    'all': 0
                };
                
                // State
                let state = {
                    timeFilter: 'all', // '1h', '12h', '24h', 'all'
                    selectedLabels: new Set()
                };

                // Elements
                const rows = document.querySelectorAll('.record-row');
                const totalCountEl = document.getElementById('total-records-count');
                const labelMenu = document.getElementById('label-menu-dropdown');
                const labelTrigger = document.getElementById('label-menu-trigger');
                const labelTextObj = document.getElementById('label-trigger-text');
                
                // --- Logic ---
                function updateVisibility() {
                    const now = Date.now();
                    const threshold = TS_MAP[state.timeFilter] ? now - TS_MAP[state.timeFilter] : 0;
                    let count = 0;

                    rows.forEach(row => {
                        const ts = parseInt(row.getAttribute('data-timestamp') || '0');
                        const lbl = row.getAttribute('data-label') || '';
                        
                        let visible = true;
                        
                        // Time Check
                        if (threshold > 0 && ts < threshold) visible = false;
                        
                        // Label Check
                        if (visible && state.selectedLabels.size > 0) {
                            // If filter explicitly has this label, show it.
                            // Note: We need to handle 'No Label' case specially if needed, but for now simple match.
                            // The row data-label might be empty string.
                            const checkLbl = lbl || '__no_label__';
                            if (!state.selectedLabels.has(checkLbl)) visible = false;
                        }

                        row.style.display = visible ? '' : 'none';
                        if (visible) count++;
                    });

                    if (totalCountEl) totalCountEl.innerText = count;
                }

                // --- Bindings ---
                
                // Time Filters
                document.querySelectorAll('.filter-time-btn').forEach(btn => {
                    btn.onclick = () => {
                        // Update UI
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

                // Label Menu Toggle
                if (labelTrigger && labelMenu) {
                    labelTrigger.onclick = (e) => {
                        e.stopPropagation();
                        labelMenu.style.display = labelMenu.style.display === 'none' ? 'block' : 'none';
                    };
                    // Close on outside click
                    document.body.onclick = () => {
                         labelMenu.style.display = 'none';
                    };
                    labelMenu.onclick = (e) => e.stopPropagation();
                }

                // Label Checkboxes
                document.querySelectorAll('.filter-label-checkbox').forEach(chk => {
                    chk.onchange = () => {
                        const val = chk.value;
                        if (chk.checked) state.selectedLabels.add(val);
                        else state.selectedLabels.delete(val);
                        
                        // Update Trigger Text
                        if (labelTextObj) {
                            labelTextObj.innerText = state.selectedLabels.size === 0 ? 'All Filter' : \`\${state.selectedLabels.size} Selected\`;
                        }
                        updateVisibility();
                    };
                });
                
                // Clear Labels
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

                // Expand/Collapse Rows
                document.querySelectorAll('.record-summary').forEach(summary => {
                    summary.onclick = () => {
                        const detail = summary.nextElementSibling;
                        if (detail && detail.classList.contains('record-detail')) {
                            const isHidden = detail.style.display === 'none';
                            detail.style.display = isHidden ? 'block' : 'none';
                            // Update icon
                            const icon = summary.querySelector('.expand-icon');
                            if (icon) icon.innerText = isHidden ? '▲' : '▼';
                        }
                    };
                });

                // Charts Notice
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

    if (loading) return <div style={{ padding: '2rem', color: 'white' }}>Loading...</div>;

    if (allData.length === 0) {
        return <div style={{ padding: '2rem', color: 'white' }}>No records found for this combination.</div>;
    }

    return (
        <div style={{ minHeight: '100vh', background: '#0f172a', color: '#f8fafc', padding: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '1px solid #334155', paddingBottom: '0.5rem' }}>
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
                    <span style={{ flexShrink: 0 }}>Details:</span>
                    <span style={{ color: '#38bdf8', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {query}
                    </span>
                </h1>
                <button
                    className="export-btn"
                    onClick={handleExportHtml}
                    style={{
                        padding: '8px 16px',
                        background: '#38bdf8',
                        color: '#0f172a',
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
            <div style={{ marginBottom: '2rem', color: '#94a3b8' }}>
                Framework: <strong style={{ color: 'white' }}>{framework || 'All'}</strong> | Total Records: <span id="total-records-count">{filteredData.length}</span>
            </div>

            {/* Controls */}
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

                {/* Comparison Dimension Toggle */}
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

                {/* Label Filter */}
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
                                    display: isLabelMenuOpen ? 'block' : 'none', // Changed to CSS toggling for export
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

                            {/* Overlay for React Interaction Only */}
                            {isLabelMenuOpen && (
                                <div
                                    style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 40 }}
                                    onClick={() => setIsLabelMenuOpen(false)}
                                />
                            )}
                        </div>
                    </div>
                )}

                {/* Model Filter */}
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

                            {/* Overlay for React Interaction Only */}
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

            {/* Charts Section */}




            {/* Charts Section */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '2rem' }}>
                <div className="card" style={cardStyle}>
                    <h3 style={chartTitleStyle}>
                        时延趋势 (秒)
                        <CustomTooltip content="从请求发出到收到最终完整回复的总耗时" />
                    </h3>
                    <ResponsiveContainer width="100%" height={200}>
                        <LineChart data={filteredData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                            <XAxis dataKey="timestamp" tickFormatter={formatTime} stroke="#64748b" fontSize={11} />
                            <YAxis stroke="#64748b" fontSize={11} />
                            <Tooltip contentStyle={{ background: '#1e293b', borderColor: '#334155' }} />
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
                            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                            <XAxis dataKey="timestamp" tickFormatter={formatTime} stroke="#64748b" fontSize={11} />
                            <YAxis stroke="#64748b" fontSize={11} />
                            <Tooltip contentStyle={{ background: '#1e293b', borderColor: '#334155' }} />
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
                            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                            <XAxis dataKey="timestamp" tickFormatter={formatTime} stroke="#64748b" fontSize={11} />
                            <YAxis stroke="#64748b" fontSize={11} domain={[0, 1]} />
                            <Tooltip contentStyle={{ background: '#1e293b', borderColor: '#334155' }} />
                            <Line type="monotone" dataKey="answer_score" stroke="#4ade80" dot={true} strokeWidth={2} />
                        </LineChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* Comparison Statistics Section */}
            {(compareDimData.latency.length > 0) && (
                <div style={{ marginBottom: '2rem' }}>
                    <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>
                        按 {comparisonDim === 'label' ? '标签 (Label)' : '模型 (Model)'} 对比 (平均值)
                    </h2>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }}>
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
                    </div>
                </div>
            )}

            {/* List Section */}
            <div className="list-container">
                <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>执行记录详情</h2>
                {/* Headers */}
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr 50px', padding: '1rem', borderBottom: '1px solid #334155', color: '#94a3b8', fontSize: '0.9rem' }}>
                    <div>时间 / ID</div>
                    <div>状态</div>
                    <div>标签</div>
                    <div>时延</div>
                    <div>消耗</div>
                    <div>评分</div>
                    <div></div>
                </div>

                {filteredData.slice().reverse().map(item => {
                    const taskId = item.task_id || item.upload_id || `temp-${item.timestamp}`;
                    const isExpanded = expandedIds.has(taskId);
                    const session = sessionData[taskId];

                    return (
                        <div
                            key={taskId}
                            className="record-row"
                            data-timestamp={new Date(item.timestamp).getTime()}
                            data-label={item.label || '__no_label__'}
                            style={{ borderBottom: '1px solid #1e293b', background: '#1e293b', marginBottom: '1px' }}
                        >
                            {/* Summary Row */}
                            <div
                                className="record-summary"
                                style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr 50px', padding: '1rem', alignItems: 'center', cursor: 'pointer', transition: 'background 0.2s' }}
                                onClick={() => toggleExpand(taskId)}
                                onMouseOver={(e: any) => e.currentTarget.style.background = '#334155'}
                                onMouseOut={(e: any) => e.currentTarget.style.background = 'transparent'}
                            >
                                <div>
                                    <div style={{ fontWeight: 'bold', fontSize: '0.95rem' }}>{formatFullTime(item.timestamp)}</div>
                                    <div style={{ fontSize: '0.8rem', color: '#64748b' }}>{taskId}</div>
                                </div>
                                <div>
                                    <span style={{
                                        padding: '4px 8px', borderRadius: '4px', fontSize: '0.8rem', fontWeight: 'bold',
                                        background: item.answer_score === null ? 'rgba(148, 163, 184, 0.1)' : ((item.answer_score || 0) > 0.8 ? 'rgba(74, 222, 128, 0.1)' : 'rgba(248, 113, 113, 0.1)'),
                                        color: item.answer_score === null ? '#94a3b8' : ((item.answer_score || 0) > 0.8 ? '#4ade80' : '#f87171')
                                    }}>
                                        {item.answer_score === null ? '--' : ((item.answer_score || 0) > 0.8 ? 'PASS' : 'FAIL')}
                                    </span>
                                </div>
                                <div style={{ fontSize: '0.9rem', color: '#cbd5e1' }}>
                                    {item.label || '-'}
                                </div>
                                <div>{item.latency ? (item.latency < 1 ? (item.latency * 1000).toFixed(0) + 'ms' : item.latency.toFixed(2) + 's') : '-'}</div>
                                <div>{item.tokens}</div>
                                <div style={{ color: item.answer_score === null ? '#94a3b8' : ((item.answer_score || 0) > 0.8 ? '#4ade80' : '#f87171') }}>{item.answer_score === null ? '--' : item.answer_score?.toFixed(2)}</div>
                                <div style={{ textAlign: 'center', color: '#94a3b8' }} className="expand-icon">
                                    {isExpanded ? '▲' : '▼'}
                                </div>
                            </div>

                            {/* Details Expanded */}
                            <div className="record-detail" style={{ display: isExpanded ? 'block' : 'none', padding: '1.5rem', background: '#0f172a', borderTop: '1px solid #334155' }}>
                                {/* Main Content Grid: Left (Result/Failures) vs Right (Skill Analysis) */}
                                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '2rem', marginBottom: '2rem' }}>

                                    {/* --- LEFT COLUMN --- */}
                                    <div style={{ minWidth: 0 }}>

                                        {/* 1. Query */}
                                        <div style={{ marginBottom: '1.5rem' }}>
                                            <h4 style={sectionHeader}>Query</h4>
                                            {editingQueryFor === taskId ? (
                                                <div>
                                                    <textarea
                                                        value={editQueryValue}
                                                        onChange={(e) => setEditQueryValue(e.target.value)}
                                                        rows={3}
                                                        style={{
                                                            width: '100%',
                                                            padding: '0.75rem',
                                                            background: '#1e293b',
                                                            border: '1px solid #334155',
                                                            borderRadius: '6px',
                                                            color: '#e2e8f0',
                                                            fontFamily: 'monospace',
                                                            fontSize: '0.9rem',
                                                            resize: 'vertical'
                                                        }}
                                                        placeholder="输入 query"
                                                    />
                                                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', alignItems: 'center' }}>
                                                        <button
                                                            onClick={() => saveQuery(taskId, item.upload_id)}
                                                            disabled={querySaveStatus?.id === taskId && querySaveStatus?.status === 'saving'}
                                                            style={{
                                                                padding: '6px 14px',
                                                                background: '#38bdf8',
                                                                color: '#0f172a',
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
                                                                background: '#334155',
                                                                color: '#94a3b8',
                                                                border: 'none',
                                                                borderRadius: '4px',
                                                                cursor: 'pointer'
                                                            }}
                                                        >
                                                            取消
                                                        </button>
                                                        {querySaveStatus?.id === taskId && querySaveStatus?.status === 'ok' && (
                                                            <span style={{ color: '#4ade80', fontSize: '0.9rem' }}>{querySaveStatus.msg}</span>
                                                        )}
                                                        {querySaveStatus?.id === taskId && querySaveStatus?.status === 'error' && (
                                                            <span style={{ color: '#f87171', fontSize: '0.9rem' }}>{querySaveStatus.msg}</span>
                                                        )}
                                                    </div>
                                                </div>
                                            ) : (
                                                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
                                                    <div style={codeBlock}>{item.query || '(空)'}</div>
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); startEditQuery(taskId, item.query || ''); }}
                                                        style={{
                                                            padding: '4px 10px',
                                                            background: 'transparent',
                                                            color: '#38bdf8',
                                                            border: '1px solid #38bdf8',
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

                                        {/* 2. Final Result */}
                                        <div style={{ marginBottom: '1.5rem' }}>
                                            <h4 style={sectionHeader}>Final Result</h4>

                                            {editingResultFor === taskId ? (
                                                <div style={{ marginTop: '0.5rem' }}>
                                                    <textarea
                                                        value={editResultValue}
                                                        onChange={(e) => setEditResultValue(e.target.value)}
                                                        rows={6}
                                                        style={{
                                                            width: '100%',
                                                            padding: '0.75rem',
                                                            background: '#1e293b',
                                                            border: '1px solid #334155',
                                                            borderRadius: '6px',
                                                            color: '#e2e8f0',
                                                            fontFamily: 'monospace',
                                                            fontSize: '0.9rem',
                                                            resize: 'vertical'
                                                        }}
                                                        placeholder="输入或上传 Final Result"
                                                    />
                                                    <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', alignItems: 'center' }}>
                                                        <button
                                                            onClick={() => saveFinalResult(taskId, item.upload_id)}
                                                            disabled={resultSaveStatus?.id === taskId && resultSaveStatus?.status === 'saving'}
                                                            style={{
                                                                padding: '6px 14px',
                                                                background: '#38bdf8',
                                                                color: '#0f172a',
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
                                                                background: '#334155',
                                                                color: '#94a3b8',
                                                                border: 'none',
                                                                borderRadius: '4px',
                                                                cursor: 'pointer'
                                                            }}
                                                        >
                                                            取消
                                                        </button>
                                                        <label style={{
                                                            padding: '6px 14px',
                                                            background: '#2d3748',
                                                            color: '#fbbf24',
                                                            border: '1px solid #fbbf24',
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
                                                            <span style={{ color: '#4ade80', fontSize: '0.9rem' }}>{resultSaveStatus.msg}</span>
                                                        )}
                                                        {resultSaveStatus?.id === taskId && resultSaveStatus?.status === 'error' && (
                                                            <span style={{ color: '#f87171', fontSize: '0.9rem' }}>{resultSaveStatus.msg}</span>
                                                        )}
                                                    </div>
                                                </div>
                                            ) : (
                                                <div>
                                                    <div style={{
                                                        ...codeBlock,
                                                        maxHeight: '300px',
                                                        overflowY: 'auto',
                                                        padding: '1rem',
                                                        background: '#1e293b',
                                                        border: '1px solid #334155',
                                                        borderRadius: '6px'
                                                    }}>
                                                        {item.final_result || '(No Result)'}
                                                    </div>
                                                    <div style={{ marginTop: '0.5rem' }}>
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); startEditResult(taskId, item.final_result || ''); }}
                                                            style={{
                                                                padding: '4px 10px',
                                                                background: 'transparent',
                                                                color: '#38bdf8',
                                                                border: '1px solid #38bdf8',
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

                                        {/* 3. Judgment Reason */}
                                        <div style={{ marginBottom: '1.5rem' }}>
                                            <h4 style={sectionHeader}>Judgment Reason</h4>
                                            <div style={{
                                                ...codeBlock,
                                                background: '#1e293b',
                                                padding: '1rem',
                                                borderRadius: '6px',
                                                border: '1px solid #334155'
                                            }}>
                                                {item.judgment_reason || '-'}
                                            </div>
                                        </div>

                                        {/* 4. Failures Section */}
                                        {item.failures && item.failures.length > 0 ? (
                                            <div style={{ marginBottom: '1.5rem' }}>
                                                <h4 style={{ ...sectionHeader, color: '#f87171', borderLeft: '3px solid #f87171', paddingLeft: '8px', borderBottom: 'none' }}> Intermediate Failures / Anomalies </h4>
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                                    {item.failures.map((fail, idx) => (
                                                        <div key={idx} style={{ background: 'rgba(248, 113, 113, 0.1)', border: '1px solid #7f1d1d', borderRadius: '6px', padding: '1rem' }}>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                                                                <span style={{ background: '#f87171', color: '#0f172a', padding: '2px 8px', borderRadius: '4px', fontSize: '0.8rem', fontWeight: 'bold' }}>
                                                                    {fail.failure_type}
                                                                </span>
                                                                <span style={{ color: '#fca5a5', fontWeight: 'bold' }}>{fail.description}</span>
                                                            </div>
                                                            {fail.context && (
                                                                <div style={{ marginBottom: '0.5rem', fontSize: '0.9rem', color: '#cbd5e1', fontFamily: 'monospace', background: 'rgba(0,0,0,0.3)', padding: '0.5rem', borderRadius: '4px' }}>
                                                                    {fail.context}
                                                                </div>
                                                            )}
                                                            {fail.recovery && (
                                                                <div style={{ fontSize: '0.9rem', color: '#86efac' }}>
                                                                    <strong style={{ color: '#94a3b8' }}>Recovery:</strong> {fail.recovery}
                                                                </div>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        ) : (
                                            <div style={{ padding: '1rem', border: '1px dashed #334155', borderRadius: '6px', color: '#64748b', textAlign: 'center', fontSize: '0.9rem' }}>
                                                No intermediate failures detected.
                                            </div>
                                        )}
                                    </div>

                                    {/* --- RIGHT COLUMN --- */}
                                    <div style={{ minWidth: 0 }}>

                                        {/* 1. Skills Used */}
                                        <div style={{ marginBottom: '2rem' }}>
                                            <h4 style={sectionHeader}>Skills Used</h4>
                                            <div style={{ ...codeBlock, padding: '0.5rem', background: '#1e293b', borderRadius: '4px', border: '1px solid #334155' }}>
                                                {item.skills?.length
                                                    ? item.skills.map(s => item.skill_version ? `${s} (v${item.skill_version})` : s).join(', ')
                                                    : (item.skill ? (item.skill_version ? `${item.skill} (v${item.skill_version})` : item.skill) : '(None)')
                                                }
                                            </div>
                                        </div>

                                        {/* 2. Skill Effectiveness Analysis */}
                                        <div style={{ background: '#1e293b', borderRadius: '6px', border: '1px solid #334155', padding: '1rem' }}>
                                            <h4 style={{ ...sectionHeader, display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                <span>🛡️</span> Skill Analysis
                                            </h4>

                                            {/* 新逻辑：使用 skill_issues 展示 */}
                                            {item.skill_issues && item.skill_issues.length > 0 ? (
                                                <div>
                                                    <div style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                        <div style={{ textAlign: 'center', background: '#0f172a', padding: '8px', borderRadius: '4px', border: '1px solid #ef4444' }}>
                                                            <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#ef4444' }}>{item.skill_issues.length}</div>
                                                            <div style={{ fontSize: '0.7rem', color: '#64748b' }}>SKILL ISSUES</div>
                                                        </div>
                                                        <div style={{ fontSize: '0.85rem', color: '#cbd5e1', flex: 1 }}>
                                                            以下评分项扣分可通过优化 Skill 定义改善：
                                                        </div>
                                                    </div>

                                                    {/* Skill Issues 列表 */}
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '400px', overflowY: 'auto' }}>
                                                        {item.skill_issues.map((issue: any, idx: number) => (
                                                            <div key={idx} style={{ padding: '10px', background: 'rgba(239, 68, 68, 0.1)', borderLeft: '3px solid #ef4444', borderRadius: '0 4px 4px 0' }}>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                                                                    <span style={{
                                                                        background: issue.type === 'root_cause' ? '#f472b6' : '#38bdf8',
                                                                        color: '#0f172a',
                                                                        padding: '2px 6px',
                                                                        borderRadius: '4px',
                                                                        fontSize: '0.7rem',
                                                                        fontWeight: 'bold'
                                                                    }}>
                                                                        {issue.id}
                                                                    </span>
                                                                    <span style={{ color: '#fca5a5', fontWeight: 'bold', fontSize: '0.85rem' }}>
                                                                        得分: {((issue.match_score || 0) * 100).toFixed(0)}%
                                                                    </span>
                                                                </div>
                                                                <div style={{ fontSize: '0.85rem', color: '#e2e8f0', marginBottom: '6px' }}>
                                                                    <strong>评分标准：</strong>{issue.content}
                                                                </div>
                                                                <div style={{ fontSize: '0.8rem', color: '#cbd5e1', marginBottom: '6px' }}>
                                                                    <strong>扣分原因：</strong>{issue.explanation}
                                                                </div>
                                                                <div style={{ fontSize: '0.8rem', color: '#fcd34d', marginBottom: '6px', fontStyle: 'italic' }}>
                                                                    <strong>分析依据：</strong>{issue.reasoning}
                                                                </div>
                                                                {issue.improvement_suggestion && (
                                                                    <div style={{ fontSize: '0.8rem', color: '#86efac', background: 'rgba(74, 222, 128, 0.1)', padding: '6px', borderRadius: '4px' }}>
                                                                        <strong>💡 改进建议：</strong>{issue.improvement_suggestion}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            ) : (
                                                <div style={{ color: '#4ade80', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                    <span style={{ fontSize: '1.2rem' }}>✅</span>
                                                    <div>
                                                        <strong>No Skill Issues Detected</strong>
                                                        <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '4px' }}>
                                                            所有扣分项均不是 Skill 定义的问题，无需优化 Skill。
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* User Feedback */}
                                <div style={{ marginBottom: '2rem', padding: '1.5rem', background: '#1e293b', borderRadius: '8px', border: '1px solid #334155' }}>
                                    <h4 style={{ ...sectionHeader, marginBottom: '1rem' }}>用户反馈 (User Feedback)</h4>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                                            <button
                                                onClick={(e) => { e.stopPropagation(); submitDetailFeedback(item, 'like'); }}
                                                style={{
                                                    display: 'flex', alignItems: 'center', gap: '0.5rem',
                                                    background: (item.user_feedback?.type === 'like') ? '#38bdf8' : '#0f172a',
                                                    color: (item.user_feedback?.type === 'like') ? '#0f172a' : '#94a3b8',
                                                    border: '1px solid #334155', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer',
                                                    fontWeight: (item.user_feedback?.type === 'like') ? 'bold' : 'normal',
                                                    transition: 'all 0.2s'
                                                }}
                                            >
                                                👍 Like
                                            </button>
                                            <button
                                                onClick={(e) => { e.stopPropagation(); submitDetailFeedback(item, 'dislike'); }}
                                                style={{
                                                    display: 'flex', alignItems: 'center', gap: '0.5rem',
                                                    background: (item.user_feedback?.type === 'dislike') ? '#f87171' : '#0f172a',
                                                    color: (item.user_feedback?.type === 'dislike') ? '#0f172a' : '#94a3b8',
                                                    border: '1px solid #334155', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer',
                                                    fontWeight: (item.user_feedback?.type === 'dislike') ? 'bold' : 'normal',
                                                    transition: 'all 0.2s'
                                                }}
                                            >
                                                👎 Dislike
                                            </button>
                                        </div>
                                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
                                            <textarea
                                                value={feedbackComments[taskId] !== undefined ? feedbackComments[taskId] : (item.user_feedback?.comment || '')}
                                                onChange={(e) => {
                                                    const val = e.target.value;
                                                    setFeedbackComments(prev => ({ ...prev, [taskId]: val }));
                                                }}
                                                onClick={e => e.stopPropagation()}
                                                placeholder="添加评论 (可选)..."
                                                style={{ flex: 1, minHeight: '60px', padding: '8px', background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0', borderRadius: '4px', fontSize: '0.9rem' }}
                                            />
                                            <button
                                                className="btn-primary"
                                                onClick={(e) => { e.stopPropagation(); submitDetailFeedback(item, item.user_feedback?.type || null, feedbackComments[taskId]); }}
                                                style={{ padding: '8px 16px', fontSize: '0.9rem', height: 'fit-content', whiteSpace: 'nowrap', background: '#38bdf8', color: '#0f172a', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                                            >
                                                保存评论
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                    {/* Runtime Metrics */}
                                    {(item.llm_call_count != null || item.tool_call_count != null || item.input_tokens != null || item.output_tokens != null || item.tool_call_error_count != null) && (
                                        <div style={{marginBottom: '1.5rem'}}>
                                            <h4 style={sectionHeader}>Runtime Metrics</h4>
                                            <div style={{
                                                display: 'grid',
                                                gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
                                                gap: '0.75rem',
                                                marginTop: '0.5rem'
                                            }}>
                                                {[
                                                    { label: 'LLM Calls', value: item.llm_call_count, color: '#38bdf8' },
                                                    { label: 'Tool Calls', value: item.tool_call_count, color: '#38bdf8' },
                                                    { label: 'Tool Errors', value: item.tool_call_error_count ?? 0, color: item.tool_call_error_count ? '#f87171' : '#4ade80' },
                                                    { label: 'Input Tokens', value: item.input_tokens, color: '#38bdf8' },
                                                    { label: 'Output Tokens', value: item.output_tokens, color: '#38bdf8' },
                                                ].map((metric, idx) => (
                                                    <div key={idx} style={{
                                                        background: '#1e293b',
                                                        border: '1px solid #334155',
                                                        borderRadius: '6px',
                                                        padding: '0.75rem',
                                                        textAlign: 'center'
                                                    }}>
                                                        <div style={{
                                                            fontSize: '1.3rem',
                                                            fontWeight: 'bold',
                                                            color: metric.color
                                                        }}>
                                                            {metric.value != null ? metric.value.toLocaleString() : '-'}
                                                        </div>
                                                        <div style={{
                                                            fontSize: '0.75rem',
                                                            color: '#64748b',
                                                            marginTop: '4px'
                                                        }}>
                                                            {metric.label}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                {session ? (
                                    session.error ? (
                                        <div style={{ color: '#94a3b8', fontStyle: 'italic' }}>{session.error}</div>
                                    ) : (
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
                                            <div style={{ minWidth: 0 }}>
                                                <div style={{
                                                    display: 'flex',
                                                    justifyContent: 'space-between',
                                                    alignItems: 'center',
                                                    marginBottom: '0.5rem',
                                                    borderBottom: '1px solid #334155',
                                                    paddingBottom: '4px',
                                                    minHeight: '34px'
                                                }}>
                                                    <h4 style={sectionHeader}>Session Data (Raw JSON)</h4>
                                                </div>
                                                <div style={{ background: '#1e293b', padding: '1rem', borderRadius: '8px', overflow: 'hidden' }}>
                                                    <ReactJson
                                                        key={`json-${focusedStep !== null ? focusedStep : 'default'}`}
                                                        src={session}
                                                        theme="monokai"
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
                                    <div style={{ color: '#38bdf8' }}>Loading session log...</div>
                                )}

                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// Styles
const cardStyle: React.CSSProperties = {
    background: '#1e293b',
    border: '1px solid #334155',
    borderRadius: '8px',
    padding: '1rem',
    display: 'flex',
    flexDirection: 'column'
};

const chartTitleStyle: React.CSSProperties = {
    margin: '0 0 1rem 0',
    fontSize: '0.9rem',
    color: '#94a3b8',
    fontWeight: 'normal'
};

const sectionHeader: React.CSSProperties = {
    color: '#38bdf8',
    margin: 0,
    fontSize: '0.95rem'
};

const codeBlock: React.CSSProperties = {
    fontFamily: 'monospace',
    fontSize: '0.9rem',
    lineHeight: '1.5',
    whiteSpace: 'pre-wrap',
    color: '#e2e8f0'
};
