
import { prisma } from './prisma';

export interface SessionData {
    taskId: string;
    label?: string;
    query?: string;
    startTime: number;
    interactions: {
        requestMessages: any[];
        responseMessage: any;
        usage: {
            prompt_tokens: number;
            completion_tokens: number;
            total_tokens: number;
        };
        latency: number;
        timestamp: number;
        toolCalls: any[];
    }[];
    user?: string; // Add user field
    model?: string; // Add model field
}

export async function startSession(taskId: string, label?: string, query?: string, user?: string, model?: string) {
    const data: SessionData = {
        taskId,
        label,
        query,
        user,
        model,
        startTime: Date.now(),
        interactions: []
    };
    
    await prisma.session.create({
        data: {
            taskId,
            label,
            query,
            user,
            model,
            startTime: new Date(data.startTime),
            interactions: JSON.stringify([])
        }
    });

    return data;
}

export async function addToSession(taskId: string, interaction: SessionData['interactions'][0]) {
    const session = await prisma.session.findUnique({ where: { taskId } });
    let interactions: any[] = [];
    let startTime = Date.now();
    let currentData: any = {};
    
    if (session) {
        // console.log(`[ProxyStore] Found session ${taskId}, existing interactions: ${session.interactions?.length}`);
        try {
            interactions = session.interactions ? JSON.parse(session.interactions as string) : [];
        } catch (e) {
            console.error(`[ProxyStore] Failed to parse interactions for ${taskId}`, e);
            interactions = [];
        }
        
        startTime = session.startTime.getTime();
        currentData = { 
            taskId: session.taskId,
            label: session.label,
            query: session.query,
            user: session.user,
            model: session.model,
            startTime,
            interactions // local ref
        };
    } else {
        console.log(`[ProxyStore] Session ${taskId} not found in addToSession, creating new.`);
        // Fallback create if missing
        currentData = { taskId, startTime, interactions: [] };
        // We create it, but we don't return yet, we proceed to add interaction
        await prisma.session.create({
            data: { 
                taskId, 
                startTime: new Date(startTime), 
                interactions: JSON.stringify([]) 
            }
        });
    }
    
    interactions.push(interaction);
    // console.log(`[ProxyStore] Saving ${interactions.length} interactions for ${taskId}`);

    await prisma.session.update({
        where: { taskId },
        data: {
            interactions: JSON.stringify(interactions)
        }
    });
    
    currentData.interactions = interactions;
    return currentData;
}

export async function endSession(taskId: string): Promise<SessionData | null> {
    const session = await prisma.session.findUnique({ where: { taskId } });
    if (!session) return null;
    
    return {
        taskId: session.taskId,
        label: session.label || undefined,
        query: session.query || undefined,
        user: session.user || undefined,
        model: session.model || undefined,
        startTime: session.startTime.getTime(),
        interactions: session.interactions ? JSON.parse(session.interactions) : []
    };
}

export async function getSession(taskId: string): Promise<SessionData | null> {
    const session = await prisma.session.findUnique({ where: { taskId } });
    if (!session) return null;
    
    return {
        taskId: session.taskId,
        label: session.label || undefined,
        query: session.query || undefined,
        user: session.user || undefined,
        model: session.model || undefined,
        startTime: session.startTime.getTime(),
        interactions: session.interactions ? JSON.parse(session.interactions) : []
    };
}
