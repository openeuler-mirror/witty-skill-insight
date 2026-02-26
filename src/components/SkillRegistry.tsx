'use client';

import { useAuth } from '@/lib/auth-context';
import { useEffect, useRef, useState } from 'react';

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
  changeLog: string;
  createdAt: string;
}

// --- Components ---

function SkillUpload({ onSuccess }: { onSuccess: () => void }) {
  const { user } = useAuth();
  const [uploading, setUploading] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFolderSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    setLogs(['Preparing upload...']);

    const formData = new FormData();
    if (user) formData.append('user', user);
    for (let i = 0; i < files.length; i++) {
      formData.append('files', files[i]);
      formData.append('paths', files[i].webkitRelativePath);
    }

    try {
      setLogs(prev => [...prev, `Uploading ${files.length} files...`]);
      const res = await fetch('/api/skills/upload', {
        method: 'POST',
        body: formData
      });

      const result = await res.json();
      if (res.ok) {
        setLogs(prev => [...prev, 'Upload successful!', `Skill: ${result.skill.name} (v${result.version.version})`]);
        alert('技能上传成功！');
        onSuccess();
      } else {
        setLogs(prev => [...prev, `Error: ${result.error}`]);
        alert(`上传失败: ${result.error}`);
      }
    } catch (err: any) {
      setLogs(prev => [...prev, `Network Error: ${err.message}`]);
      alert('上传出错');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="upload-card">
      <div style={{ fontSize: '3rem', marginBottom: '1rem', color: '#475569' }}>📂</div>
      <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.5rem', color: '#f8fafc' }}>Upload Skill Folder</h3>
      <p style={{ color: '#94a3b8', marginBottom: '1.5rem', maxWidth: '400px', fontSize: '0.9rem', lineHeight: 1.5 }}>
        Select the folder containing <code>SKILL.md</code>.
        <br /><span style={{ color: '#fbbf24' }}>Note: Upload the entire folder structure.</span>
        <br /><span style={{ color: '#f87171', fontWeight: 'bold' }}>Important: Folder name must NOT contain Chinese characters.</span>
      </p>

      <div style={{ position: 'relative', display: 'inline-block' }}>
        <button
          className="btn-primary"
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem 1.5rem', fontSize: '1rem' }}
          onClick={() => fileInputRef.current?.click()}
        >
          <span>Select Folder</span>
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
        <div style={{ marginTop: '2rem', width: '100%', maxWidth: '600px', textAlign: 'left', background: '#0f172a', padding: '1rem', borderRadius: '0.5rem', maxHeight: '150px', overflowY: 'auto' }}>
          {logs.map((log, i) => (
            <div key={i} style={{ color: '#cbd5e1', fontSize: '0.8rem', fontFamily: 'monospace', marginBottom: '4px', borderBottom: '1px solid #1e293b', paddingBottom: '2px' }}>{log}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function SkillVersionDetailModal({ skillId, version, onClose }: { skillId: string, version: number, onClose: () => void }) {
  const { user } = useAuth();
  const [detail, setDetail] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/skills/${skillId}/versions/${version}?user=${encodeURIComponent(user || '')}`)
      .then(res => res.json())
      .then(d => {
        setDetail(d);
        setLoading(false);
      })
      .catch(e => {
        alert("Failed to load details");
        setLoading(false);
      });
  }, [skillId, version]);

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 1100 }}>
      <div className="modal-content card" onClick={e => e.stopPropagation()} style={{ width: '800px', maxHeight: '90vh', display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}>
        
        {/* Header - Styled like parent modal */}
        <div className="modal-header-new" style={{ padding: '1rem 1.5rem', background: '#0f172a', borderBottom: '1px solid #334155', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 'bold', color: 'white' }}>Version Details (v{version})</h3>
          <button 
            onClick={onClose} 
            style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '1.5rem', cursor: 'pointer', padding: '0 0.5rem', lineHeight: 1 }}
          >
            &times;
          </button>
        </div>
        
        <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem' }}>
          {loading ? (
             <div style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>Loading details...</div>
          ) : detail ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                {/* Meta Info - Removed Asset Path */}
                <div style={{ background: '#1e293b', padding: '1rem', borderRadius: '8px', border: '1px solid #334155' }}>
                    <div>
                        <span style={{ color: '#94a3b8', fontSize: '0.85rem', display: 'block', marginBottom: '4px' }}>Created At</span>
                        <div style={{ color: '#f8fafc', fontWeight: 500 }}>{new Date(detail.createdAt).toLocaleString()}</div>
                    </div>
                </div>

                {/* Changelog */}
                <div>
                    <h4 style={{ color: '#94a3b8', marginBottom: '0.5rem', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Changelog</h4>
                    <div style={{ background: '#0f172a', padding: '1rem', borderRadius: '6px', color: '#e2e8f0', whiteSpace: 'pre-wrap', border: '1px solid #334155', fontSize: '0.9rem', lineHeight: 1.6 }}>
                        {detail.changeLog || <span style={{ color: '#64748b', fontStyle: 'italic' }}>No changelog provided.</span>}
                    </div>
                </div>

                {/* Content (SKILL.md) */}
                <div>
                     <h4 style={{ color: '#94a3b8', marginBottom: '0.5rem', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Skill Content (SKILL.md)</h4>
                     <pre style={{ 
                         background: '#0f172a', 
                         padding: '1rem', 
                         borderRadius: '6px', 
                         color: '#e2e8f0', 
                         overflowX: 'auto', 
                         fontFamily: 'monospace', 
                         fontSize: '0.85rem',
                         border: '1px solid #334155',
                         maxHeight: '400px',
                         whiteSpace: 'pre-wrap'
                     }}>
                         {detail.content || <span style={{ color: '#64748b', fontStyle: 'italic' }}>(Empty content)</span>}
                     </pre>
                </div>

                {/* Files List */}
                <div>
                    <h4 style={{ color: '#94a3b8', marginBottom: '0.5rem', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Included Files</h4>
                    <div style={{ background: '#0f172a', padding: '1rem', borderRadius: '6px', border: '1px solid #334155' }}>
                        {(() => {
                            try {
                                const files = detail.files ? JSON.parse(detail.files) : [];
                                if (files.length === 0) return <span style={{ color: '#64748b', fontSize: '0.9rem', fontStyle: 'italic' }}>No additional files.</span>;
                                return (
                                    <ul style={{ margin: 0, paddingLeft: '1.2rem', color: '#cbd5e1', fontSize: '0.9rem' }}>
                                        {files.map((f: string, i: number) => <li key={i} style={{ marginBottom: '4px' }}>{f}</li>)}
                                    </ul>
                                );
                            } catch (e) {
                                return <span style={{ color: '#ef4444', fontSize: '0.9rem' }}>Error parsing file list.</span>;
                            }
                        })()}
                    </div>
                </div>
            </div>
          ) : (
            <div style={{ color: '#ef4444', textAlign: 'center', padding: '2rem' }}>Failed to load details.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function SkillVersionsModal({ skill, onClose, onUpdate }: { skill: Skill, onClose: () => void, onUpdate: () => void }) {
  const { user } = useAuth();
  const [versions, setVersions] = useState<SkillVersion[]>([]);
  const [currentActiveVersion, setCurrentActiveVersion] = useState(skill.activeVersion);
  const [hasUpdated, setHasUpdated] = useState(false);
  const [viewingVersion, setViewingVersion] = useState<number | null>(null);

  useEffect(() => {
    fetch(`/api/skills/${skill.id}/versions?user=${encodeURIComponent(user || '')}`)
      .then(res => res.json())
      .then(data => {
        setVersions(data);
      });
  }, [skill.id]);

  useEffect(() => {
    setCurrentActiveVersion(skill.activeVersion);
  }, [skill.activeVersion]);

  // Wrap onClose to trigger update if needed
  const handleClose = () => {
    if (hasUpdated) onUpdate();
    onClose();
  };

  const handleActivate = async (version: number) => {
    try {
      const res = await fetch(`/api/skills/${skill.id}/activate`, {
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
      const res = await fetch('/api/skills/upload', {
        method: 'POST',
        body: formData
      });
      const result = await res.json();

      if (res.ok) {
        alert(`Version v${result.version.version} uploaded successfully!`);
        // Refresh versions
        const vRes = await fetch(`/api/skills/${skill.id}/versions?user=${encodeURIComponent(user || '')}`);
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
            <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 'bold', color: 'white' }}>{skill.name}</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.25rem', fontSize: '0.875rem', color: '#94a3b8' }}>
              <span>Current Active:</span>
              <span style={{ color: '#4ade80', fontFamily: 'monospace', fontWeight: 'bold', background: 'rgba(74, 222, 128, 0.1)', padding: '0 6px', borderRadius: '4px' }}>v{currentActiveVersion}</span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <button
              className="btn-primary"
              style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
              onClick={() => versionFileInputRef.current?.click()}
            >
              <span>📤 Upload New Version</span>
            </button>
            <button
              onClick={handleClose}
              style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '1.5rem', cursor: 'pointer', padding: '0 0.5rem' }}
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
                <th style={{ width: '120px' }}>Version</th>
                <th>Changelog</th>
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
                        <span style={{ fontSize: '1rem', fontFamily: 'monospace', fontWeight: 'bold', color: isActive ? '#4ade80' : '#60a5fa' }}>
                          v{v.version}
                        </span>
                        {isActive && (
                          <span style={{
                            fontSize: '0.7rem',
                            backgroundColor: 'rgba(74, 222, 128, 0.2)',
                            color: '#4ade80',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            fontWeight: 'bold',
                            border: '1px solid rgba(74, 222, 128, 0.3)'
                          }}>
                            ACTIVE
                          </span>
                        )}
                      </div>
                      <span style={{ fontSize: '0.75rem', color: '#64748b' }}>{new Date(v.createdAt).toLocaleDateString()}</span>
                    </td>
                    <td>
                      <p style={{ margin: 0, color: '#e2e8f0', whiteSpace: 'pre-wrap', lineHeight: 1.6, fontSize: '0.9rem' }}>
                        {v.changeLog || <span style={{ color: '#64748b', fontStyle: 'italic' }}>No changelog provided</span>}
                      </p>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                          <button 
                            onClick={() => setViewingVersion(v.version)}
                            className="btn-sm"
                            style={{ background: '#334155', border: '1px solid #475569', padding: '6px 12px' }}
                          >
                            View
                          </button>
                          
                          {!isActive ? (
                            <button
                              onClick={() => handleActivate(v.version)}
                              className="btn-sm"
                              style={{ background: '#1e293b', border: '1px solid #475569', padding: '6px 12px' }}
                            >
                              Set Active
                            </button>
                          ) : (
                            <span style={{ padding: '6px 12px', fontSize: '0.8rem', fontFamily: 'monospace', color: '#4ade80', display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#4ade80' }}></span>
                              Current
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
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '200px', color: '#64748b' }}>
              <div style={{ fontSize: '2rem', marginBottom: '1rem', opacity: 0.5 }}>📂</div>
              <p>No versions history found.</p>
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
  const { user } = useAuth();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);

  const fetchSkills = () => {
    if (!user) return;
    setLoading(true);
    fetch(`/api/skills?user=${encodeURIComponent(user)}`)
      .then(res => res.json())
      .then(d => {
        setSkills(Array.isArray(d) ? d : []);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchSkills();
  }, [refresh]);

  // Keep selectedSkill in sync with fetched skills
  useEffect(() => {
    if (selectedSkill) {
      const updated = skills.find(s => s.id === selectedSkill.id);
      if (updated) setSelectedSkill(updated);
    }
  }, [skills]);

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this skill? This action cannot be undone.')) return;
    
    try {
      const res = await fetch(`/api/skills?id=${id}&user=${encodeURIComponent(user || '')}`, { method: 'DELETE' });
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
      const res = await fetch(`/api/skills/${id}/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      <div className="loading-spinner" style={{ width: '2rem', height: '2rem', border: '2px solid #334155', borderTopColor: '#38bdf8', borderRadius: '50%', animation: 'spin 1s linear infinite' }}></div>
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
        background: '#1e293b',
        padding: '1.5rem',
        borderRadius: '0.75rem',
        border: '1px solid #334155'
      }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: '0.875rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Total Skills</span>
          <span style={{ fontSize: '2.5rem', fontWeight: 700, color: '#f8fafc', lineHeight: 1 }}>{totalSkills}</span>
        </div>
        <div style={{ width: '1px', background: '#334155' }}></div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: '0.875rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Uploaded Skills</span>
          <span style={{ fontSize: '2.5rem', fontWeight: 700, color: '#4ade80', lineHeight: 1 }}>{uploadedSkills}</span>
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
                  <span className="skill-version-badge">v{skill.version}</span>
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
                {skill.description || <span style={{ fontStyle: 'italic', color: '#64748b' }}>No description provided for this skill.</span>}
              </div>

              <div className="skill-tags">
                {skill.tags?.slice(0, 3).map((tag, i) => (
                  <span key={i} className="skill-tag">
                    #{tag}
                  </span>
                ))}
                {(skill.tags?.length || 0) > 3 && <span className="skill-tag" style={{ background: 'transparent', border: 'none', color: '#64748b' }}>+{skill.tags!.length - 3}</span>}
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
                  background: skill.isUploaded ? 'rgba(74, 222, 128, 0.1)' : 'transparent',
                  border: `1px solid ${skill.isUploaded ? '#4ade80' : '#475569'}`,
                  color: skill.isUploaded ? '#4ade80' : '#94a3b8',
                  padding: '0.4rem',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.2s'
                }}
              >
                {skill.isUploaded ? '☁️ Active' : '☁️ Upload'}
              </button>

              <button
                onClick={() => setSelectedSkill(skill)}
                className="btn-manage"
              >
                <span>⚙️</span>
                <span>Manage Versions</span>
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
            <p style={{ color: '#94a3b8', fontSize: '1.2rem' }}>No skills yet.</p>
            <p style={{ color: '#64748b', fontSize: '0.9rem', marginTop: '0.5rem' }}>Upload a skill folder to get started.</p>
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
  const [activeTab, setActiveTab] = useState<'catalog' | 'upload'>('catalog');
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <div style={{ marginTop: '1rem' }}>
      {/* Tabs */}
      <div className="nav-tabs">
        <button
          onClick={() => setActiveTab('catalog')}
          className={`nav-tab-item ${activeTab === 'catalog' ? 'active' : ''}`}
        >
          Skill Catalog
        </button>
        <button
          onClick={() => setActiveTab('upload')}
          className={`nav-tab-item ${activeTab === 'upload' ? 'active' : ''}`}
        >
          Upload New Skill
        </button>
      </div>

      {/* Content Area */}
      <div style={{ minHeight: '400px' }}>
        {activeTab === 'catalog' && (
          <SkillCatalog refresh={refreshKey} />
        )}

        {activeTab === 'upload' && (
          <SkillUpload onSuccess={() => {
            setRefreshKey(prev => prev + 1);
            setActiveTab('catalog');
          }} />
        )}
      </div>
    </div>
  );
}