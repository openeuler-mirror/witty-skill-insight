import { prisma } from '@/lib/prisma';
import fs from 'fs';
import { NextRequest, NextResponse } from 'next/server';
import path from 'path';

;

// Helper: Ensure directory exists
function ensureDir(dirPath: string) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

export async function POST(request: NextRequest) {
    try {
        const formData = await request.formData();
        const files = formData.getAll('files') as File[];
        const paths = formData.getAll('paths') as string[]; // Relative paths

        if (files.length === 0) {
            return NextResponse.json({ error: 'No files uploaded' }, { status: 400 });
        }

        // 1. Find SKILL.md
        let skillMdFile: File | null = null;
        let skillMdIndex = -1;

        for (let i = 0; i < files.length; i++) {
            // Paths usually look like "my-skill/SKILL.md" or just "SKILL.md" if uploaded root
            // We check for endsWith('SKILL.md') and ensure it is at the root of the "skill folder"
            // But since we can support nested or root upload, let's just find the *top level* SKILL.md if possible,
            // or just ANY SKILL.md. To be safe, we require SKILL.md to be one of the files.
            // Actually, the path usually includes the folder name, e.g. "my-skill/SKILL.md".
            if (paths[i].endsWith('SKILL.md')) {
                skillMdFile = files[i];
                skillMdIndex = i;
                break;
            }
        }

        if (!skillMdFile) {
            return NextResponse.json({ error: 'SKILL.md is missing' }, { status: 400 });
        }

        // 2. Read SKILL.md content
        const skillContent = await skillMdFile.text();

        // Parse name from SKILL.md (simple regex or fallback to folder name)
        const folderPath = paths[skillMdIndex]; // "my-skill/SKILL.md"
        const folderName = folderPath.includes('/') ? folderPath.split('/')[0] : 'uploaded-skill';
        
        let extractedName = folderName;
        let extractedDesc = 'Imported via upload';

        // Try to extract name and description from frontmatter
        // Regex to match YAML frontmatter between ---
        const frontmatterRegex = /^---\s*([\s\S]*?)\s*---/;
        const match = skillContent.match(frontmatterRegex);
        
        if (match && match[1]) {
            const frontmatter = match[1];
            // Simple line-by-line parsing for "name:" and "description:"
            const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
            const descMatch = frontmatter.match(/^description:\s*(.+)$/m);
            
            if (nameMatch && nameMatch[1]) {
                extractedName = nameMatch[1].trim();
            }
            if (descMatch && descMatch[1]) {
                extractedDesc = descMatch[1].trim();
            }
        }

        // (Optional: We could still parse title for description or display name alias, but for unique ID use folderName)

        // 3. Create or Find Skill
        let skill: any = null;

        const targetSkillId = formData.get('targetSkillId') as string;
        const user = formData.get('user') as string;

        if (targetSkillId) {
            // Case A: New Version for EXISTING Skill
            skill = await prisma.skill.findUnique({ where: { id: targetSkillId } });
            if (!skill) {
                return NextResponse.json({ error: 'Target skill not found' }, { status: 404 });
            }
            
            // Optional: Verify user owns the skill if user is provided
            if (user && skill.user && skill.user !== user) {
                return NextResponse.json({ error: 'Unauthorized to update this skill' }, { status: 403 });
            }

            // STRICT VALIDATION: Folder Name must match Skill Name
            if (extractedName !== skill.name) {
                return NextResponse.json({
                    error: `Folder name mismatch! Expected: "${skill.name}", Found: "${extractedName}". Version updates must use the exact same folder name.`
                }, { status: 400 });
            }
        } else {
            // Case B: Brand New Skill
            // Use unique constraint name + user
            skill = await prisma.skill.findFirst({ 
                where: { 
                    name: extractedName,
                    user: user || null
                } 
            });

            if (skill) {
                // If skill exists, we now REJECT it.
                return NextResponse.json({
                    error: `Skill '${extractedName}' already exists. Please use the 'Version Management' (版本管理) -> 'Upload New Version' feature to update it.`
                }, { status: 400 });
            }

            skill = await prisma.skill.create({
                data: {
                    name: extractedName,
                    description: extractedDesc,
                    visibility: 'private',
                    activeVersion: 0,
                    user: user || null
                }
            });
        }

        // 4. Create Version
        // Calculate next version
        // 4. Create Version
        // REQUIREMENT: Start at v0 for fresh upload.
        // If skill exists, we might increment? Or if it's a re-upload of same folder?
        // "Using folder name as unique identifier... if exists... save content... and give version v0?"
        // If the user says "Start at v0", it implies the first ever version is v0.
        // If I re-upload "test-skill", should it be v1? 
        // "用户提供文件夹名...存在则将SKILL.md...保存在数据库...并给版本标签v0"
        // This suggests every upload (or at least the initial one) sets/resets to v0?
        // Or maybe just "Initial is v0". 
        // Let's assume: If skill is new -> v0. If skill exists -> Increment (v+1).

        const lastVersion = await prisma.skillVersion.findFirst({
            where: { skillId: skill.id },
            orderBy: { version: 'desc' }
        });

        // If no versions exist (new skill), start at 0.
        // If versions exist, increment.
        const nextVersionNum = lastVersion ? (lastVersion.version + 1) : 0;

        // 5. Save Files to Storage
        // Storage Path: data/storage/skills/{skillId}/v{version}/
        const storageBase = path.join(process.cwd(), 'data', 'storage', 'skills', skill.id, `v${nextVersionNum}`);
        ensureDir(storageBase);

        const savedFilesList: string[] = [];

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const relativePath = paths[i];
            // Remove the top-level folder name from relativePath to make it cleaner inside v{num}
            // e.g. "my-skill/scripts/run.py" -> "scripts/run.py"
            const parts = relativePath.split('/');
            const cleanPath = parts.length > 1 ? parts.slice(1).join('/') : relativePath;

            if (!cleanPath) continue; // Skip if it was just the folder name entry

            const fullPath = path.join(storageBase, cleanPath);
            ensureDir(path.dirname(fullPath));

            const buffer = Buffer.from(await file.arrayBuffer());
            fs.writeFileSync(fullPath, buffer);
            savedFilesList.push(cleanPath);
        }

        // 6. DB Record
        const skillVersion = await prisma.skillVersion.create({
            data: {
                skillId: skill.id,
                version: nextVersionNum,
                content: skillContent,
                assetPath: `data/storage/skills/${skill.id}/v${nextVersionNum}`,
                files: JSON.stringify(savedFilesList),
                changeLog: `Uploaded version ${nextVersionNum}`
            }
        });

        return NextResponse.json({ success: true, skill, version: skillVersion });

    } catch (error: any) {
        console.error('Upload Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
