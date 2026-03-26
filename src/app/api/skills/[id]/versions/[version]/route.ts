import { canAccessSkill, resolveUser } from '@/lib/auth';
import { db } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string; version: string }> }
) {
    try {
        const { id, version: versionStr } = await params;
        const version = parseInt(versionStr, 10);

        if (isNaN(version)) {
            return NextResponse.json({ error: 'Invalid version number' }, { status: 400 });
        }

        const { username } = await resolveUser(request);

        const { allowed, skill } = await canAccessSkill(id, username);
        if (!skill) {
            return NextResponse.json({ error: 'Skill not found' }, { status: 404 });
        }
        if (!allowed) {
            return NextResponse.json({ error: 'Unauthorized: You do not own this skill' }, { status: 403 });
        }

        const versionToDelete = await db.findSkillVersion(id, version);
        if (!versionToDelete) {
            return NextResponse.json({ error: `Version ${version} not found` }, { status: 404 });
        }

        if (skill.versions && skill.versions.length === 1) {
            return NextResponse.json({ 
                error: 'Cannot delete the last version. Delete the skill instead.' 
            }, { status: 400 });
        }

        await db.deleteSkillVersion(id, version);

        if (skill.activeVersion === version) {
            const remainingVersions = (skill.versions || []).filter((v: any) => v.version !== version);
            if (remainingVersions.length > 0) {
                const newActiveVersion = remainingVersions[0].version;
                await db.updateSkill(id, { activeVersion: newActiveVersion });
                console.log(`[Delete Version] Updated activeVersion from ${version} to ${newActiveVersion}`);
            }
        }

        return NextResponse.json({ 
            success: true, 
            message: `Version ${version} deleted successfully`,
            previousActiveVersion: skill.activeVersion
        });

    } catch (error: any) {
        console.error('Delete Version Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string; version: string }> }
) {
    try {
        const { id, version: versionStr } = await params;
        const version = parseInt(versionStr, 10);

        if (isNaN(version)) {
            return NextResponse.json({ error: 'Invalid version number' }, { status: 400 });
        }

        const skillVersion = await db.findSkillVersion(id, version);
        if (!skillVersion) {
            return NextResponse.json({ error: `Version ${version} not found` }, { status: 404 });
        }

        return NextResponse.json(skillVersion);

    } catch (error: any) {
        console.error('Get Version Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
