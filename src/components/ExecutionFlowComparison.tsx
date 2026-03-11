'use client';

import { useEffect, useState } from 'react';

interface ExecutionFlowComparisonProps {
  executionId: string;
  skillId?: string;
  user?: string | null;
}

interface MatchSummary {
  totalSteps: number;
  matchedSteps: number;
  partialSteps: number;
  unexpectedSteps: number;
  skippedSteps: number;
  orderViolations: number;
  overallScore: number;
}

interface MatchData {
  analyzed: boolean;
  mode?: 'dynamic' | 'compare';
  matchJson?: string;
  staticMermaid?: string;
  dynamicMermaid?: string;
  analysisText?: string;
  interactionCount?: number;
  currentInteractionCount?: number;
  hasUpdate?: boolean;
  matchedAt?: string;
  usedSkillName?: string;
  usedSkillVersion?: number;
}

export default function ExecutionFlowComparison({ 
  executionId, 
  skillId, 
  user 
}: ExecutionFlowComparisonProps) {
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeMode, setAnalyzeMode] = useState<'dynamic' | 'compare'>('compare');
  const [matchData, setMatchData] = useState<MatchData | null>(null);
  const [error, setError] = useState<string>('');
  const [analysisExpanded, setAnalysisExpanded] = useState(true);

  const actualSkillId = skillId && skillId.trim() ? skillId : null;

  useEffect(() => {
    fetch(`/api/executions/${executionId}/analyze-match`)
      .then(res => res.json())
      .then((data: MatchData) => {
        if (data.analyzed) {
          setMatchData(data);
        }
      })
      .catch(() => {});
  }, [executionId]);

  const handleDynamicAnalyze = async () => {
    setAnalyzing(true);
    setError('');
    setAnalyzeMode('dynamic');
    
    try {
      const res = await fetch(`/api/executions/${executionId}/analyze-match`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user, mode: 'dynamic' })
      });
      
      const result = await res.json();
      
      if (result.success) {
        setMatchData({
          analyzed: true,
          mode: 'dynamic',
          dynamicMermaid: result.dynamicMermaid,
          interactionCount: result.interactionCount,
          matchedAt: new Date().toISOString()
        });
      } else {
        setError(result.error || '分析失败');
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : '网络错误';
      setError(message);
    } finally {
      setAnalyzing(false);
    }
  };

  const handleCompareAnalyze = async () => {
    if (!actualSkillId) {
      setError('该执行记录未关联 Skill，无法进行静态对比。请使用"动态分析"功能。');
      return;
    }

    setAnalyzing(true);
    setError('');
    setAnalyzeMode('compare');
    
    try {
      const res = await fetch(`/api/executions/${executionId}/analyze-match`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user, mode: 'compare' })
      });
      
      const result = await res.json();
      
      if (result.success) {
        setMatchData({
          analyzed: true,
          mode: 'compare',
          matchJson: JSON.stringify(result.match),
          staticMermaid: result.staticMermaid,
          dynamicMermaid: result.dynamicMermaid,
          analysisText: result.match?.analysis,
          interactionCount: result.interactionCount,
          currentInteractionCount: result.currentInteractionCount,
          hasUpdate: result.hasUpdate,
          matchedAt: new Date().toISOString(),
          usedSkillName: result.usedSkillName,
          usedSkillVersion: result.usedSkillVersion
        });
      } else {
        setError(result.error || '分析失败');
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : '网络错误';
      setError(message);
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div style={{ 
      padding: '1.5rem', 
      background: '#1e293b', 
      borderRadius: '8px', 
      border: '1px solid #334155',
      marginBottom: '2rem'
    }}>
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        marginBottom: '1rem'
      }}>
        <h4 style={{ color: '#38bdf8', margin: 0, fontSize: '0.95rem' }}>
          📊 执行流程分析
        </h4>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            onClick={handleDynamicAnalyze}
            disabled={analyzing}
            style={{
              padding: '6px 16px',
              background: analyzing && analyzeMode === 'dynamic' ? '#334155' : '#22c55e',
              color: analyzing && analyzeMode === 'dynamic' ? '#94a3b8' : '#0f172a',
              border: 'none',
              borderRadius: '4px',
              cursor: analyzing ? 'not-allowed' : 'pointer',
              fontWeight: 'bold',
              fontSize: '0.85rem'
            }}
          >
            {analyzing && analyzeMode === 'dynamic' ? '分析中...' : '动态分析'}
          </button>
          <button
            onClick={handleCompareAnalyze}
            disabled={analyzing}
            style={{
              padding: '6px 16px',
              background: analyzing && analyzeMode === 'compare' ? '#334155' : '#38bdf8',
              color: analyzing && analyzeMode === 'compare' ? '#94a3b8' : '#0f172a',
              border: 'none',
              borderRadius: '4px',
              cursor: analyzing ? 'not-allowed' : 'pointer',
              fontWeight: 'bold',
              fontSize: '0.85rem'
            }}
          >
            {analyzing && analyzeMode === 'compare' ? '对比中...' : '静态对比'}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ 
          padding: '0.75rem', 
          background: 'rgba(248, 113, 113, 0.1)', 
          borderRadius: '4px', 
          color: '#f87171',
          marginBottom: '1rem',
          fontSize: '0.9rem'
        }}>
          {error}
        </div>
      )}

      {matchData && matchData.analyzed ? (
        <div>
          {matchData.mode === 'compare' && matchData.dynamicMermaid ? (
            <div style={{ marginBottom: '1rem' }}>
              <h5 style={{ color: '#94a3b8', margin: '0 0 0.5rem 0', fontSize: '0.85rem' }}>
                执行流程对比 {matchData.usedSkillName && `(${matchData.usedSkillName} v${matchData.usedSkillVersion})`}
              </h5>
              <div style={{ 
                background: '#0f172a', 
                padding: '1rem', 
                borderRadius: '6px', 
                border: '1px solid #334155',
                minHeight: '250px',
                overflowX: 'auto',
                overflowY: 'auto'
              }}>
                <MermaidRenderer code={matchData.dynamicMermaid || ''} />
              </div>
            </div>
          ) : (
            <div style={{ marginBottom: '1rem' }}>
              <h5 style={{ color: '#94a3b8', margin: '0 0 0.5rem 0', fontSize: '0.85rem' }}>
                执行轨迹
              </h5>
              <div style={{ 
                background: '#0f172a', 
                padding: '1rem', 
                borderRadius: '6px', 
                border: '1px solid #334155',
                minHeight: '180px',
                overflowX: 'auto',
                overflowY: 'auto'
              }}>
                <MermaidRenderer code={matchData.dynamicMermaid || ''} />
              </div>
            </div>
          )}

          {matchData.mode === 'compare' && matchData.matchJson && (
            (() => {
              let summary: MatchSummary | null = null;
              try {
                summary = JSON.parse(matchData.matchJson)?.summary;
              } catch {}
              
              if (!summary) return null;
              
              return (
                <div style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '1.5rem', 
                  padding: '0.75rem',
                  background: '#0f172a',
                  borderRadius: '6px',
                  marginBottom: '1rem'
                }}>
                  <div style={{ display: 'flex', gap: '1.5rem', fontSize: '0.85rem' }}>
                    <span style={{ color: '#4ade80' }}>✅ 符合预期：{summary.matchedSteps || 0}</span>
                    <span style={{ color: '#fbbf24' }}>⚠️ 部分偏离：{summary.partialSteps || 0}</span>
                    <span style={{ color: '#f87171' }}>❌ 非预期调用：{summary.unexpectedSteps || 0}</span>
                    <span style={{ color: '#94a3b8' }}>⭕ 跳过：{summary.skippedSteps || 0}</span>
                  </div>
                  <div style={{ marginLeft: 'auto', fontSize: '0.8rem', color: '#64748b' }}>
                    对话轮数: {matchData.interactionCount}
                    {matchData.hasUpdate && (
                      <span style={{ color: '#fbbf24', marginLeft: '0.5rem' }}>
                        (有更新)
                      </span>
                    )}
                  </div>
                </div>
              );
            })()
          )}

          {matchData.mode === 'compare' && matchData.analysisText && (
            <div style={{ marginBottom: '1rem' }}>
              <div 
                style={{ 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  alignItems: 'center',
                  cursor: 'pointer',
                  marginBottom: '0.5rem'
                }}
                onClick={() => setAnalysisExpanded(!analysisExpanded)}
              >
                <h5 style={{ color: '#94a3b8', margin: 0, fontSize: '0.85rem' }}>
                  执行分析
                </h5>
                <button
                  style={{
                    background: '#334155',
                    border: 'none',
                    borderRadius: '4px',
                    color: '#94a3b8',
                    padding: '4px 8px',
                    cursor: 'pointer',
                    fontSize: '0.8rem'
                  }}
                >
                  {analysisExpanded ? '收起 ▲' : '展开 ▼'}
                </button>
              </div>
              {analysisExpanded && (
                <div style={{ 
                  background: '#0f172a', 
                  padding: '1rem', 
                  borderRadius: '6px', 
                  border: '1px solid #334155',
                  color: '#e2e8f0',
                  fontSize: '0.9rem',
                  lineHeight: 1.6,
                  whiteSpace: 'pre-wrap'
                }}>
                  {matchData.analysisText}
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div style={{ 
          color: '#64748b', 
          fontSize: '0.9rem',
          textAlign: 'center',
          padding: '2rem'
        }}>
          <div style={{ marginBottom: '0.5rem' }}>
            <strong>动态分析</strong>：根据执行数据生成轨迹图，无需关联 Skill
          </div>
          <div>
            <strong>静态对比</strong>：与已解析的 Skill 流程进行对比分析
          </div>
        </div>
      )}
    </div>
  );
}

function MermaidRenderer({ code }: { code: string }) {
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string>('');

  useEffect(() => {
    const renderMermaid = async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({ 
          startOnLoad: false, 
          theme: 'dark',
          flowchart: { 
            useMaxWidth: false,
            curve: 'basis'
          },
          themeVariables: {
            fontSize: '16px'
          }
        });
        const { svg } = await mermaid.render('mermaid-exec-' + Date.now(), code);
        setSvg(svg);
        setError('');
      } catch (e) {
        console.error('Mermaid render error:', e);
        setError('渲染失败');
      }
    };
    if (code) renderMermaid();
  }, [code]);

  if (error) {
    return <div style={{ color: '#f87171' }}>{error}</div>;
  }

  if (!svg) {
    return <div style={{ color: '#64748b' }}>加载中...</div>;
  }

  return (
    <div 
      style={{ 
        width: '100%', 
        display: 'flex', 
        justifyContent: 'flex-start',
        alignItems: 'flex-start',
        minWidth: 'max-content'
      }}
      dangerouslySetInnerHTML={{ __html: svg }} 
    />
  );
}
