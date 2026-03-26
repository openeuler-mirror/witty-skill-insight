import { NextRequest, NextResponse } from 'next/server';
import { analyzeExecutionMatch, getExecutionMatch, analyzeDynamicOnly } from '@/lib/flow-parser';
import { db } from '@/lib/prisma';

interface ExecutionRecord {
  skill?: string;
  skillVersion?: number;
  skills?: string;
}

interface Session {
  interactions?: string | unknown[];
}

interface SkillDetail {
  id: string;
  name: string;
  versions?: { version: number }[];
}

async function getSkillAndActiveVersion(skillName: string, user: string | null): Promise<{ skillId: string; version: number } | null> {
  try {
    const skill = await db.findSkill(skillName, user) as SkillDetail | null;
    if (!skill) {
      return null;
    }
    
    const fullSkill = await db.findSkillById(skill.id) as SkillDetail | null;
    if (!fullSkill || !fullSkill.versions || fullSkill.versions.length === 0) {
      return null;
    }
    
    const targetVersion = (fullSkill as any).activeVersion || 0;
    const versionExists = fullSkill.versions.some((v: { version: number }) => v.version === targetVersion);
    
    if (versionExists) {
      return { skillId: skill.id, version: targetVersion };
    } else {
      const versions = fullSkill.versions.map((v: { version: number }) => v.version);
      const latestVersion = Math.max(...versions);
      return { skillId: skill.id, version: latestVersion };
    }
  } catch {
    return null;
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ executionId: string }> }
) {
  try {
    const { executionId } = await params;
    const body = await request.json().catch(() => ({}));
    const user = body.user || null;
    const mode = body.mode || 'compare';
    
    const execution = await db.findExecutionById(executionId) as ExecutionRecord | null;
    if (!execution) {
      return NextResponse.json({ error: 'Execution not found' }, { status: 404 });
    }
    
    let skillName = execution.skill;
    let skillVersion: number | undefined = execution.skillVersion ?? undefined;
    let skillId: string | undefined;
    
    if (!skillName) {
      if (execution.skills) {
        try {
          const skillsList = JSON.parse(execution.skills);
          if (Array.isArray(skillsList) && skillsList.length > 0) {
            skillName = skillsList[0];
          }
        } catch {}
      }
    }
    
    if (mode === 'dynamic') {
      const result = await analyzeDynamicOnly(executionId, user);
      if (!result.success) {
        return NextResponse.json({ error: result.error }, { status: 500 });
      }
      return NextResponse.json({
        success: true,
        mode: 'dynamic',
        dynamicMermaid: result.dynamicMermaid,
        interactionCount: result.interactionCount
      });
    }
    
    if (!skillName) {
      return NextResponse.json({ error: 'No skill associated with this execution' }, { status: 400 });
    }
    
    const skillInfo = await getSkillAndActiveVersion(skillName, user);
    if (!skillInfo) {
      return NextResponse.json({ 
        error: `Skill "${skillName}" 未找到或没有版本。请确认 Skill 已创建并至少有一个版本，或者使用"动态分析"功能。` 
      }, { status: 400 });
    }
    
    skillId = skillInfo.skillId;
    if (!skillVersion) {
      skillVersion = skillInfo.version;
    }
    
    const result = await analyzeExecutionMatch(
      executionId,
      skillId,
      skillVersion,
      user
    );
    
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }
    
    return NextResponse.json({
      success: true,
      mode: 'compare',
      match: result.result,
      staticMermaid: result.staticMermaid,
      dynamicMermaid: result.dynamicMermaid,
      interactionCount: result.interactionCount,
      usedSkillName: skillName,
      usedSkillVersion: skillVersion
    });
    
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('Analyze execution match error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ executionId: string }> }
) {
  try {
    const { executionId } = await params;
    
    const match = await getExecutionMatch(executionId);
    
    if (!match) {
      return NextResponse.json({ 
        analyzed: false,
        message: 'Execution not analyzed yet' 
      });
    }
    
    const session = await db.findSessionByTaskId(executionId) as Session | null;
    let currentInteractionCount = 0;
    if (session && session.interactions) {
      try {
        const interactions = typeof session.interactions === 'string' 
          ? JSON.parse(session.interactions) 
          : session.interactions;
        currentInteractionCount = Array.isArray(interactions) ? interactions.length : 0;
      } catch {
        // ignore parse errors
      }
    }

    const execution = await db.findExecutionById(executionId) as ExecutionRecord | null;
    const skillName = execution?.skill || null;
    
    return NextResponse.json({
      analyzed: true,
      mode: match.mode || 'compare',
      matchJson: match.matchJson,
      staticMermaid: match.staticMermaid,
      dynamicMermaid: match.dynamicMermaid,
      analysisText: match.analysisText,
      interactionCount: match.interactionCount,
      currentInteractionCount,
      hasUpdate: currentInteractionCount > match.interactionCount,
      matchedAt: match.matchedAt,
      usedSkillName: skillName,
      usedSkillVersion: match.skillVersion
    });
    
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error('Get execution match error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
