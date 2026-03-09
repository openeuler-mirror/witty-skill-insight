
import { db } from '@/lib/prisma';
import { getProxyConfig } from '@/lib/proxy-config';
import { getActiveConfig } from '@/lib/server-config';
import { generateAnswerExtractionPrompt, generateConfigExtractionPrompt } from '@/prompts/config-extraction-prompt';
import { NextResponse } from 'next/server';
import { OpenAI } from "openai";
const pdfParse = require('pdf-parse/lib/pdf-parse.js');

export const dynamic = 'force-dynamic';

async function processConfigAsync(
    configId: string, 
    query: string, 
    standardAnswer: string, 
    documentContent: string | null,
    user?: string | null
) {
    try {
        const settings = await getActiveConfig(user);
        if (!settings || !settings.apiKey) {
            console.error(`[ConfigCreate] No model configuration for user: ${user}`);
            await db.updateConfig(configId, { parseStatus: 'failed' });
            return;
        }

        const { customFetch } = getProxyConfig();
        const openaiClient = new OpenAI({
            apiKey: settings.apiKey,
            baseURL: settings.baseUrl || 'https://api.deepseek.com',
            fetch: customFetch,
        });
        const modelName = settings.model || 'deepseek-chat';

        if (documentContent && !standardAnswer) {
            try {
                const prompt = generateAnswerExtractionPrompt(query, documentContent);
                const response = await openaiClient.chat.completions.create({
                    messages: [{ role: "user", content: prompt }],
                    model: modelName,
                });

                const content = response.choices[0].message.content;
                if (!content) {
                    throw new Error('No content returned from LLM for document extraction');
                }

                let jsonStr = content.trim();
                const matchParse = jsonStr.match(/```(?:json)?\\s*([\\s\\S]*?)\\s*```/i);
                if (matchParse) {
                    jsonStr = matchParse[1];
                } else {
                    const first = jsonStr.indexOf('{');
                    const last = jsonStr.lastIndexOf('}');
                    if (first !== -1 && last !== -1 && last >= first) {
                        jsonStr = jsonStr.substring(first, last + 1);
                    }
                }
                const parsed = JSON.parse(jsonStr);
                standardAnswer = parsed.standard_answer || '';

                if (!standardAnswer) {
                    throw new Error('Extracted standard answer is empty');
                }

                await db.updateConfig(configId, { standardAnswer });

                console.log(`[ConfigCreate] Successfully extracted standard answer for config ${configId}`);
            } catch (e: any) {
                console.error(`[ConfigCreate] Failed to extract standard answer for config ${configId}:`, e.message);
                await db.updateConfig(configId, { parseStatus: 'failed' }).catch(() => {});
                return;
            }
        }

        const prompt = generateConfigExtractionPrompt(query, standardAnswer);

        const response = await openaiClient.chat.completions.create({
            messages: [{ role: "user", content: prompt }],
            model: modelName,
        });

        const content = response.choices[0].message.content;
        if (!content) {
            throw new Error('No content returned from LLM');
        }

        let jsonStr = content.trim();
        const matchParse = jsonStr.match(/```(?:json)?\\s*([\\s\\S]*?)\\s*```/i);
        if (matchParse) {
            jsonStr = matchParse[1];
        } else {
            const first = jsonStr.indexOf('{');
            const last = jsonStr.lastIndexOf('}');
            if (first !== -1 && last !== -1 && last >= first) {
                jsonStr = jsonStr.substring(first, last + 1);
            }
        }
        const extractedData = JSON.parse(jsonStr);
        const rootCauses = extractedData.root_causes || [];
        const keyActions = extractedData.key_actions || [];

        await db.updateConfig(configId, {
            rootCauses: JSON.stringify(rootCauses),
            keyActions: JSON.stringify(keyActions),
            parseStatus: 'completed'
        });

        console.log(`[ConfigCreate] Successfully extracted key points for config ${configId}`);
    } catch (error: any) {
        console.error(`[ConfigCreate] Failed to process config ${configId}:`, error.message);
        await db.updateConfig(configId, { parseStatus: 'failed' }).catch(() => {});
    }
}

export async function POST(request: Request) {
    try {
        const contentType = request.headers.get('content-type') || '';
        
        let query = '';
        let standardAnswer = '';
        let user: string | null = null;
        let documentContent: string | null = null;

        if (contentType.includes('multipart/form-data')) {
            const formData = await request.formData();
            query = formData.get('query') as string || '';
            standardAnswer = formData.get('standardAnswer') as string || '';
            user = formData.get('user') as string || null;

            const file = formData.get('document') as File | null;
            if (file) {
                const fileName = file.name.toLowerCase();
                if (fileName.endsWith('.pdf')) {
                    const arrayBuffer = await file.arrayBuffer();
                    const buffer = Buffer.from(arrayBuffer);
                    const pdfData = await pdfParse(buffer);
                    documentContent = pdfData.text;
                } else {
                    documentContent = await file.text();
                }
            }
        } else {
            const body = await request.json();
            query = body.query || '';
            standardAnswer = body.standardAnswer || '';
            user = body.user || null;
            documentContent = body.documentContent || null;
        }

        if (!query) {
            return NextResponse.json({ error: '问题 (Query) 不能为空' }, { status: 400 });
        }

        if (!standardAnswer && !documentContent) {
            return NextResponse.json({ error: '请提供标准答案或上传案例文档' }, { status: 400 });
        }

        const existingConfigs = await db.findConfigs({
            OR: [
                { user: user || null }
            ]
        });
        const existing = existingConfigs.find((c: any) => c.query === query);
        if (existing) {
            return NextResponse.json({ error: '该问题已存在于数据集中' }, { status: 409 });
        }

        const newConfig = await db.createConfig({
            query,
            skill: '',
            standardAnswer: standardAnswer || '',
            rootCauses: null,
            keyActions: null,
            user: user || null,
            parseStatus: 'parsing'
        });

        const formattedConfig = {
            id: newConfig.id,
            query: newConfig.query,
            skill: newConfig.skill,
            standard_answer: standardAnswer || (documentContent ? '正在从文档中提取...' : ''),
            root_causes: [],
            key_actions: [],
            parse_status: 'parsing'
        };

        processConfigAsync(newConfig.id, query, standardAnswer, documentContent, user);

        return NextResponse.json(formattedConfig);

    } catch (error: any) {
        console.error('Config Create Error:', error);
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}
