
import { canAccessSkill, resolveUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import archiver from 'archiver';
import fs from 'fs';
import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { Readable } from 'stream';

export async function GET(
    request: NextRequest,
    props: { params: Promise<{ id: string; version: string }> }
) {
    const params = await props.params;
    const { id, version } = params;
    const versionNum = parseInt(version);

    if (isNaN(versionNum)) {
        return NextResponse.json({ error: 'Invalid version' }, { status: 400 });
    }

    try {
        // 用户身份解析（GET 请求通过 header 或查询参数）
        const { username } = await resolveUser(request);

        // 权限校验
        const { allowed, skill } = await canAccessSkill(id, username);
        if (!skill) {
            return NextResponse.json({ error: 'Skill not found' }, { status: 404 });
        }
        if (!allowed) {
            return NextResponse.json({ error: 'Unauthorized: Access denied' }, { status: 403 });
        }

        console.log(`[Download] Requested ID: ${id}, Version: ${version} (User: ${username || 'anonymous'})`);
        // 1. Get skill version info
        const skillVersion = await prisma.skillVersion.findFirst({
            where: {
                skillId: id,
                version: versionNum,
            },
            include: {
                Skill: true
            }
        });

        if (!skillVersion) {
            console.log('[Download] Version not found in DB');
            return NextResponse.json({ error: 'Version not found' }, { status: 404 });
        }
        console.log(`[Download] Found version. AssetPath: ${skillVersion.assetPath}`);

        // 2. Locate assets
        // Logic from upload: STORAGE_ROOT/id/version/ ...
        // Note: In upload route we might have different path logic.
        // Let's verify upload logic. The uploaded files are in:
        // path.join(process.cwd(), 'storage', 'skills', skillId, `v${version}`)

        // Use assetPath from DB (handles version inheritance)
        const assetPath = skillVersion.assetPath;
        const storageRoot = assetPath ? path.join(process.cwd(), assetPath) : '';

        // Create archive
        const archive = archiver('zip', {
            zlib: { level: 9 }
        });

        const stream = new Readable({
            read() { }
        });

        archive.on('data', (chunk) => stream.push(chunk));
        archive.on('end', () => stream.push(null));
        archive.on('error', (err) => {
            console.error('Archive error:', err);
            stream.destroy(err);
        });

        // 3. Add other files from storage if exists (First, so DB content potentially overwrites it)
        // 3. Add other files from storage if exists
        // Manual traversal to ensure we explicitly exclude SKILL.md
        if (storageRoot && fs.existsSync(storageRoot)) {
            const addDirectory = (dir: string, base: string) => {
                const files = fs.readdirSync(dir);
                for (const file of files) {
                    const fullPath = path.join(dir, file);
                    const relativePath = path.join(base, file);

                    if (fs.statSync(fullPath).isDirectory()) {
                        addDirectory(fullPath, relativePath);
                    } else {
                        // Ignore SKILL.md (case insensitive check)
                        if (file.toLowerCase() !== 'skill.md') {
                            archive.file(fullPath, { name: relativePath });
                        }
                    }
                }
            };
            addDirectory(storageRoot, '');
        }

        // 4. Add SKILL.md from DB (ensure it's the latest edited content)
        // We add it AFTER storage files so if storage has SKILL.md, this one (from DB) takes precedence
        archive.append(skillVersion.content, { name: 'SKILL.md' });

        archive.finalize();

        // Return stream response
        // Next.js App Router streaming response
        // We can return a Response with the readable stream

        // Convert Node Readable to Web ReadableStream
        const webStream = new ReadableStream({
            start(controller) {
                stream.on('data', chunk => controller.enqueue(chunk));
                stream.on('end', () => controller.close());
                stream.on('error', err => controller.error(err));
            }
        });

        return new Response(webStream, {
            headers: {
                'Content-Type': 'application/zip',
                'Content-Disposition': `attachment; filename="${skillVersion.Skill.name}-v${versionNum}.zip"`
            }
        });

    } catch (error) {
        console.error('Download error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
