
import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { name, version, user } = body;

        if (!name) {
            return NextResponse.json({ error: 'Missing skill name' }, { status: 400 });
        }

        if (!user) {
            return NextResponse.json({ error: 'Missing user' }, { status: 400 });
        }

        // 1. Find Skill
        const skill = await prisma.skill.findFirst({
            where: { 
                name: name,
                user: user
            },
            include: { versions: true }
        });

        if (!skill) {
            return NextResponse.json({ error: `Skill '${name}' for user '${user}' not found` }, { status: 404 });
        }

        // 2. Determine Version
        let targetVersion = version;

        if (targetVersion === undefined || targetVersion === null) {
            // Use latest if not specified
            const sortedVersions = skill.versions.sort((a, b) => b.version - a.version);
            if (sortedVersions.length > 0) {
                targetVersion = sortedVersions[0].version;
            } else {
                return NextResponse.json({ error: 'No versions available for this skill' }, { status: 400 });
            }
        }

        // Verify version exists
        const versionRecord = skill.versions.find(v => v.version === targetVersion);
        if (!versionRecord) {
            return NextResponse.json({ error: `Version ${targetVersion} not found for skill '${name}'` }, { status: 404 });
        }

        // 3. Update Status
        const updated = await prisma.skill.update({
            where: { id: skill.id },
            data: {
                activeVersion: targetVersion,
                isUploaded: true
            }
        });

        return NextResponse.json({
            success: true,
            activeVersion: updated.activeVersion,
            isUploaded: updated.isUploaded,
            message: `Skill '${name}' v${updated.activeVersion} activated and marked for sync.`
        });

    } catch (error: any) {
        console.error('Auto Push Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
