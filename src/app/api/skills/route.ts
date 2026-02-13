import { resolveUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import fs from 'fs';
import { NextRequest, NextResponse } from 'next/server';
import path from 'path';

export const dynamic = 'force-dynamic';

// GET /api/skills
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get('query');
    const category = searchParams.get('category');
    const userParam = searchParams.get('user');
    
    // 用户身份解析：优先 user 查询参数，其次 apiKey
    const { username: user } = await resolveUser(request, userParam);
    
    const where: any = {};
    
    // User Isolation: Only show my skills or public skills (optional logic)
    // For now, let's strictly show only this user's skills if user is provided.
    if (user) {
        // The provided code snippet for this block seems to be from a different context (e.g., a POST request for creating config items)
        // and is syntactically incorrect for assigning to `where.OR` in a GET request's filtering logic.
        // To make the file syntactically correct and based on the instruction to "Use 'any' casting to resolve property access and object literal errors",
        // and assuming the intent was to modify the filtering logic, the original filtering logic is retained,
        // but if the user intended to insert the provided `for...of` loop, it cannot be done here while maintaining syntax.
        // If the intention was to replace the `where.OR` assignment with the provided loop, it would break the query.
        // As the instruction is to make the resulting file syntactically correct, and the provided snippet is not valid
        // for the `where.OR` assignment, the original `where.OR` assignment is kept.
        // If the user intended to add the provided loop elsewhere or in a different context, please provide further clarification.
        where.OR = [
            { user: user },
            { user: null },
            { visibility: 'public' }
        ];
    }

    if (query) {
      const queryFilter = {
        OR: [
          { name: { contains: query } },
          { description: { contains: query } }
        ]
      };
      // Merge with where
      if (where.OR) {
          where.AND = [
              { OR: where.OR },
              queryFilter
          ];
          delete where.OR;
      } else {
          where.OR = queryFilter.OR;
      }
    }
    
    if (category && category !== '全部') {
      where.category = category;
    }

    const skills = await prisma.skill.findMany({
      where,
      // orderBy: { updatedAt: 'desc' }, // Custom sort by v0 createdAt below
      include: {
        versions: {
          orderBy: { version: 'desc' },
          select: { version: true, createdAt: true, changeLog: true }
        }
      }
    });

    // Sort by v0 creation time (Descending)
    skills.sort((a, b) => {
      const v0A = a.versions.find((v: any) => v.version === 0);
      const v0B = b.versions.find((v: any) => v.version === 0);
      const timeA = v0A ? new Date(v0A.createdAt).getTime() : 0;
      const timeB = v0B ? new Date(v0B.createdAt).getTime() : 0;
      return timeB - timeA;
    });

    // Transform to match frontend expectation (partially)
    const response = skills.map((s: any) => {
      // Find active version data
      const activeVerObj = s.versions?.find((v: any) => v.version === (s.activeVersion || 0));

      // Use active version's changelog/time if available, else fallback to skill's generic info
      const displayDescription = activeVerObj?.changeLog || s.description;
      // Use active version's createdAt, or fallback to skill updated at
      const displayTime = activeVerObj?.createdAt ? new Date(activeVerObj.createdAt).toISOString() : s.updatedAt.toISOString();

      return {
        id: s.id,
        name: s.name,
        description: displayDescription,
        category: s.category,
        tags: s.tags ? JSON.parse(s.tags) : [],
        author: s.author,
        updatedAt: displayTime,
        version: s.activeVersion || 0, // Frontend shows this as 'Activated: vX'
        activeVersion: s.activeVersion || 0,
        visibility: s.visibility,
        // Mock stats for now as we didn't migrate stats DB
        qualityScore: 0,
        usageCount: 0,
        successRate: 0,
        isUploaded: s.isUploaded,
        versions: s.versions?.map((v: any) => ({
          version: v.version,
          createdAt: v.createdAt ? new Date(v.createdAt).toISOString() : '',
          changeLog: v.changeLog
        })) || []
      };
    });

    return NextResponse.json(response);
  } catch (error) {
    console.error('Fetch Skills Error:', error);
    return NextResponse.json({ error: 'Failed to fetch skills' }, { status: 500 });
  }
}

// DELETE /api/skills
export async function DELETE(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const id = searchParams.get('id');
  const userParam = searchParams.get('user');
  if (!id) return NextResponse.json({ error: 'ID required' }, { status: 400 });

  try {
    // 用户身份解析
    const { username: user } = await resolveUser(request, userParam);
    
    // 1. Check if skill exists and belongs to user
    const skill: any = await prisma.skill.findUnique({ where: { id } });
    if (!skill) return NextResponse.json({ error: 'Skill not found' }, { status: 404 });
    
    if (user && skill.user && skill.user !== user) {
        return NextResponse.json({ error: 'Unauthorized delete' }, { status: 403 });
    }

    // 2. We assume standard path: data/storage/skills/{id}
    const storagePath = path.join(process.cwd(), 'data', 'storage', 'skills', id);

    // 3. Delete files from storage
    if (fs.existsSync(storagePath)) {
      fs.rmSync(storagePath, { recursive: true, force: true });
    }

    // 4. Delete from DB (Cascade deletes versions)
    await prisma.skill.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (e: any) {
    console.error('Delete Skill Error:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}