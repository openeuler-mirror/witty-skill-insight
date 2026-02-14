#!/usr/bin/env node

/**
 * Claude Code Stop Hook - Witty-Skill-Insight
 * 
 * Captures full session data at the end of a session.
 * Receives JSON via stdin from Claude Code.
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Helper: Load configuration from ~/.witty/.env
function loadConfiguration() {
    let config = {};
    try {
        const envPath = path.join(os.homedir(), '.witty', '.env');
        if (fs.existsSync(envPath)) {
            const content = fs.readFileSync(envPath, 'utf8');
            content.split('\n').forEach(line => {
                const match = line.match(/^\s*([\w_]+)\s*=\s*(.*)?\s*$/);
                if (match) {
                    const key = match[1];
                    let val = match[2] || '';
                    val = val.trim().replace(/^['"](.*)['"]$/, '$1'); 
                    config[key] = val;
                }
            });
        }
    } catch (e) {}
    
    return {
        apiKey: config['WITTY_INSIGHT_API_KEY'] || process.env.WITTY_INSIGHT_API_KEY,
        host: config['WITTY_INSIGHT_HOST'] || process.env.WITTY_INSIGHT_HOST || '127.0.0.1:3000'
    };
}

async function main() {
    let inputData = '';
    process.stdin.setEncoding('utf8');
    
    // Read all data from stdin
    for await (const chunk of process.stdin) {
        inputData += chunk;
    }

    if (!inputData) process.exit(0);

    const { apiKey, host } = loadConfiguration();

    try {
        const data = JSON.parse(inputData);

        // Data usually has a 'messages' array and 'metadata' or 'billing'
        const messages = data.messages || [];
        const lastUserMsg = messages.filter(m => m.role === 'user').pop();
        const lastAssistantMsg = messages.filter(m => m.role === 'assistant').pop();

        // Calculate usage if possible, or use provided fields
        const tokens = (data.billing?.inputTokens || 0) + (data.billing?.outputTokens || 0);
        const model = data.model || 'claude-3-5-sonnet';

        const payload = {
            task_id: data.id || `claude-${Date.now()}`,
            query: lastUserMsg?.content || 'Claude Session',
            framework: 'claudecode',
            model: model,
            tokens: tokens,
            final_result: lastAssistantMsg?.content || '',
            interactions: messages,
            timestamp: new Date().toISOString()
        };

        const payloadStr = JSON.stringify(payload);
        
        // Parse host
        const urlStr = host.match(/^https?:\/\//) ? host : `http://${host}`;
        const parsedHost = new URL(urlStr);
        const requestModule = parsedHost.protocol === 'https:' ? https : http;

        const options = {
            hostname: parsedHost.hostname,
            port: parsedHost.port || (parsedHost.protocol === 'https:' ? 443 : 80),
            path: '/api/upload',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payloadStr),
                'x-witty-api-key': apiKey || ''
            }
        };

        const req = requestModule.request(options, (res) => {
             let responseBody = '';
             res.on('data', (chunk) => responseBody += chunk);
             res.on('end', () => {
             });
        });

        req.on('error', (e) => {
        });
        
        req.write(payloadStr);
        req.end();

    } catch (err) {
        process.exit(0);
    }
}

main();
