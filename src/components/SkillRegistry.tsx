'use client';

import { useAuth } from '@/lib/auth-context';
import { useLocale } from '@/lib/locale-context';
import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/api'
import { useTheme, useThemeColors } from '@/lib/theme-context';

// Types matching Backend Response
interface Skill {
  id: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  author: string;
  updatedAt: string;
  version: number;
  semanticVersion?: string;
  activeVersion: number;
  visibility: string;
  qualityScore: number;
  usageCount: number;
  successRate: number;
  isUploaded: boolean;
}

interface SkillVersion {
  id: string;
  version: number;
  semanticVersion?: string;
  changeLog: string;
  createdAt: string;
}

// --- Components ---

function EnterpriseSync({ onSuccess }: { onSuccess: () => void }) {
  const { apiKey } = useAuth();
    const { isDark } = useTheme();
    const { t } = useLocale();
    const c = useThemeColors();

  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<any>(null);
  const [syncProgress, setSyncProgress] = useState('');

  const handleSyncFromEnterprise = async () => {
    setSyncing(true);
    setSyncProgress(t('skill.syncingProgress'));
    setSyncResult(null);

    try {
      const res = await apiFetch('/api/skills/sync-enterprise', {
        method: 'POST',
        headers: apiKey ? { 'x-witty-api-key': apiKey } : {}
      });

      const result = await res.json();
      if (res.ok) {
        setSyncProgress(t('skill.syncComplete'));
        setSyncResult(result);
        onSuccess();
      } else {
        setSyncProgress(`同步失败: ${result.error}`);
        alert(`同步失败: ${result.error}`);
      }
    } catch (err: any) {
      setSyncProgress(`同步出错: ${err.message}`);
      alert(t('skill.syncError'));
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="upload-card">
      <div style={{ fontSize: '3rem', marginBottom: '1rem', color: c.fgMuted }}>🔄</div>
      <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.5rem', color: c.fg }}>
        {t('skill.syncFromEnterprise')}
      </h3>
      <p style={{ color: c.fgSecondary, marginBottom: '1.5rem', maxWidth: '400px', fontSize: '0.9rem', lineHeight: 1.5 }}>
        {t('skill.syncDescription')}
      </p>

      <button
        className="btn-primary"
        onClick={handleSyncFromEnterprise}
        disabled={syncing}
        style={{
          opacity: syncing ? 0.6 : 1,
          cursor: syncing ? 'not-allowed' : 'pointer'
        }}
      >
        {syncing ? t('skill.syncing') : t('skill.syncStart')}
      </button>

      {syncProgress && (
        <div style={{ marginTop: '1rem', color: c.fgSecondary, fontSize: '0.9rem' }}>
          {syncProgress}
        </div>
      )}

      {syncResult && (
        <div style={{ marginTop: '1rem', padding: '1rem', backgroundColor: '#e4e4e7', borderRadius: '0.5rem' }}>
          <div style={{ fontWeight: 600, marginBottom: '0.5rem' }}>{t('skill.syncResult')}</div>
          <div>{t('skill.totalSkillsCount')}: {syncResult.totalSkills}</div>
          <div style={{ color: c.success }}>{t('skill.successCount')}: {syncResult.successCount}</div>
          <div style={{ color: c.error }}>{t('skill.failedCount')}: {syncResult.failedCount}</div>
          {syncResult.failedCount > 0 && (
            <details style={{ marginTop: '0.5rem' }}>
              <summary style={{ cursor: 'pointer', color: c.fgSecondary }}>{t('common.seeDetails')}</summary>
              <ul style={{ marginTop: '0.5rem', paddingLeft: '1.5rem' }}>
                {syncResult.results.filter((r: any) => !r.success).map((r: any, i: number) => (
                  <li key={i} style={{ color: c.error }}>
                    {r.skillName} (v{r.version}): {r.error}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function SkillUpload({ onSuccess }: { onSuccess: () => void }) {
  const { isDark } = useTheme();
  const { t } = useLocale();
  const c = useThemeColors();
  const { user } = useAuth();
  const [uploading, setUploading] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFolderSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    setLogs([t('skill.preparingUpload')]);

    const formData = new FormData();
    if (user) formData.append('user', user);
    for (let i = 0; i < files.length; i++) {
      formData.append('files', files[i]);
      formData.append('paths', files[i].webkitRelativePath);
    }

    try {
      setLogs(prev => [...prev, `Uploading ${files.length} files...`]);
      const res = await apiFetch('/api/skills/upload', {
        method: 'POST',
        body: formData
      });

      const result = await res.json();
      if (res.ok) {
        setLogs(prev => [...prev, 'Upload successful!', `Skill: ${result.skill.name} (v${result.version.version})`]);
        alert(t('skill.uploadSuccess'));
        onSuccess();
      } else {
        setLogs(prev => [...prev, `Error: ${result.error}`]);
        alert(`上传失败: ${result.error}`);
      }
    } catch (err: any) {
      setLogs(prev => [...prev, `Network Error: ${err.message}`]);
      alert(t('skill.uploadError'));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="upload-card">
      <div style={{ fontSize: '3rem', marginBottom: '1rem', color: c.fgMuted }}>📂</div>
      <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.5rem', color: c.fg }}>{t('skill.uploadTitle')}</h3>
      <p style={{ color: c.fgSecondary, marginBottom: '1.5rem', maxWidth: '400px', fontSize: '0.9rem', lineHeight: 1.5 }}>
        {t('skill.uploadDescription')}
        <br /><span style={{ color: c.warning }}>{t('skill.uploadNote1')}</span>
        <br /><span style={{ color: c.error, fontWeight: 'bold' }}>{t('skill.uploadNote2')}</span>
      </p>

      <div style={{ position: 'relative', display: 'inline-block' }}>
        <button
          className="btn-primary"
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem 1.5rem', fontSize: '1rem' }}
          onClick={() => fileInputRef.current?.click()}
        >
          <span>{t('skill.selectFolder')}</span>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          // @ts-ignore
          webkitdirectory=""
          directory=""
          multiple
          style={{ display: 'none' }}
          onChange={handleFolderSelect}
        />
      </div>

      {logs.length > 0 && (
        <div style={{ marginTop: '2rem', width: '100%', maxWidth: '600px', textAlign: 'left', background: c.bgSecondary, padding: '1rem', borderRadius: '0.5rem', maxHeight: '150px', overflowY: 'auto' }}>
          {logs.map((log, i) => (
            <div key={i} style={{ color: c.fgSecondary, fontSize: '0.8rem', fontFamily: 'monospace', marginBottom: '4px', borderBottom: `1px solid ${c.border}`, paddingBottom: '2px' }}>{log}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function SkillVersionDetailModal({ skillId, version, onClose }: { skillId: string, version: number, onClose: () => void }) {
  const { isDark } = useTheme();
  const { t } = useLocale();
  const c = useThemeColors();
  const { user } = useAuth();
  const [detail, setDetail] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [parsing, setParsing] = useState(false);
  const [parsedFlow, setParsedFlow] = useState<any>(null);
  const [autoParsing, setAutoParsing] = useState(false);

  useEffect(() => {
    setLoading(true);
    apiFetch(`/api/skills/${skillId}/versions/${version}?user=${encodeURIComponent(user || '')}`)
      .then(res => res.json())
      .then(d => {
        setDetail(d);
        setLoading(false);
      })
      .catch(e => {
        alert("Failed to load details");
        setLoading(false);
      });
    let pollTimer: ReturnType<typeof setTimeout> | null = null;

    const checkParsedFlow = () => {
      apiFetch(`/api/skills/${skillId}/versions/${version}/parse-flow?user=${encodeURIComponent(user || '')}`)
        .then(res => res.json())
        .then(d => {
          if (d.parsed) {
            if (!d.flowJson && !d.mermaidCode) {
              setAutoParsing(true);
              pollTimer = setTimeout(checkParsedFlow, 3000);
            } else {
              setAutoParsing(false);
              setParsedFlow(d);
            }
          } else {
            setAutoParsing(false);
          }
        })
        .catch(() => {
          setAutoParsing(false);
        });
    };

    checkParsedFlow();

    return () => {
      if (pollTimer) clearTimeout(pollTimer);
    };
  }, [skillId, version]);

  const handleParseFlow = async () => {
    setParsing(true);
    try {
      const res = await apiFetch(`/api/skills/${skillId}/versions/${version}/parse-flow`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user })
      });
      const result = await res.json();
      if (result.success) {
        setParsedFlow({
          parsed: true,
          flowJson: JSON.stringify(result.flow),
          mermaidCode: result.mermaidCode,
          parsedAt: new Date().toISOString()
        });
      } else {
        alert(`解析失败: ${result.error}`);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : t('skill.versions.unknownError');
      alert(`解析出错: ${message}`);
    } finally {
      setParsing(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 1100 }}>
      <div className="modal-content card" onClick={e => e.stopPropagation()} style={{ width: '1200px', maxWidth: '95vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}>

        <div className="modal-header-new" style={{ padding: '1rem 1.5rem', background: c.bgSecondary, borderBottom: `1px solid ${c.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 'bold', color: c.fg }}>Version Details (v{version})</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <button
              onClick={handleParseFlow}
              disabled={parsing}
              style={{
                padding: '6px 16px',
                background: parsing ? '#d4d4d8' : '#2563eb',
                color: parsing ? '#64748b' : '#ffffff',
                border: 'none',
                borderRadius: '4px',
                cursor: parsing ? 'not-allowed' : 'pointer',
                fontWeight: 'bold',
                fontSize: '0.9rem'
              }}
            >
              {parsing ? t('skill.versions.parsing') : (parsedFlow ? t('skill.versions.reparsing') : t('skill.versions.parseFlow'))}
            </button>
            <button
              onClick={onClose}
              style={{ background: 'none', border: 'none', color: c.fgSecondary, fontSize: '1.5rem', cursor: 'pointer', padding: '0 0.5rem', lineHeight: 1 }}
            >
              &times;
            </button>
          </div>
        </div>

        <div style={{ flex: 1, display: 'flex', gap: '1.5rem', padding: '1.5rem', minHeight: 0, overflowY: 'auto' }}>
          {loading ? (
             <div style={{ textAlign: 'center', padding: '2rem', color: c.fgSecondary, flex: 1 }}>Loading details...</div>
          ) : detail ? (
            <>
              <div style={{ flex: '1 1 50%', display: 'flex', flexDirection: 'column', gap: '1.5rem', minWidth: 0 }}>
                <div style={{ background: c.bgSecondary, padding: '1rem', borderRadius: '8px', border: `1px solid ${c.border}` }}>
                    <div>
                        <span style={{ color: c.fgSecondary, fontSize: '0.85rem', display: 'block', marginBottom: '4px' }}>Created At</span>
                        <div style={{ color: c.fg, fontWeight: 500 }}>{new Date(detail.createdAt).toLocaleString()}</div>
                    </div>
                </div>

                <div>
                    <h4 style={{ color: c.fgSecondary, marginBottom: '0.5rem', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>{t('skill.versions.changeLog')}</h4>
                    <div style={{ background: c.bgSecondary, padding: '1rem', borderRadius: '6px', color: c.fg, whiteSpace: 'pre-wrap', border: `1px solid ${c.border}`, fontSize: '0.9rem', lineHeight: 1.6 }}>
                        {detail.changeLog || <span style={{ color: c.fgMuted, fontStyle: 'italic' }}>{t('skill.versions.noChangeHistory')}</span>}
                    </div>
                </div>

                <div>
                     <h4 style={{ color: c.fgSecondary, marginBottom: '0.5rem', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>{t('skill.versions.skillContent')}</h4>
                     <pre style={{ 
                         background: c.bgSecondary, 
                         padding: '1rem', 
                         borderRadius: '6px', 
                         color: c.fg, 
                         overflowX: 'auto', 
                         fontFamily: 'monospace', 
                         fontSize: '0.85rem',
                         border: `1px solid ${c.border}`,
                         maxHeight: '300px',
                         whiteSpace: 'pre-wrap'
                     }}>
                         {detail.content || <span style={{ color: c.fgMuted, fontStyle: 'italic' }}>(Empty content)</span>}
                     </pre>
                </div>

                <div>
                    <h4 style={{ color: c.fgSecondary, marginBottom: '0.5rem', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Included Files</h4>
                    <div style={{ background: c.bgSecondary, padding: '1rem', borderRadius: '6px', border: `1px solid ${c.border}` }}>
                        {(() => {
                            try {
                                const files = detail.files ? JSON.parse(detail.files) : [];
                                if (files.length === 0) return <span style={{ color: c.fgMuted, fontSize: '0.9rem', fontStyle: 'italic' }}>No additional files.</span>;
                                return (
                                    <ul style={{ margin: 0, paddingLeft: '1.2rem', color: c.fgSecondary, fontSize: '0.9rem' }}>
                                        {files.map((f: string, i: number) => <li key={i} style={{ marginBottom: '4px' }}>{f}</li>)}
                                    </ul>
                                );
                            } catch (e) {
                                return <span style={{ color: c.error, fontSize: '0.9rem' }}>Error parsing file list.</span>;
                            }
                        })()}
                    </div>
                </div>
              </div>

              <div style={{ flex: '1 1 50%', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                <h4 style={{ color: c.fgSecondary, marginBottom: '0.5rem', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>{t('skill.versions.expectedFlow')}</h4>
                {parsedFlow ? (
                  <div style={{
                    background: c.bgSecondary,
                    padding: '1rem',
                    borderRadius: '6px',
                    border: `1px solid ${c.border}`,
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column'
                  }}>
                    <div style={{ marginBottom: '0.5rem', fontSize: '0.8rem', color: c.fgMuted, flexShrink: 0 }}>
                      {t('skill.versions.parsedAt')}: {new Date(parsedFlow.parsedAt).toLocaleString()}
                    </div>
                    <div style={{ flex: 1, overflow: 'auto' }}>
                      <MermaidFlowChart code={parsedFlow.mermaidCode} />
                    </div>
                  </div>
                ) : autoParsing ? (
                  <div style={{ 
                    background: '#eff6ff', 
                    padding: '2rem', 
                    borderRadius: '6px', 
                    border: '1px solid #bfdbfe', 
                    flex: 1, 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center', 
                    color: '#2563eb',
                    gap: '0.5rem'
                  }}>
                    <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>🔄</span>
                    {t('flow.autoParsingSkill')}
                  </div>
                ) : (
                  <div style={{
                    background: c.bgSecondary,
                    padding: '2rem',
                    borderRadius: '6px',
                    border: `1px solid ${c.border}`,
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: c.fgMuted
                  }}>
                    {t('skill.versions.clickParse')}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div style={{ color: c.error, textAlign: 'center', padding: '2rem', flex: 1 }}>Failed to load details.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function MermaidFlowChart({ code }: { code: string }) {
  const { isDark } = useTheme();
  const c = useThemeColors();
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string>('');

  useEffect(() => {
    const renderMermaid = async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: 'default',
          flowchart: { useMaxWidth: false }
        });
        const { svg } = await mermaid.render('mermaid-' + Date.now(), code);
        setSvg(svg);
        setError('');
      } catch (e) {
        console.error('Mermaid render error:', e);
        setError('Flow diagram render failed');
      }
    };
    if (code) renderMermaid();
  }, [code]);

  if (error) {
    return <div style={{ color: c.error }}>{error}</div>;
  }

  return (
    <div
      style={{
        width: '100%',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'flex-start'
      }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

function SkillVersionsModal({ skill, onClose, onUpdate }: { skill: Skill, onClose: () => void, onUpdate: () => void }) {
  const { isDark } = useTheme();
  const c = useThemeColors();
  const { user } = useAuth();
  const { t } = useLocale();
  const [versions, setVersions] = useState<SkillVersion[]>([]);
  const [currentActiveVersion, setCurrentActiveVersion] = useState(skill.activeVersion);
  const [hasUpdated, setHasUpdated] = useState(false);
  const [viewingVersion, setViewingVersion] = useState<number | null>(null);
  const [isEnterpriseMode, setIsEnterpriseMode] = useState(false);

  useEffect(() => {
    apiFetch(`/api/skills/${skill.id}/versions?user=${encodeURIComponent(user || '')}`)
      .then(res => res.json())
      .then(data => {
        setVersions(data);
      });
  }, [skill.id]);

  useEffect(() => {
    setCurrentActiveVersion(skill.activeVersion);
  }, [skill.activeVersion]);

  // 检查企业模式
  useEffect(() => {
    apiFetch('/api/config/status?check_org=true')
      .then(res => res.json())
      .then(data => {
        setIsEnterpriseMode(data.org_mode || false);
      })
      .catch(() => {});
  }, []);

  // Wrap onClose to trigger update if needed
  const handleClose = () => {
    if (hasUpdated) onUpdate();
    onClose();
  };

  const handleActivate = async (version: number) => {
    try {
      const res = await apiFetch(`/api/skills/${skill.id}/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version, user })
      });

      if (res.ok) {
        setCurrentActiveVersion(version);
        setHasUpdated(true);
      } else {
        const d = await res.json();
        alert(`Failed to activate: ${d.error}`);
      }
    } catch (e: any) {
      alert(`Error: ${e.message}`);
    }
  };

  const handleDeleteVersion = async (version: number) => {
    const versionObj = versions.find(v => v.version === version);
    const { semanticVersion } = versionObj || {};
    const versionDisplay = semanticVersion || version;

    const confirmMsg = isEnterpriseMode
      ? t('skill.versions.deleteConfirmOrg', { version: String(versionDisplay) })
      : t('skill.versions.deleteConfirm', { version: String(versionDisplay) });
    
    if (!confirm(confirmMsg)) return;

    try {
      const res = await apiFetch(`/api/skills/${skill.id}/versions/${version}?user=${encodeURIComponent(user || '')}`, {
        method: 'DELETE'
      });

      if (res.ok) {
        alert(`Version ${versionDisplay} deleted successfully!`);
        const vRes = await apiFetch(`/api/skills/${skill.id}/versions?user=${encodeURIComponent(user || '')}`);
        const newVersions = await vRes.json();
        setVersions(newVersions);
        setHasUpdated(true);

        if (currentActiveVersion === version && newVersions.length > 0) {
          setCurrentActiveVersion(newVersions[0].version);
        }
      } else {
        const d = await res.json();
        alert(`Failed to delete version: ${d.error}`);
      }
    } catch (e: any) {
      alert(`Error: ${e.message}`);
    }
  };

  // Upload New Version Logic
  const versionFileInputRef = useRef<HTMLInputElement>(null);
  const handleVersionFolderSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const formData = new FormData();
    formData.append('targetSkillId', skill.id);
    if (user) formData.append('user', user);

    for (let i = 0; i < files.length; i++) {
      formData.append('files', files[i]);
      formData.append('paths', files[i].webkitRelativePath);
    }

    try {
      const res = await apiFetch('/api/skills/upload', {
        method: 'POST',
        body: formData
      });
      const result = await res.json();

      if (res.ok) {
        alert(`Version v${result.version.version} uploaded successfully!`);
        // Refresh versions
        const vRes = await apiFetch(`/api/skills/${skill.id}/versions?user=${encodeURIComponent(user || '')}`);
        setVersions(await vRes.json());
        setHasUpdated(true);
      } else {
        alert(`Upload failed: ${result.error}`);
      }
    } catch (err: any) {
      alert(`Upload error: ${err.message}`);
    } finally {
      if (versionFileInputRef.current) versionFileInputRef.current.value = '';
    }
  };

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal-window-lg" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="modal-header-new">
          <div>
            <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 'bold', color: c.fg }}>{skill.name}</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.25rem', fontSize: '0.875rem', color: c.fgSecondary }}>
              <span>{t('skill.versions.currentUsing')}</span>
              <span style={{ color: c.success, fontFamily: 'monospace', fontWeight: 'bold', background: c.successSubtle, padding: '0 6px', borderRadius: '4px' }}>
                v{versions.find(v => v.version === currentActiveVersion)?.semanticVersion || currentActiveVersion}
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <button
              className="btn-primary"
              style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
              onClick={() => versionFileInputRef.current?.click()}
            >
              <span>{t('skill.versions.uploadNewVersion')}</span>
            </button>
            <button
              onClick={handleClose}
              style={{ background: 'none', border: 'none', color: c.fgSecondary, fontSize: '1.5rem', cursor: 'pointer', padding: '0 0.5rem' }}
            >
              &times;
            </button>
          </div>
          <input
            ref={versionFileInputRef}
            type="file"
            // @ts-ignore
            webkitdirectory=""
            directory=""
            multiple
            style={{ display: 'none' }}
            onChange={handleVersionFolderSelect}
          />
        </div>

        {/* Content Table */}
        <div className="modal-content-scroll">
          <table className="version-table w-full text-left order-collapse">
            <thead>
              <tr>
                <th style={{ width: '120px' }}>{t('skill.versions.version')}</th>
                <th>{t('skill.versions.changeLog')}</th>
                <th style={{ textAlign: 'right', width: '220px' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {versions.map(v => {
                const isActive = v.version === currentActiveVersion;
                return (
                  <tr key={v.id} className={`version-row ${isActive ? 'version-active-row' : ''}`}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '1rem', fontFamily: 'monospace', fontWeight: 'bold', color: isActive ? '#16a34a' : '#2563eb' }}>
                          v{v.semanticVersion || v.version}
                        </span>
                        {isActive && (
                          <span style={{
                            fontSize: '0.7rem',
                            backgroundColor: 'rgba(22, 163, 74, 0.15)',
                            color: c.success,
                            padding: '2px 6px',
                            borderRadius: '4px',
                            fontWeight: 'bold',
                            border: '1px solid rgba(22, 163, 74, 0.3)'
                          }}>
                            ACTIVE
                          </span>
                        )}
                      </div>
                      <span style={{ fontSize: '0.75rem', color: c.fgMuted }}>{new Date(v.createdAt).toLocaleDateString()}</span>
                    </td>
                    <td>
                      <p style={{ margin: 0, color: c.fg, whiteSpace: 'pre-wrap', lineHeight: 1.6, fontSize: '0.9rem' }}>
                        {v.changeLog || <span style={{ color: c.fgMuted, fontStyle: 'italic' }}>{t('skill.versions.noChangeHistory')}</span>}
                      </p>
                    </td>
                    <td style={{ textAlign: 'right', minWidth: '280px' }}>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', flexWrap: 'nowrap', alignItems: 'center' }}>
                          <button
                            onClick={() => setViewingVersion(v.version)}
                            className="btn-sm"
                            style={{
                              background: c.bgTertiary,
                              border: `1px solid ${c.borderDark}`,
                              padding: '6px 12px',
                              color: c.fgSecondary,
                              whiteSpace: 'nowrap',
                              fontSize: '0.85rem',
                              minWidth: '60px'
                            }}
                          >
                            {t('skill.versions.view')}
                          </button>

                          {!isActive ? (
                            <>
                              <button
                                onClick={() => handleActivate(v.version)}
                                className="btn-sm"
                                style={{
                                  background: c.primarySubtle,
                                  border: `1px solid ${c.primary}`,
                                  padding: '6px 12px',
                                  color: c.primary,
                                  whiteSpace: 'nowrap',
                                  fontSize: '0.85rem',
                                  minWidth: '85px'
                                }}
                              >
                                {t('common.activate')}
                              </button>
                              <button
                                onClick={() => handleDeleteVersion(v.version)}
                                className="btn-sm"
                                style={{
                                  background: c.errorSubtle,
                                  border: `1px solid ${c.error}`,
                                  padding: '6px 12px',
                                  color: c.error,
                                  whiteSpace: 'nowrap',
                                  fontSize: '0.85rem',
                                  minWidth: '65px'
                                }}
                              >
                                {t('common.delete')}
                              </button>
                            </>
                          ) : (
                            <span style={{
                              padding: '6px 12px',
                              fontSize: '0.85rem',
                              fontFamily: 'monospace',
                              color: c.success,
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px',
                              whiteSpace: 'nowrap'
                            }}>
                              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: c.success }}></span>
                              {t('common.active')}
                            </span>
                          )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>


          {versions.length === 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '200px', color: c.fgMuted }}>
              <div style={{ fontSize: '2rem', marginBottom: '1rem', opacity: 0.5 }}>📂</div>
              <p>{t('skill.versions.noVersions')}</p>
            </div>
          )}
        </div>

        {viewingVersion !== null && (
            <SkillVersionDetailModal
                skillId={skill.id}
                version={viewingVersion}
                onClose={() => setViewingVersion(null)}
            />
        )}
      </div>
    </div>
  );
}


function SkillCatalog({ refresh }: { refresh: number }) {
  const { isDark } = useTheme();
  const { t } = useLocale();
  const c = useThemeColors();
  const { user } = useAuth();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [isEnterpriseMode, setIsEnterpriseMode] = useState(false);

  const fetchSkills = () => {
    if (!user) return;
    setLoading(true);
    apiFetch(`/api/skills?user=${encodeURIComponent(user)}`)
      .then(res => res.json())
      .then(d => {
        setSkills(Array.isArray(d) ? d : []);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchSkills();
  }, [refresh]);

  // 检查企业模式
  useEffect(() => {
    apiFetch('/api/config/status?check_org=true')
      .then(res => res.json())
      .then(data => {
        setIsEnterpriseMode(data.org_mode || false);
      })
      .catch(() => {});
  }, []);

  // Keep selectedSkill in sync with fetched skills
  useEffect(() => {
    if (selectedSkill) {
      const updated = skills.find(s => s.id === selectedSkill.id);
      if (updated) setSelectedSkill(updated);
    }
  }, [skills]);

  const handleDelete = async (id: string) => {
    const confirmMsg = isEnterpriseMode
      ? t('skill.enterprise.deleteConfirm')
      : t('skill.versions.deleteSkillConfirm');
    
    if (!confirm(confirmMsg)) return;

    try {
      const res = await apiFetch(`/api/skills?id=${id}&user=${encodeURIComponent(user || '')}`, { method: 'DELETE' });
      const data = await res.json();

      if (res.ok) {
        fetchSkills();
      } else {
        alert(`Failed to delete skill: ${data.error}`);
      }
    } catch (err: any) {
      alert(`Delete error: ${err.message}`);
    }
  };

  const handleToggleUpload = async (id: string, currentStatus: boolean, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const res = await apiFetch(`/api/skills/${id}/toggle`, {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({ isUploaded: !currentStatus, user })
      });
      if (res.ok) {
        fetchSkills(); // Refresh to update stats and UI
      } else {
        alert('Failed to toggle upload status');
      }
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
  };

  const totalSkills = skills.length;
  const uploadedSkills = skills.filter(s => s.isUploaded).length;

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '5rem' }}>
      <div className="loading-spinner" style={{ width: '2rem', height: '2rem', border: `2px solid ${c.border}`, borderTopColor: '#2563eb', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
      <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
    </div>
  );

  return (
    <div>
      {/* Stats Header */}
      <div className="stats-header" style={{
        display: 'flex',
        gap: '2rem',
        marginBottom: '2rem',
        background: c.bgSecondary,
        padding: '1.5rem',
        borderRadius: '0.75rem',
        border: `1px solid ${c.border}`
      }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: '0.875rem', color: c.fgSecondary, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>{t('skill.totalSkills')}</span>
          <span style={{ fontSize: '2.5rem', fontWeight: 700, color: c.fg, lineHeight: 1 }}>{totalSkills}</span>
        </div>
        <div style={{ width: '1px', background: '#e4e4e7' }}></div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: '0.875rem', color: c.fgSecondary, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>{t('skill.uploadedSkills')}</span>
          <span style={{ fontSize: '2.5rem', fontWeight: 700, color: c.success, lineHeight: 1 }}>{uploadedSkills}</span>
        </div>
      </div>

      <div className="skill-grid">
        {skills.map(skill => (
          <div key={skill.id} className="skill-card">
            {/* Header */}
            <div className="skill-card-header">
              <div>
                <h4 className="skill-title" title={skill.name}>
                  {skill.name}
                </h4>
                <div className="skill-meta">
                  <span className="skill-version-badge">
                    {skill.semanticVersion ? `v${skill.semanticVersion}` : `v${skill.version}`}
                  </span>
                  <span className="skill-date">{new Date(skill.updatedAt).toLocaleDateString()}</span>
                </div>
              </div>
              <div className="skill-icon">
                🧩
              </div>
            </div>

            {/* Body */}
            <div className="skill-body">
              <div className="skill-description">
                {skill.description || <span style={{ fontStyle: 'italic', color: c.fgMuted }}>No description provided for this skill.</span>}
              </div>

              <div className="skill-tags">
                {skill.tags?.slice(0, 3).map((tag, i) => (
                  <span key={i} className="skill-tag">
                    #{tag}
                  </span>
                ))}
                {(skill.tags?.length || 0) > 3 && <span className="skill-tag" style={{ background: 'transparent', border: 'none', color: c.fgMuted }}>+{skill.tags!.length - 3}</span>}
              </div>
            </div>

            {/* Actions */}
            <div className="skill-actions">
              {/* Upload Toggle Button */}
              <button
                onClick={(e) => handleToggleUpload(skill.id, skill.isUploaded, e)}
                className={`btn-icon ${skill.isUploaded ? 'uploaded' : ''}`}
                title={skill.isUploaded ? "Withdraw Skill (Stop Sync)" : "Upload Skill (Enable Sync)"}
                style={{
                  background: skill.isUploaded ? 'rgba(22, 163, 74, 0.1)' : 'transparent',
                  border: `1px solid ${skill.isUploaded ? '#16a34a' : '#d4d4d8'}`,
                  color: skill.isUploaded ? '#16a34a' : '#64748b',
                  padding: '0.4rem',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.2s'
                }}
              >
                {skill.isUploaded ? t('skill.catalog.uploadToggle') : t('skill.catalog.uploadNotActive')}
              </button>

              <button
                onClick={() => setSelectedSkill(skill)}
                className="btn-manage"
              >
                <span>{t('skill.catalog.manage')}</span>
              </button>
              <button
                onClick={() => handleDelete(skill.id)}
                className="btn-delete"
                title="Delete Skill"
              >
                <span>🗑️</span>
              </button>
            </div>
          </div>
        ))}

        {/* Empty State */}
        {skills.length === 0 && (
          <div className="upload-card" style={{ gridColumn: '1 / -1', background: 'transparent', borderStyle: 'dashed' }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem', opacity: 0.3 }}>📦</div>
            <p style={{ color: c.fgSecondary, fontSize: '1.2rem' }}>{t('skill.noSkill')}</p>
            <p style={{ color: c.fgMuted, fontSize: '0.9rem', marginTop: '0.5rem' }}>{t('skill.uploadSkill')}</p>
          </div>
        )}
      </div>

      {selectedSkill && (
        <SkillVersionsModal
          skill={selectedSkill}
          onClose={() => setSelectedSkill(null)}
          onUpdate={fetchSkills}
        />
      )}
    </div>
  );
}

export default function SkillRegistry() {
  const { t } = useLocale();
  const [activeTab, setActiveTab] = useState<'catalog' | 'upload'>('catalog');
  const [refreshKey, setRefreshKey] = useState(0);
  const [isEnterpriseMode, setIsEnterpriseMode] = useState(false);

  useEffect(() => {
    apiFetch('/api/config/status?check_org=true')
      .then(res => res.json())
      .then(data => {
        setIsEnterpriseMode(data.org_mode || false);
      })
      .catch(() => {});
  }, []);

  return (
    <div style={{ marginTop: '1rem' }}>
      {/* Tabs */}
      <div className="nav-tabs">
        <button
          onClick={() => setActiveTab('catalog')}
          className={`nav-tab-item ${activeTab === 'catalog' ? 'active' : ''}`}
        >
          {t('nav.catalog')}
        </button>
        <button
          onClick={() => setActiveTab('upload')}
          className={`nav-tab-item ${activeTab === 'upload' ? 'active' : ''}`}
        >
          {t('nav.upload')}
        </button>
      </div>

      {/* Content Area */}
      <div style={{ minHeight: '400px' }}>
        {activeTab === 'catalog' && (
          <SkillCatalog refresh={refreshKey} />
        )}

        {activeTab === 'upload' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '2rem' }}>
            <SkillUpload onSuccess={() => {
              setRefreshKey(prev => prev + 1);
              setActiveTab('catalog');
            }} />
            {isEnterpriseMode && (
              <EnterpriseSync onSuccess={() => {
                setRefreshKey(prev => prev + 1);
              }} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
