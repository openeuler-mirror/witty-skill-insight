'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';

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

function SkillContent() {
  const searchParams = useSearchParams();
  const skillId = searchParams.get('id');
  const skillName = searchParams.get('name');
  const user = searchParams.get('user') || undefined;
  const version = searchParams.get('version');

  const [skill, setSkill] = useState<SkillData | null>(null);
  const [skillVersion, setSkillVersion] = useState<SkillVersionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchSkill() {
      setLoading(true);
      setError(null);

      try {
        let skillData: SkillData | null = null;

        if (skillId) {
          const res = await fetch(`/api/skills/${skillId}`);
          if (res.ok) {
            skillData = await res.json();
          }
        } else if (skillName) {
          const params = new URLSearchParams({ name: skillName });
          if (user) params.set('user', user);
          const res = await fetch(`/api/skills/by-name?${params}`);
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
        const verRes = await fetch(`/api/skills/${skillData.id}/versions/${versionNum}`);
        if (verRes.ok) {
          setSkillVersion(await verRes.json());
        }
      } catch (err) {
        setError('Failed to load skill');
      }

      setLoading(false);
    }

    fetchSkill();
  }, [skillId, skillName, user, version]);

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
    <div style={{ padding: '2rem', color: '#e2e8f0', maxWidth: '1200px', margin: '0 auto' }}>
      <Link href="/" style={{ color: '#60a5fa', marginBottom: '1rem', display: 'inline-block' }}>
        ← Back to Dashboard
      </Link>

      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '2rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>
          {skill.name}
        </h1>
        <p style={{ color: '#94a3b8', fontSize: '0.9rem' }}>
          Category: {skill.category || 'Other'} | Version: {version || skill.activeVersion}
        </p>
      </div>

      {skill.description && (
        <div style={{ marginBottom: '2rem', padding: '1rem', background: '#1e293b', borderRadius: '8px' }}>
          <h3 style={{ color: '#94a3b8', marginBottom: '0.5rem' }}>Description</h3>
          <p>{skill.description}</p>
        </div>
      )}

      {skillVersion?.changeLog && (
        <div style={{ marginBottom: '2rem', padding: '1rem', background: '#1e293b', borderRadius: '8px' }}>
          <h3 style={{ color: '#94a3b8', marginBottom: '0.5rem' }}>Change Log</h3>
          <p>{skillVersion.changeLog}</p>
        </div>
      )}

      {skillVersion?.content && (
        <div style={{ marginBottom: '2rem' }}>
          <h3 style={{ color: '#94a3b8', marginBottom: '0.5rem' }}>Skill Content</h3>
          <pre style={{ 
            padding: '1rem', 
            background: '#0f172a', 
            borderRadius: '8px', 
            overflow: 'auto',
            fontSize: '0.85rem',
            whiteSpace: 'pre-wrap'
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
