import { canAccessSkill, resolveUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import fs from 'fs';
import { NextRequest, NextResponse } from 'next/server';
import path from 'path';

// Helper
function copyRecursiveSync(src: string, dest: string) {
    const exists = fs.existsSync(src);
    const stats = exists && fs.statSync(src);
    const isDirectory = exists && stats && stats.isDirectory();

    if (isDirectory) {
        if (!fs.existsSync(dest)) {
            fs.mkdirSync(dest, { recursive: true });
        }
        fs.readdirSync(src).forEach((childItemName) => {
            copyRecursiveSync(path.join(src, childItemName), path.join(dest, childItemName));
        });
    } else {
        if (!fs.existsSync(path.dirname(dest))) {
            fs.mkdirSync(path.dirname(dest), { recursive: true });
        }
        fs.copyFileSync(src, dest);
    }
}

export async function POST(request: NextRequest) {
    try {
        const { skillId, version, user: explicitUser } = await request.json();

        if (!skillId || !version) {
            return NextResponse.json({ error: 'Missing skillId or version' }, { status: 400 });
        }

        // 用户身份解析
        const { username } = await resolveUser(request, explicitUser);

        // 权限校验
        const { allowed, skill: skillCheck } = await canAccessSkill(skillId, username);
        if (!skillCheck) {
            return NextResponse.json({ error: 'Skill not found' }, { status: 404 });
        }
        if (!allowed) {
            return NextResponse.json({ error: 'Unauthorized: Access denied' }, { status: 403 });
        }

        // 1. Fetch Version
        const skillVersion = await prisma.skillVersion.findUnique({
            where: {
                skillId_version: {
                    skillId,
                    version: parseInt(version)
                }
            },
            include: { Skill: true }
        });

        if (!skillVersion) {
            return NextResponse.json({ error: 'Version not found' }, { status: 404 });
        }

        // 2. Define Opencode Target Path
        // Assuming opencode is at `opencode/` in project root or parallel?
        // Found `opencode` dir in root in step 22.
        const opencodeRoot = path.join(process.cwd(), 'opencode', 'skills');
        const skillName = skillVersion.Skill.name; // sanitized?
        const targetDir = path.join(opencodeRoot, skillName);

        // 3. Prepare Target Directory
        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }

        // 4. Write SKILL.md
        fs.writeFileSync(path.join(targetDir, 'SKILL.md'), skillVersion.content);

        // 5. Copy Assets
        // If assetPath exists
        if (skillVersion.assetPath) {
            const sourcePath = path.resolve(skillVersion.assetPath); // Ensure absolute

            if (fs.existsSync(sourcePath)) {
                // We only copy the contents of the asset folder, not the folder itself?
                // "files" list might help, or just copy everything in assetPath.
                // Since assetPath = "data/storage/skills/.../v1", it contains "scripts/", "assets/" etc.
                // So we copy contents of sourcePath to targetDir.

                const files = fs.readdirSync(sourcePath);
                for (const file of files) {
                    copyRecursiveSync(path.join(sourcePath, file), path.join(targetDir, file));
                }
            }
        }

        // 6. Update opencode/skills.json (Optional)
        // If there is a registry file for opencode, update it.
        // Assuming just file presence is enough or we need to check requirements.
        // For now, file copy is the main requirement "load to opencode directory".

        return NextResponse.json({ success: true, targetDir });

    } catch (error: any) {
        console.error('Sync Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
