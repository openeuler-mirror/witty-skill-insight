import { readConfig } from '@/lib/data-service';
import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const user = searchParams.get('user');
    const data = await readConfig(user);
    return NextResponse.json(data);
  } catch (error) {
    console.error('Config Load Error:', error);
    return NextResponse.json({ error: 'Failed to load config' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { configs: newConfig, user } = await request.json();
    
    // Basic validation
    if (!Array.isArray(newConfig)) {
       return NextResponse.json({ error: 'Invalid config format, expected array' }, { status: 400 });
    }

    if (!user) {
        return NextResponse.json({ error: 'User is required for scoped config' }, { status: 400 });
    }

    // Transaction: Delete all for THIS user AND legacy orphans, then create
    await prisma.$transaction(async (tx) => {
        await tx.config.deleteMany({ 
            where: { 
                OR: [
                    { user: user },
                    { user: null }
                ]
            } as any
        });
        
        for (const item of newConfig) {
             const data: any = {
                 query: item.query,
                 skill: item.skill || '',
                 standardAnswer: item.standard_answer || '',
                 rootCauses: item.root_causes ? JSON.stringify(item.root_causes) : null,
                 keyActions: item.key_actions ? JSON.stringify(item.key_actions) : null,
                 user: user,
                 parseStatus: item.parse_status || 'completed'
             };
             await tx.config.create({ data });
        }
    });

    return NextResponse.json({ success: true, message: 'Config saved' });
  } catch (error) {
    console.error('Config Save Error:', error);
    return NextResponse.json({ error: 'Failed to save config' }, { status: 500 });
  }
}
