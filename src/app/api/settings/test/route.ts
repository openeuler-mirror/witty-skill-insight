import { getProxyConfig } from '@/lib/proxy-config';
import { NextResponse } from 'next/server';
import { OpenAI } from "openai";

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const apiKey = body.apiKey || body.evalApiKey;
        const provider = body.provider || body.evalProvider;
        const model = body.model || body.evalModel;
        
        const baseUrl = body.baseUrl || body.evalBaseUrl;
        let normalizedBaseUrl = baseUrl;
        if (normalizedBaseUrl) {
            normalizedBaseUrl = normalizedBaseUrl.replace(/\/chat\/completions\/?$/, '').replace(/\/v1\/?$/, '');
        }

        if (!apiKey) return NextResponse.json({ success: false, error: 'API Key is required' }, { status: 400 });

        const { customFetch } = getProxyConfig();

        const client = new OpenAI({
             apiKey,
             baseURL: normalizedBaseUrl || 
                      (provider === 'deepseek' ? "https://api.deepseek.com" : 
                       provider === 'siliconflow' ? "https://api.siliconflow.cn/v1" : 
                       undefined),
             fetch: customFetch,
             timeout: 10000
        });

        const completion = await client.chat.completions.create({
            messages: [{ role: "user", content: "Hi" }],
            model: model || 
                   (provider === 'deepseek' ? "deepseek-chat" : 
                    provider === 'siliconflow' ? "deepseek-ai/DeepSeek-V3" :
                    "gpt-3.5-turbo"),
            max_tokens: 5
        });

        if (completion && completion.choices) {
             return NextResponse.json({ success: true, message: 'Connection successful' });
        } else {
             throw new Error('No response from model');
        }

    } catch (e: any) {
        console.error("Test Route Error:", e);
        const detail = e.cause ? ` (Cause: ${e.cause.message || e.cause})` : '';
        return NextResponse.json({ 
            success: false, 
            error: (e.message || 'Connection failed') + detail
        }, { status: 500 });
    }
}
