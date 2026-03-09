import { resolveUser } from '@/lib/auth';
import { db, prisma } from '@/lib/prisma';
import fs from 'fs';
import { NextRequest, NextResponse } from 'next/server';
import path from 'path';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get('query');
    const category = searchParams.get('category');
    const userParam = searchParams.get('user');
    
    const { username: user } = await resolveUser(request, userParam);
    
    const where: any = {};
    
    if (user) {
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

    const skills = await db.findSkills(where);

    skills.sort((a: any, b: any) => {
      const v0A = a.versions?.find((v: any) => v.version === 0);
      const v0B = b.versions?.find((v: any) => v.version === 0);
      const timeA = v0A ? new Date(v0A.createdAt).getTime() : 0;
      const timeB = v0B ? new Date(v0B.createdAt).getTime() : 0;
      return timeB - timeA;
    });

    const response = skills.map((s: any) => {
      const activeVerObj = s.versions?.find((v: any) => v.version === (s.activeVersion || 0));
      const displayDescription = activeVerObj?.changeLog || s.description;
      const displayTime = activeVerObj?.createdAt ? new Date(activeVerObj.createdAt).toISOString() : s.updatedAt.toISOString();

      return {
        id: s.id,
        name: s.name,
        description: displayDescription,
        category: s.category,
        tags: s.tags ? JSON.parse(s.tags) : [],
        author: s.author,
        updatedAt: displayTime,
        version: s.activeVersion || 0,
        activeVersion: s.activeVersion || 0,
        visibility: s.visibility,
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

export async function DELETE(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const id = searchParams.get('id');
  const userParam = searchParams.get('user');
  if (!id) return NextResponse.json({ error: 'ID required' }, { status: 400 });

  try {
    const { username: user } = await resolveUser(request, userParam);
    
    const skill = await db.findSkillById(id);
    if (!skill) return NextResponse.json({ error: 'Skill not found' }, { status: 404 });
    
    if (user && skill.user && skill.user !== user) {
        return NextResponse.json({ error: 'Unauthorized delete' }, { status: 403 });
    }

    const storagePath = path.join(process.cwd(), 'data', 'storage', 'skills', id);

    if (fs.existsSync(storagePath)) {
      fs.rmSync(storagePath, { recursive: true, force: true });
    }

    await db.deleteSkill(id);

    return NextResponse.json({ success: true });
  } catch (e: any) {
    console.error('Delete Skill Error:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
