'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';


// --- Types ---
interface Execution {
    timestamp: string;
    framework: string;
    tokens: number;
    latency: number;
    query: string;
    skill?: string;
    skills?: string[];
    skill_version?: string;
    final_result?: string;
    is_skill_correct?: boolean;
    is_answer_correct?: boolean;
    answer_score?: number;
    judgment_reason?: string;
    cost?: number; // legacy
    skill_score?: number;
    label?: string;
    task_id?: string;
    upload_id?: string;
    user_feedback?: {
        type: 'like' | 'dislike' | null;
        comment: string;
    };
    failures?: {
        failure_type: string;
        description: string;
        context: string;
        recovery: string;
        attribution?: string;
        attribution_reason?: string;
    }[];
    model?: string;
}

interface ConfigItem {
    id: string;
    query: string;
    skill: string;
    standard_answer: string;
    root_causes?: { content: string; weight: number }[];
    key_actions?: { content: string; weight: number }[];
    parse_status?: 'parsing' | 'completed' | 'failed';
}

interface SkillOption {
    id: string;
    name: string;
    versions: { version: number }[];
}

interface AvgComparison {
    query: string;
    shortQuery: string;
    latestTimestamp: number;
    [key: string]: string | number;
}

const COLORS = ['#38bdf8', '#f472b6', '#4ade80', '#fbbf24', '#818cf8', '#f87171'];

// --- Helpers ---
const formatLatency = (ms: number) => {
    if (ms < 1000) return `${ms.toFixed(0)}ms`;
    const seconds = ms / 1000;
    if (seconds >= 60) {
        const m = Math.floor(seconds / 60);
        const s = Math.round(seconds % 60);
        return s === 0 ? `${m}m` : `${m}m${s}s`;
    }
    return `${seconds.toFixed(1)}s`;
};

const formatTokens = (num: number) => {
    if (num >= 1000) return `${(num / 1000).toFixed(1)}k`;
    return num.toString();
};

const formatDateTime = (ts: string | Date) => {
    if (!ts) return '-';
    const d = new Date(ts);
    return d.getFullYear() + '/' +
        String(d.getMonth() + 1).padStart(2, '0') + '/' +
        String(d.getDate()).padStart(2, '0') + ' ' +
        String(d.getHours()).padStart(2, '0') + ':' +
        String(d.getMinutes()).padStart(2, '0') + ':' +
        String(d.getSeconds()).padStart(2, '0');
};

const generateId = () => Math.random().toString(36).substr(2, 9);

