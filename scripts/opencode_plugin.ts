// @ts-nocheck
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { URL } = require('url');

const DEBUG_LOG = path.join(os.homedir(), '.opencode', 'witty_plugin_debug.log');

function logDebug(msg) {
    try {
        const logDir = path.dirname(DEBUG_LOG);
        if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
        fs.appendFileSync(DEBUG_LOG, new Date().toISOString() + ' ' + msg + '\n');
    } catch (e) {}
}

// Global store
let sessionStore = new Map();
let uploadedSessions = new Set();

function toMsTimestamp(v) {
    if (v == null) return null;
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') {
        const s = v.trim();
        if (!s) return null;
        // numeric string (ms)
        if (/^\d+$/.test(s)) {
            const n = Number(s);
            return Number.isFinite(n) ? n : null;
        }
        // ISO-like
        const t = Date.parse(s);
        return Number.isFinite(t) ? t : null;
    }
    return null;
}

function buildTiming(startRaw, endRaw) {
    const startMs = toMsTimestamp(startRaw);
    const endMs = toMsTimestamp(endRaw);
    let durationMs = null;
    if (startMs != null && endMs != null) {
        const d = endMs - startMs;
        // guard against bogus clocks/units: ignore >= 1h spans for tool call
        if (d >= 0 && d < 3600000) durationMs = d;
    }
    // Only attach timing if we have at least one bound
    if (startRaw == null && endRaw == null) return undefined;
    const timing = {};
    if (startRaw != null) timing.started_at = startRaw;
    if (endRaw != null) timing.completed_at = endRaw;
    if (durationMs != null) timing.duration_ms = durationMs;
    return timing;
}

// Helper: Check if host should skip proxy based on NO_PROXY
function shouldSkipProxy(targetHostname) {
    const noProxy = process.env.no_proxy || process.env.NO_PROXY;
    if (!noProxy) return false;
    const segments = noProxy.split(',').map(s => s.trim().toLowerCase());
    return segments.some(s => s === '*' || targetHostname.toLowerCase().endsWith(s));
}

// Helper: Get proxy setup
function getRequestOptions(targetUrl, apiKey, bodyLength) {
    const protocol = targetUrl.protocol;
    const proxy = (protocol === 'https:' ? (process.env.https_proxy || process.env.HTTPS_PROXY) : (process.env.http_proxy || process.env.HTTP_PROXY)) || process.env.all_proxy || process.env.ALL_PROXY;
    
    let options = {
        hostname: targetUrl.hostname,
        port: targetUrl.port || (protocol === 'https:' ? 443 : 80),
        path: path.join(targetUrl.pathname === '/' ? '' : targetUrl.pathname, '/api/upload'),
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': bodyLength,
            'x-witty-api-key': apiKey
        }
    };

    if (proxy && !shouldSkipProxy(targetUrl.hostname)) {
        try {
            const proxyUrl = new URL(proxy);
            if (protocol === 'http:') {
                options.hostname = proxyUrl.hostname;
                options.port = proxyUrl.port || 80;
                options.path = targetUrl.origin + options.path;
                if (proxyUrl.username) {
                    const auth = Buffer.from(`${proxyUrl.username}:${proxyUrl.password}`).toString('base64');
                    options.headers['Proxy-Authorization'] = `Basic ${auth}`;
                }
            }
        } catch (e) {}
    }
    return options;
}

