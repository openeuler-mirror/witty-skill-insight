
import { canAccessSkill, resolveUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';

// POST /api/skills/[id]/toggle
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const body = await request.json();
        const { isUploaded, user: explicitUser } = body;

        if (typeof isUploaded !== 'boolean') {
            return NextResponse.json({ error: 'isUploaded must be a boolean' }, { status: 400 });
        }

        // 用户身份解析
        const { username } = await resolveUser(request, explicitUser);

        // 权限校验
        const { allowed, skill } = await canAccessSkill(id, username);
        if (!skill) {
            return NextResponse.json({ error: 'Skill not found' }, { status: 404 });
        }
        if (!allowed) {
            return NextResponse.json({ error: 'Unauthorized: You do not own this skill' }, { status: 403 });
        }

        const updatedSkill = await prisma.skill.update({
            where: { id },
            data: { isUploaded }
        });

        return NextResponse.json({ success: true, skill: updatedSkill });
    } catch (error) {
        console.error('Toggle Upload Error:', error);
        return NextResponse.json({ error: 'Failed to update skill status' }, { status: 500 });
    }
}
