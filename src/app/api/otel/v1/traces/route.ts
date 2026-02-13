
import { saveExecutionRecord } from '@/lib/data-service';
import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';

// Helper to extract value from OTLP AnyValue
function getValue(anyValue: any): any {
  if (!anyValue) return undefined;
  if (anyValue.stringValue !== undefined) return anyValue.stringValue;
  if (anyValue.intValue !== undefined) return parseInt(anyValue.intValue); // intValue is often string in JSON
  if (anyValue.doubleValue !== undefined) return anyValue.doubleValue;
  if (anyValue.boolValue !== undefined) return anyValue.boolValue;
  if (anyValue.arrayValue !== undefined) return anyValue.arrayValue.values?.map(getValue);
  if (anyValue.kvlistValue !== undefined) {
    const obj: any = {};
    anyValue.kvlistValue.values.forEach((kv: any) => {
        obj[kv.key] = getValue(kv.value);
    });
    return obj;
  }
  return undefined;
}

export async function POST(req: Request) {
  try {
    // 1. Authenticate User via Header
    const apiKey = req.headers.get('x-witty-api-key');
    let authenticatedUser: string | undefined;

    if (apiKey) {
        const userRecord = await prisma.user.findUnique({
            where: { apiKey }
        });
        if (userRecord) {
            authenticatedUser = userRecord.username;
            console.log(`[OTel] Authenticated User: ${authenticatedUser}`);
        } else {
            console.warn(`[OTel] Invalid API Key provided: ${apiKey}`);
        }
    }

    const contentType = req.headers.get('content-type') || '';
    console.log(`[OTel] Received Request. Content-Type: ${contentType}`);

    let body;
    try {
        if (contentType.includes('application/json')) {
            body = await req.json();
        } else if (contentType.includes('application/x-protobuf')) {
            // TODO: Implement Protobuf parsing if needed.
            // For now, we can't parse it without a library, but we acknowledge receipt.
            console.warn('[OTel] Received Protobuf payload. JSON parser skipped.');
            return NextResponse.json({ error: 'Protobuf not supported yet, please use OTEL_EXPORTER_OTLP_PROTOCOL=http/json' }, { status: 415 });
        } else {
            console.log('[OTel] Unknown Content-Type, attempting JSON parse...');
            body = await req.json();
        }
    } catch (e) {
        console.error('[OTel] Failed to parse request body:', e);
        return NextResponse.json({ error: 'Invalid Payload' }, { status: 400 });
    }
    
    if (!body) return NextResponse.json({}); // Early exit for protobuf pending support

    // DEBUG: Log entire payload structure to see what opencode is sending
    console.log('[OTel] Raw Body Structure:', JSON.stringify(body, (key, value) => {
        if (key === 'resourceSpans' && Array.isArray(value)) return `[${value.length} spans]`; 
        return value;
    }, 2));
    
    // Log specifics
    if (body.resourceSpans && body.resourceSpans.length > 0) {
        console.log('[OTel] First Resource Attributes:', JSON.stringify(body.resourceSpans[0].resource?.attributes));
        if (body.resourceSpans[0].scopeSpans?.[0]?.spans?.[0]) {
             console.log('[OTel] First Span Attributes:', JSON.stringify(body.resourceSpans[0].scopeSpans[0].spans[0].attributes));
        }
    }

    const resourceSpans = body.resourceSpans || [];

    for (const resourceSpan of resourceSpans) {
      const resourceAttrsStart = resourceSpan.resource?.attributes || [];
      const resourceAttrs: Record<string, any> = {};
      resourceAttrsStart.forEach((a: any) => {
          resourceAttrs[a.key] = getValue(a.value);
      });

      const serviceName = resourceAttrs['service.name'] || 'unknown-service';
      
      // Prefer Authenticated User -> User from OTel Attributes -> Default
      const userId = authenticatedUser || resourceAttrs['user.id'] || resourceAttrs['enduser.id'];

      const scopeSpans = resourceSpan.scopeSpans || [];
      for (const scopeSpan of scopeSpans) {
        const spans = scopeSpan.spans || [];
        for (const span of spans) {
          const attrsStart = span.attributes || [];
          const attrs: Record<string, any> = {};
          attrsStart.forEach((a: any) => {
              attrs[a.key] = getValue(a.value);
          });

          // Check for GenAI Call
          const isGenAI = Object.keys(attrs).some(k => k.startsWith('gen_ai.') || k.startsWith('llm.'));
          // Check for Tool Call (often has tool.name or similar)
          const isTool = attrs['tool.name'] !== undefined;

          // We want to capture significant steps.
          // GenAI calls are "interactions".
          // Tool calls are also important.

          if (isGenAI || isTool) {
            const traceId = span.traceId;
            const spanId = span.spanId;
            const parentSpanId = span.parentSpanId;
            
            // Extract Metrics
            const model = attrs['gen_ai.request.model'] || attrs['llm.request.model'];
            const inputTokens = attrs['gen_ai.usage.input_tokens'] || attrs['llm.usage.prompt_tokens'] || 0;
            const outputTokens = attrs['gen_ai.usage.output_tokens'] || attrs['llm.usage.completion_tokens'] || 0;
            const totalTokens = (inputTokens || 0) + (outputTokens || 0);

            // Times
            // Unix Nanoseconds string -> Milliseconds
            // BigInt literal support depends on target, use constructor for safety
            const startTimeNano = BigInt(span.startTimeUnixNano || 0);
            const endTimeNano = BigInt(span.endTimeUnixNano || 0);
            const latencyMs = Number((endTimeNano - startTimeNano) / BigInt(1000000));
            const startTimeMs = Number(startTimeNano / BigInt(1000000));

            // Content Extraction
            // Different instrumentations use different keys.
            // OpenInference / Semantic Conventions:
            const prompt = attrs['gen_ai.prompt'] || attrs['db.statement']; // db.statement sometimes used for prompts
            const completion = attrs['gen_ai.completion'] || attrs['db.result']; 
            
            // Construct Interaction Object
            const interaction: any = {
                spanId,
                parentSpanId,
                name: span.name, // e.g. "chat", "tool_call"
                type: isTool ? 'tool' : 'llm',
                model,
                usage: { 
                    input_tokens: inputTokens, 
                    output_tokens: outputTokens, 
                    total_tokens: totalTokens 
                },
                latency: latencyMs,
                timestamp: startTimeMs,
            };

            if (prompt) interaction.requestMessages = [{ role: 'user', content: prompt }];
            if (completion) interaction.responseMessage = { role: 'assistant', content: completion };
            
            if (isTool) {
                interaction.toolCall = {
                    name: attrs['tool.name'],
                    arguments: attrs['tool.arguments'] || JSON.stringify(attrs)
                };
            }

            console.log(`[OTel] Processed Span: ${traceId} - ${span.name} (${latencyMs}ms)`);

            // Strategy: Grouping for Multi-turn Sessions (CLI REPL)
            // 1. If 'service.instance.id' (Process ID) is present, use it as the Session ID (TaskId).
            //    This ensures all interactions in one open CLI window are grouped together.
            // 2. Fallback to 'traceId' for single-shot commands or if Instance ID is missing.
            //    (Note: Single commands usually have 1 trace, so this works fine too).
            
            const serviceInstanceId = resourceAttrs['service.instance.id'];
            // You can also look for explicit session.id if the tool sends it
            const explicitSessionId = resourceAttrs['session.id'] || attrs['session.id'];

            let taskId = explicitSessionId || serviceInstanceId || traceId;
            
            // Clean up ID if it's too generic (unlikely for UUIDs)
            if (taskId === 'unknown') taskId = traceId;

            console.log(`[OTel] Grouping into Session: ${taskId} (Source: ${explicitSessionId ? 'SessionID' : serviceInstanceId ? 'ProcessID' : 'TraceID'})`);

            const existingSession = await prisma.session.findUnique({ where: { taskId } });
            
            let currentInteractions: any[] = [];
            if (existingSession?.interactions) {
                try {
                    currentInteractions = JSON.parse(existingSession.interactions);
                } catch (e) {}
            }
            
            // Avoid duplicates
            if (!currentInteractions.find((i: any) => i.spanId === spanId)) {
                
                // Add traceId to interaction for correlation
                interaction.traceId = traceId;

                currentInteractions.push(interaction);
                // Sort by timestamp
                currentInteractions.sort((a, b) => a.timestamp - b.timestamp);
                
                // Update Session
                // Cast to any to bypass potential stale Prisma types
                await prisma.session.upsert({
                    where: { taskId },
                    create: {
                        taskId,
                        user: userId,
                        model: model || 'unknown', 
                        startTime: new Date(startTimeMs),
                        interactions: JSON.stringify(currentInteractions),
                        label: serviceName // e.g. "opencode-cli"
                    } as any,
                    update: {
                        interactions: JSON.stringify(currentInteractions),
                        endTime: new Date(), 
                        model: (existingSession && (existingSession as any).model === 'unknown' && model) ? model : undefined
                    } as any
                });
            }

            // --- BRIDGE TO EXECUTION TABLE ---
            // This ensures OTel-origin sessions show up in the main Dashboard UI
            try {
                // Find the first prompt in this session to use as the Query
                const firstInteraction = currentInteractions[0];
                const lastInteraction = currentInteractions[currentInteractions.length - 1];
                
                // Aggregate usage across all interactions in this session
                const totalInputTokens = currentInteractions.reduce((sum, i) => sum + (i.usage?.input_tokens || 0), 0);
                const totalOutputTokens = currentInteractions.reduce((sum, i) => sum + (i.usage?.output_tokens || 0), 0);
                const totalLatency = currentInteractions.reduce((sum, i) => sum + (i.latency || 0), 0);

                await saveExecutionRecord({
                    task_id: taskId,
                    query: firstInteraction?.requestMessages?.[0]?.content || 'OTel Session',
                    framework: serviceName,
                    model: model || 'unknown',
                    tokens: totalInputTokens + totalOutputTokens,
                    latency: totalLatency,
                    final_result: lastInteraction?.responseMessage?.content || '',
                    timestamp: new Date(startTimeMs),
                    label: serviceName,
                    user: userId || 'anonymous',
                    // We don't have skill extraction here yet, but standard judgment will run if query matches config
                });
                console.log(`[OTel] Synced Task ${taskId} to Execution table.`);
            } catch (err) {
                console.error('[OTel] Execution Sync Error:', err);
            }
          }
        }
      }
    }

    return NextResponse.json({ status: 'success' });
  } catch (e) {
    console.error('OTel Parsing Error', e);
    return NextResponse.json({ error: 'Failed to parse OTLP' }, { status: 400 });
  }
}

export async function OPTIONS(req: Request) {
    console.log('[OTel] Received OPTIONS Request. Headers:', JSON.stringify(Object.fromEntries(req.headers.entries())));
    return new NextResponse(null, {
        status: 204,
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-witty-api-key, x-api-key, baggage, traceparent, tracestate',
        }
    });
}
