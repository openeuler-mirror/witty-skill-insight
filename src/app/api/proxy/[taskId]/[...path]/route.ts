
import { prisma } from '@/lib/prisma';
import { addToSession, getSession } from '@/lib/proxy-store';
import { getActiveConfig } from '@/lib/server-config';
import { NextResponse } from 'next/server';
import { ProxyAgent, fetch as undiciFetch } from 'undici';

// --- Proxy Configuration for Corporate Intranet ---
// Create a proxy agent if http_proxy/https_proxy is configured
function getProxyDispatcher(): ProxyAgent | undefined {
  const proxyUrl = process.env.https_proxy || process.env.HTTPS_PROXY || process.env.http_proxy || process.env.HTTP_PROXY;
  if (proxyUrl) {
    console.log('[API Proxy] HTTP proxy configured');
    return new ProxyAgent({
      uri: proxyUrl,
      // For self-signed certs in intranet, respect NODE_TLS_REJECT_UNAUTHORIZED
      connect: {
        rejectUnauthorized: process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0'
      }
    });
  }
  return undefined;
}

const proxyDispatcher = getProxyDispatcher();

// Use undici fetch with proxy support, or fallback to native fetch
async function proxyFetch(url: string, init: RequestInit): Promise<Response> {
  if (proxyDispatcher) {
    // Use undici with proxy dispatcher
    const response = await undiciFetch(url, {
      ...init as any,
      dispatcher: proxyDispatcher
    });
    return response as unknown as Response;
  }
  // No proxy, use native fetch
  return fetch(url, init);
}

// We use OpenAI client for types, but manual fetch for proxying to ensure full control
// Actually, raw fetch is better as we are a transparent proxy.


// ... (keep imports)

