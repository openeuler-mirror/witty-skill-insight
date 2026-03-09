
import { saveExecutionRecord } from '@/lib/data-service';
import { db } from '@/lib/prisma';
import { NextResponse } from 'next/server';

function getValue(anyValue: any): any {
    if (!anyValue) return undefined;
    if (anyValue.stringValue !== undefined) return anyValue.stringValue;
    if (anyValue.intValue !== undefined) return parseInt(anyValue.intValue);
    if (anyValue.doubleValue !== undefined) return anyValue.doubleValue;
    if (anyValue.boolValue !== undefined) return anyValue.boolValue;
    if (anyValue.arrayValue !== undefined) {
        return anyValue.arrayValue.values?.map((v: any) => getValue(v)) || [];
    }
    if (anyValue.kvlistValue !== undefined) {
        const obj: any = {};
        for (const kv of (anyValue.kvlistValue.values || [])) {
            obj[kv.key] = getValue(kv.value);
        }
        return obj;
    }
    return undefined;
}

export async function POST(req: Request) {
    try {
        const apiKey = req.headers.get('x-witty-api-key');
        let authenticatedUser: string | undefined;

        if (apiKey) {
            const userRecord = await db.findUserByApiKey(apiKey);
            if (userRecord) {
                authenticatedUser = userRecord.username;
                console.log(`[OTel Logs] Authenticated User: ${authenticatedUser}`);
            }
        }

        const contentType = req.headers.get('content-type') || '';

        if (!contentType.includes('application/json')) {
            console.warn(`[OTel Logs] Unsupported Content-Type: ${contentType}`);
            return new NextResponse(JSON.stringify({ error: 'Only application/json is supported. Set OTEL_EXPORTER_OTLP_LOGS_PROTOCOL=http/json' }), { status: 415 });
        }

        const body = await req.json();

        if (!body.resourceLogs || !Array.isArray(body.resourceLogs)) {
            console.log('[OTel Logs] Empty or missing resourceLogs');
            return NextResponse.json({ status: 'success', message: 'No logs' });
        }

        console.log(`[OTel Logs] Received ${body.resourceLogs.length} resourceLog(s)`);

        for (const resourceLog of body.resourceLogs) {
            const resourceAttrs: any = {};
            if (resourceLog.resource?.attributes) {
                for (const attr of resourceLog.resource.attributes) {
                    resourceAttrs[attr.key] = getValue(attr.value);
                }
            }

            const serviceName = resourceAttrs['service.name'] || 'unknown-service';

            for (const scopeLog of resourceLog.scopeLogs || []) {
                for (const record of scopeLog.logRecords || []) {
                    const attributes: any = {};
                    if (record.attributes) {
                        for (const attr of record.attributes) {
                            attributes[attr.key] = getValue(attr.value);
                        }
                    }

                    const eventName = attributes['event.name'] || record.body?.stringValue;
                    
                    const sessionId = attributes['session.id'] || resourceAttrs['session.id'] || resourceAttrs['service.instance.id'];
                    const otelUserId = attributes['user.id'] || resourceAttrs['user.id'];
                    
                    const finalUser = authenticatedUser || otelUserId || 'anonymous';

                    console.log(`[OTel Logs] Event: ${eventName} | Session: ${sessionId} | User: ${finalUser}`);

                    if (!sessionId) {
                        console.warn('[OTel Logs] No session.id found, skipping bridge.');
                        continue;
                    }

                    const framework = serviceName === 'cli-agent' || serviceName === 'claude-code' ? 'claudecode' : serviceName;

                    if (eventName === 'user_prompt') {
                        await saveExecutionRecord({
                            task_id: sessionId,
                            query: attributes['prompt'] || 'Claude Code Session',
                            framework: framework,
                            user: finalUser,
                            timestamp: new Date(),
                        });
                        console.log(`[OTel Logs] ✅ Saved user_prompt for session ${sessionId}`);

                    } else if (eventName === 'api_request') {
                        const inputTokens = parseInt(attributes['input_tokens'] || '0');
                        const outputTokens = parseInt(attributes['output_tokens'] || '0');
                        const cacheRead = parseInt(attributes['cache_read_tokens'] || '0');
                        const cacheCreate = parseInt(attributes['cache_creation_tokens'] || '0');
                        const totalTokens = inputTokens + outputTokens + cacheRead + cacheCreate;
                        const durationMs = parseInt(attributes['duration_ms'] || '0');
                        const costUsd = parseFloat(attributes['cost_usd'] || '0');

                        await saveExecutionRecord({
                            task_id: sessionId,
                            model: attributes['model'],
                            tokens: totalTokens,
                            latency: durationMs / 1000,
                            cost: costUsd,
                            framework: framework,
                            user: finalUser,
                        });
                        console.log(`[OTel Logs] ✅ Saved api_request for session ${sessionId}: model=${attributes['model']}, tokens=${totalTokens}`);

                    } else if (eventName === 'tool_result') {
                        console.log(`[OTel Logs] Tool: ${attributes['tool_name']} | Success: ${attributes['success']} | Duration: ${attributes['duration_ms']}ms`);

                    } else if (eventName === 'api_error') {
                        console.warn(`[OTel Logs] ⚠️ API Error in session ${sessionId}: ${attributes['error']} (status: ${attributes['status_code']})`);
                    }
                }
            }
        }

        return NextResponse.json({ status: 'success' });
    } catch (err: any) {
        console.error('[OTel Logs] Handler Error:', err);
        return NextResponse.json({ status: 'error', message: err.message }, { status: 500 });
    }
}

export async function OPTIONS() {
    return new NextResponse(null, {
        status: 204,
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-witty-api-key, baggage, traceparent, tracestate',
        }
    });
}
