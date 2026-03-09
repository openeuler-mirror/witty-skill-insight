import { readConfig } from '@/lib/data-service';
import { db, prisma } from '@/lib/prisma';
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
    
    if (!Array.isArray(newConfig)) {
       return NextResponse.json({ error: 'Invalid config format, expected array' }, { status: 400 });
    }

    if (!user) {
        return NextResponse.json({ error: 'User is required for scoped config' }, { status: 400 });
    }

    const client = db.getClient();
    
    if ('query' in client) {
        const pgClient = client as any;
        
        await pgClient.query('BEGIN');
        try {
            await pgClient.query(
                `DELETE FROM "Config" WHERE "user" = $1 OR "user" IS NULL`,
                [user]
            );
            
            for (const item of newConfig) {
                const id = require('uuid').v4();
                await pgClient.query(
                    `INSERT INTO "Config" (id, query, skill, "standardAnswer", "rootCauses", "keyActions", "user", "parseStatus") VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                    [
                        id,
                        item.query,
                        item.skill || '',
                        item.standard_answer || '',
                        item.root_causes ? JSON.stringify(item.root_causes) : null,
                        item.key_actions ? JSON.stringify(item.key_actions) : null,
                        user,
                        item.parse_status || 'completed'
                    ]
                );
            }
            
            await pgClient.query('COMMIT');
        } catch (e) {
            await pgClient.query('ROLLBACK');
            throw e;
        }
    } else {
        await (prisma as any).$transaction(async (tx: any) => {
            await tx.config.deleteMany({ 
                where: { 
                    OR: [
                        { user: user },
                        { user: null }
                    ]
                }
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
    }

    return NextResponse.json({ success: true, message: 'Config saved' });
  } catch (error) {
    console.error('Config Save Error:', error);
    return NextResponse.json({ error: 'Failed to save config' }, { status: 500 });
  }
}