export async function POST(
  request: Request,
  { params }: { params: Promise<{ taskId: string; path: string[] }> }
) {
  const { taskId, path } = await params;
  
  // Default Configuration
  let baseUrl = 'https://api.deepseek.com';
  if (taskId.startsWith('claude')) {
      baseUrl = 'https://api.deepseek.com/anthropic';
  }
  
  // 1. Prepare Request Body & User/Session Handling
  let body: any = {};
  const clonedRequest = request.clone(); // Clone to read text/json
  try {
      body = await clonedRequest.json();
  } catch (e) {
      console.error('Failed to parse request body');
  }

  const headers = new Headers(request.headers);
  headers.delete('host');
  headers.delete('content-length');
  
  // 从界面配置获取 API Key（不再依赖环境变量）
  const activeConfig = await getActiveConfig();
  let apiKey = activeConfig?.apiKey;

  try {
        const session = await getSession(taskId);
        if (session?.model) {
            // A. Override Model Field in Body
            if (typeof body === 'object' && body !== null) {
                console.log(`[Proxy] Overriding model for task ${taskId}: ${body.model} -> ${session.model}`);
                body.model = session.model;
            }
        } else if (typeof body === 'object' && body !== null && body.model) {
            // B. Capture Model from Request if not set in session
            await prisma.session.update({
                where: { taskId },
                data: { model: body.model }
            });
            console.log(`[Proxy] Captured model from request for task ${taskId}: ${body.model}`);
        }
    } catch (e) {
        console.error('Failed to apply or capture model preference', e);
    }


  // 3. Construct Target URL
  const targetUrl = `${baseUrl}/${path.join('/')}`;

  // Inject stream_options for usage in streaming mode
  if (body.stream && !body.stream_options) {
      body.stream_options = { include_usage: true };
  }

  // 4. Set Authorization Header
  // Priority: Custom Config Key -> Environment Key -> Incoming Header (if none of above)
  // Actually, standard behavior: System/Custom Key overrides user provided key in local proxy scenarios usually?
  // Let's stick to: If we found a key (System or Custom), use it.
  if (apiKey) {
      headers.set('Authorization', `Bearer ${apiKey}`);
  } else if (!headers.has('Authorization')) {
      // If no key found and no header, warn?
      console.warn('[Proxy] No API Key available for request');
  }

  const startTime = Date.now();
  let interactionData: any = {
      requestMessages: body.messages || [],
      responseMessage: { role: 'assistant', content: '' }, // Initialize
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      toolCalls: [],
      timestamp: startTime,
      latency: 0
  };

  try {
      const response = await proxyFetch(targetUrl, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify(body),
      });

      if (!response.ok) {
          console.error("Upstream error", response.status, response.statusText);
          return response; // Pass through error
      }

      // Process headers to ensure we don't send conflicting encoding/length info
      const responseHeaders = new Headers(response.headers);
      responseHeaders.delete('content-encoding');
      responseHeaders.delete('content-length');
      responseHeaders.delete('transfer-encoding');

      const isStream = body.stream === true;

      if (isStream) {
          // Handle Streaming
          // Tee the stream: one for the client (immediate), one for logging (background)
          const [clientStream, logStream] = response.body?.tee() || [];

          if (!clientStream || !logStream) {
             console.error("Failed to tee stream"); 
             return response;
          }

          // 1. Return response to client IMMEDIATELY
          const nextResponse = new NextResponse(clientStream as any, {
              headers: responseHeaders,
              status: response.status
          });

          // 2. Process logging in background
          (async () => {
              try {
                const reader = logStream.getReader();
                const decoder = new TextDecoder();
                let done = false;
                
                interactionData.responseMessage.reasoning_content = ''; 

                while (!done) {
                    const { value, done: doneReading } = await reader.read();
                    done = doneReading;
                    if (value) {
                         const chunk = decoder.decode(value, { stream: true });
                         const lines = chunk.split('\n');
                         for (const line of lines) {
                            if (line.trim().startsWith('data: ')) {
                                const dataStr = line.trim().substring(6);
                                if (dataStr === '[DONE]') continue;
                                try {
                                    const data = JSON.parse(dataStr);

                                    // Handle Anthropic/DeepSeek structure variations
                                    if (data.choices && data.choices[0] && data.choices[0].delta) {
                                        const delta = data.choices[0].delta;
                                        if (delta.content) interactionData.responseMessage.content += delta.content;
                                        if (delta.reasoning_content) interactionData.responseMessage.reasoning_content += delta.reasoning_content;
                                        
                                        if (delta.tool_calls) {
                                            delta.tool_calls.forEach((tc: any, index: number) => {
                                                if (!interactionData.toolCalls[index]) interactionData.toolCalls[index] = { function: { name: '', arguments: '' }};
                                                if (tc.function?.name) interactionData.toolCalls[index].function.name += tc.function.name;
                                                if (tc.function?.arguments) interactionData.toolCalls[index].function.arguments += tc.function.arguments;
                                            });
                                        }
                                    }

                                    if (data.type === 'content_block_delta' && data.delta) {
                                        if (data.delta.type === 'text_delta' && data.delta.text) {
                                             interactionData.responseMessage.content += data.delta.text;
                                        } else if (data.delta.type === 'thinking_delta' && data.delta.thinking) {
                                             interactionData.responseMessage.reasoning_content += data.delta.thinking;
                                        } else if (data.delta.reasoning_content) {
                                             interactionData.responseMessage.reasoning_content += data.delta.reasoning_content;
                                        }
                                    }
                                    
                                    // Usage Merging Logic
                                    let newUsage = null;
                                    if (data.usage) newUsage = data.usage;
                                    if (data.type === 'message_delta' && data.usage) newUsage = data.usage;
                                    if (data.type === 'message_start' && data.message?.usage) newUsage = data.message.usage;

                                    if (newUsage) {
                                        if (!interactionData.usage) interactionData.usage = {};
                                        if (newUsage.input_tokens !== undefined) interactionData.usage.input_tokens = newUsage.input_tokens;
                                        if (newUsage.output_tokens !== undefined) interactionData.usage.output_tokens = newUsage.output_tokens;
                                        if (newUsage.cache_read_input_tokens !== undefined) interactionData.usage.cache_read_input_tokens = newUsage.cache_read_input_tokens;
                                        if (newUsage.cache_creation_input_tokens !== undefined) interactionData.usage.cache_creation_input_tokens = newUsage.cache_creation_input_tokens;
                                        
                                        // Calculate total tokens including cache for Claude
                                        const input = interactionData.usage.input_tokens || 0;
                                        const output = interactionData.usage.output_tokens || 0;
                                        const cacheRead = interactionData.usage.cache_read_input_tokens || 0;
                                        const cacheCreate = interactionData.usage.cache_creation_input_tokens || 0;
                                        interactionData.usage.total_tokens = input + output + cacheRead + cacheCreate;
                                    }

                                } catch (e) {}
                            }
                         }
                    }
                }
                
                // Fallback for missing usage
                if (!interactionData.usage) interactionData.usage = {};
                if (!interactionData.usage.input_tokens) {
                     // Estimate Input: Roughly 1 token per 4 chars of JSON body
                     const bodyStr = JSON.stringify(body);
                     const estInput = Math.ceil(bodyStr.length / 4);
                     interactionData.usage.input_tokens = estInput;
                }
                
                if (!interactionData.usage.output_tokens) {
                     // Estimate Output: Content + Reasoning
                     const outContent = (interactionData.responseMessage.content || '') + (interactionData.responseMessage.reasoning_content || '');
                     const estOutput = Math.ceil(outContent.length / 3); 
                     interactionData.usage.output_tokens = estOutput;
                }
                
                // Final Total Calculation (Ensuring we respect cache if it was somehow captured or just 0)
                const finalInput = interactionData.usage.input_tokens || 0;
                const finalOutput = interactionData.usage.output_tokens || 0;
                const finalCacheRead = interactionData.usage.cache_read_input_tokens || 0;
                const finalCacheCreate = interactionData.usage.cache_creation_input_tokens || 0;
                interactionData.usage.total_tokens = finalInput + finalOutput + finalCacheRead + finalCacheCreate;

                interactionData.latency = Date.now() - startTime;
                await addToSession(taskId, interactionData);
              } catch (err) {
                  console.error("Background stream logger error", err);
              }
          })();

          return nextResponse;

      } else {
          // Handle JSON
          const data = await response.json();
          
          // Capture info
          if (data.usage) interactionData.usage = data.usage;
          if (data.choices && data.choices[0]) {
              interactionData.responseMessage = data.choices[0].message;
              if (data.choices[0].message.tool_calls) {
                  interactionData.toolCalls = data.choices[0].message.tool_calls;
              }
          }
          
          interactionData.latency = Date.now() - startTime;
          await addToSession(taskId, interactionData);
          
          return NextResponse.json(data, {
              status: response.status,
              headers: responseHeaders 
          });
      }

  } catch (error) {
     console.error("[Proxy-Path] ❌ Error:", error);
     return NextResponse.json({ error: 'Proxy Failed' }, { status: 500 });
  }
}
