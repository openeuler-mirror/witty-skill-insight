
import { getServerSettings, saveServerSettings } from '@/lib/server-config';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const user = searchParams.get('user');
    return NextResponse.json(await getServerSettings(user));
}

export async function POST(request: Request) {
    try {
        const { settings, user } = await request.json();
        if (!user) return NextResponse.json({ error: 'User is required' }, { status: 400 });
        const updated = await saveServerSettings(settings, user);
        return NextResponse.json(updated);
    } catch (e: any) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
