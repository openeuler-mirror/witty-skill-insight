
import { canAccessSkill, resolveUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(
    request: NextRequest,
    props: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await props.params;
        const body = await request.json();
        const { version, user: explicitUser } = body;

        if (version === undefined || version === null) {
            console.error('Activate Error: Version missing in body', body);
            return NextResponse.json({ error: 'Version is required' }, { status: 400 });
        }

        // 用户身份解析：优先 body 中的 user 参数，其次 apiKey
        const { username } = await resolveUser(request, explicitUser);

        // 权限校验
        const { allowed, skill } = await canAccessSkill(id, username);
        if (!skill) {
            return NextResponse.json({ error: 'Skill not found' }, { status: 404 });
        }
        if (!allowed) {
            return NextResponse.json({ error: 'Unauthorized: You do not own this skill' }, { status: 403 });
        }

        console.log(`Activating skill ${id} to version ${version} (user: ${username || 'anonymous'})`);

        // Verify version exists
        const sv = await prisma.skillVersion.findFirst({
            where: { skillId: id, version: Number(version) }
        });

        if (!sv) {
            console.error(`Activate Error: Version ${version} not found for skill ${id}`);
            return NextResponse.json({ error: 'Version does not exist' }, { status: 404 });
        }

        // Update Skill activeVersion
        const updatedSkill = await prisma.skill.update({
            where: { id },
            data: { activeVersion: Number(version) }
        });

        console.log(`Success: Skill ${id} activeVersion set to ${updatedSkill.activeVersion}`);
        return NextResponse.json(updatedSkill);
    } catch (error: any) {
        console.error('Activate Exception:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
