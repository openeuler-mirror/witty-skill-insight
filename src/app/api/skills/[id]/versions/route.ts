import { canAccessSkill, resolveUser } from '@/lib/auth';
import { db } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const body = await request.json();
        const { content, changeLog, user: explicitUser } = body;

        if (!content) {
            return NextResponse.json({ error: 'Content is required' }, { status: 400 });
        }

        const { username } = await resolveUser(request, explicitUser);

        const { allowed, skill } = await canAccessSkill(id, username);
        if (!skill) {
            return NextResponse.json({ error: 'Skill not found' }, { status: 404 });
        }
        if (!allowed) {
            return NextResponse.json({ error: 'Unauthorized: You do not own this skill' }, { status: 403 });
        }

        const latestVersion = await db.findLatestSkillVersion(id);

        const nextVersionNum = (latestVersion?.version || 0) + 1;

        const assetPath = latestVersion?.assetPath || '';
        const files = latestVersion?.files || '[]';

        const newVersion = await db.createSkillVersion({
            skillId: id,
            version: nextVersionNum,
            content,
            assetPath,
            files,
            changeLog: changeLog || `Updated v${nextVersionNum} via Editor`
        });

        return NextResponse.json(newVersion);

    } catch (error: any) {
        console.error('Create Version Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const skill = await db.findSkillById(id);
        if (!skill) {
            return NextResponse.json({ error: 'Skill not found' }, { status: 404 });
        }
        
        const versions = skill.versions || [];
        const versionsList = versions.map((v: any) => ({
            id: v.id,
            version: v.version,
            changeLog: v.changeLog,
            createdAt: v.createdAt
        }));
        
        return NextResponse.json(versionsList);
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