function loadConfiguration() {
    let config = {};
    try {
        const envPath = path.join(os.homedir(), '.witty', '.env');
        if (fs.existsSync(envPath)) {
            const content = fs.readFileSync(envPath, 'utf8');
            content.split('\n').forEach(line => {
                const match = line.match(/^\s*([\w_]+)\s*=\s*(.*)?\s*$/);
                if (match) config[match[1]] = (match[2] || '').trim().replace(/^['"](.*)['"]$/, '$1');
            });
        }
    } catch (e) {}
    return {
        apiKey: config['WITTY_INSIGHT_API_KEY'] || process.env.WITTY_INSIGHT_API_KEY,
        host: config['WITTY_INSIGHT_HOST'] || process.env.WITTY_INSIGHT_HOST
    };
}

export default async function WittySkillInsightPlugin(input) {
  const { apiKey, host } = loadConfiguration();
  if (!apiKey || !host) {
      logDebug("Plugin disabled: Missing API Key or Host");
      return {};
  }

  let parsedHost;
  try {
      const urlStr = host.match(/^https?:\/\//) ? host : `http://${host}`;
      parsedHost = new URL(urlStr);
  } catch (e) { return {}; }

  const requestModule = parsedHost.protocol === 'https:' ? https : http;

  // Auto-Sync Skills on Startup
  try {
     const syncScript = path.join(os.homedir(), '.witty', 'sync_skills.ts');
     if (fs.existsSync(syncScript)) {
         const cp = require('child_process');
         // Run async to avoid blocking
         const cmd = `npx -y tsx "${syncScript}" --agent opencode`;
         
         // Only run if we are in a project directory that might use local skills?
         // Or always run. Always run is safer for "latest active" requirement.
         
         // Use exec to run in background
         cp.exec(cmd, { cwd: process.cwd() }, (err, stdout, stderr) => {
             if (err) logDebug(`Skill Sync Error: ${err.message}`);
             else if (stdout) logDebug(`Skill Sync: ${stdout.trim()}`);
         });
     }
  } catch (e) {
      logDebug(`Skill Sync Init Exception: ${e.message}`);
  }

  // logDebug("Witty Plugin Initialized");

  return {
    event: async ({ event }) => {
      logDebug(`Event received: ${event.type}`);
      if (event.type && event.type.startsWith('tool')) {
          logDebug(`Tool Payload: ${JSON.stringify(event.payload || event.properties || {})}`);
      }

      try {
          const rawLogPath = path.join(os.homedir(), '.opencode', 'witty_plugin_raw_events.log');
          if (!fs.existsSync(path.dirname(rawLogPath))) fs.mkdirSync(path.dirname(rawLogPath), { recursive: true });
          fs.appendFileSync(rawLogPath, JSON.stringify({t: new Date().toISOString(), ...event}) + '\n');
      } catch (e) {
          logDebug(`Raw Log Error: ${e.message}`);
      }

      // logDebug(`Event: ${event.type}`);

      try {
          // Attempt to find session ID in various places
          const sessionId = event.session_id || event.properties?.sessionID || event.payload?.session_id;

          // 1. Accumulate Message Metadata
          if (event.type === 'message.created' || event.type === 'message.updated') {
             let info = (event.payload && event.payload.message) || (event.properties && event.properties.info);
             if (info && info.id) {
                 const msgId = info.id;
                 if (!sessionStore.has(msgId)) {
                     sessionStore.set(msgId, { 
                         info: { sessionID: sessionId }, 
                         parts: new Map(), 
                         content: '' 
                     });
                 }
                 const entry = sessionStore.get(msgId);
                 if (sessionId) entry.info.sessionID = sessionId;
                  // Merge info
                  Object.assign(entry.info, info);
                  if (info.tool_calls || info.toolCalls) entry.info.tool_calls = info.tool_calls || info.toolCalls;
                  if (info.function_call || info.functionCall) entry.info.function_call = info.function_call || info.functionCall;
             }
          }

          // 2. Accumulate Message Content Parts
          if (event.type === 'message.part.created' || event.type === 'message.part.updated') {
              let part = (event.payload && event.payload.part) || (event.properties && event.properties.part);
              if (!part && event.payload) part = event.payload; // fallback

              if (part && (part.messageID || part.message_id)) {
                  const msgId = part.messageID || part.message_id;
                  
                  if (!sessionStore.has(msgId)) {
                        sessionStore.set(msgId, { 
                             info: { sessionID: sessionId }, 
                             parts: new Map(), 
                             toolParts: new Map(),
                             content: '' 
                        });
                  }
                  const entry = sessionStore.get(msgId);
                  
                  // Store part
                  const partId = part.id || `temp_${Date.now()}_${Math.random()}`;
                  
                  if (part.type === 'tool') {
                      // Tool calls in OpenCode are often special parts
                      if (!entry.toolParts) entry.toolParts = new Map();
                      entry.toolParts.set(part.callID || partId, part);
                  } else {
                      entry.parts.set(partId, part);
                  }
                  
                  // Reassemble content (text)
                  let full = "";
                  const sortedParts = Array.from(entry.parts.values()).sort((a, b) => {
                      const ta = a.time?.start || (a.meta && a.meta.start) || 0;
                      const tb = b.time?.start || (b.meta && b.meta.start) || 0;
                      return ta - tb;
                  });
                  
                  for (const p of sortedParts) {
                      if (p.text) full += p.text;
                      else if (p.content) full += p.content;
                  }
                  entry.content = full;

                  // Process Tool Calls for storage
                  if (entry.toolParts && entry.toolParts.size > 0) {
                      const tool_calls = [];
                      for (const tp of entry.toolParts.values()) {
                          if (tp.tool && tp.state) {
                              // Try to infer timing from common OpenCode shapes
                              const startRaw =
                                  tp.time?.start ??
                                  tp.time?.created ??
                                  tp.meta?.start ??
                                  tp.meta?.created ??
                                  tp.state?.time?.start ??
                                  tp.state?.time?.created ??
                                  tp.state?.started_at ??
                                  tp.state?.startTime ??
                                  tp.state?.start_time ??
                                  null;
                              const endRaw =
                                  tp.time?.completed ??
                                  tp.time?.end ??
                                  tp.meta?.completed ??
                                  tp.meta?.end ??
                                  tp.state?.time?.completed ??
                                  tp.state?.time?.end ??
                                  tp.state?.completed_at ??
                                  tp.state?.endTime ??
                                  tp.state?.end_time ??
                                  null;
                              const timing = buildTiming(startRaw, endRaw);

                              tool_calls.push({
                                  id: tp.callID,
                                  type: 'function',
                                  function: {
                                      name: tp.tool,
                                      arguments: JSON.stringify(tp.state.input || {})
                                  },
                                  state: tp.state.status,
                                  output: tp.state.output,
                                  timing: timing
                              });
                          }
                      }
                      if (tool_calls.length > 0) {
                           entry.info.tool_calls = tool_calls;
                      }
                  }
                  
                  // Update SessionID if found in event
                  if (sessionId && !entry.info.sessionID) entry.info.sessionID = sessionId;
              }
          }

          // 3. Upload on Session Idle
          if (event.type === "session.idle") {
              if (!sessionId || !sessionId.startsWith("ses")) return;

              logDebug(`Session Idle: ${sessionId}. Messages in store: ${sessionStore.size}`);

              const messages = [];
              for (const [mid, entry] of sessionStore.entries()) {
                  if (entry.info.sessionID === sessionId) {
                      // Calculate latency for this message if possible from parts
                      let partBasedDuration = 0;
                      if (entry.parts.size > 0) {
                          const parts = Array.from(entry.parts.values()).map(p => p.time?.start || 0).filter(t => t > 0).sort((a,b)=>a-b);
                          if (parts.length >= 1) {
                              const start = parts[0];
                              const end = parts[parts.length - 1];
                              // Rough estimation: span between first and last part start time
                              partBasedDuration = Math.max(0, end - start);
                              // Add a small buffer for the last chunk generation? say 50ms per char? 
                              // Or if there is a 'completed' timestamp on info, prefer that.
                          }
                      }

                      messages.push({
                          role: entry.info.role || 'unknown',
                          content: entry.content || entry.info.content || "",
                          tool_calls: entry.info.tool_calls || entry.info.toolCalls,
                          function_call: entry.info.function_call || entry.info.functionCall,
                          usage: entry.info.usage || entry.info.tokens,
                          timestamp: entry.info.created || entry.info.time?.created,
                          timeInfo: entry.info.time,
                          partBasedDuration: partBasedDuration,
                          modelID: entry.info.modelID,
                          model: entry.info.model
                      });
                  }
              }

              if (messages.length === 0) {
                  logDebug(`No messages found for session ${sessionId}, skipping upload.`);
                  return;
              }

              // Sort messages by timestamp safely
              messages.sort((a, b) => {
                  const ta = Number(a.timestamp) || 0;
                  const tb = Number(b.timestamp) || 0;
                  return ta - tb;
              });

              // Analyze
              let totalTokens = 0;
              let totalLatencyMs = 0;
              let firstUserQuery = "";
              let lastAssistantContent = "";
              let model = "";
              let totalInputTokens = 0;
              let totalOutputTokens = 0;
              let llmCallCount = 0;
              let toolCallCount = 0;
              let toolCallErrorCount = 0;

              for (const m of messages) {
                  if (m.role === 'user' && !firstUserQuery) firstUserQuery = m.content;
                  if (m.role === 'assistant') {
                      llmCallCount++;
                      lastAssistantContent = m.content;
                      if (m.model) model = m.model;
                      else if (m.modelID) model = m.modelID;
                      
                      // Token logic
                      const u = m.usage;
                      if (u) {
                          if (u.total !== undefined) {
                              totalTokens += Number(u.total);
                          } else {
                              totalTokens += Number(u.input_tokens || u.input || 0) + Number(u.output_tokens || u.output || 0);
                              if (u.cache) {
                                  totalTokens += Number(u.cache.read || 0) + Number(u.cache.write || 0);
                              }
                              totalTokens += Number(u.cache_creation_input_tokens || 0) + Number(u.cache_read_input_tokens || 0);
                          }
                          // Extended metrics: separate input/output token counts
                          const inputToks = Number(u.input_tokens || u.input || 0)
                              + Number(u.cache?.read || u.cache_read_input_tokens || 0)
                              + Number(u.cache?.write || u.cache_creation_input_tokens || 0);
                          const outputToks = Number(u.output_tokens || u.output || 0);
                          totalInputTokens += inputToks;
                          totalOutputTokens += outputToks;
                      }
                      
                      // Latency Logic
                      let mDuration = 0;
                      if (m.timeInfo?.created && m.timeInfo?.completed) {
                           mDuration = new Date(m.timeInfo.completed).getTime() - new Date(m.timeInfo.created).getTime();
                      } else if (m.partBasedDuration > 0) {
                           mDuration = m.partBasedDuration + 100;
                      }

                      if (mDuration > 0 && mDuration < 3600000) {
                          totalLatencyMs += mDuration;
                      }

                      // Count tool calls from this message
                      if (m.tool_calls && Array.isArray(m.tool_calls)) {
                          toolCallCount += m.tool_calls.length;
                          for (const tc of m.tool_calls) {
                              if (tc.state === 'error' || tc.state === 'failed') {
                                  toolCallErrorCount++;
                              }
                          }
                      }
                  }
              }

              logDebug(`Uploading session ${sessionId}. Latency: ${totalLatencyMs}ms, Messages: ${messages.length}`);

              const payload = {
                  task_id: sessionId,
                  query: firstUserQuery || `OpenCode Session ${sessionId}`,
                  framework: 'opencode', 
                  model: model,
                  tokens: totalTokens,
                  latency: totalLatencyMs / 1000,
                  input_tokens: totalInputTokens,
                  output_tokens: totalOutputTokens,
                  tool_call_count: toolCallCount,
                  tool_call_error_count: toolCallErrorCount,
                  llm_call_count: llmCallCount,
                  final_result: lastAssistantContent,
                  interactions: messages.map(m => ({
                      role: m.role,
                      content: m.content,
                      tool_calls: m.tool_calls || m.toolCalls,
                      function_call: m.function_call || m.functionCall,
                      usage: m.usage,
                      timestamp: m.timestamp,
                      timeInfo: m.timeInfo
                  })),
                  timestamp: new Date().toISOString()
              };

              if (uploadedSessions.has(sessionId)) {
                  logDebug(`Session ${sessionId} already uploaded, skipping.`);
                  return;
              }
              uploadedSessions.add(sessionId);

              const body = JSON.stringify(payload);
              logDebug(`Payload Body Size: ${Buffer.byteLength(body)} bytes`);
              
              await new Promise((resolve) => {
                  const options = getRequestOptions(parsedHost, apiKey, Buffer.byteLength(body));
                  const req = requestModule.request(options, (res) => {
                      let resData = "";
                      res.on('data', (chunk) => { resData += chunk; });
                      res.on('end', () => {
                          logDebug(`Upload Status: ${res.statusCode}, Response: ${resData}`);
                          resolve();
                      });
                  });
                  req.on('error', (e) => {
                      logDebug(`Upload Error: ${e.message}`);
                      resolve();
                  });
                  req.setTimeout(10000, () => {
                      logDebug(`Upload Timeout`);
                      req.destroy();
                      resolve();
                  });
                  req.end(body);
              });

              /* 
              // Cleanup - DISABLED
              // We want to accumulate history.
              for (const [msgId, entry] of sessionStore.entries()) {
                  if (entry.info.sessionID === sessionId) sessionStore.delete(msgId);
              }
              */
          }
      } catch (err) {
          logDebug(`Plugin Exception: ${err.message}`);
      }
    }
  };
}
