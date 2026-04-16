'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { useThemeColors } from '@/lib/theme-context';

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
  const c = useThemeColors();

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
          const res = await apiFetch(`/api/skills/${skillId}`);
          if (res.ok) {
            skillData = await res.json();
          }
        } else if (skillName) {
          const params = new URLSearchParams({ name: skillName });
          if (user) params.set('user', user);
          const res = await apiFetch(`/api/skills/by-name?${params}`);
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
        const verRes = await apiFetch(`/api/skills/${skillData.id}/versions/${versionNum}`);
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
      <div style={{ padding: '2rem', color: c.fgSecondary }}>
        <p>Loading skill...</p>
      </div>
    );
  }

  if (error || !skill) {
    return (
      <div style={{ padding: '2rem', color: c.fg }}>
        <Link href="/" style={{ color: c.link, marginBottom: '1rem', display: 'inline-block' }}>
          ← Back to Dashboard
        </Link>
        <h1 style={{ color: c.error }}>Skill Not Found</h1>
        <p style={{ color: c.fgMuted }}>
          {error || 'The requested skill could not be found. It may have been deleted.'}
        </p>
      </div>
    );
  }

  return (
    <div style={{ padding: '2rem', color: c.fg, maxWidth: '1200px', margin: '0 auto' }}>
      <Link href="/" style={{ color: c.link, marginBottom: '1rem', display: 'inline-block' }}>
        ← Back to Dashboard
      </Link>

      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '2rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>
          {skill.name}
        </h1>
        <p style={{ color: c.fgMuted, fontSize: '0.9rem' }}>
          Category: {skill.category || 'Other'} | Version: {version || skill.activeVersion}
        </p>
      </div>

      {skill.description && (
        <div style={{ marginBottom: '2rem', padding: '1rem', background: c.bgSecondary, borderRadius: '8px', border: `1px solid ${c.border}` }}>
          <h3 style={{ color: c.fgSecondary, marginBottom: '0.5rem' }}>Description</h3>
          <p>{skill.description}</p>
        </div>
      )}

      {skillVersion?.changeLog && (
        <div style={{ marginBottom: '2rem', padding: '1rem', background: c.bgSecondary, borderRadius: '8px', border: `1px solid ${c.border}` }}>
          <h3 style={{ color: c.fgSecondary, marginBottom: '0.5rem' }}>Change Log</h3>
          <p>{skillVersion.changeLog}</p>
        </div>
      )}

      {skillVersion?.content && (
        <div style={{ marginBottom: '2rem' }}>
          <h3 style={{ color: c.fgSecondary, marginBottom: '0.5rem' }}>Skill Content</h3>
          <pre style={{ 
            padding: '1rem', 
            background: c.codeBlockBg, 
            borderRadius: '8px', 
            overflow: 'auto',
            fontSize: '0.85rem',
            whiteSpace: 'pre-wrap',
            border: `1px solid ${c.border}`
          }}>
            {skillVersion.content}
          </pre>
        </div>
      )}
    </div>
  );
}

function LoadingFallback() {
  const c = useThemeColors();
  return (
    <div style={{ padding: '2rem', color: c.fgSecondary }}>
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
