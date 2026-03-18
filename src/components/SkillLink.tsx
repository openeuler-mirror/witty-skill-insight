'use client';

import { useRouter } from 'next/navigation';
import React from 'react';

interface SkillLinkProps {
  skillId?: string | null;
  skillName: string;
  version?: string | number | null;
  user?: string | null;
}

export function SkillLink({ skillId, skillName, version, user }: SkillLinkProps) {
  const router = useRouter();

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    
    const params = new URLSearchParams();
    if (skillId) {
      params.set('id', skillId);
    } else {
      params.set('name', skillName);
      if (user) params.set('user', user);
    }
    if (version !== null && version !== undefined) {
      params.set('version', String(version));
    }
    
    router.push(`/skills?${params.toString()}`);
  };

  if (!skillId && !skillName) {
    return <span style={{ color: '#64748b' }}>(None)</span>;
  }

  return (
    <span
      onClick={handleClick}
      style={{
        color: '#60a5fa',
        cursor: 'pointer',
        textDecoration: 'none',
        transition: 'color 0.2s',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.textDecoration = 'underline';
        e.currentTarget.style.color = '#93c5fd';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.textDecoration = 'none';
        e.currentTarget.style.color = '#60a5fa';
      }}
    >
      {skillName}{version ? ` (v${version})` : ''}
    </span>
  );
}

interface SkillLinksProps {
  skills?: string[];
  skill?: string;
  skillId?: string | null;
  skillIds?: string[];
  skillVersion?: number | null;
  user?: string | null;
}

export function SkillLinks({ 
  skills, 
  skill, 
  skillId, 
  skillIds, 
  skillVersion, 
  user 
}: SkillLinksProps) {
  if (!skills?.length && !skill) {
    return <span style={{ color: '#64748b' }}>(None)</span>;
  }

  if (skills?.length) {
    return (
      <>
        {skills.map((s, index) => {
          const sId = skillIds?.[index] || null;
          return (
            <React.Fragment key={index}>
              {index > 0 && <span style={{ color: '#e2e8f0' }}>, </span>}
              <SkillLink
                skillId={sId}
                skillName={s}
                version={skillVersion}
                user={user}
              />
            </React.Fragment>
          );
        })}
      </>
    );
  }

  return (
    <SkillLink
      skillId={skillId}
      skillName={skill!}
      version={skillVersion}
      user={user}
    />
  );
}
