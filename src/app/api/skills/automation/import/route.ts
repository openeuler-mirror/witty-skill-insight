
import { prisma } from '@/lib/prisma';
import fs from 'fs';
import { NextRequest, NextResponse } from 'next/server';
import path from 'path';

// Helper: Ensure directory exists
function ensureDir(dirPath: string) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

// Copy directory content recursively
function copyFolderSync(from: string, to: string, filesList: string[], rootTo: string) {
    if (!fs.existsSync(to)) {
        fs.mkdirSync(to, { recursive: true });
    }

    const entries = fs.readdirSync(from, { withFileTypes: true });

    for (const entry of entries) {
        const srcPath = path.join(from, entry.name);
        const destPath = path.join(to, entry.name);

        if (entry.isDirectory()) {
            copyFolderSync(srcPath, destPath, filesList, rootTo);
        } else {
            fs.copyFileSync(srcPath, destPath);
            // Store relative path from the Version root
            filesList.push(path.relative(rootTo, destPath));
        }
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { path: localPath, user } = body;

        if (!localPath) {
            return NextResponse.json({ error: 'Missing path' }, { status: 400 });
        }
        
        if (!user) {
            return NextResponse.json({ error: 'Missing user' }, { status: 400 });
        }

        if (!fs.existsSync(localPath)) {
            return NextResponse.json({ error: 'Path does not exist' }, { status: 404 });
        }

        const skillMdPath = path.join(localPath, 'SKILL.md');
        if (!fs.existsSync(skillMdPath)) {
            return NextResponse.json({ error: 'SKILL.md not found in path' }, { status: 400 });
        }

        // 1. Read SKILL.md and Parse Info
        const skillContent = fs.readFileSync(skillMdPath, 'utf8');
        let extractedName = path.basename(localPath);
        let extractedDesc = 'Imported via automation';

        const frontmatterRegex = /^---\s*([\s\S]*?)\s*---/;
        const match = skillContent.match(frontmatterRegex);

        if (match && match[1]) {
            const frontmatter = match[1];
            const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
            const descMatch = frontmatter.match(/^description:\s*(.+)$/m);

            if (nameMatch && nameMatch[1]) extractedName = nameMatch[1].trim();
            if (descMatch && descMatch[1]) extractedDesc = descMatch[1].trim();
        }

        // 2. Check DB
        // Use findFirst because prisma client might not have updated the unique type yet
        let skill = await prisma.skill.findFirst({ 
            where: { 
                name: extractedName,
                user: user
            } 
        });
        let nextVersionNum = 0;

        if (!skill) {
            // Create New
            skill = await prisma.skill.create({
                data: {
                    name: extractedName,
                    user: user,
                    description: extractedDesc,
                    visibility: 'private',
                    activeVersion: 0,
                    isUploaded: false
                }
            });
            nextVersionNum = 0;
        } else {
            // Update Existing - Increment Version
            const lastVersion = await prisma.skillVersion.findFirst({
                where: { skillId: skill.id },
                orderBy: { version: 'desc' }
            });
            nextVersionNum = lastVersion ? (lastVersion.version + 1) : 0;
        }

        // 3. Storage Copy
        const storageBase = path.join(process.cwd(), 'data', 'storage', 'skills', skill.id, `v${nextVersionNum}`);
        ensureDir(storageBase);

        const savedFilesList: string[] = [];
        copyFolderSync(localPath, storageBase, savedFilesList, storageBase);

        // 4. Create Version Record
        const skillVersion = await prisma.skillVersion.create({
            data: {
                skillId: skill.id,
                version: nextVersionNum,
                content: skillContent,
                assetPath: `data/storage/skills/${skill.id}/v${nextVersionNum}`,
                files: JSON.stringify(savedFilesList),
                changeLog: `Auto-imported version ${nextVersionNum}`
            }
        });

        // 5. Update active version
        await prisma.skill.update({
            where: { id: skill.id },
            data: { activeVersion: nextVersionNum }
        });

        return NextResponse.json({
            success: true,
            skill: { id: skill.id, name: skill.name },
            version: nextVersionNum,
            status: nextVersionNum === 0 ? 'created' : 'updated'
        });

    } catch (error: any) {
        console.error('Auto Import Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
