
import { prisma } from '@/lib/prisma'; // Ensure this exists
import { startSession } from '@/lib/proxy-store';
import { NextResponse } from 'next/server';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const taskId = (await params).taskId;
  let body: any = {};
  try {
      body = await request.json();
  } catch (e) {
      // Body might be empty or missing
  }
  if (!body || typeof body !== 'object') body = {};
  
  const { searchParams } = new URL(request.url);
  // Default: Get user from params/body
  let user = body.user || searchParams.get('user');

  // Check Headers for API Key if User not explicitly provided (or prioritize API Key?)
  // Let's prioritize API Key for "seamless upload via env var"
  const apiKey = request.headers.get('x-api-key') || body.apiKey;
  let model: string | undefined = body.model || searchParams.get('model') || undefined;

  if (apiKey) {
      try {
          const u = await prisma.user.findUnique({ where: { apiKey } });
          if (u) {
              user = u.username;
          }
      } catch (e) {
          console.error('API Key Lookup Failed', e);
      }
  }
  const query = body.query || searchParams.get('query');

  let sanitizedQuery = query;
  if (sanitizedQuery && typeof sanitizedQuery === 'string') {
      sanitizedQuery = sanitizedQuery.trim().replace(/^['"]+|['"]+$/g, '').trim();
  }

  
  await startSession(taskId, body.label, sanitizedQuery, user, model);
  return NextResponse.json({ status: 'ok', task_id: taskId, label: body.label, query: sanitizedQuery, user, message: 'Session started' });
}
