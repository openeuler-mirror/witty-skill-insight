'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';

interface SkillData {
  id: string;
  name: string;
  description?: string;
  category?: string;
  activeVersion: number;
}

interface SkillVersionData {
  version: number;
  content: string;
  changeLog?: string;
  createdAt: string;
}

interface InvokedSkill {
  name: string;
  version: number | null;
}

interface RoutingSkillBreakdown {
  skill: string;
  expected: boolean;
  invoked: boolean;
  matched: boolean;
  status: 'matched' | 'missed' | 'unexpected' | 'not_applicable';
  expected_version: number | null;
  invoked_version: number | null;
}

interface OutcomeSkillBreakdown {
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

interface RoutingEvaluation {
  status: 'available' | 'missing';
  matched_query?: string;
  matched_intent?: string;
  matched_anchors?: string[];
  recall_rate: number | null;
  expected_count: number;
  matched_count: number;
  skill_breakdown: RoutingSkillBreakdown[];
}

interface OutcomeEvaluation {
  status: 'available' | 'missing' | 'pending';
  matched_query?: string;
  matched_skill?: string;
  matched_skill_version?: number | null;
  score: number | null;
  reason?: string;
  root_cause_count: number;
  key_action_count: number;
  skill_breakdown: OutcomeSkillBreakdown[];
}

interface SkillLogEntry {
  task_id?: string;
  upload_id?: string;
  timestamp?: string;
  query?: string;
  final_result?: string;
  answer_score?: number | null;
  judgment_reason?: string;
  failures?: {
    failure_type: string;
    description: string;
    context: string;
    recovery: string;
  }[];
  skill_issues?: {
    content?: string;
    improvement_suggestion?: string;
  }[];
  label?: string | null;
  skill_version?: number | null;
  invoked_skills?: InvokedSkill[];
  routing_evaluation?: RoutingEvaluation | null;
  outcome_evaluation?: OutcomeEvaluation | null;
  focused_routing?: RoutingSkillBreakdown | null;
  focused_outcome?: OutcomeSkillBreakdown | null;
}

const cardStyle: React.CSSProperties = {
  background: '#111827',
  border: '1px solid #1f2937',
  borderRadius: '14px',
  padding: '1rem',
};

function formatDateTime(value?: string) {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function truncateText(value?: string, max = 180) {
  if (!value) return '--';
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function formatSkillVersion(value: number | null | undefined) {
  return value != null ? `v${value}` : 'unversioned';
}

function formatInvokedSkills(skills: InvokedSkill[] = []) {
  if (skills.length === 0) return '--';
  return skills
    .map(skill => `${skill.name}${skill.version != null ? ` v${skill.version}` : ''}`)
    .join(', ');
}

function getRoutingStatusMeta(status?: RoutingSkillBreakdown['status'] | 'missing_dataset') {
  switch (status) {
    case 'matched':
      return { label: 'Matched', color: '#4ade80', background: 'rgba(74, 222, 128, 0.12)', border: 'rgba(74, 222, 128, 0.35)' };
    case 'missed':
      return { label: 'Missed', color: '#f87171', background: 'rgba(248, 113, 113, 0.12)', border: 'rgba(248, 113, 113, 0.35)' };
    case 'unexpected':
      return { label: 'Unexpected', color: '#fbbf24', background: 'rgba(251, 191, 36, 0.12)', border: 'rgba(251, 191, 36, 0.35)' };
    case 'missing_dataset':
      return { label: 'No routing dataset', color: '#94a3b8', background: 'rgba(148, 163, 184, 0.12)', border: 'rgba(148, 163, 184, 0.35)' };
    default:
      return { label: 'Context only', color: '#94a3b8', background: 'rgba(148, 163, 184, 0.12)', border: 'rgba(148, 163, 184, 0.35)' };
  }
}

function getOutcomeStatusMeta(status?: OutcomeEvaluation['status']) {
  switch (status) {
    case 'available':
      return { label: 'Available', color: '#4ade80', background: 'rgba(74, 222, 128, 0.12)', border: 'rgba(74, 222, 128, 0.35)' };
    case 'pending':
      return { label: 'Pending', color: '#38bdf8', background: 'rgba(56, 189, 248, 0.12)', border: 'rgba(56, 189, 248, 0.35)' };
    default:
      return { label: 'No outcome dataset', color: '#94a3b8', background: 'rgba(148, 163, 184, 0.12)', border: 'rgba(148, 163, 184, 0.35)' };
  }
}

function MetricCard({ title, value, hint }: { title: string; value: string; hint: string }) {
  return (
    <div style={{ ...cardStyle, minHeight: '122px' }}>
      <div style={{ color: '#94a3b8', fontSize: '0.85rem', marginBottom: '0.5rem' }}>{title}</div>
      <div style={{ color: '#f8fafc', fontWeight: 800, fontSize: '1.8rem', marginBottom: '0.35rem' }}>{value}</div>
      <div style={{ color: '#64748b', fontSize: '0.8rem', lineHeight: 1.6 }}>{hint}</div>
    </div>
  );
}

function SkillContent() {
  const searchParams = useSearchParams();
  const skillId = searchParams.get('id');
  const skillName = searchParams.get('name');
  const user = searchParams.get('user') || undefined;
  const version = searchParams.get('version');

  const [skill, setSkill] = useState<SkillData | null>(null);
  const [skillVersion, setSkillVersion] = useState<SkillVersionData | null>(null);
  const [logs, setLogs] = useState<SkillLogEntry[]>([]);
  const [expandedRecordId, setExpandedRecordId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [logsLoading, setLogsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchSkill() {
      setLoading(true);
      setError(null);

      try {
        let skillData: SkillData | null = null;

        if (skillId) {
          const res = await apiFetch(`/api/skills/${skillId}`);
          if (res.ok) {
            skillData = await res.json();
          }
        } else if (skillName) {
          const params = new URLSearchParams({ name: skillName });
          if (user) params.set('user', user);
          const res = await apiFetch(`/api/skills/by-name?${params.toString()}`);
          if (res.ok) {
            skillData = await res.json();
          }
        }

        if (!skillData) {
          setError('Skill not found');
          setLoading(false);
          return;
        }

        setSkill(skillData);

        const versionNum = version ? parseInt(version, 10) : skillData.activeVersion;
        const versionRes = await apiFetch(`/api/skills/${skillData.id}/versions/${versionNum}`);
        if (versionRes.ok) {
          setSkillVersion(await versionRes.json());
        }
      } catch {
        setError('Failed to load skill');
      }

      setLoading(false);
    }

    fetchSkill();
  }, [skillId, skillName, user, version]);

  useEffect(() => {
    async function fetchLogs() {
      if (!skill?.name) return;

      setLogsLoading(true);
      try {
        const params = new URLSearchParams({
          skill: skill.name,
          limit: '50',
        });

        const res = await apiFetch(`/api/skills/logs?${params.toString()}`);
        if (res.ok) {
          const data = await res.json();
          setLogs(Array.isArray(data) ? data : []);
          if (Array.isArray(data) && data.length > 0) {
            setExpandedRecordId(data[0].task_id || data[0].upload_id || null);
          }
        } else {
          setLogs([]);
        }
      } catch {
        setLogs([]);
      }
      setLogsLoading(false);
    }

    fetchLogs();
  }, [skill, version]);

  const summary = useMemo(() => {
    const routingRelevant = logs.filter(log => log.focused_routing?.expected);
    const routingMatched = routingRelevant.filter(log => log.focused_routing?.status === 'matched').length;
    const routingMissed = routingRelevant.filter(log => log.focused_routing?.status === 'missed').length;
    const routingUnexpected = logs.filter(log => log.focused_routing?.status === 'unexpected').length;

    const outcomeAvailable = logs.filter(log => log.outcome_evaluation?.status === 'available' && log.focused_outcome?.score != null);
    const outcomePending = logs.filter(log => log.outcome_evaluation?.status === 'pending').length;
    const avgOutcomeScore = outcomeAvailable.length > 0
      ? outcomeAvailable.reduce((sum, log) => sum + (log.focused_outcome?.score || 0), 0) / outcomeAvailable.length
      : null;

    const primaryRuns = logs.filter(log => log.focused_outcome?.role === 'primary').length;
    const invokedRuns = logs.filter(log => log.focused_outcome?.is_invoked).length;

    return {
      totalRuns: logs.length,
      routingRelevantCount: routingRelevant.length,
      routingMatched,
      routingMissed,
      routingUnexpected,
      routingHitRate: routingRelevant.length > 0 ? routingMatched / routingRelevant.length : null,
      avgOutcomeScore,
      outcomeAvailableCount: outcomeAvailable.length,
      outcomePending,
      primaryRuns,
      invokedRuns,
    };
  }, [logs]);

  if (loading) {
    return (
      <div style={{ padding: '2rem', color: '#e2e8f0' }}>
        <p>Loading skill...</p>
      </div>
    );
  }

  if (error || !skill) {
    return (
      <div style={{ padding: '2rem', color: '#e2e8f0' }}>
        <Link href="/" style={{ color: '#60a5fa', marginBottom: '1rem', display: 'inline-block' }}>
          ← Back to Dashboard
        </Link>
        <h1 style={{ color: '#f87171' }}>Skill Not Found</h1>
        <p style={{ color: '#94a3b8' }}>
          {error || 'The requested skill could not be found. It may have been deleted.'}
        </p>
      </div>
    );
  }

  return (
    <div style={{ padding: '2rem', color: '#e2e8f0', maxWidth: '1280px', margin: '0 auto' }}>
      <Link href="/" style={{ color: '#60a5fa', marginBottom: '1rem', display: 'inline-block' }}>
        ← Back to Dashboard
      </Link>

      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '2rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>
          {skill.name}
        </h1>
        <p style={{ color: '#94a3b8', fontSize: '0.95rem', lineHeight: 1.7, margin: 0 }}>
          Category: {skill.category || 'Other'} | Viewing version: {version || skill.activeVersion}
        </p>
        <p style={{ color: '#64748b', fontSize: '0.85rem', lineHeight: 1.7, marginTop: '0.45rem' }}>
          This page expands routing and outcome evaluation around the current skill, not around a single query. Outcome score is still shared by the full execution and is shown here as this skill's execution context. The execution panel spans this skill across available runs, while the content panel is anchored to the selected version.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        <MetricCard
          title="Tracked Runs"
          value={String(summary.totalRuns)}
          hint="Executions in which this skill appeared as primary or invoked skill."
        />
        <MetricCard
          title="Routing Hit Rate"
          value={summary.routingHitRate != null ? `${(summary.routingHitRate * 100).toFixed(0)}%` : '--'}
          hint={summary.routingRelevantCount > 0
            ? `${summary.routingMatched}/${summary.routingRelevantCount} expected routing cases matched this skill.`
            : 'No routing dataset currently expects this skill.'}
        />
        <MetricCard
          title="Average Outcome Score"
          value={summary.avgOutcomeScore != null ? summary.avgOutcomeScore.toFixed(2) : '--'}
          hint={summary.outcomeAvailableCount > 0
            ? `Average shared execution score across ${summary.outcomeAvailableCount} evaluated runs.`
            : 'No completed outcome evaluation is available yet.'}
        />
        <MetricCard
          title="Skill Roles"
          value={`${summary.primaryRuns}/${summary.invokedRuns}`}
          hint="Primary runs / total runs where this skill was actually invoked."
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
        <div style={cardStyle}>
          <h3 style={{ marginTop: 0, marginBottom: '0.75rem', color: '#f8fafc' }}>Routing Lens</h3>
          <div style={{ color: '#cbd5e1', lineHeight: 1.8, fontSize: '0.9rem' }}>
            <div><strong style={{ color: '#94a3b8' }}>Matched:</strong> {summary.routingMatched}</div>
            <div><strong style={{ color: '#94a3b8' }}>Missed:</strong> {summary.routingMissed}</div>
            <div><strong style={{ color: '#94a3b8' }}>Unexpected:</strong> {summary.routingUnexpected}</div>
          </div>
        </div>

        <div style={cardStyle}>
          <h3 style={{ marginTop: 0, marginBottom: '0.75rem', color: '#f8fafc' }}>Outcome Lens</h3>
          <div style={{ color: '#cbd5e1', lineHeight: 1.8, fontSize: '0.9rem' }}>
            <div><strong style={{ color: '#94a3b8' }}>Available:</strong> {summary.outcomeAvailableCount}</div>
            <div><strong style={{ color: '#94a3b8' }}>Pending:</strong> {summary.outcomePending}</div>
            <div><strong style={{ color: '#94a3b8' }}>Interpretation:</strong> Outcome is execution-level, viewed from this skill's participation.</div>
          </div>
        </div>
      </div>

      {skill.description && (
        <div style={{ ...cardStyle, marginBottom: '1.5rem' }}>
          <h3 style={{ color: '#94a3b8', marginBottom: '0.5rem', marginTop: 0 }}>Description</h3>
          <p style={{ margin: 0, lineHeight: 1.7 }}>{skill.description}</p>
        </div>
      )}

      {skillVersion?.changeLog && (
        <div style={{ ...cardStyle, marginBottom: '1.5rem' }}>
          <h3 style={{ color: '#94a3b8', marginBottom: '0.5rem', marginTop: 0 }}>Change Log</h3>
          <p style={{ margin: 0, lineHeight: 1.7 }}>{skillVersion.changeLog}</p>
        </div>
      )}

      <div style={{ ...cardStyle, marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', marginBottom: '0.75rem' }}>
          <h3 style={{ color: '#f8fafc', margin: 0 }}>Skill-Centric Execution Review</h3>
          <span style={{ color: '#64748b', fontSize: '0.82rem' }}>
            {logsLoading ? 'Loading runs...' : `${logs.length} run(s)`}
          </span>
        </div>

        {logsLoading ? (
          <div style={{ color: '#94a3b8', padding: '1rem 0' }}>Loading recent executions...</div>
        ) : logs.length === 0 ? (
          <div style={{ color: '#94a3b8', padding: '1rem 0' }}>
            No execution history is available for this skill version yet.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            {logs.map(log => {
              const recordId = log.task_id || log.upload_id || `${log.timestamp}-${log.query}`;
              const isExpanded = expandedRecordId === recordId;
              const routingMeta = getRoutingStatusMeta(log.focused_routing?.status);
              const outcomeMeta = getOutcomeStatusMeta(log.outcome_evaluation?.status);

              return (
                <div
                  key={recordId}
                  style={{
                    border: '1px solid #1f2937',
                    borderRadius: '12px',
                    background: '#0f172a',
                    overflow: 'hidden',
                  }}
                >
                  <button
                    onClick={() => setExpandedRecordId(isExpanded ? null : recordId)}
                    style={{
                      width: '100%',
                      padding: '1rem',
                      background: 'transparent',
                      border: 'none',
                      textAlign: 'left',
                      cursor: 'pointer',
                      color: '#e2e8f0',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'flex-start' }}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ color: '#f8fafc', fontWeight: 700, marginBottom: '0.35rem' }}>
                          {truncateText(log.query, 140)}
                        </div>
                        <div style={{ color: '#64748b', fontSize: '0.82rem' }}>
                          {formatDateTime(log.timestamp)} | {log.label || formatSkillVersion(log.skill_version)}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        <span style={{ padding: '0.28rem 0.55rem', borderRadius: '999px', fontSize: '0.78rem', color: routingMeta.color, background: routingMeta.background, border: `1px solid ${routingMeta.border}` }}>
                          Routing: {routingMeta.label}
                        </span>
                        <span style={{ padding: '0.28rem 0.55rem', borderRadius: '999px', fontSize: '0.78rem', color: outcomeMeta.color, background: outcomeMeta.background, border: `1px solid ${outcomeMeta.border}` }}>
                          Outcome: {outcomeMeta.label}
                        </span>
                      </div>
                    </div>
                  </button>

                  {isExpanded && (
                    <div style={{ padding: '0 1rem 1rem 1rem', borderTop: '1px solid #1f2937' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '0.85rem', marginTop: '1rem' }}>
                        <div style={{ ...cardStyle, background: '#111827', padding: '0.9rem' }}>
                          <div style={{ color: '#f8fafc', fontWeight: 700, marginBottom: '0.55rem' }}>Routing for This Skill</div>
                          <div style={{ color: '#cbd5e1', fontSize: '0.88rem', lineHeight: 1.8 }}>
                            <div><strong style={{ color: '#94a3b8' }}>Status:</strong> {routingMeta.label}</div>
                            <div><strong style={{ color: '#94a3b8' }}>Expected Version:</strong> {formatSkillVersion(log.focused_routing?.expected_version)}</div>
                            <div><strong style={{ color: '#94a3b8' }}>Invoked Version:</strong> {formatSkillVersion(log.focused_routing?.invoked_version)}</div>
                            <div><strong style={{ color: '#94a3b8' }}>Matched Query:</strong> {log.routing_evaluation?.matched_query || '--'}</div>
                            {log.routing_evaluation?.matched_intent && <div><strong style={{ color: '#94a3b8' }}>Matched Intent:</strong> {log.routing_evaluation.matched_intent}</div>}
                            {log.routing_evaluation?.matched_anchors?.length ? <div><strong style={{ color: '#94a3b8' }}>Matched Anchors:</strong> {log.routing_evaluation.matched_anchors.join(', ')}</div> : null}
                          </div>
                        </div>

                        <div style={{ ...cardStyle, background: '#111827', padding: '0.9rem' }}>
                          <div style={{ color: '#f8fafc', fontWeight: 700, marginBottom: '0.55rem' }}>Outcome for This Skill Context</div>
                          <div style={{ color: '#cbd5e1', fontSize: '0.88rem', lineHeight: 1.8 }}>
                            <div><strong style={{ color: '#94a3b8' }}>Role:</strong> {log.focused_outcome?.role || '--'}</div>
                            <div><strong style={{ color: '#94a3b8' }}>Shared Score:</strong> {log.focused_outcome?.score != null ? log.focused_outcome.score.toFixed(2) : '--'}</div>
                            <div><strong style={{ color: '#94a3b8' }}>Criteria Count:</strong> {log.outcome_evaluation ? log.outcome_evaluation.root_cause_count + log.outcome_evaluation.key_action_count : '--'}</div>
                            <div><strong style={{ color: '#94a3b8' }}>Matched Skill:</strong> {log.outcome_evaluation?.matched_skill ? `${log.outcome_evaluation.matched_skill}${log.outcome_evaluation.matched_skill_version != null ? ` v${log.outcome_evaluation.matched_skill_version}` : ''}` : '--'}</div>
                            {log.outcome_evaluation?.matched_query && <div><strong style={{ color: '#94a3b8' }}>Source Scenario:</strong> {log.outcome_evaluation.matched_query}</div>}
                          </div>
                        </div>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: '0.85rem', marginTop: '0.85rem' }}>
                        <div style={{ ...cardStyle, background: '#111827', padding: '0.9rem' }}>
                          <div style={{ color: '#f8fafc', fontWeight: 700, marginBottom: '0.55rem' }}>Execution Outcome Reason</div>
                          <div style={{ color: '#cbd5e1', fontSize: '0.88rem', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
                            {log.outcome_evaluation?.reason || log.judgment_reason || '--'}
                          </div>
                        </div>

                        <div style={{ ...cardStyle, background: '#111827', padding: '0.9rem' }}>
                          <div style={{ color: '#f8fafc', fontWeight: 700, marginBottom: '0.55rem' }}>Execution Context</div>
                          <div style={{ color: '#cbd5e1', fontSize: '0.88rem', lineHeight: 1.8 }}>
                            <div><strong style={{ color: '#94a3b8' }}>Invoked Skills:</strong> {formatInvokedSkills(log.invoked_skills)}</div>
                            <div><strong style={{ color: '#94a3b8' }}>Failures:</strong> {log.failures?.length || 0}</div>
                            <div><strong style={{ color: '#94a3b8' }}>Skill Issues:</strong> {log.skill_issues?.length || 0}</div>
                          </div>
                          {recordId && (
                            <div style={{ marginTop: '0.75rem' }}>
                              <Link
                                href={`/details?expandTaskId=${encodeURIComponent(recordId)}`}
                                style={{ color: '#60a5fa', fontSize: '0.85rem', textDecoration: 'underline' }}
                              >
                                Open execution details
                              </Link>
                            </div>
                          )}
                        </div>
                      </div>

                      {log.final_result && (
                        <div style={{ ...cardStyle, background: '#111827', padding: '0.9rem', marginTop: '0.85rem' }}>
                          <div style={{ color: '#f8fafc', fontWeight: 700, marginBottom: '0.55rem' }}>Final Result Preview</div>
                          <div style={{ color: '#cbd5e1', fontSize: '0.88rem', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
                            {truncateText(log.final_result, 600)}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {skillVersion?.content && (
        <div style={{ marginBottom: '2rem' }}>
          <h3 style={{ color: '#94a3b8', marginBottom: '0.5rem' }}>Skill Content</h3>
          <pre style={{
            padding: '1rem',
            background: '#0f172a',
            borderRadius: '8px',
            overflow: 'auto',
            fontSize: '0.85rem',
            whiteSpace: 'pre-wrap',
            border: '1px solid #1f2937',
          }}>
            {skillVersion.content}
          </pre>
        </div>
      )}
    </div>
  );
}

function LoadingFallback() {
  return (
    <div style={{ padding: '2rem', color: '#e2e8f0' }}>
      <p>Loading skill...</p>
    </div>
  );
}

export default function SkillDetailPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <SkillContent />
    </Suspense>
  );
}