const CustomTooltip = ({ content }: { content: React.ReactNode }) => {
    const [visible, setVisible] = useState(false);
    const triggerRef = useRef<HTMLSpanElement>(null);
    const [coords, setCoords] = useState({ top: 0, left: 0 });

    const handleMouseEnter = () => {
        if (triggerRef.current) {
            const rect = triggerRef.current.getBoundingClientRect();
            setCoords({
                top: rect.top,
                left: rect.left + rect.width / 2
            });
            setVisible(true);
        }
    };

    return (
        <>
            <span
                ref={triggerRef}
                style={{ marginLeft: '4px', cursor: 'help', fontSize: '0.8rem', display: 'inline-block' }}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={() => setVisible(false)}
            >
                ⓘ
            </span>
            {visible && typeof document !== 'undefined' && createPortal(
                <div style={{
                    position: 'fixed',
                    top: coords.top - 8,
                    left: coords.left,
                    transform: 'translate(-50%, -100%)',
                    background: '#0f172a',
                    border: '1px solid #334155',
                    color: '#f1f5f9',
                    padding: '6px 10px',
                    borderRadius: '4px',
                    whiteSpace: 'pre-wrap',
                    minWidth: '200px',
                    textAlign: 'left',
                    zIndex: 9999,
                    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.5)',
                    pointerEvents: 'none'
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
                </div>,
                document.body
            )}
        </>
    );
};

import { useAuth } from '@/lib/auth-context';
import SkillRegistry from './SkillRegistry';

// --- Main Component ---
export default function Dashboard() {
    const { user, apiKey } = useAuth(); // Destructure apiKey from useAuth
    const [localApiKey, setLocalApiKey] = useState<string | null>(null);

    // Setup local state for apiKey after mount to avoid hydration mismatch
    useEffect(() => {
        if (apiKey) setLocalApiKey(apiKey);
        // Fallback or explicit check if useAuth doesn't populate immediately but we want to be sure
        else if (typeof window !== 'undefined') {
            const stored = localStorage.getItem('api_key');
            if (stored) setLocalApiKey(stored);
        }
    }, [apiKey]);

    const [activeTab, setActiveTab] = useState<'dashboard' | 'config' | 'skill'>('dashboard');
    const [showUserModal, setShowUserModal] = useState(false); // State for User Modal

    // Fetch fresh API Key from DB when user modal opens to ensure accuracy
    useEffect(() => {
        if (showUserModal && user) {
            fetch('/api/auth/apikey', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: user })
            })
                .then(res => res.json())
                .then(data => {
                    if (data.apiKey) {
                        setLocalApiKey(data.apiKey);
                        localStorage.setItem('api_key', data.apiKey); // Keep cache in sync with DB
                    }
                })
                .catch(err => console.error("Failed to fetch fresh API key", err));
        }
    }, [showUserModal, user]);

    // Data States
    const [rawData, setRawData] = useState<Execution[]>([]);
    const [loadingData, setLoadingData] = useState(true);

    // Config States
    const [configs, setConfigs] = useState<ConfigItem[]>([]);
    const [availableSkills, setAvailableSkills] = useState<SkillOption[]>([]); // New Skill Options


    // Rejudge State
    const [rejudgingIds, setRejudgingIds] = useState<Set<string>>(new Set());

    // Interactive States
    const [selectedRecord, setSelectedRecord] = useState<Execution | null>(null);

    // Inline Editing
    const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
    const [tempLabelValue, setTempLabelValue] = useState<string>('');

    // Filters
    const [timeFilter, setTimeFilter] = useState('all');
    const [comparisonMode, setComparisonMode] = useState<'latest_10' | 'single' | 'all'>('latest_10');
    const [comparisonQuery, setComparisonQuery] = useState<string>('');

    // Drill-down Filters
    const [selectedFramework, setSelectedFramework] = useState<string>('');
    const [selectedQuery, setSelectedQuery] = useState<string>('');
    const [selectedLabel, setSelectedLabel] = useState<string>(''); // New Label Filter

    // Comparison Options
    const [comparisonGroupByLabel, setComparisonGroupByLabel] = useState(false);
    const [selectedComparisonLabels, setSelectedComparisonLabels] = useState<string[]>([]);
    const [comparisonDimension, setComparisonDimension] = useState<'framework' | 'model'>('framework');

    // Drill-down Classification Options
    const [drillDownGroupByLabel, setDrillDownGroupByLabel] = useState(false);
    const [drillDownGroupByModel, setDrillDownGroupByModel] = useState(false);
    const [selectedDrillDownLabels, setSelectedDrillDownLabels] = useState<string[]>([]);
    const [selectedDrillDownModels, setSelectedDrillDownModels] = useState<string[]>([]);

    // User Feedback State
    const [feedbackComment, setFeedbackComment] = useState('');
    const [copiedApiKey, setCopiedApiKey] = useState(false);

    // Settings Modal State
    const [showSettingsModal, setShowSettingsModal] = useState(false);
    const [isSavingSettings, setIsSavingSettings] = useState(false);
    const [settingsStatus, setSettingsStatus] = useState<{ type: 'success' | 'error', msg: string } | null>(null);

    // New V2 Settings Structure
    interface EvalConfigItem {
        id: string;
        name: string;
        provider: 'deepseek' | 'openai' | 'anthropic' | 'siliconflow' | 'custom';
        apiKey?: string;
        baseUrl?: string;
        model?: string;
    }

    const [allConfigs, setAllConfigs] = useState<EvalConfigItem[]>([]);
    const [activeConfigId, setActiveConfigId] = useState<string>('default');

    // Editing state in modal
    const [editingConfigId, setEditingConfigId] = useState<string | null>(null);
    const [tempConfig, setTempConfig] = useState<EvalConfigItem>({
        id: 'new', name: 'New Config', provider: 'deepseek', model: 'deepseek-chat'
    });


    // Save entire settings verify connection for the *currently edited* config if relevant
    const saveCurrentConfig = async () => {
        setIsSavingSettings(true);
        setSettingsStatus(null);
        try {
            // 1. Prepare new list
            let newConfigs = [...allConfigs];
            const configToSave = { ...tempConfig };

            // If new, generate ID
            if (configToSave.id === 'new') {
                configToSave.id = `config_${Date.now()}`;
                newConfigs.push(configToSave);
            } else {
                newConfigs = newConfigs.map(c => c.id === configToSave.id ? configToSave : c);
            }

            // 2. Test Connection
            const testPayload = {
                provider: configToSave.provider,
                apiKey: configToSave.apiKey,
                baseUrl: configToSave.baseUrl,
                model: configToSave.model
            };

            setSettingsStatus({ type: 'success', msg: 'Testing connection...' }); // reuse success style for info

            const testRes = await fetch('/api/settings/test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(testPayload)
            });
            const testData = await testRes.json();

            if (!testData.success) {
                setSettingsStatus({ type: 'error', msg: `Connection Test Failed: ${testData.error}` });
                setIsSavingSettings(false);
                return;
            }

            // 3. Save to server
            // Automatically activate if it's the first config or currently active is missing
            let newActiveId = activeConfigId;
            if (newConfigs.length === 1 || activeConfigId === 'default') {
                newActiveId = configToSave.id;
            }

            const payload = {
                activeConfigId: newActiveId,
                configs: newConfigs
            };
            const finalPayload = {
                settings: payload,
                user: user
            };

            const res = await fetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(finalPayload)
            });

            if (res.ok) {
                setAllConfigs(newConfigs);
                setActiveConfigId(newActiveId);
                setEditingConfigId(null); // Return to list view
                setSettingsStatus({ type: 'success', msg: 'Saved!' });
                setTimeout(() => setSettingsStatus(null), 1500);
            } else {
                const err = await res.json();
                setSettingsStatus({ type: 'error', msg: `Failed to save settings: ${err.error || res.statusText}` });
            }
        } catch (e: any) {
            setSettingsStatus({ type: 'error', msg: `Error: ${e.message}` });
        } finally {
            setIsSavingSettings(false);
        }
    };

    const activateConfig = async (id: string) => {
        const payload = { activeConfigId: id, configs: allConfigs };
        const finalPayload = { settings: payload, user };
        await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(finalPayload)
        });
        setActiveConfigId(id);
    };

    const deleteEvalConfig = async (id: string) => {
        if (!confirm('Are you sure?')) return;
        const newConfigs = allConfigs.filter(c => c.id !== id);
        let newActive = activeConfigId;
        if (id === activeConfigId) newActive = newConfigs[0]?.id || '';

        const payload = { activeConfigId: newActive, configs: newConfigs };
        await fetch('/api/settings', { method: 'POST', body: JSON.stringify(payload) });
        setAllConfigs(newConfigs);
        setActiveConfigId(newActive);
    };

    useEffect(() => {
        fetchServerSettings(); // fetch on mount to show in header
    }, []);

    // When modal opens, if we have configs, show list. if empty, show edit new.
    useEffect(() => {
        if (showSettingsModal) {
            fetchServerSettings();
            setSettingsStatus(null);
            setEditingConfigId(null);
        }
    }, [showSettingsModal]);

    // Reset comment when record changes
    useEffect(() => {
        if (selectedRecord && selectedRecord.user_feedback) {
            setFeedbackComment(selectedRecord.user_feedback.comment || '');
        } else {
            setFeedbackComment('');
        }
    }, [selectedRecord]);

    // Table Filters & Pagination


    // Inline Editing
    const [tableFramework, setTableFramework] = useState<string>('');
    const [tableLabel, setTableLabel] = useState<string>('');
    const [tableQuery, setTableQuery] = useState<string>('');
    const [tableModel, setTableModel] = useState<string>('');
    const [tablePage, setTablePage] = useState(1);
    const TABLE_PAGE_SIZE = 10;

    // Reset page when filters change
    useEffect(() => {
        setTablePage(1);
    }, [tableFramework, tableLabel, tableQuery, tableModel, timeFilter]);

    // Fetch Data
    const fetchData = async () => {
        setLoadingData(true);
        try {
            // Witty_public special case: if user is 'public', map to 'witty_public'
            // OR if user wants to see public data, maybe we should have a toggle?
            // The prompt says "why I cannot see my date when login as public".
            // Previously we migrated data to 'witty_public'. 
            // So if user logs in as 'public', they are actually 'public' user, but data is in 'witty_public'.
            // Let's assume the user meant they logged in as 'public' but expected to see the 'witty_public' data.
            // Or maybe they logged in as 'witty_public'? 
            // If they logged in as 'witty_public', filtering by 'witty_public' works.
            // If they logged in as 'public', filtering by 'public' returns nothing.
            // Let's aliasing 'public' -> 'witty_public' for view convenience if that was the intention.

            const queryUser = user;

            const url = queryUser ? `/api/data?user=${encodeURIComponent(queryUser)}` : '/api/data';
            const res = await fetch(url, { cache: 'no-store' });
            const d = await res.json();
            const cleanData = d
                .filter((x: any) => x.query && x.query.trim() !== '') // 4. Filter empty queries
                .map((x: any) => {
                    let rawLat = Number(x.latency || 0);
                    // Legacy frameworks (opencode, openhands, or old proxy 'claude') saved as Seconds.
                    // The new local parser correctly saves 'claudecode' as Milliseconds.
                    if (x.framework === 'opencode' || x.framework === 'openhands' || x.framework === 'claude') {
                        rawLat = rawLat * 1000;
                    }

                    return {
                        ...x,
                        tokens: Number(x.tokens || x.Token || 0),
                        latency: rawLat,
                        // 1. Rename framework
                        framework: (x.framework === 'claude' ? 'claudecode' : x.framework) || 'Unknown',
                        model: x.model || 'Unknown',
                        skill_score: x.skill_score !== undefined ? Number(x.skill_score) : undefined,
                        answer_score: x.answer_score === null ? null : (x.answer_score !== undefined ? Number(x.answer_score) : (x.is_answer_correct ? 1.0 : 0.0))
                    };
                });
            setRawData(cleanData);
        } catch (e) {
            console.error("Failed to fetch data", e);
        } finally {
            setLoadingData(false);
        }
    };

    const fetchConfig = () => {
        if (!user) return;
        fetch(`/api/config?user=${encodeURIComponent(user)}`)
            .then(res => res.json())
            .then(d => {
                if (Array.isArray(d)) setConfigs(d);
                else console.error("Invalid config data received:", d);
            })
            .catch(e => console.error("Failed to fetch configs", e));
    };

    const fetchSkills = () => {
        if (!user) return;
        fetch(`/api/skills?user=${encodeURIComponent(user)}`)
            .then(res => res.json())
            .then(d => {
                if (Array.isArray(d)) setAvailableSkills(d);
                else console.error("Invalid skills data received:", d);
            })
            .catch(e => console.error("Failed to fetch skills", e));
    };

    const fetchServerSettings = useCallback(async () => {
        if (!user) return;
        try {
            const res = await fetch(`/api/settings?user=${encodeURIComponent(user)}`);
            if (res.ok) {
                const data = await res.json();
                if (data.configs) {
                    setAllConfigs(data.configs);
                    setActiveConfigId(data.activeConfigId || data.configs[0]?.id || 'default');
                }
            }
        } catch (e) {
            console.error("Failed to fetch settings", e);
        }
    }, [user]);

    useEffect(() => {
        if (user) {
            fetchData();
            fetchConfig();
            fetchSkills();
            fetchServerSettings();
        }
    }, [user, fetchServerSettings]);

    // --- Actions ---
    const handleDelete = async (record: Execution) => {
        if (!confirm('确定要删除这条记录吗?')) return;
        try {
            const res = await fetch(`/api/data?user=${encodeURIComponent(user || '')}`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(record)
            });
            if (res.ok) fetchData();
            else alert('删除失败');
        } catch (e) {
            alert('删除出错');
        }
    };

    const submitFeedback = async (type: 'like' | 'dislike' | null, comment?: string) => {
        if (!selectedRecord) return;
        try {
            const newFeedback = { type, comment: comment !== undefined ? comment : feedbackComment };
            const updatedRecord = { ...selectedRecord, user_feedback: newFeedback };

            // Update UI optimistically
            setSelectedRecord(updatedRecord);
            setRawData(prev => prev.map(d =>
                (d.task_id === selectedRecord.task_id || d.upload_id === selectedRecord.upload_id) ? updatedRecord : d
            ));

            const res = await fetch('/api/data', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    task_id: selectedRecord.task_id,
                    upload_id: selectedRecord.upload_id,
                    user_feedback: newFeedback
                })
            });

            if (!res.ok) {
                console.error('Feedback save failed');
            } else {
                alert('保存成功');
            }
        } catch (e) {
            console.error('Feedback error', e);
        }
    };


    const handleRejudge = async (record: Execution) => {
        const id = record.upload_id || record.task_id || '';
        if (!id) return;
        if (!confirm('确定要重新评估这条记录吗?')) return;

        console.log('Rejudging ID:', id); // Debug check
        setRejudgingIds(prev => {
            const next = new Set(prev);
            next.add(id);
            return next;
        });

        try {
            const res = await fetch('/api/rejudge', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...record, currentUser: user })
            });
            if (res.ok) {
                const data = await res.json();
                const reason = data.record?.judgment_reason || '';
                const noMatch = reason.includes('未找到匹配的评测配置');
                if (noMatch) {
                    alert(`重评完成: 未找到匹配的评测配置，Score 已归零。请在「数据集管理」中为该 query 添加完全一致的条目后再重评。`);
                } else {
                    alert(`重评完成: Score ${data.record.answer_score?.toFixed(2)}`);
                }

                // Update local state immediately
                const updatedRecord = {
                    ...data.record,
                    tokens: Number(data.record.tokens || data.record.Token || 0),
                    latency: Number(data.record.latency || 0),
                    framework: data.record.framework || 'Unknown',
                    skill_score: data.record.skill_score !== undefined ? Number(data.record.skill_score) : undefined,
                    answer_score: data.record.answer_score !== null ? Number(data.record.answer_score) : (data.record.is_answer_correct ? 1.0 : 0.0)
                };

                setRawData(prev => prev.map(r =>
                    (r.upload_id === record.upload_id || r.task_id === record.task_id) ? updatedRecord : r
                ));

                // Update modal if open
                if (selectedRecord && (selectedRecord.task_id === record.task_id || selectedRecord.upload_id === record.upload_id)) {
                    setSelectedRecord(updatedRecord);
                }

                // Also fetch to sync fully
                fetchData();
            } else {
                let errorMsg = '重评失败';
                try {
                    const errData = await res.json();
                    if (errData && errData.error) errorMsg += `: ${errData.error}`;
                } catch (e) { }
                alert(errorMsg);
            }
        } catch (e) {
            alert('重评请求出错');
        } finally {
            setRejudgingIds(prev => {
                const next = new Set(prev);
                next.delete(id);
                return next;
            });
        }
    };

    const handleUpdateLabel = async (record: Execution, newLabel: string) => {
        try {
            // Use PATCH /api/data instead of POST /api/upload to avoid re-triggering judgment
            const payload = {
                task_id: record.task_id,
                upload_id: record.upload_id,
                label: newLabel
            };

            const res = await fetch('/api/data', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (res.ok) {
                setEditingLabelId(null);
                fetchData(); // Refresh to reflect changes
            } else {
                alert('更新标签失败');
            }
        } catch (e) {
            alert('更新标签出错');
        }
    };

    const [editingConfig, setEditingConfig] = useState<Partial<ConfigItem> & { version?: number }>({});
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [isSavingConfig, setIsSavingConfig] = useState(false);
    const [configAnswerMode, setConfigAnswerMode] = useState<'manual' | 'document'>('manual');
    const [configDocumentFile, setConfigDocumentFile] = useState<File | null>(null);
    const pollingTimersRef = useRef<Map<string, NodeJS.Timeout>>(new Map());

    // Cleanup polling timers on unmount
    useEffect(() => {
        return () => {
            pollingTimersRef.current.forEach(timer => clearTimeout(timer));
        };
    }, []);

    // Poll for parsing status of config items
    const pollConfigStatus = useCallback((configId: string) => {
        const poll = async () => {
            try {
                const res = await fetch(`/api/config/status?id=${configId}`);
                if (!res.ok) return;
                const data = await res.json();

                if (data.parse_status === 'completed' || data.parse_status === 'failed') {
                    // Update the config in state (including standard_answer which may have been extracted from document)
                    setConfigs(prev => prev.map(c => c.id === configId ? {
                        ...c,
                        standard_answer: data.standard_answer || c.standard_answer,
                        root_causes: data.root_causes,
                        key_actions: data.key_actions,
                        parse_status: data.parse_status
                    } : c));
                    // Stop polling
                    const timer = pollingTimersRef.current.get(configId);
                    if (timer) clearTimeout(timer);
                    pollingTimersRef.current.delete(configId);
                } else {
                    // Continue polling
                    const timer = setTimeout(poll, 2000);
                    pollingTimersRef.current.set(configId, timer);
                }
            } catch (e) {
                console.error('Config status poll error:', e);
                const timer = setTimeout(poll, 5000);
                pollingTimersRef.current.set(configId, timer);
            }
        };
        // Start first poll after 2s
        const timer = setTimeout(poll, 2000);
        pollingTimersRef.current.set(configId, timer);
    }, []);

    // Start polling for any configs in 'parsing' state on load
    useEffect(() => {
        configs.forEach(c => {
            if (c.parse_status === 'parsing' && !pollingTimersRef.current.has(c.id)) {
                pollConfigStatus(c.id);
            }
        });
    }, [configs, pollConfigStatus]);


    const saveConfig = async () => {
        if (!editingConfig.query?.trim()) return alert('问题 (Query) 不能为空');

        // 新增模式下校验问题是否已存在（trim 后比较，防止前后空格绕过）
        if (!editingConfig.id) {
            const trimmedQuery = editingConfig.query.trim();
            const isDuplicate = configs.some(c => c.query.trim() === trimmedQuery);
            if (isDuplicate) {
                return alert('该问题已存在于数据集中，请修改后再保存');
            }
            // 自动 trim 问题
            editingConfig.query = trimmedQuery;
        }

        setIsSavingConfig(true);

        try {
            if (!editingConfig.id) {
                // --- NEW CREATE MODE ---
                // Validate: need standard answer OR document
                if (configAnswerMode === 'manual' && !editingConfig.standard_answer?.trim()) {
                    setIsSavingConfig(false);
                    return alert('请填写标准答案');
                }
                if (configAnswerMode === 'document' && !configDocumentFile) {
                    setIsSavingConfig(false);
                    return alert('请上传案例文档');
                }

                let res: Response;
                if (configAnswerMode === 'document' && configDocumentFile) {
                    // Use FormData for file upload
                    const formData = new FormData();
                    formData.append('query', editingConfig.query);
                    formData.append('document', configDocumentFile);
                    if (user) formData.append('user', user);
                    res = await fetch('/api/config/create', { method: 'POST', body: formData });
                } else {
                    res = await fetch('/api/config/create', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            query: editingConfig.query,
                            standardAnswer: editingConfig.standard_answer,
                            user
                        })
                    });
                }

                if (res.ok) {
                    const newConfig = await res.json();
                    if (newConfig && newConfig.id) {
                        setConfigs(prev => [newConfig, ...prev]);
                        // Start polling for parsing status
                        if (newConfig.parse_status === 'parsing') {
                            pollConfigStatus(newConfig.id);
                        }
                    }
                    setIsEditModalOpen(false);
                    setEditingConfig({});
                    setConfigDocumentFile(null);
                    setConfigAnswerMode('manual');
                } else {
                    const err = await res.json();
                    alert(`保存失败: ${err.error || 'Unknown error'}`);
                }
            } else {
                // --- EDIT MODE ---
                let newConfigs = [...configs];
                newConfigs = newConfigs.map(c => c.id === editingConfig.id ? { ...c, ...editingConfig } as ConfigItem : c);

                const res = await fetch('/api/config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ configs: newConfigs, user })
                });
                if (res.ok) {
                    setConfigs(newConfigs);
                    setIsEditModalOpen(false);
                    setEditingConfig({});
                } else {
                    alert('保存失败');
                }
            }
        } catch (e: any) {
            console.error(e);
            alert('保存出错: ' + e.message);
        } finally {
            setIsSavingConfig(false);
        }
    };


    const deleteConfig = async (id: string) => {
        if (!confirm('确定删除此配置?')) return;
        const newConfigs = configs.filter(c => c.id !== id);
        const res = await fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ configs: newConfigs, user }) // Include user in the body
        });
        if (res.ok) setConfigs(newConfigs);
    };

    // --- Derived Data ---
    const allFrameworks = useMemo(() => Array.from(new Set(rawData.map(d => d.framework))).sort(), [rawData]);

    const allQueries = useMemo(() => Array.from(new Set(rawData.map(d => d.query))).sort(), [rawData]);

    // Dynamic Labels for Dropdown
    // Should depend on the Comparison Mode Dataset
    const filteredData = useMemo(() => {
        if (timeFilter === 'all') return rawData;
        const now = Date.now();
        const map = {
            '1h': 60 * 60 * 1000,
            '3h': 3 * 60 * 60 * 1000,
            '24h': 24 * 60 * 60 * 1000,
        };
        const threshold = now - (map[timeFilter as keyof typeof map] || 0);
        return rawData.filter(d => new Date(d.timestamp).getTime() > threshold);
    }, [rawData, timeFilter]);

    const allLabels = useMemo(() => {
        const labels = new Set<string>();
        filteredData.forEach(d => {
            if (d.label) labels.add(d.label);
        });
        return Array.from(labels).sort();
    }, [filteredData]);

    const allModels = useMemo(() => {
        const models = new Set<string>();
        filteredData.forEach(d => {
            if (d.model) models.add(d.model);
        });
        return Array.from(models).sort();
    }, [filteredData]);

    // Series to use for comparison
    const comparisonSeries = comparisonDimension === 'framework' ? allFrameworks : allModels;

    // Dynamic Labels for Dropdown
    // Should depend on the Comparison Mode Dataset
    const comparisonAvailableLabels = useMemo(() => {
        let dataset = filteredData;

        if (comparisonMode === 'single') {
            dataset = dataset.filter(d => d.query === comparisonQuery);
        }

        return Array.from(new Set(dataset.map(d => d.label || 'Other'))).sort();
    }, [filteredData, comparisonMode, comparisonQuery]);

    // Dynamic Labels for Drill Down Dropdown (Context Aware)
    const drillDownAvailableLabels = useMemo(() => {
        let dataset = filteredData;
        if (selectedQuery) {
            dataset = dataset.filter(d => d.query === selectedQuery);
        }
        if (selectedFramework) {
            dataset = dataset.filter(d => d.framework === selectedFramework);
        }
        return Array.from(new Set(dataset.map(d => d.label || 'Other'))).sort();
    }, [filteredData, selectedQuery, selectedFramework]);

    const drillDownAvailableModels = useMemo(() => {
        let dataset = filteredData;
        if (selectedQuery) {
            dataset = dataset.filter(d => d.query === selectedQuery);
        }
        if (selectedFramework) {
            dataset = dataset.filter(d => d.framework === selectedFramework);
        }
        return Array.from(new Set(dataset.map(d => d.model || 'Unknown'))).sort();
    }, [filteredData, selectedQuery, selectedFramework]);

    const filteredQueries = useMemo(() => {
        let dataset = filteredData;
        if (selectedFramework) {
            dataset = dataset.filter(d => d.framework === selectedFramework);
        }
        return Array.from(new Set(dataset.map(d => d.query))).sort();
    }, [filteredData, selectedFramework]);

    // Init Defaults
    useEffect(() => {
        if ((!selectedFramework || !allFrameworks.includes(selectedFramework)) && allFrameworks.length > 0) setSelectedFramework(allFrameworks[0]);
        if (!comparisonQuery && allQueries.length > 0) setComparisonQuery(allQueries[0]);
    }, [allFrameworks, allQueries]);

    useEffect(() => {
        if ((!selectedQuery || !filteredQueries.includes(selectedQuery)) && filteredQueries.length > 0) setSelectedQuery(filteredQueries[0]);
    }, [filteredQueries]);

    // Comparison Data Logic
    const comparisonData = useMemo(() => {
        let dataToUse = filteredData;

        // Filter by mode first
        if (comparisonMode === 'single') {
            dataToUse = dataToUse.filter(d => d.query === comparisonQuery);
        } else if (comparisonMode === 'latest_10') {
            // For 'latest_10', we need to get the latest 10 unique queries first, then filter data
            const uniqueQueriesSortedByLatestTimestamp = Array.from(new Set(dataToUse.map(d => d.query)))
                .map(q => ({
                    query: q,
                    latestTimestamp: Math.max(...dataToUse.filter(d => d.query === q).map(x => new Date(x.timestamp).getTime()))
                }))
                .sort((a, b) => b.latestTimestamp - a.latestTimestamp)
                .slice(0, 10)
                .map(item => item.query);
            dataToUse = dataToUse.filter(d => uniqueQueriesSortedByLatestTimestamp.includes(d.query));
        }

        // Use comparisonSeries instead of allFrameworks
        const relevantSeries = comparisonSeries;

        // Group by Label if needed
        if (comparisonGroupByLabel) {
            const result: any[] = [];
            // Get labels from data
            const labels = Array.from(new Set(dataToUse.map(d => d.label || 'Other'))).sort();

            labels.forEach(lbl => {
                if (selectedComparisonLabels.length > 0 && !selectedComparisonLabels.includes(lbl)) return;

                const lblData = dataToUse.filter(d => (d.label || 'Other') === lbl);
                if (lblData.length === 0) return;

                const row: any = { label: lbl, data: [] };
                // We need to aggregate per Query to get points for the chart?
                // Actually the previous logic was: X-axis is Query (or Index), Lines are Frameworks.
                // So for this label, we gather unique queries.
                const lblQueries = Array.from(new Set(lblData.map(d => d.query)));

                lblQueries.forEach(q => {
                    const qRecord: any = { shortQuery: q.length > 15 ? q.substring(0, 15) + '...' : q };
                    relevantSeries.forEach(seriesName => {
                        const fwOrModelData = lblData.filter(d => d.query === q && (comparisonDimension === 'framework' ? d.framework : (d.model || 'Unknown')) === seriesName);
                        if (fwOrModelData.length > 0) {
                            const avgLat = fwOrModelData.reduce((s, x) => s + x.latency, 0) / fwOrModelData.length;
                            const avgTok = fwOrModelData.reduce((s, x) => s + x.tokens, 0) / fwOrModelData.length;
                            const evaluatedDatas = fwOrModelData.filter(d => d.answer_score !== null);
                            const avgScore = evaluatedDatas.length ? evaluatedDatas.reduce((s, x) => s + (x.answer_score || 0), 0) / evaluatedDatas.length : 0;

                            qRecord[`${seriesName}_lat`] = parseFloat(avgLat.toFixed(2));
                            qRecord[`${seriesName}_tok`] = Math.round(avgTok);
                            qRecord[`${seriesName}_score`] = parseFloat(avgScore.toFixed(2));
                        }
                    });
                    if (Object.keys(qRecord).length > 1) { // Check if any series data was added
                        row.data.push(qRecord);
                    }
                });
                if (row.data.length > 0) {
                    result.push(row);
                }
            });
            return result;
        } else {
            // ORIGINAL LOGIC (Group by Query)
            const groups: Record<string, Execution[]> = {};
            dataToUse.forEach(d => {
                if (!groups[d.query]) groups[d.query] = [];
                groups[d.query].push(d);
            });

            const result: AvgComparison[] = [];
            Object.keys(groups).forEach(q => {
                const group = groups[q];
                const latestTs = Math.max(...group.map(x => new Date(x.timestamp).getTime()));
                const row: AvgComparison = {
                    query: q,
                    shortQuery: q.length > 15 ? q.substring(0, 15) + '...' : q,
                    latestTimestamp: latestTs
                };

                let hasData = false;
                relevantSeries.forEach(seriesName => {
                    const fwOrModelData = group.filter(d => (comparisonDimension === 'framework' ? d.framework : (d.model || 'Unknown')) === seriesName);
                    if (fwOrModelData.length > 0) {
                        const avgLat = fwOrModelData.reduce((s, x) => s + x.latency, 0) / fwOrModelData.length;
                        const avgTok = fwOrModelData.reduce((s, x) => s + x.tokens, 0) / fwOrModelData.length;
                        const recall = (fwOrModelData.filter(d => d.is_skill_correct).length / fwOrModelData.length) * 100;
                        const evaluatedDatas = fwOrModelData.filter(d => d.answer_score !== null);
                        const avgScore = evaluatedDatas.length ? evaluatedDatas.reduce((s, x) => s + (x.answer_score || 0), 0) / evaluatedDatas.length : 0;

                        row[`${seriesName}_lat`] = parseFloat(avgLat.toFixed(2));
                        row[`${seriesName}_tok`] = Math.round(avgTok);
                        row[`${seriesName}_recall`] = parseFloat(recall.toFixed(1));
                        row[`${seriesName}_score`] = parseFloat(avgScore.toFixed(2));
                        hasData = true;
                    }
                });
                if (hasData) result.push(row);
            });

            result.sort((a, b) => b.latestTimestamp - a.latestTimestamp);

            if (comparisonMode === 'latest_10') return result.slice(0, 10);
            return result;
        }
    }, [filteredData, comparisonMode, comparisonQuery, comparisonGroupByLabel, selectedComparisonLabels, comparisonSeries, comparisonDimension]);


    // Single Query Drill-down Data
    const singleQueryStats = useMemo(() => {
        if (!selectedQuery) return null;

        // Start with all data for this query
        let relevant = filteredData.filter(d => d.query === selectedQuery);

        // Apply Framework Filter (Optional)
        if (selectedFramework) {
            relevant = relevant.filter(d => d.framework === selectedFramework);
        }

        if (relevant.length === 0) return null;

        const totalLat = relevant.reduce((sum, d) => sum + d.latency, 0);
        const sorted = [...relevant].sort((a, b) => a.latency - b.latency);

        const correctSkillCount = relevant.filter(d => d.is_skill_correct).length;

        return {
            count: relevant.length,
            avgLatency: totalLat / relevant.length,
            avgTokens: Math.round(relevant.reduce((sum, d) => sum + d.tokens, 0) / relevant.length),
            skillRecall: (correctSkillCount / relevant.length) * 100,
            avgAnsScore: relevant.filter(d => d.answer_score !== null).length ? (relevant.filter(d => d.answer_score !== null).reduce((sum, d) => sum + (d.answer_score || 0), 0) / relevant.filter(d => d.answer_score !== null).length) : 0,
            best: sorted[0], // Best by Latency
            worst: sorted[sorted.length - 1], // Worst by Latency
            avgSkillScore: (relevant.reduce((sum, d) => sum + (d.skill_score || 0), 0) / relevant.filter(d => d.skill_score !== undefined).length) || 0
        };
    }, [filteredData, selectedFramework, selectedQuery]);

    // Derived Table Data
    const tableFilteredData = useMemo(() => {
        return filteredData.filter(d => {
            if (tableFramework && d.framework !== tableFramework) return false;
            if (tableLabel && d.label !== tableLabel) return false;
            if (tableModel && d.model !== tableModel) return false;
            if (tableQuery && !d.query.toLowerCase().includes(tableQuery.toLowerCase())) return false;
            return true;
        });
    }, [filteredData, tableFramework, tableLabel, tableModel, tableQuery]);

    const totalTablePages = Math.ceil(tableFilteredData.length / TABLE_PAGE_SIZE);
    const currentTableData = tableFilteredData.slice((tablePage - 1) * TABLE_PAGE_SIZE, tablePage * TABLE_PAGE_SIZE);

    // --- External Components ---
    const ChartLayout = ({ title, dataKey, unit = '', data, frameworks, yFormatter }: { title: React.ReactNode, dataKey: string, unit?: string, data: any[], frameworks: string[], yFormatter?: (val: number) => string }) => (
        <div className="card" style={{ height: '350px', display: 'flex', flexDirection: 'column' }}>
            <div className="card-title" style={{ marginBottom: '10px' }}>{title}</div>
            <div style={{ flex: 1, minHeight: 0 }}>
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 20 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                        <XAxis dataKey="shortQuery" stroke="#94a3b8" fontSize={11} angle={-20} textAnchor="end" height={60} />
                        <YAxis stroke="#94a3b8" tickFormatter={yFormatter} />
                        <Tooltip
                            formatter={(val: any, name: any) => [val !== undefined ? val + unit : '-', name || '']}
                            contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', color: '#f8fafc' }}
                        />
                        <Legend />
                        {frameworks.map((fw, i) => (
                            <Bar key={fw} dataKey={`${fw}_${dataKey}`} name={fw} fill={COLORS[i % COLORS.length]} radius={[4, 4, 0, 0]} />
                        ))}
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
    );



    return (
        <div className="dashboard-container">
            {/* Header */}
            <header className="header" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <h1 className="title" style={{ marginBottom: 0 }}>Witty-Skill-Insight</h1>
                        <span style={{ fontSize: '0.8rem', color: '#94a3b8', letterSpacing: '1px' }}>智能体技能评估、分析与优化</span>
                    </div>

                    {/* Main Navigation Tabs */}
                    <div className="tabs">
                        <button
                            className={`tab-btn ${activeTab === 'dashboard' ? 'active' : ''}`}
                            onClick={() => setActiveTab('dashboard')}
                        >
                            数据概览
                        </button>
                        <button
                            className={`tab-btn ${activeTab === 'config' ? 'active' : ''}`}
                            onClick={() => setActiveTab('config')}
                        >
                            数据集管理
                        </button>
                        <button
                            className={`tab-btn ${activeTab === 'skill' ? 'active' : ''}`}
                            onClick={() => setActiveTab('skill')}
                        >
                            技能管理
                        </button>
                    </div>
                </div>
                {activeTab === 'dashboard' && (
                    <div className="controls" style={{ display: 'flex', gap: '8px' }}>
                        <select value={timeFilter} onChange={(e) => setTimeFilter(e.target.value)}>
                            <option value="all">全部时间</option>
                            <option value="24h">24H</option>
                            <option value="3h">3H</option>
                            <option value="1h">1H</option>
                        </select>
                        {allConfigs.length > 0 ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', border: '1px solid #334155', borderRadius: '4px', padding: '4px 8px', background: '#0f172a' }}>
                                <span style={{ fontSize: '0.8rem', color: '#64748b' }}>Eval:</span>
                                <select
                                    value={activeConfigId || 'none'}
                                    onChange={(e) => activateConfig(e.target.value)}
                                    style={{ background: 'transparent', color: '#e2e8f0', border: 'none', maxWidth: '140px', outline: 'none', cursor: 'pointer' }}
                                >
                                    <option value="none">不进行评估 (No Eval)</option>
                                    {allConfigs.map(c => (
                                        <option key={c.id} value={c.id}>{c.name}</option>
                                    ))}
                                </select>
                                <div style={{ width: '1px', height: '14px', background: '#334155', margin: '0 4px' }}></div>
                                <button
                                    onClick={() => setShowSettingsModal(true)}
                                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '0', fontSize: '1rem' }}
                                    title="Manage Configurations"
                                >
                                    ⚙️
                                </button>
                            </div>
                        ) : (
                            <button
                                className="btn-secondary"
                                style={{
                                    padding: '4px 8px',
                                    background: 'transparent',
                                    border: '1px solid #334155',
                                    color: '#94a3b8'
                                }}
                                onClick={() => setShowSettingsModal(true)}
                            >
                                ⚙️ Eval Config
                            </button>
                        )}
                    </div>
                )}
            </header>

            {/* SETTINGS MODAL */}
            {showSettingsModal && (
                <div style={{
                    position: 'fixed',
                    top: 0, left: 0, right: 0, bottom: 0,
                    background: 'rgba(0,0,0,0.7)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 2000
                }} onClick={(e) => {
                    if (e.target === e.currentTarget) setShowSettingsModal(false);
                }}>
                    <div className="card" style={{ width: '600px', maxHeight: '90vh', overflowY: 'auto' }}>

                        {/* VIEW 1: LIST OF CONFIGS */}
                        {!editingConfigId && (
                            <>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem', alignItems: 'center' }}>
                                    <h3 style={{ margin: 0, color: '#f1f5f9' }}>Manage Evaluation Models</h3>
                                    <button onClick={() => setShowSettingsModal(false)} style={{ background: 'transparent', border: 'none', color: '#94a3b8', fontSize: '1.2rem', cursor: 'pointer' }}>✕</button>
                                </div>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '1.5rem' }}>
                                    {allConfigs.map(config => (
                                        <div key={config.id} style={{
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            alignItems: 'center',
                                            padding: '10px',
                                            background: activeConfigId === config.id ? 'rgba(59, 130, 246, 0.1)' : '#1e293b',
                                            border: activeConfigId === config.id ? '1px solid #3b82f6' : '1px solid #334155',
                                            borderRadius: '6px'
                                        }}>
                                            <div>
                                                <div style={{ fontWeight: 'bold', color: activeConfigId === config.id ? '#60a5fa' : '#f1f5f9' }}>
                                                    {config.name} {activeConfigId === config.id && '(Active)'}
                                                </div>
                                                <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                                                    {config.provider} • {config.model}
                                                </div>
                                            </div>

                                            <div style={{ display: 'flex', gap: '8px' }}>
                                                {activeConfigId !== config.id && (
                                                    <button
                                                        className="btn-secondary"
                                                        style={{ padding: '4px 8px', fontSize: '0.8rem' }}
                                                        onClick={() => activateConfig(config.id)}
                                                    >
                                                        Activate
                                                    </button>
                                                )}
                                                <button
                                                    className="btn-secondary"
                                                    style={{ padding: '4px 8px', fontSize: '0.8rem' }}
                                                    onClick={() => {
                                                        setTempConfig({ ...config });
                                                        setEditingConfigId(config.id);
                                                        setSettingsStatus(null);
                                                    }}
                                                >
                                                    Edit
                                                </button>
                                                <button
                                                    className="btn-secondary"
                                                    style={{ padding: '4px 8px', fontSize: '0.8rem', color: '#f87171', borderColor: '#7f1d1d' }}
                                                    onClick={() => deleteEvalConfig(config.id)}
                                                >
                                                    Del
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                <button
                                    className="btn-primary"
                                    style={{ width: '100%', display: 'flex', justifyContent: 'center', gap: '8px' }}
                                    onClick={() => {
                                        setTempConfig({
                                            id: 'new',
                                            name: 'New Configuration',
                                            provider: 'deepseek',
                                            model: 'deepseek-chat',
                                            apiKey: '',
                                            baseUrl: 'https://api.deepseek.com'
                                        });
                                        setEditingConfigId('new');
                                        setSettingsStatus(null);
                                    }}
                                >
                                    + Add New Configuration
                                </button>
                            </>
                        )}

                        {/* VIEW 2: EDITING FORM */}
                        {editingConfigId && (
                            <>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem', alignItems: 'center' }}>
                                    <h3 style={{ margin: 0, color: '#f1f5f9' }}>{editingConfigId === 'new' ? 'New Configuration' : 'Edit Configuration'}</h3>
                                    <button
                                        onClick={() => setEditingConfigId(null)}
                                        style={{ background: 'transparent', border: 'none', color: '#94a3b8', fontSize: '0.9rem', cursor: 'pointer' }}
                                    >
                                        Back to List
                                    </button>
                                </div>

                                {/* Status Message Display */}
                                {settingsStatus && (
                                    <div style={{
                                        padding: '10px',
                                        marginBottom: '1rem',
                                        borderRadius: '4px',
                                        background: settingsStatus.type === 'success' ? 'rgba(74, 222, 128, 0.1)' : 'rgba(248, 113, 113, 0.1)',
                                        border: `1px solid ${settingsStatus.type === 'success' ? '#4ade80' : '#f87171'}`,
                                        color: settingsStatus.type === 'success' ? '#4ade80' : '#f87171',
                                        fontSize: '0.9rem'
                                    }}>
                                        {settingsStatus.msg}
                                    </div>
                                )}

                                <div className="form-group">
                                    <label>Config Name</label>
                                    <input
                                        placeholder="e.g. My DeepSeek, Company OpenAI Proxy"
                                        value={tempConfig.name || ''}
                                        onChange={e => setTempConfig({ ...tempConfig, name: e.target.value })}
                                        style={{ width: '100%', padding: '10px', background: '#0f172a', border: '1px solid #334155', color: 'white', borderRadius: '4px' }}
                                    />
                                </div>

                                <div className="form-group">
                                    <label>Provider</label>
                                    <select
                                        value={tempConfig.provider}
                                        onChange={e => {
                                            const p = e.target.value as any;
                                            const updates: any = { provider: p };
                                            if (p === 'deepseek') {
                                                updates.baseUrl = 'https://api.deepseek.com';
                                                updates.model = 'deepseek-chat';
                                            } else if (p === 'siliconflow') {
                                                updates.baseUrl = 'https://api.siliconflow.cn/v1';
                                                updates.model = 'deepseek-ai/DeepSeek-V3';
                                            } else if (p === 'openai') {
                                                updates.baseUrl = 'https://api.openai.com/v1';
                                                updates.model = 'gpt-4o';
                                            } else if (p === 'anthropic') {
                                                updates.baseUrl = 'https://api.anthropic.com/v1';
                                                updates.model = 'claude-3-5-sonnet-20240620';
                                            }
                                            setTempConfig({ ...tempConfig, ...updates });
                                        }}
                                        style={{ width: '100%', padding: '10px', background: '#0f172a', border: '1px solid #334155', color: 'white', borderRadius: '4px' }}
                                    >
                                        <option value="deepseek">DeepSeek (Official)</option>
                                        <option value="siliconflow">SiliconFlow (DeepSeek V3 High Speed)</option>
                                        <option value="openai">OpenAI</option>
                                        <option value="anthropic">Anthropic</option>
                                        <option value="custom">Custom (OpenAI Compatible)</option>
                                    </select>
                                </div>

                                <div className="form-group">
                                    <label>Base URL (Optional)</label>
                                    <input
                                        placeholder="e.g. https://api.deepseek.com or https://api.openai.com/v1"
                                        value={tempConfig.baseUrl || ''}
                                        onChange={e => {
                                            let val = e.target.value;
                                            // Normalize: strip /chat/completions or /v1 if user pasted full endpoint
                                            val = val.replace(/\/chat\/completions\/?$/, '').replace(/\/v1\/?$/, '');
                                            setTempConfig({ ...tempConfig, baseUrl: val });
                                        }}
                                        style={{ width: '100%', padding: '10px', background: '#0f172a', border: '1px solid #334155', color: 'white', borderRadius: '4px' }}
                                    />
                                </div>

                                <div className="form-group">
                                    <label>API Key</label>
                                    <input
                                        type="password"
                                        placeholder="sk-..."
                                        value={tempConfig.apiKey || ''}
                                        onChange={e => setTempConfig({ ...tempConfig, apiKey: e.target.value })}
                                        style={{ width: '100%', padding: '10px', background: '#0f172a', border: '1px solid #334155', color: 'white', borderRadius: '4px' }}
                                    />
                                </div>

                                <div className="form-group">
                                    <label>Model Name</label>
                                    <input
                                        placeholder="e.g. deepseek-chat, gpt-4o"
                                        value={tempConfig.model || ''}
                                        onChange={e => setTempConfig({ ...tempConfig, model: e.target.value })}
                                        style={{ width: '100%', padding: '10px', background: '#0f172a', border: '1px solid #334155', color: 'white', borderRadius: '4px' }}
                                    />
                                </div>

                                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '2rem' }}>
                                    <button className="btn-secondary" onClick={() => setEditingConfigId(null)}>Cancel</button>
                                    <button
                                        className="btn-primary"
                                        onClick={saveCurrentConfig}
                                        disabled={isSavingSettings}
                                        style={{ opacity: isSavingSettings ? 0.7 : 1, display: 'flex', alignItems: 'center', gap: '6px' }}
                                    >
                                        {isSavingSettings && <span style={{
                                            width: '12px', height: '12px', border: '2px solid white', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite'
                                        }}></span>}
                                        {isSavingSettings ? 'Testing & Saving...' : 'Test Connection & Save'}
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* DASHBOARD */}
            {activeTab === 'dashboard' && (
                <>
                    {/* 1. Global Cards */}
                    <h2 className="section-title">全景概览</h2>
                    <div className="grid">
                        {allFrameworks.map((fw, idx) => {
                            const fwData = filteredData.filter(d => d.framework === fw);
                            const avgLat = fwData.length ? (fwData.reduce((s, x) => s + x.latency, 0) / fwData.length) : 0;
                            const avgTok = fwData.length ? (fwData.reduce((s, x) => s + x.tokens, 0) / fwData.length) : 0;
                            const skillRecall = fwData.length ? (fwData.filter(d => d.is_skill_correct).length / fwData.length * 100) : 0;
                            const evaluatedFwData = fwData.filter(d => d.answer_score !== null);
                            const avgScore = evaluatedFwData.length ? (evaluatedFwData.reduce((s, x) => s + (x.answer_score || 0), 0) / evaluatedFwData.length) : 0;

                            return (
                                <div className="card" key={fw} style={{ borderLeft: `4px solid ${COLORS[idx % COLORS.length]}` }}>
                                    <div className="card-title" style={{ color: COLORS[idx % COLORS.length] }}>{fw}</div>
                                    <div className="stat-value">{fwData.length} <small style={{ fontSize: '1rem', color: '#64748b' }}>Executions</small></div>
                                    <div style={{ marginTop: '1rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.2rem' }}>
                                        {/* Latency */}
                                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                                            <span style={{ fontSize: '0.8rem', color: '#94a3b8', textTransform: 'uppercase' }}>时延</span>
                                            <span style={{ fontSize: '1.5rem', fontWeight: 700, color: '#f1f5f9' }}>{formatLatency(avgLat)}</span>
                                        </div>
                                        {/* Token */}
                                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                                            <span style={{ fontSize: '0.8rem', color: '#94a3b8', textTransform: 'uppercase' }}>TOKEN</span>
                                            <span style={{ fontSize: '1.5rem', fontWeight: 700, color: '#f1f5f9' }}>{formatTokens(Math.round(avgTok))}</span>
                                        </div>
                                    </div>
                                    <div style={{ marginTop: '0.8rem', paddingTop: '0.8rem', borderTop: '1px solid #334155' }}>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.2rem', alignItems: 'center' }}>
                                            {/* Accuracy Label - Aligned with Latency (Left) */}
                                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                <span style={{ fontSize: '0.9rem', color: '#cbd5e1' }}>准确率</span>
                                            </div>
                                            {/* Score Value - Aligned with Token (Right) */}
                                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                <span style={{ fontSize: '1.8rem', fontWeight: 800, color: avgScore > 0.8 ? '#4ade80' : '#fbbf24' }}>
                                                    {(avgScore * 100).toFixed(1)}%
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {/* 2. Charts (Split 4 ways) */}
                    <h2 className="section-title">对比分析</h2>
                    <div className="analysis-controls">
                        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                            {['latest_10', 'all', 'single'].map(m => (
                                <label key={m} style={{ cursor: 'pointer', color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '5px' }}>
                                    <input type="radio" checked={comparisonMode === m} onChange={() => setComparisonMode(m as any)} />
                                    {m === 'latest_10' ? '最新10问' : m === 'all' ? '所有' : '单问题'}
                                </label>
                            ))}
                        </div>
                        {comparisonMode === 'single' && (
                            <select value={comparisonQuery} onChange={e => setComparisonQuery(e.target.value)} style={{ maxWidth: '300px' }}>
                                {allQueries.map(q => <option key={q} value={q}>{q.substring(0, 40)}</option>)}
                            </select>
                        )}

                        <div style={{ marginLeft: '10px', display: 'flex', gap: '8px', borderLeft: '1px solid #475569', paddingLeft: '10px' }}>
                            <span style={{ color: '#94a3b8', fontSize: '0.9rem', display: 'flex', alignItems: 'center' }}>Group By:</span>
                            <button
                                className={`tab-btn-sm ${comparisonDimension === 'framework' ? 'active' : ''}`}
                                onClick={() => setComparisonDimension('framework')}
                                style={{ padding: '2px 8px', fontSize: '0.8rem', background: comparisonDimension === 'framework' ? '#38bdf8' : 'transparent', color: comparisonDimension === 'framework' ? '#0f172a' : '#94a3b8', border: '1px solid #38bdf8' }}
                            >
                                Framework
                            </button>
                            <button
                                className={`tab-btn-sm ${comparisonDimension === 'model' ? 'active' : ''}`}
                                onClick={() => setComparisonDimension('model')}
                                style={{ padding: '2px 8px', fontSize: '0.8rem', background: comparisonDimension === 'model' ? '#38bdf8' : 'transparent', color: comparisonDimension === 'model' ? '#0f172a' : '#94a3b8', border: '1px solid #38bdf8' }}
                            >
                                Model
                            </button>
                        </div>


                        <div style={{ marginLeft: '10px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <label style={{ cursor: 'pointer', color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '5px' }}>
                                <input type="checkbox" checked={comparisonGroupByLabel} onChange={(e) => {
                                    setComparisonGroupByLabel(e.target.checked);
                                    if (e.target.checked && selectedComparisonLabels.length === 0) {
                                        // Default to select all if none selected initially? Or let user pick.
                                        // Let's default to empty means ALL for now, or we force selection.
                                    }
                                }} />
                                按标签分类
                            </label>

                            {comparisonGroupByLabel && (
                                <div style={{ position: 'relative', display: 'inline-block' }}>
                                    <div className="dropdown-trigger" style={{ background: '#1e293b', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', border: '1px solid #334155', minWidth: '150px' }}>
                                        {selectedComparisonLabels.length === 0 ? '所有标签 (All)' : `已选 ${selectedComparisonLabels.length} 个`}
                                        <span style={{ float: 'right', fontSize: '0.8rem' }}>▼</span>
                                    </div>
                                    <div className="dropdown-content" style={{
                                        position: 'absolute', top: '100%', left: 0, zIndex: 10,
                                        background: '#1e293b', border: '1px solid #334155', borderRadius: '4px',
                                        padding: '0.5rem', minWidth: '200px', maxHeight: '300px', overflowY: 'auto',
                                        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.5)'
                                    }}>
                                        <label style={{ display: 'block', marginBottom: '4px', cursor: 'pointer' }}>
                                            <input type="checkbox"
                                                checked={selectedComparisonLabels.length === 0}
                                                onChange={() => setSelectedComparisonLabels([])}
                                            /> <span style={{ marginLeft: '4px' }}>所有标签 (All)</span>
                                        </label>
                                        <hr style={{ borderColor: '#334155', margin: '4px 0' }} />
                                        {comparisonAvailableLabels.map(l => (
                                            <label key={l} style={{ display: 'block', marginBottom: '4px', cursor: 'pointer' }}>
                                                <input type="checkbox"
                                                    checked={selectedComparisonLabels.includes(l)}
                                                    onChange={(e) => {
                                                        if (e.target.checked) {
                                                            setSelectedComparisonLabels([...selectedComparisonLabels, l]);
                                                        } else {
                                                            setSelectedComparisonLabels(selectedComparisonLabels.filter(x => x !== l));
                                                        }
                                                    }}
                                                /> <span style={{ marginLeft: '4px' }}>{l}</span>
                                            </label>
                                        ))}
                                    </div>

                                </div>
                            )}
                        </div>
                    </div>

                    {comparisonGroupByLabel ? (
                        // Grouped By Label View (Rows of Charts)
                        <div>
                            {comparisonData.map((group: any) => (
                                <div key={group.label} style={{ marginBottom: '2rem' }}>
                                    <h3 style={{ color: '#f8fafc', borderBottom: '1px solid #334155', paddingBottom: '0.5rem', marginBottom: '1rem' }}>
                                        Tag: <span style={{ color: '#38bdf8' }}>{group.label}</span>
                                    </h3>
                                    <div className="analysis-grid">
                                        <ChartLayout title="平均时延" unit="s" dataKey="lat" data={group.data} frameworks={comparisonSeries} />
                                        <ChartLayout title="平均消耗 (Tokens)" dataKey="tok" data={group.data} frameworks={comparisonSeries} yFormatter={formatTokens} />
                                        <ChartLayout title="平均准确率" dataKey="score" unit="" data={group.data} frameworks={comparisonSeries} />
                                    </div>
                                </div>
                            ))}
                            {comparisonData.length === 0 && <div className="card" style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>无数据</div>}
                        </div>
                    ) : (
                        // Default View
                        comparisonData.length > 0 ? (
                            <div className="analysis-grid">
                                <ChartLayout
                                    title={<span>平均时延 <CustomTooltip content="基于选中查询的所有执行结果计算出的平均总响应耗时（秒）" /></span>}
                                    dataKey="lat"
                                    unit="s"
                                    data={comparisonData}
                                    frameworks={comparisonSeries}
                                    yFormatter={(v) => Number(v).toFixed(1) + 's'}
                                />
                                <ChartLayout
                                    title={<span>平均消耗 (Tokens) <CustomTooltip content="基于选中查询的所有执行结果计算出的平均 Token 消耗总额" /></span>}
                                    dataKey="tok"
                                    unit=""
                                    data={comparisonData}
                                    frameworks={comparisonSeries}
                                    yFormatter={formatTokens}
                                />
                                <ChartLayout
                                    title={<span>平均准确率 <CustomTooltip content={<div>基于LLM评估所有执行结果与期望答案的差异，计算出的0-1分值的平均值，1表示完全正确。<br />"--"表示评估失败，可能是由于模型未配置或者数据项未配置。</div>} /></span>}
                                    dataKey="score"
                                    unit=""
                                    data={comparisonData}
                                    frameworks={comparisonSeries}
                                />
                            </div>
                        ) : (
                            <div className="card" style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>无数据</div>
                        )
                    )}


                    {/* 3. Single Query Drill-down */}
                    <h2 className="section-title">单问题详情 (Drill-down)</h2>
                    <div className="analysis-controls">
                        <select value={selectedFramework} onChange={e => setSelectedFramework(e.target.value)}>
                            <option value="">选择框架</option>
                            {allFrameworks.map(f => <option key={f} value={f}>{f}</option>)}
                        </select>
                        <select value={selectedQuery} onChange={e => setSelectedQuery(e.target.value)} style={{ flex: 1 }}>
                            <option value="">选择问题</option>
                            {filteredQueries.map(q => <option key={q} value={q}>{q.substring(0, 80)}</option>)}
                        </select>
                        <div style={{ marginLeft: '10px', display: 'flex', alignItems: 'center', gap: '20px' }}>
                            <label style={{ cursor: 'pointer', color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '5px' }}>
                                <input type="checkbox" checked={drillDownGroupByLabel} onChange={(e) => {
                                    setDrillDownGroupByLabel(e.target.checked);
                                    if (e.target.checked) setDrillDownGroupByModel(false);
                                }} />
                                按标签分类
                            </label>

                            <label style={{ cursor: 'pointer', color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '5px' }}>
                                <input type="checkbox" checked={drillDownGroupByModel} onChange={(e) => {
                                    setDrillDownGroupByModel(e.target.checked);
                                    if (e.target.checked) setDrillDownGroupByLabel(false);
                                }} />
                                按模型分类
                            </label>

                            {drillDownGroupByLabel && (
                                <div className="dropdown-container" style={{ position: 'relative', display: 'inline-block' }}>
                                    <div className="dropdown-trigger" style={{ background: '#1e293b', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', border: '1px solid #334155', minWidth: '150px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                        {selectedDrillDownLabels.length === 0 ? '所有标签 (All Labels)' : `已选 ${selectedDrillDownLabels.length} 个`}
                                        <span style={{ fontSize: '0.8rem', marginLeft: '8px' }}>▼</span>
                                    </div>
                                    <div className="dropdown-content" style={{
                                        position: 'absolute', top: '100%', left: 0, zIndex: 10,
                                        background: '#1e293b', border: '1px solid #334155', borderRadius: '4px',
                                        padding: '0.5rem', minWidth: '200px', maxHeight: '300px', overflowY: 'auto',
                                        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.5)'
                                    }}>
                                        <label style={{ display: 'block', marginBottom: '4px', cursor: 'pointer' }}>
                                            <input type="checkbox"
                                                checked={selectedDrillDownLabels.length === 0}
                                                onChange={() => setSelectedDrillDownLabels([])}
                                            /> <span style={{ marginLeft: '4px' }}>所有标签 (All)</span>
                                        </label>
                                        <hr style={{ borderColor: '#334155', margin: '4px 0' }} />
                                        {drillDownAvailableLabels.map(l => (
                                            <label key={l} style={{ display: 'block', marginBottom: '4px', cursor: 'pointer' }}>
                                                <input type="checkbox"
                                                    checked={selectedDrillDownLabels.includes(l)}
                                                    onChange={(e) => {
                                                        if (e.target.checked) {
                                                            setSelectedDrillDownLabels([...selectedDrillDownLabels, l]);
                                                        } else {
                                                            setSelectedDrillDownLabels(selectedDrillDownLabels.filter(x => x !== l));
                                                        }
                                                    }}
                                                /> <span style={{ marginLeft: '4px' }}>{l}</span>
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {drillDownGroupByModel && (
                                <div className="dropdown-container" style={{ position: 'relative', display: 'inline-block' }}>
                                    <div className="dropdown-trigger" style={{ background: '#1e293b', padding: '4px 8px', borderRadius: '4px', cursor: 'pointer', border: '1px solid #334155', minWidth: '150px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                        {selectedDrillDownModels.length === 0 ? '所有模型 (All Models)' : `已选 ${selectedDrillDownModels.length} 个`}
                                        <span style={{ fontSize: '0.8rem', marginLeft: '8px' }}>▼</span>
                                    </div>
                                    <div className="dropdown-content" style={{
                                        position: 'absolute', top: '100%', left: 0, zIndex: 10,
                                        background: '#1e293b', border: '1px solid #334155', borderRadius: '4px',
                                        padding: '0.5rem', minWidth: '200px', maxHeight: '300px', overflowY: 'auto',
                                        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.5)'
                                    }}>
                                        <label style={{ display: 'block', marginBottom: '4px', cursor: 'pointer' }}>
                                            <input type="checkbox"
                                                checked={selectedDrillDownModels.length === 0}
                                                onChange={() => setSelectedDrillDownModels([])}
                                            /> <span style={{ marginLeft: '4px' }}>所有模型 (All)</span>
                                        </label>
                                        <hr style={{ borderColor: '#334155', margin: '4px 0' }} />
                                        {drillDownAvailableModels.map(m => (
                                            <label key={m} style={{ display: 'block', marginBottom: '4px', cursor: 'pointer' }}>
                                                <input type="checkbox"
                                                    checked={selectedDrillDownModels.includes(m)}
                                                    onChange={(e) => {
                                                        if (e.target.checked) {
                                                            setSelectedDrillDownModels([...selectedDrillDownModels, m]);
                                                        } else {
                                                            setSelectedDrillDownModels(selectedDrillDownModels.filter(x => x !== m));
                                                        }
                                                    }}
                                                /> <span style={{ marginLeft: '4px' }}>{m}</span>
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {drillDownGroupByLabel || drillDownGroupByModel ? (
                        // Grouped View for Drill Down (Label or Model)
                        <div>
                            {(drillDownGroupByLabel ? drillDownAvailableLabels : drillDownAvailableModels)
                                .filter(val => {
                                    if (drillDownGroupByLabel) {
                                        return selectedDrillDownLabels.length === 0 || selectedDrillDownLabels.includes(val);
                                    } else {
                                        return selectedDrillDownModels.length === 0 || selectedDrillDownModels.includes(val);
                                    }
                                })
                                .map(val => {
                                    // Filter Data
                                    let relevant = filteredData;
                                    if (drillDownGroupByLabel) {
                                        relevant = relevant.filter(d => (d.label || 'Other') === val);
                                    } else {
                                        relevant = relevant.filter(d => (d.model || 'Unknown') === val);
                                    }

                                    if (selectedQuery) relevant = relevant.filter(d => d.query === selectedQuery);
                                    if (selectedFramework) relevant = relevant.filter(d => d.framework === selectedFramework);

                                    if (relevant.length === 0) return null;

                                    // Calc Stats
                                    const counts = relevant.length;
                                    const avgLat = relevant.reduce((sum, d) => sum + d.latency, 0) / counts;
                                    const avgTok = Math.round(relevant.reduce((sum, d) => sum + d.tokens, 0) / counts);
                                    const recall = (relevant.filter(d => d.is_skill_correct).length / counts) * 100;
                                    const evaluatedRelevant = relevant.filter(d => d.answer_score !== null);
                                    const avgSc = evaluatedRelevant.length ? (evaluatedRelevant.reduce((sum, d) => sum + (d.answer_score || 0), 0) / evaluatedRelevant.length) : 0;
                                    const best = [...relevant].sort((a, b) => a.latency - b.latency)[0];
                                    const worst = [...relevant].sort((a, b) => b.latency - a.latency)[0];

                                    return (
                                        <div key={val} style={{ marginBottom: '2rem' }}>
                                            <div style={{ marginBottom: '0.5rem' }}>
                                                <h3 style={{ margin: 0, color: '#38bdf8', fontSize: '1.1rem' }}>
                                                    {drillDownGroupByLabel ? '标签 (Label): ' : '模型 (Model): '} {val}
                                                </h3>
                                            </div>
                                            <div className="grid">
                                                {/* Stats Card */}
                                                <div className="card" style={{ gridColumn: 'span 2' }}>
                                                    <div className="card-title">
                                                        平均表现
                                                        <span style={{ fontSize: '0.85rem', color: '#94a3b8', fontWeight: 'normal', marginLeft: '8px' }}>
                                                            (基于 {counts} 条记录)
                                                        </span>
                                                    </div>
                                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', textAlign: 'center' }}>
                                                        <div>
                                                            <div className="text-sm text-slate-400">平均时延</div>
                                                            <div className="text-xl font-bold">{formatLatency(avgLat)}</div>
                                                        </div>
                                                        <div>
                                                            <div className="text-sm text-slate-400">平均 Token</div>
                                                            <div className="text-xl font-bold">{formatTokens(avgTok)}</div>
                                                        </div>
                                                        <div>
                                                            <div className="text-sm text-slate-400">平均准确率</div>
                                                            <div className="text-xl font-bold" style={{ color: avgSc > 0.8 ? '#4ade80' : '#fbbf24' }}>{avgSc.toFixed(2)}</div>
                                                        </div>
                                                    </div>
                                                </div>
                                                {/* Best/Worst */}
                                                <div className="card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                                                    <div>
                                                        <div className="card-title text-green-400" style={{ fontSize: '0.85rem' }}>最好表现 (Min Lat)</div>
                                                        <div className="text-xl font-bold">{formatLatency(best.latency)}</div>
                                                        <div className="text-sm text-slate-400 mt-2" style={{ fontSize: '0.75rem' }}>
                                                            Token: {formatTokens(best.tokens)} <br />
                                                            Score: {best.answer_score?.toFixed(2) || '-'}
                                                        </div>
                                                    </div>
                                                    <div style={{ fontSize: '0.75rem', color: '#38bdf8', cursor: 'pointer', marginTop: '0.5rem', textAlign: 'right' }} onClick={() => {
                                                        const url = `/details?framework=${encodeURIComponent(best.framework)}&expandTaskId=${best.task_id || best.upload_id}`;
                                                        window.open(url, '_blank');
                                                    }}>View Log &gt;</div>
                                                </div>
                                                <div className="card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                                                    <div>
                                                        <div className="card-title text-red-400" style={{ fontSize: '0.85rem' }}>最差表现 (Max Lat)</div>
                                                        <div className="text-xl font-bold">{formatLatency(worst.latency)}</div>
                                                        <div className="text-sm text-slate-400 mt-2" style={{ fontSize: '0.75rem' }}>
                                                            Token: {formatTokens(worst.tokens)} <br />
                                                            Score: {worst.answer_score?.toFixed(2) || '-'}
                                                        </div>
                                                    </div>
                                                    <div style={{ fontSize: '0.75rem', color: '#38bdf8', cursor: 'pointer', marginTop: '0.5rem', textAlign: 'right' }} onClick={() => window.open(`/details?framework=${encodeURIComponent(worst.framework)}&query=${encodeURIComponent(worst.query)}&expandTaskId=${worst.task_id || worst.upload_id}`, '_blank')}>View Log &gt;</div>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                        </div>
                    ) : (
                        singleQueryStats ? (
                            <div className="grid">
                                {/* Stats Card */}
                                <div className="card" style={{ gridColumn: 'span 2' }}>
                                    <div className="card-title">
                                        平均表现
                                        <span style={{ fontSize: '0.9rem', color: '#94a3b8', fontWeight: 'normal', marginLeft: '8px' }}>
                                            (基于 {singleQueryStats.count} 条记录)
                                        </span>
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', textAlign: 'center' }}>
                                        <div>
                                            <div className="text-sm text-slate-400">平均时延</div>
                                            <div className="text-xl font-bold">{formatLatency(singleQueryStats.avgLatency)}</div>
                                        </div>
                                        <div>
                                            <div className="text-sm text-slate-400">平均 Token</div>
                                            <div className="text-xl font-bold">{formatTokens(singleQueryStats.avgTokens)}</div>
                                        </div>
                                        <div>
                                            <div className="text-sm text-slate-400">平均准确率</div>
                                            <div className="text-xl font-bold" style={{ color: singleQueryStats.avgAnsScore > 0.8 ? '#4ade80' : '#fbbf24' }}>{singleQueryStats.avgAnsScore.toFixed(2)}</div>
                                        </div>
                                    </div>

                                </div>
                                {/* Best/Worst */}
                                <div className="card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                                    <div>
                                        <div className="card-title text-green-400">最好表现 (Min Latency)</div>
                                        <div className="text-2xl font-bold">{formatLatency(singleQueryStats.best.latency)}</div>
                                        <div className="text-sm text-slate-400 mt-2">
                                            Token: {formatTokens(singleQueryStats.best.tokens)} <br />
                                            Time: {formatDateTime(singleQueryStats.best.timestamp)}
                                        </div>
                                    </div>
                                    <div style={{ fontSize: '0.8rem', color: '#38bdf8', cursor: 'pointer', marginTop: '0.5rem', textAlign: 'right' }} onClick={() => window.open(`/details?framework=${encodeURIComponent(singleQueryStats.best.framework)}&query=${encodeURIComponent(singleQueryStats.best.query)}&expandTaskId=${singleQueryStats.best.task_id || singleQueryStats.best.upload_id}`, '_blank')}>View Log &gt;</div>
                                </div>
                                <div className="card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                                    <div>
                                        <div className="card-title text-red-400">最差表现 (Max Latency)</div>
                                        <div className="text-2xl font-bold">{formatLatency(singleQueryStats.worst.latency)}</div>
                                        <div className="text-sm text-slate-400 mt-2">
                                            Token: {formatTokens(singleQueryStats.worst.tokens)} <br />
                                            Time: {formatDateTime(singleQueryStats.worst.timestamp)}
                                        </div>
                                    </div>
                                    <div style={{ fontSize: '0.8rem', color: '#38bdf8', cursor: 'pointer', marginTop: '0.5rem', textAlign: 'right' }} onClick={() => {
                                        const url = `/details?framework=${encodeURIComponent(singleQueryStats.worst.framework)}&expandTaskId=${singleQueryStats.worst.task_id || singleQueryStats.worst.upload_id}`;
                                        window.open(url, '_blank');
                                    }}>View Log &gt;</div>
                                </div>
                            </div>
                        ) : (
                            <div className="card" style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>
                                {selectedQuery ? '该组合下暂无数据' : '请选择一个问题进行分析'}
                            </div>
                        )
                    )}

                    {/* 4. Records Table */}
                    <h2 className="section-title">执行记录</h2>

                    {/* Table Filters */}
                    <div className="analysis-controls" style={{ marginBottom: '1rem' }}>
                        <select value={tableFramework} onChange={e => setTableFramework(e.target.value)} style={{ fontSize: '0.9rem' }}>
                            <option value="">所有框架 (All Frameworks)</option>
                            {allFrameworks.map(f => <option key={f} value={f}>{f}</option>)}
                        </select>

                        <select value={tableLabel} onChange={e => setTableLabel(e.target.value)} style={{ fontSize: '0.9rem' }}>
                            <option value="">所有标签 (All Labels)</option>
                            {allLabels.map(l => <option key={l} value={l}>{l}</option>)}
                        </select>

                        <select value={tableModel} onChange={e => setTableModel(e.target.value)} style={{ fontSize: '0.9rem' }}>
                            <option value="">所有模型 (All Models)</option>
                            {allModels.map(m => <option key={m} value={m}>{m}</option>)}
                        </select>

                        <input
                            type="text"
                            placeholder="搜索问题..."
                            value={tableQuery}
                            onChange={e => setTableQuery(e.target.value)}
                            style={{ padding: '0.5rem', background: '#1e293b', border: '1px solid #334155', borderRadius: '4px', color: 'white', minWidth: '250px' }}
                        />

                        <span style={{ marginLeft: 'auto', color: '#64748b', fontSize: '0.9rem' }}>
                            共有 {tableFilteredData.length} 条数据
                        </span>
                    </div>

                    <div className="card table-container">
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead style={{ textAlign: 'left', color: '#94a3b8', borderBottom: '1px solid #334155' }}>
                                <tr>
                                    <th className="p-2" style={{ whiteSpace: 'nowrap' }}>时间</th>
                                    <th className="p-2" style={{ whiteSpace: 'nowrap' }}>框架</th>
                                    <th className="p-2" style={{ whiteSpace: 'nowrap' }}>问题</th>
                                    <th className="p-2" style={{ whiteSpace: 'nowrap' }}><span>时延 <CustomTooltip content="从请求发出到收到最终完整回复的总耗时" /></span></th>
                                    <th className="p-2" style={{ whiteSpace: 'nowrap' }}><span>Token <CustomTooltip content="输入 Prompt 与输出 Completion 的 Token 总和" /></span></th>
                                    <th className="p-2" style={{ whiteSpace: 'nowrap' }}><span>准确率 <CustomTooltip content={<div>基于LLM评估Agent真实运行结果与期望答案的差异，给出0-1分值，1表示完全正确。<br />"--"表示评估失败，可能是由于模型未配置或者数据项未配置。</div>} /></span></th>
                                    <th className="p-2" style={{ whiteSpace: 'nowrap' }}>模型</th>

                                    <th className="p-2" style={{ whiteSpace: 'nowrap' }}>标签</th>
                                    <th className="p-2" style={{ whiteSpace: 'nowrap' }}>操作</th>
                                </tr>
                            </thead>
                            <tbody>
                                {currentTableData.map((row, i) => {
                                    const recordId = row.upload_id || row.task_id || '';
                                    return (
                                        <tr key={i} style={{ borderBottom: '1px solid #1e293b' }}>
                                            <td className="p-2" style={{ fontSize: '0.85rem', whiteSpace: 'nowrap' }}>{formatDateTime(row.timestamp)}</td>
                                            <td className="p-2" style={{ whiteSpace: 'nowrap' }}>{row.framework}</td>
                                            <td className="p-2" title={row.query}>{row.query.length > 30 ? row.query.substring(0, 30) + '...' : row.query}</td>
                                            <td className="p-2">{formatLatency(row.latency)}</td>
                                            <td className="p-2">{formatTokens(row.tokens)}</td>
                                            <td className="p-2">
                                                <span style={{ color: row.answer_score === null ? '#94a3b8' : ((row.answer_score || 0) > 0.8 ? '#4ade80' : '#ef4444'), fontWeight: 'bold' }}>
                                                    {row.answer_score === null ? '--' : (row.answer_score || 0).toFixed(2)}
                                                </span>
                                            </td>
                                            <td className="p-2" style={{ fontSize: '0.85rem', whiteSpace: 'nowrap' }}>{row.model || '-'}</td>

                                            <td className="p-2">
                                                {editingLabelId === recordId ? (
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                        <input
                                                            value={tempLabelValue}
                                                            onChange={e => setTempLabelValue(e.target.value)}
                                                            style={{ width: '80px', padding: '2px 4px', fontSize: '0.8rem', background: '#0f172a', border: '1px solid #334155' }}
                                                        />
                                                        <button onClick={() => handleUpdateLabel(row, tempLabelValue)} style={{ color: '#4ade80', background: 'none', border: 'none', cursor: 'pointer' }}>✓</button>
                                                        <button onClick={() => setEditingLabelId(null)} style={{ color: '#f87171', background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
                                                    </div>
                                                ) : (
                                                    <div
                                                        style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}
                                                        onClick={() => {
                                                            if (recordId) {
                                                                setEditingLabelId(recordId);
                                                                setTempLabelValue(row.label || '');
                                                            }
                                                        }}
                                                    >
                                                        {row.label ? <span style={{ padding: '2px 6px', background: '#334155', borderRadius: '4px', fontSize: '0.8rem' }}>{row.label}</span> : <span style={{ color: '#64748b' }}>-</span>}
                                                        <span style={{ fontSize: '0.7rem', color: '#475569', opacity: 0.5 }}>✎</span>
                                                    </div>
                                                )}
                                            </td>
                                            <td className="p-2">
                                                <div style={{ display: 'flex', gap: '8px', whiteSpace: 'nowrap' }}>
                                                    <button onClick={() => {
                                                        const url = `/details?framework=${encodeURIComponent(row.framework)}&expandTaskId=${recordId}`;
                                                        window.open(url, '_blank');
                                                    }} className="btn-sm" style={{ background: '#3b82f6' }}>
                                                        详情
                                                    </button>
                                                    <button
                                                        onClick={() => handleRejudge(row)}
                                                        className="btn-sm"
                                                        disabled={rejudgingIds.has(recordId)}
                                                        style={{
                                                            background: rejudgingIds.has(recordId) ? '#94a3b8' : '#fbbf24',
                                                            color: '#0f172a',
                                                            cursor: rejudgingIds.has(recordId) ? 'not-allowed' : 'pointer',
                                                            display: 'inline-flex',
                                                            alignItems: 'center',
                                                            gap: '4px',
                                                            opacity: rejudgingIds.has(recordId) ? 0.7 : 1
                                                        }}
                                                    >
                                                        {rejudgingIds.has(recordId) ? (
                                                            <>
                                                                <span style={{
                                                                    width: '12px',
                                                                    height: '12px',
                                                                    border: '2px solid #0f172a',
                                                                    borderTopColor: 'transparent',
                                                                    borderRadius: '50%',
                                                                    animation: 'spin 1s linear infinite',
                                                                    display: 'inline-block'
                                                                }}></span>
                                                                <span>评估中...</span>
                                                            </>
                                                        ) : (
                                                            '重评'
                                                        )}
                                                    </button>
                                                    <button onClick={() => handleDelete(row)} className="btn-sm" style={{ background: '#ef4444' }}>
                                                        删
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    {/* Pagination Controls */}
                    {totalTablePages > 1 && (
                        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', marginTop: '1rem', gap: '1rem' }}>
                            <button
                                className="btn-sm"
                                disabled={tablePage === 1}
                                onClick={() => setTablePage(p => Math.max(1, p - 1))}
                                style={{ background: tablePage === 1 ? '#334155' : '#38bdf8', color: tablePage === 1 ? '#94a3b8' : '#0f172a', cursor: tablePage === 1 ? 'not-allowed' : 'pointer' }}
                            >
                                &lt; Prev
                            </button>
                            <span style={{ color: '#94a3b8' }}>
                                Page {tablePage} of {totalTablePages}
                            </span>
                            <button
                                className="btn-sm"
                                disabled={tablePage === totalTablePages}
                                onClick={() => setTablePage(p => Math.min(totalTablePages, p + 1))}
                                style={{ background: tablePage === totalTablePages ? '#334155' : '#38bdf8', color: tablePage === totalTablePages ? '#94a3b8' : '#0f172a', cursor: tablePage === totalTablePages ? 'not-allowed' : 'pointer' }}
                            >
                                Next &gt;
                            </button>
                        </div>
                    )}
                </>
            )}

            {/* CONFIG TAB */}
            {activeTab === 'config' && (
                <div className="config-container">
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem', alignItems: 'center' }}>
                        <h2 className="section-title" style={{ marginBottom: 0 }}>数据集管理</h2>
                        <button
                            onClick={() => { setEditingConfig({}); setConfigAnswerMode('manual'); setConfigDocumentFile(null); setIsEditModalOpen(true) }}
                            className="btn-primary"
                            style={{ padding: '8px 20px', fontSize: '0.9rem', borderRadius: '6px' }}
                        >
                            + 新增数据项
                        </button>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {Array.isArray(configs) && configs.length === 0 && (
                            <div className="card" style={{ textAlign: 'center', padding: '3rem', color: '#64748b' }}>
                                暂无数据项，点击上方"+ 新增数据项"开始添加
                            </div>
                        )}
                        {Array.isArray(configs) && configs.map(c => (
                            <div key={c.id} className="card" style={{
                                padding: '14px 18px',
                                display: 'flex',
                                flexDirection: 'row',
                                alignItems: 'center',
                                gap: '16px',
                                transition: 'border-color 0.2s',
                                borderColor: '#1e293b'
                            }}>
                                {/* 解析状态指示器 */}
                                <div style={{
                                    flexShrink: 0, width: '8px', height: '8px', borderRadius: '50%',
                                    background: c.parse_status === 'parsing' ? '#fbbf24' : c.parse_status === 'failed' ? '#ef4444' : '#4ade80',
                                    boxShadow: `0 0 6px ${c.parse_status === 'parsing' ? '#fbbf2444' : c.parse_status === 'failed' ? '#ef444444' : '#4ade8044'}`,
                                    ...(c.parse_status === 'parsing' ? { animation: 'pulse-dot 1.5s ease-in-out infinite' } : {})
                                }} />
                                {/* 内容区 */}
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{
                                        fontWeight: 500,
                                        color: '#e2e8f0',
                                        fontSize: '0.9rem',
                                        whiteSpace: 'nowrap',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        marginBottom: '4px'
                                    }}>
                                        {c.query}
                                    </div>
                                    <div style={{
                                        color: '#64748b',
                                        fontSize: '0.8rem',
                                        whiteSpace: 'nowrap',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis'
                                    }}>
                                        {(c.standard_answer || '').length > 100 ? (c.standard_answer || '').substring(0, 100) + '...' : (c.standard_answer || '暂无标准答案')}
                                    </div>
                                </div>
                                {/* 状态标签 */}
                                <div style={{ flexShrink: 0 }}>
                                    {c.parse_status === 'parsing' ? (
                                        <span style={{
                                            display: 'inline-flex', alignItems: 'center', gap: '5px',
                                            padding: '3px 10px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 500,
                                            background: 'rgba(251, 191, 36, 0.12)', color: '#fbbf24', border: '1px solid rgba(251, 191, 36, 0.25)'
                                        }}>
                                            <span style={{ width: '10px', height: '10px', border: '1.5px solid #fbbf24', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite', display: 'inline-block' }}></span>
                                            解析中
                                        </span>
                                    ) : c.parse_status === 'failed' ? (
                                        <span style={{
                                            padding: '3px 10px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 500,
                                            background: 'rgba(239, 68, 68, 0.12)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.25)'
                                        }}>✕ 失败</span>
                                    ) : (
                                        <span style={{
                                            padding: '3px 10px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 500,
                                            background: 'rgba(74, 222, 128, 0.12)', color: '#4ade80', border: '1px solid rgba(74, 222, 128, 0.25)'
                                        }}>✓ 完成</span>
                                    )}
                                </div>
                                {/* 操作按钮 */}
                                <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                                    <button
                                        onClick={() => { setEditingConfig(c); setIsEditModalOpen(true) }}
                                        style={{
                                            padding: '5px 12px',
                                            background: '#1e3a5f',
                                            color: '#38bdf8',
                                            border: 'none',
                                            borderRadius: '6px',
                                            cursor: 'pointer',
                                            fontSize: '0.8rem',
                                            fontWeight: 500,
                                            transition: 'background 0.2s'
                                        }}
                                    >
                                        详情
                                    </button>
                                    <button
                                        onClick={() => {
                                            setEditingConfig({
                                                query: c.query,
                                                skill: '',
                                                standard_answer: c.standard_answer,
                                            });
                                            setConfigAnswerMode('manual');
                                            setConfigDocumentFile(null);
                                            setIsEditModalOpen(true);
                                        }}
                                        style={{
                                            padding: '5px 12px',
                                            background: '#2d1b4e',
                                            color: '#a855f7',
                                            border: 'none',
                                            borderRadius: '6px',
                                            cursor: 'pointer',
                                            fontSize: '0.8rem',
                                            fontWeight: 500,
                                            transition: 'background 0.2s'
                                        }}
                                    >
                                        复制
                                    </button>
                                    <button
                                        onClick={() => deleteConfig(c.id)}
                                        style={{
                                            padding: '5px 12px',
                                            background: '#3b1c1c',
                                            color: '#ef4444',
                                            border: 'none',
                                            borderRadius: '6px',
                                            cursor: 'pointer',
                                            fontSize: '0.8rem',
                                            fontWeight: 500,
                                            transition: 'background 0.2s'
                                        }}
                                    >
                                        删除
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* SKILL MANAGEMENT TAB */}
            {activeTab === 'skill' && (
                <SkillRegistry />
            )}


            {/* MODALS */}
            {/* 1. Config Edit Modal */}
            {isEditModalOpen && (
                <div className="modal-overlay" onClick={() => setIsEditModalOpen(false)}>
                    <div className="modal-content card" onClick={e => e.stopPropagation()} style={{ maxHeight: '90vh', overflowY: 'auto', maxWidth: '900px', width: '66vw', minWidth: '500px', flexDirection: 'column' }}>
                        <h3>{editingConfig.id ? '数据项详情' : '新增数据项'}</h3>

                        {/* 问题 - 始终突出显示 */}
                        <div className="form-group">
                            <label style={{ fontWeight: 600, fontSize: '0.95rem', color: '#e2e8f0' }}>问题 (Query) <span style={{ color: '#ef4444' }}>*</span></label>
                            <textarea
                                value={editingConfig.query || ''}
                                onChange={e => setEditingConfig({ ...editingConfig, query: e.target.value })}
                                disabled={!!editingConfig.id}
                                placeholder="请输入需要评估的问题..."
                                style={{ width: '100%', padding: '10px', minHeight: '60px', opacity: editingConfig.id ? 0.7 : 1, cursor: editingConfig.id ? 'not-allowed' : 'text', background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0', borderRadius: '6px', fontSize: '0.95rem' }}
                            />
                        </div>

                        {!editingConfig.id ? (
                            // --- NEW CONFIG FORM ---
                            <>
                                {/* 标准答案 - 突出显示 */}
                                <div className="form-group">
                                    <label style={{ fontWeight: 600, fontSize: '0.95rem', color: '#e2e8f0' }}>标准答案 <span style={{ color: '#ef4444' }}>*</span></label>
                                    <div style={{ display: 'flex', gap: '12px', marginBottom: '10px' }}>
                                        <button
                                            onClick={() => { setConfigAnswerMode('manual'); setConfigDocumentFile(null); }}
                                            style={{
                                                padding: '6px 16px',
                                                background: configAnswerMode === 'manual' ? '#38bdf8' : '#1e293b',
                                                color: configAnswerMode === 'manual' ? '#0f172a' : '#94a3b8',
                                                border: `1px solid ${configAnswerMode === 'manual' ? '#38bdf8' : '#334155'}`,
                                                borderRadius: '6px',
                                                cursor: 'pointer',
                                                fontSize: '0.85rem',
                                                fontWeight: configAnswerMode === 'manual' ? 600 : 400,
                                                transition: 'all 0.2s'
                                            }}
                                        >
                                            ✏️ 手动填写
                                        </button>
                                        <button
                                            onClick={() => setConfigAnswerMode('document')}
                                            style={{
                                                padding: '6px 16px',
                                                background: configAnswerMode === 'document' ? '#38bdf8' : '#1e293b',
                                                color: configAnswerMode === 'document' ? '#0f172a' : '#94a3b8',
                                                border: `1px solid ${configAnswerMode === 'document' ? '#38bdf8' : '#334155'}`,
                                                borderRadius: '6px',
                                                cursor: 'pointer',
                                                fontSize: '0.85rem',
                                                fontWeight: configAnswerMode === 'document' ? 600 : 400,
                                                transition: 'all 0.2s'
                                            }}
                                        >
                                            📄 上传案例文档
                                        </button>
                                    </div>

                                    {configAnswerMode === 'manual' ? (
                                        <textarea
                                            value={editingConfig.standard_answer || ''}
                                            onChange={e => setEditingConfig({ ...editingConfig, standard_answer: e.target.value })}
                                            placeholder="请填写该问题的标准答案..."
                                            style={{ width: '100%', padding: '10px', minHeight: '150px', background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0', borderRadius: '6px', fontSize: '0.9rem' }}
                                        />
                                    ) : (
                                        <div style={{
                                            border: '2px dashed #334155',
                                            borderRadius: '8px',
                                            padding: '2rem',
                                            textAlign: 'center',
                                            background: '#0f172a',
                                            cursor: 'pointer',
                                            transition: 'border-color 0.2s'
                                        }}
                                            onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = '#38bdf8'; }}
                                            onDragLeave={e => { e.currentTarget.style.borderColor = '#334155'; }}
                                            onDrop={e => {
                                                e.preventDefault();
                                                e.currentTarget.style.borderColor = '#334155';
                                                const file = e.dataTransfer.files[0];
                                                if (file) setConfigDocumentFile(file);
                                            }}
                                            onClick={() => {
                                                const input = document.createElement('input');
                                                input.type = 'file';
                                                input.accept = '.txt,.md,.markdown,.pdf';
                                                input.onchange = (e: any) => {
                                                    const file = e.target.files[0];
                                                    if (file) setConfigDocumentFile(file);
                                                };
                                                input.click();
                                            }}
                                        >
                                            {configDocumentFile ? (
                                                <div>
                                                    <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📄</div>
                                                    <div style={{ color: '#4ade80', fontWeight: 500 }}>{configDocumentFile.name}</div>
                                                    <div style={{ color: '#94a3b8', fontSize: '0.8rem', marginTop: '4px' }}>
                                                        {(configDocumentFile.size / 1024).toFixed(1)} KB · 点击更换文件
                                                    </div>
                                                </div>
                                            ) : (
                                                <div>
                                                    <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📁</div>
                                                    <div style={{ color: '#94a3b8' }}>点击或拖拽上传案例文档</div>
                                                    <div style={{ color: '#64748b', fontSize: '0.8rem', marginTop: '4px' }}>
                                                        支持 .txt, .md, .pdf 格式
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>

                                <div style={{ marginTop: '1rem', padding: '12px 16px', background: 'rgba(56, 189, 248, 0.08)', border: '1px solid rgba(56, 189, 248, 0.2)', borderRadius: '8px', color: '#94a3b8', fontSize: '0.85rem' }}>
                                    <p style={{ margin: 0 }}>
                                        💡 保存后，系统将基于标准答案自动提取<strong style={{ color: '#bae6fd' }}>关键观点</strong>（回答中必须包含的核心信息）和<strong style={{ color: '#bae6fd' }}>关键动作</strong>（Agent 必须执行的操作步骤），用于后续的细致评估打分。此过程在后台执行，无需等待。
                                    </p>
                                </div>
                            </>
                        ) : (
                            // --- VIEW/EDIT FORM ---
                            <>
                                {/* 标准答案 - 突出显示 */}
                                <div className="form-group">
                                    <label style={{ fontWeight: 600, fontSize: '0.95rem', color: '#e2e8f0' }}>标准答案</label>
                                    <textarea
                                        value={editingConfig.standard_answer || ''}
                                        onChange={e => setEditingConfig({ ...editingConfig, standard_answer: e.target.value })}
                                        style={{ width: '100%', padding: '10px', minHeight: '120px', background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0', borderRadius: '6px', fontSize: '0.9rem' }}
                                    />
                                </div>

                                {/* 关键观点 - 默认折叠 */}
                                <details style={{ marginBottom: '1rem' }}>
                                    <summary style={{
                                        cursor: 'pointer',
                                        color: '#94a3b8',
                                        fontSize: '0.9rem',
                                        padding: '10px 12px',
                                        userSelect: 'none',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '8px',
                                        background: 'rgba(30, 41, 59, 0.5)',
                                        borderRadius: '6px',
                                        border: '1px solid #334155',
                                        listStyle: 'none',
                                        transition: 'background 0.2s'
                                    }}>
                                        <span className="details-arrow" style={{ fontSize: '0.7rem', color: '#64748b', transition: 'transform 0.2s', display: 'inline-block' }}>▶</span>
                                        <span style={{ fontWeight: 500 }}>关键观点 (Expected Key Points)</span>
                                        <span style={{ fontSize: '0.8rem', color: '#64748b', marginLeft: 'auto' }}>
                                            {(editingConfig.root_causes || []).length} 项 · 点击展开
                                        </span>
                                    </summary>
                                    <div style={{ background: '#0f172a', padding: '10px', borderRadius: '4px', border: '1px solid #334155', marginTop: '8px' }}>
                                        <div style={{ color: '#64748b', fontSize: '0.8rem', marginBottom: '10px', padding: '6px 8px', background: 'rgba(100, 116, 139, 0.1)', borderRadius: '4px' }}>
                                            来源：从标准答案中自动提取 · 作用：评估 Agent 回答是否包含了所有关键信息
                                        </div>
                                        {(editingConfig.root_causes || []).map((item, idx) => (
                                            <div key={idx} style={{ display: 'flex', gap: '10px', marginBottom: '8px' }}>
                                                <input
                                                    placeholder="内容"
                                                    value={item.content}
                                                    onChange={e => {
                                                        const newItems = [...(editingConfig.root_causes || [])];
                                                        newItems[idx].content = e.target.value;
                                                        setEditingConfig({ ...editingConfig, root_causes: newItems });
                                                    }}
                                                    style={{ flex: 1, padding: '6px' }}
                                                />
                                                <input
                                                    type="number"
                                                    placeholder="权重"
                                                    value={item.weight}
                                                    onChange={e => {
                                                        const newItems = [...(editingConfig.root_causes || [])];
                                                        newItems[idx].weight = Number(e.target.value);
                                                        setEditingConfig({ ...editingConfig, root_causes: newItems });
                                                    }}
                                                    style={{ width: '80px', padding: '6px' }}
                                                />
                                                <button
                                                    onClick={() => {
                                                        const newItems = (editingConfig.root_causes || []).filter((_, i) => i !== idx);
                                                        setEditingConfig({ ...editingConfig, root_causes: newItems });
                                                    }}
                                                    style={{ color: '#ef4444', padding: '0 8px', background: 'none', border: 'none', cursor: 'pointer' }}
                                                >
                                                    ✕
                                                </button>
                                            </div>
                                        ))}
                                        <button
                                            className="btn-sm"
                                            style={{ background: '#334155', marginTop: '5px' }}
                                            onClick={() => setEditingConfig({
                                                ...editingConfig,
                                                root_causes: [...(editingConfig.root_causes || []), { content: '', weight: 1 }]
                                            })}
                                        >
                                            + 添加关键观点
                                        </button>
                                    </div>
                                </details>

                                {/* 关键动作 - 默认折叠 */}
                                <details style={{ marginBottom: '1rem' }}>
                                    <summary style={{
                                        cursor: 'pointer',
                                        color: '#94a3b8',
                                        fontSize: '0.9rem',
                                        padding: '10px 12px',
                                        userSelect: 'none',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '8px',
                                        background: 'rgba(30, 41, 59, 0.5)',
                                        borderRadius: '6px',
                                        border: '1px solid #334155',
                                        listStyle: 'none',
                                        transition: 'background 0.2s'
                                    }}>
                                        <span className="details-arrow" style={{ fontSize: '0.7rem', color: '#64748b', transition: 'transform 0.2s', display: 'inline-block' }}>▶</span>
                                        <span style={{ fontWeight: 500 }}>关键动作 (Expected Key Actions)</span>
                                        <span style={{ fontSize: '0.8rem', color: '#64748b', marginLeft: 'auto' }}>
                                            {(editingConfig.key_actions || []).length} 项 · 点击展开
                                        </span>
                                    </summary>
                                    <div style={{ background: '#0f172a', padding: '10px', borderRadius: '4px', border: '1px solid #334155', marginTop: '8px' }}>
                                        <div style={{ color: '#64748b', fontSize: '0.8rem', marginBottom: '10px', padding: '6px 8px', background: 'rgba(100, 116, 139, 0.1)', borderRadius: '4px' }}>
                                            来源：从标准答案中自动提取 · 作用：评估 Agent 是否执行了所有必要的操作步骤
                                        </div>
                                        {(editingConfig.key_actions || []).map((item, idx) => (
                                            <div key={idx} style={{ display: 'flex', gap: '10px', marginBottom: '8px' }}>
                                                <input
                                                    placeholder="内容"
                                                    value={item.content}
                                                    onChange={e => {
                                                        const newItems = [...(editingConfig.key_actions || [])];
                                                        newItems[idx].content = e.target.value;
                                                        setEditingConfig({ ...editingConfig, key_actions: newItems });
                                                    }}
                                                    style={{ flex: 1, padding: '6px' }}
                                                />
                                                <input
                                                    type="number"
                                                    placeholder="权重"
                                                    value={item.weight}
                                                    onChange={e => {
                                                        const newItems = [...(editingConfig.key_actions || [])];
                                                        newItems[idx].weight = Number(e.target.value);
                                                        setEditingConfig({ ...editingConfig, key_actions: newItems });
                                                    }}
                                                    style={{ width: '80px', padding: '6px' }}
                                                />
                                                <button
                                                    onClick={() => {
                                                        const newItems = (editingConfig.key_actions || []).filter((_, i) => i !== idx);
                                                        setEditingConfig({ ...editingConfig, key_actions: newItems });
                                                    }}
                                                    style={{ color: '#ef4444', padding: '0 8px', background: 'none', border: 'none', cursor: 'pointer' }}
                                                >
                                                    ✕
                                                </button>
                                            </div>
                                        ))}
                                        <button
                                            className="btn-sm"
                                            style={{ background: '#334155', marginTop: '5px' }}
                                            onClick={() => setEditingConfig({
                                                ...editingConfig,
                                                key_actions: [...(editingConfig.key_actions || []), { content: '', weight: 1 }]
                                            })}
                                        >
                                            + 添加关键动作
                                        </button>
                                    </div>
                                </details>
                            </>
                        )}

                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid #334155' }}>
                            <button
                                onClick={() => { setIsEditModalOpen(false); setIsSavingConfig(false); }}
                                style={{
                                    padding: '8px 24px',
                                    background: '#1e293b',
                                    color: '#94a3b8',
                                    border: '1px solid #334155',
                                    borderRadius: '6px',
                                    cursor: 'pointer',
                                    fontSize: '0.9rem',
                                    fontWeight: 500,
                                    transition: 'all 0.2s'
                                }}
                            >
                                取消
                            </button>
                            <button
                                onClick={saveConfig}
                                disabled={isSavingConfig}
                                style={{
                                    padding: '8px 28px',
                                    background: isSavingConfig ? '#1e3a5f' : '#38bdf8',
                                    color: isSavingConfig ? '#64748b' : '#0f172a',
                                    border: 'none',
                                    borderRadius: '6px',
                                    cursor: isSavingConfig ? 'not-allowed' : 'pointer',
                                    fontSize: '0.9rem',
                                    fontWeight: 600,
                                    transition: 'all 0.2s',
                                    boxShadow: isSavingConfig ? 'none' : '0 2px 8px rgba(56, 189, 248, 0.25)'
                                }}
                            >
                                {isSavingConfig ? '保存中...' : '保存'}
                            </button>
                        </div>
                    </div >
                </div >
            )}

            {/* 2. Record Detail Modal */}
            {selectedRecord && (
                <div className="modal-overlay" onClick={() => setSelectedRecord(null)}>
                    <div className="modal-content card" onClick={e => e.stopPropagation()} style={{ width: '800px', maxWidth: '95%', maxHeight: '90vh', overflowY: 'auto' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                            <h3>记录详情</h3>
                            <button onClick={() => setSelectedRecord(null)} style={{ background: 'transparent', border: 'none', color: 'white', fontSize: '1.5rem', cursor: 'pointer' }}>×</button>
                        </div>

                        <div className="detail-section">
                            <h4>基本信息</h4>
                            <div className="detail-grid">
                                <div><strong>Time:</strong> {formatDateTime(selectedRecord.timestamp)}</div>
                                <div><strong>Framework:</strong> {selectedRecord.framework}</div>
                                <div><strong>Latency:</strong> {formatLatency(selectedRecord.latency)}</div>
                                <div><strong>Token:</strong> {selectedRecord.tokens}</div>
                            </div>
                        </div>

                        <div className="detail-section">
                            <h4>Input / Output</h4>
                            <div className="detail-row">
                                <strong style={{ display: 'block', marginBottom: '0.2rem', color: '#94a3b8' }}>Query:</strong>
                                <div className="code-block">{selectedRecord.query}</div>
                            </div>
                            <div className="detail-row">
                                <strong style={{ display: 'block', marginBottom: '0.2rem', color: '#94a3b8' }}>Skills Used:</strong>
                                <div className="code-block">
                                    {selectedRecord.skills?.length
                                        ? selectedRecord.skills.map(s => selectedRecord.skill_version ? `${s} (v${selectedRecord.skill_version})` : s).join(', ')
                                        : (selectedRecord.skill ? (selectedRecord.skill_version ? `${selectedRecord.skill} (v${selectedRecord.skill_version})` : selectedRecord.skill) : '(None)')}
                                </div>
                            </div>
                            <div className="detail-row">
                                <strong style={{ display: 'block', marginBottom: '0.2rem', color: '#94a3b8' }}>Final Result:</strong>
                                <div className="code-block" style={{ maxHeight: '200px', overflowY: 'auto' }}>{selectedRecord.final_result || '(None)'}</div>
                            </div>
                        </div>

                        <div className="detail-section">
                            <h4>评估结果</h4>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1rem', marginBottom: '1.5rem' }}>
                                <div className={`status-box ${selectedRecord.answer_score === null ? 'warning' : ((selectedRecord.answer_score || 0) > 0.8 ? 'good' : 'bad')}`}
                                    style={selectedRecord.answer_score === null ? { borderLeft: '4px solid #94a3b8', background: 'rgba(148, 163, 184, 0.1)', color: '#94a3b8' } : {}}>
                                    <strong>回答评分:</strong> {selectedRecord.answer_score === null ? '--' : (selectedRecord.answer_score || 0).toFixed(2)}
                                </div>
                            </div>

                            {selectedRecord.failures && selectedRecord.failures.length > 0 && (
                                <div className="detail-section">
                                    <h4 style={{ color: '#f87171' }}>中间故障 / 异常分析</h4>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                        {selectedRecord.failures.map((fail, idx) => (
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
                                                        <strong style={{ color: '#94a3b8' }}>修复建议:</strong> {fail.recovery}
                                                    </div>
                                                )}

                                                {/* Attribution Display */}
                                                {(fail.attribution || fail.attribution_reason) && (
                                                    <div style={{ marginTop: '0.8rem', paddingTop: '0.8rem', borderTop: '1px dashed #7f1d1d' }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.3rem' }}>
                                                            <strong style={{ color: '#fbbf24' }}>归因分析:</strong>
                                                            {fail.attribution && (
                                                                <span style={{
                                                                    background: '#fbbf24',
                                                                    color: '#451a03',
                                                                    padding: '1px 6px',
                                                                    borderRadius: '4px',
                                                                    fontSize: '0.75rem',
                                                                    fontWeight: 'bold',
                                                                    border: '1px solid #d97706'
                                                                }}>
                                                                    {fail.attribution}
                                                                </span>
                                                            )}
                                                        </div>
                                                        {fail.attribution_reason && (
                                                            <div style={{ fontSize: '0.9rem', color: '#fcd34d', fontStyle: 'italic' }}>
                                                                {fail.attribution_reason}
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}



                            <div className="detail-row" style={{ marginTop: '1rem' }}>
                                <strong style={{ color: '#94a3b8' }}>Reason:</strong>
                                <div style={{ marginTop: '0.2rem', fontSize: '0.9rem', color: '#e2e8f0', whiteSpace: 'pre-wrap' }}>{selectedRecord.judgment_reason || '-'}</div>
                            </div>
                        </div >

                        <div className="detail-section">
                            <h4>用户反馈 (User Feedback)</h4>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                                    <button
                                        onClick={() => submitFeedback('like')}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: '0.5rem',
                                            background: (selectedRecord.user_feedback?.type === 'like') ? '#38bdf8' : '#334155',
                                            color: (selectedRecord.user_feedback?.type === 'like') ? '#0f172a' : '#94a3b8',
                                            border: 'none', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer',
                                            fontWeight: (selectedRecord.user_feedback?.type === 'like') ? 'bold' : 'normal',
                                            transition: 'all 0.2s'
                                        }}
                                    >
                                        👍 Like
                                    </button>
                                    <button
                                        onClick={() => submitFeedback('dislike')}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: '0.5rem',
                                            background: (selectedRecord.user_feedback?.type === 'dislike') ? '#f87171' : '#334155',
                                            color: (selectedRecord.user_feedback?.type === 'dislike') ? '#0f172a' : '#94a3b8',
                                            border: 'none', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer',
                                            fontWeight: (selectedRecord.user_feedback?.type === 'dislike') ? 'bold' : 'normal',
                                            transition: 'all 0.2s'
                                        }}
                                    >
                                        👎 Dislike
                                    </button>
                                </div>
                                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
                                    <textarea
                                        value={feedbackComment}
                                        onChange={(e) => setFeedbackComment(e.target.value)}
                                        placeholder="添加评论 (可选)..."
                                        style={{ flex: 1, minHeight: '60px', padding: '8px', background: '#0f172a', border: '1px solid #334155', color: '#e2e8f0', borderRadius: '4px', fontSize: '0.9rem' }}
                                    />
                                    <button
                                        className="btn-primary"
                                        onClick={() => submitFeedback(selectedRecord.user_feedback?.type || null)}
                                        style={{ padding: '8px 16px', fontSize: '0.9rem', height: 'fit-content', whiteSpace: 'nowrap' }}
                                    >
                                        保存评论
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div >
                </div >
            )}

            {/* Floating User Button */}
            <button
                onClick={() => setShowUserModal(true)}
                style={{
                    position: 'fixed',
                    top: '1.5rem',
                    right: '2rem',
                    width: '3rem',
                    height: '3rem',
                    borderRadius: '50%',
                    background: '#38bdf8',
                    color: '#0f172a',
                    border: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '1.5rem',
                    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
                    cursor: 'pointer',
                    zIndex: 900,
                    transition: 'transform 0.2s'
                }}
                onMouseOver={(e) => e.currentTarget.style.transform = 'scale(1.1)'}
                onMouseOut={(e) => e.currentTarget.style.transform = 'scale(1)'}
                title="User Settings"
            >
                👤
            </button>

            {/* User Info Modal */}
            {showUserModal && (
                <div className="modal-overlay" onClick={() => setShowUserModal(false)} style={{ alignItems: 'flex-start', paddingTop: '10vh' }}>
                    <div className="modal-content" style={{ width: '500px', maxWidth: '90vw', background: '#0f172a', border: '1px solid #334155', borderRadius: '12px', padding: '0', overflow: 'hidden' }} onClick={e => e.stopPropagation()}>

                        {/* Modal Header */}
                        <div style={{ padding: '1.5rem', background: 'linear-gradient(to right, #1e293b, #0f172a)', borderBottom: '1px solid #334155', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                <div style={{
                                    width: '40px', height: '40px', borderRadius: '50%', background: '#38bdf8', color: '#0f172a',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem', fontWeight: 'bold'
                                }}>
                                    {user ? user.substring(0, 1).toUpperCase() : '?'}
                                </div>
                                <div>
                                    <h3 style={{ margin: 0, color: '#f8fafc', fontSize: '1.1rem' }}>{user}</h3>
                                    <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>User Profile</span>
                                </div>
                            </div>
                            <button onClick={() => setShowUserModal(false)} style={{ background: 'transparent', border: 'none', color: '#64748b', fontSize: '1.5rem', cursor: 'pointer', lineHeight: 1 }}>×</button>
                        </div>

                        {/* Modal Body */}
                        <div style={{ padding: '1.5rem' }}>

                            {/* Stats or Info could go here */}

                            {localApiKey ? (
                                <div className="form-group" style={{ background: '#1e293b', padding: '1.25rem', borderRadius: '8px', border: '1px solid #334155' }}>
                                    <label style={{ color: '#94a3b8', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '0.75rem', display: 'block' }}>API Key</label>
                                    <div style={{ display: 'flex', gap: '10px' }}>
                                        <div style={{
                                            flex: 1, padding: '0.75rem 1rem', background: '#0f172a', borderRadius: '6px',
                                            border: '1px solid #334155', color: '#e2e8f0', fontFamily: 'monospace', fontSize: '0.9rem',
                                            overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis'
                                        }}>
                                            {localApiKey}
                                        </div>
                                        <button
                                            className="btn-primary"
                                            onClick={() => {
                                                const textToCopy = localApiKey;
                                                const handleSuccess = () => {
                                                    setCopiedApiKey(true);
                                                    setTimeout(() => setCopiedApiKey(false), 2000);
                                                };

                                                if (navigator.clipboard && window.isSecureContext) {
                                                    navigator.clipboard.writeText(textToCopy).then(handleSuccess);
                                                } else {
                                                    // Fallback using document.execCommand('copy')
                                                    const textArea = document.createElement("textarea");
                                                    textArea.value = textToCopy;
                                                    textArea.style.position = "fixed";
                                                    textArea.style.left = "-9999px";
                                                    textArea.style.top = "0";
                                                    document.body.appendChild(textArea);
                                                    textArea.focus();
                                                    textArea.select();
                                                    try {
                                                        document.execCommand('copy');
                                                        handleSuccess();
                                                    } catch (err) {
                                                        console.error('Fallback: Oops, unable to copy', err);
                                                        alert('复制失败，请手动复制');
                                                    }
                                                    document.body.removeChild(textArea);
                                                }
                                            }}
                                            style={{
                                                padding: '0 1.25rem',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '6px',
                                                background: copiedApiKey ? '#4ade80' : undefined
                                            }}
                                        >
                                            {copiedApiKey ? (
                                                <>
                                                    <span>✅</span> Copied
                                                </>
                                            ) : (
                                                <>
                                                    <span>📋</span> Copy
                                                </>
                                            )}
                                        </button>
                                    </div>
                                    <div style={{ marginTop: '1rem', padding: '0.75rem', background: 'rgba(56, 189, 248, 0.1)', borderRadius: '6px', border: '1px solid rgba(56, 189, 248, 0.2)' }}>
                                        <p style={{ margin: 0, fontSize: '0.85rem', color: '#bae6fd', lineHeight: 1.5 }}>
                                            <strong>Usage:</strong> Set this key in your environment to upload data seamlessly without login.<br />
                                            <code style={{ display: 'block', marginTop: '6px', padding: '4px', background: 'rgba(0,0,0,0.3)', borderRadius: '4px' }}>export WITTY_INSIGHT_API_KEY={localApiKey}</code>
                                        </p>
                                    </div>
                                </div>
                            ) : (
                                <div style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>
                                    No API Key found.
                                </div>
                            )}

                        </div>

                        {/* Modal Footer */}
                        <div style={{ padding: '1.25rem 1.5rem', background: '#0f172a', borderTop: '1px solid #334155', display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
                            <button
                                onClick={() => setShowUserModal(false)}
                                style={{
                                    background: 'transparent',
                                    border: '1px solid #334155',
                                    color: '#94a3b8',
                                    padding: '0.6rem 1.25rem',
                                    borderRadius: '6px',
                                    fontWeight: '500',
                                    cursor: 'pointer'
                                }}
                            >
                                Close
                            </button>
                            <button
                                onClick={() => {
                                    localStorage.removeItem('user_id');
                                    localStorage.removeItem('api_key');
                                    window.location.reload();
                                }}
                                style={{
                                    background: '#ef4444',
                                    border: 'none',
                                    color: 'white',
                                    padding: '0.6rem 1.25rem',
                                    borderRadius: '6px',
                                    fontWeight: '600',
                                    cursor: 'pointer',
                                    boxShadow: '0 2px 4px rgba(239, 68, 68, 0.2)'
                                }}
                            >
                                Sign Out
                            </button>
                        </div>
                    </div>
                </div>
            )}



            {/* User Modal */}

            {/* Styles */}
            <style jsx>{`
        .tab-btn { background: transparent; border: none; color: #94a3b8; padding: 0.5rem 1rem; cursor: pointer; font-size: 1rem; border-bottom: 2px solid transparent; }
        .tab-btn.active { color: #38bdf8; border-bottom-color: #38bdf8; }
        .p-2 { padding: 0.75rem; }
        .btn-primary { background: #38bdf8; color: #0f172a; border: none; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer; font-weight: bold; }
        .btn-sm { color: white; border: none; padding: 4px 8px; border-radius: 4px; cursor: pointer; font-size: 0.8rem; }
        .modal-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.8); display: flex; justify-content: center; alignItems: center; z-index: 1000; backdrop-filter: blur(2px); }
        .modal-content { background: #1e293b; padding: 2rem; border: 1px solid #334155; width: 66vw; max-width: 1200px; }
        .form-group { margin-bottom: 1rem; }
        .form-group label { display: block; marginBottom: 0.5rem; color: #cbd5e1; }
        input, textarea { background: #0f172a; border: 1px solid #334155; color: white; borderRadius: 4px; }
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        details[open] > summary .details-arrow { transform: rotate(90deg); }
        details > summary:hover { background: rgba(30, 41, 59, 0.8) !important; }
        details > summary::-webkit-details-marker { display: none; }
        details > summary::marker { display: none; content: ''; }
        @keyframes pulse-dot { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.5; transform: scale(1.3); } }
        
        .detail-section { margin-bottom: 1.5rem; padding-bottom: 1.5rem; border-bottom: 1px solid #334155; }
        .detail-section:last-child { border-bottom: none; }
        .detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
        .detail-row { margin-bottom: 1rem; }
        .code-block { background: #0f172a; padding: 0.8rem; border-radius: 6px; font-family: monospace; white-space: pre-wrap; font-size: 0.9rem; color: #e2e8f0; }
        .status-box { padding: 1rem; border-radius: 6px; text-align: center; }
        .status-box.good { background: rgba(74, 222, 128, 0.1); border: 1px solid #4ade80; color: #4ade80; }
        .status-box.bad { background: rgba(248, 113, 113, 0.1); border: 1px solid #f87171; color: #f87171; }
        
        h4 { color: #38bdf8; margin-bottom: 1rem; margin-top: 0; }
        .text-sm { font-size: 0.875rem; }
        .text-xl { font-size: 1.25rem; }
        .text-2xl { font-size: 1.5rem; }
        .font-bold { font-weight: 700; }
        .text-slate-400 { color: #94a3b8; }
        .text-green-400 { color: #4ade80; }
        .text-red-400 { color: #f87171; }
        .dropdown-content { display: none; }
        .dropdown-trigger:hover + .dropdown-content, .dropdown-content:hover { display: block; }
      `}</style>
        </div >
    );
}
