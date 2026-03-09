import { db } from '@/lib/prisma';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id');

        if (!id) {
            return NextResponse.json({ error: 'Missing id parameter' }, { status: 400 });
        }

        const config = await db.findConfigById(id);

        if (!config) {
            return NextResponse.json({ error: 'Config not found' }, { status: 404 });
        }

        let rootCauses = [];
        let keyActions = [];
        try {
            if (config.rootCauses) rootCauses = JSON.parse(config.rootCauses);
            if (config.keyActions) keyActions = JSON.parse(config.keyActions);
        } catch (e) {}

        return NextResponse.json({
            id: config.id,
            query: config.query,
            skill: config.skill,
            standard_answer: config.standardAnswer,
            root_causes: rootCauses,
            key_actions: keyActions,
            parse_status: config.parseStatus || 'completed'
        });
    } catch (error: any) {
        console.error('Config Status Error:', error);
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}
