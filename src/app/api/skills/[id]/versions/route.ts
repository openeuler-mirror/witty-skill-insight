import { canAccessSkill, resolveUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import fs from 'fs';
import { NextRequest, NextResponse } from 'next/server';

// Helper: Ensure directory exists
function ensureDir(dirPath: string) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

// POST /api/skills/[id]/versions
// Create a new version from text content (Edit in browser)
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> } // Next.js 15+ params are async
) {
    try {
        const { id } = await params;
        const body = await request.json();
        const { content, changeLog, user: explicitUser } = body;

        if (!content) {
            return NextResponse.json({ error: 'Content is required' }, { status: 400 });
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

        // Get latest version to copy assets from
        const latestVersion = await prisma.skillVersion.findFirst({
            where: { skillId: id },
            orderBy: { version: 'desc' }
        });

        const nextVersionNum = (latestVersion?.version || 0) + 1;

        // We reuse the asset path from the previous version if it exists, 
        // OR we create a new folder and copy files?
        // Requirement: "Standard scenarios: User modifies SKILL.md but rarely scripts... adopt hybrid reference mode"
        // So we can just point `assetPath` to the SAME location as the previous version, 
        // unless the user uploads a new folder.
        // If we point to the same location, we must ensure we don't *delete* files there that old versions need.
        // But since it's "Hybrid Reference", sharing assets is fine.

        const assetPath = latestVersion?.assetPath || '';
        const files = latestVersion?.files || '[]';

        const newVersion = await prisma.skillVersion.create({
            data: {
                skillId: id,
                version: nextVersionNum,
                content,
                assetPath, // Reuse assets
                files,     // Reuse file list
                changeLog: changeLog || `Updated v${nextVersionNum} via Editor`
            }
        });

        return NextResponse.json(newVersion);

    } catch (error: any) {
        console.error('Create Version Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

// GET /api/skills/[id]/versions
// List all versions
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const versions = await prisma.skillVersion.findMany({
            where: { skillId: id },
            orderBy: { version: 'desc' },
            select: {
                id: true,
                version: true,
                changeLog: true,
                createdAt: true,
                // Do not return full content in list if large
            }
        });
        return NextResponse.json(versions);
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
