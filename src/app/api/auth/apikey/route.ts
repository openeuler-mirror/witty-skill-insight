
import { prisma } from '@/lib/prisma';
import crypto from 'crypto';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const { username } = await request.json();
    
    if (!username || typeof username !== 'string') {
      return NextResponse.json({ error: 'Username is required' }, { status: 400 });
    }

    const cleanUsername = username.trim().toLowerCase();
    
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(cleanUsername)) {
      return NextResponse.json({ error: 'Username must be a valid email address' }, { status: 400 });
    }
    
    // Find existing user
    let user = await prisma.user.findUnique({
      where: { username: cleanUsername }
    });

    // If not found, create new user with API Key
    if (!user) {
      const apiKey = `sk-${crypto.randomBytes(16).toString('hex')}`;
      try {
          user = await prisma.user.create({
            data: {
              username: cleanUsername,
              apiKey
            }
          });
      } catch (e: any) {
          // Handle race condition where user might be created between findUnique and create
          // P2002 is Prisma unique constraint violation code
          if (e.code === 'P2002') {
              user = await prisma.user.findUnique({
                  where: { username: cleanUsername }
              });
          } else {
              throw e;
          }
      }
    }

    if (!user) {
        throw new Error("Failed to retrieve or create user");
    }

    return NextResponse.json({ 
        username: user.username, 
        apiKey: user.apiKey 
    });

  } catch (error) {
    console.error('API Key generation error:', error);
    return NextResponse.json({ error: 'Failed to generate API Key', details: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
