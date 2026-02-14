
import { resolveUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    try {
        // 解析用户身份：优先 user 查询参数，其次 apiKey
        const userParam = request.nextUrl.searchParams.get('user');
        const { username } = await resolveUser(request, userParam);

        // 构建查询条件
        const where: any = { isUploaded: true };

        if (username) {
            // 有用户身份：只返回该用户的 skill + 公共 skill + 无主 skill
            where.OR = [
                { user: username },
                { user: null },
                { visibility: 'public' }
            ];
        }
        // 无用户身份（兼容旧逻辑）：返回所有已发布的 skill

        const skills = await prisma.skill.findMany({
            where,
            include: {
                versions: {
                    orderBy: { version: 'desc' }
                }
            }
        });

        const manifest = [];

        for (const s of skills) {
            const activeVerNum = s.activeVersion || 0;
            const activeVersionInfo = s.versions.find(v => v.version === activeVerNum);

            if (activeVersionInfo) {
                manifest.push({
                    id: s.id,
                    name: s.name,
                    version: activeVerNum,
                    updatedAt: activeVersionInfo.createdAt.toISOString(),
                    downloadUrl: `/api/skills/${s.id}/versions/${activeVerNum}/download`
                });
            }
        }

        console.log(`[Manifest] User: ${username || 'anonymous'}, Returning ${manifest.length} skills: ${manifest.map(m => m.name).join(', ')}`);
        return NextResponse.json({ skills: manifest });
    } catch (error) {
        console.error('[Manifest] Error:', error);
        return NextResponse.json({ error: 'Failed to generate manifest' }, { status: 500 });
    }
}
