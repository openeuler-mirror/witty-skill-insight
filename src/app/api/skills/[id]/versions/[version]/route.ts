
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(
    request: NextRequest,
    props: { params: Promise<{ id: string; version: string }> }
) {
    try {
        const { id, version } = await props.params;

        if (!version) return NextResponse.json({ error: 'Version ID required' }, { status: 400 });

        const ver = await prisma.skillVersion.findFirst({
            where: {
                skillId: id,
                version: parseInt(version, 10)
            }
        });

        if (!ver) {
            return NextResponse.json({ error: 'Version not found' }, { status: 404 });
        }

        return NextResponse.json(ver);
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
