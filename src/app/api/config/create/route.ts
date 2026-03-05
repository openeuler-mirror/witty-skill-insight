
import { prisma } from '@/lib/prisma';
import { getProxyConfig } from '@/lib/proxy-config';
import { getActiveConfig } from '@/lib/server-config';
import { generateAnswerExtractionPrompt, generateConfigExtractionPrompt } from '@/prompts/config-extraction-prompt';
import { NextResponse } from 'next/server';
import { OpenAI } from "openai";
// 直接引用 lib/pdf-parse.js，绕过 index.js 中在 !module.parent 时尝试读取测试文件的 bug
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfParse = require('pdf-parse/lib/pdf-parse.js');

export const dynamic = 'force-dynamic';

/**
 * 全异步后台处理：先提取标准答案（如果是文档上传），再提取关键观点和动作
 */
async function processConfigAsync(
    configId: string, 
    query: string, 
    standardAnswer: string, 
    documentContent: string | null,
    user?: string | null
) {
    try {
        // 1. Get LLM client
        const settings = await getActiveConfig(user);
        if (!settings || !settings.apiKey) {
            console.error(`[ConfigCreate] No model configuration for user: ${user}`);
            await prisma.config.update({
                where: { id: configId },
                data: { parseStatus: 'failed' } as any
            });
            return;
        }

        const { customFetch } = getProxyConfig();
        const openaiClient = new OpenAI({
            apiKey: settings.apiKey,
            baseURL: settings.baseUrl || 'https://api.deepseek.com',
            fetch: customFetch,
        });
        const modelName = settings.model || 'deepseek-chat';

        // 2. 如果有文档但没有标准答案，先从文档提取标准答案
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

                // 更新数据库中的标准答案
                await prisma.config.update({
                    where: { id: configId },
                    data: { standardAnswer } as any
                });

                console.log(`[ConfigCreate] Successfully extracted standard answer for config ${configId}`);
            } catch (e: any) {
                console.error(`[ConfigCreate] Failed to extract standard answer for config ${configId}:`, e.message);
                await prisma.config.update({
                    where: { id: configId },
                    data: { parseStatus: 'failed' } as any
                }).catch(() => {});
                return;
            }
        }

        // 3. 基于标准答案提取关键观点和动作
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

        // 4. Update config with extracted data
        await prisma.config.update({
            where: { id: configId },
            data: {
                rootCauses: JSON.stringify(rootCauses),
                keyActions: JSON.stringify(keyActions),
                parseStatus: 'completed'
            } as any
        });

        console.log(`[ConfigCreate] Successfully extracted key points for config ${configId}`);
    } catch (error: any) {
        console.error(`[ConfigCreate] Failed to process config ${configId}:`, error.message);
        await prisma.config.update({
            where: { id: configId },
            data: { parseStatus: 'failed' } as any
        }).catch(() => {}); // Ignore DB error in error handler
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
            // Handle file upload
            const formData = await request.formData();
            query = formData.get('query') as string || '';
            standardAnswer = formData.get('standardAnswer') as string || '';
            user = formData.get('user') as string || null;

            const file = formData.get('document') as File | null;
            if (file) {
                const fileName = file.name.toLowerCase();
                if (fileName.endsWith('.pdf')) {
                    // Parse PDF to extract text
                    const arrayBuffer = await file.arrayBuffer();
                    const buffer = Buffer.from(arrayBuffer);
                    const pdfData = await pdfParse(buffer);
                    documentContent = pdfData.text;
                } else {
                    documentContent = await file.text();
                }
            }
        } else {
            // Handle JSON body
            const body = await request.json();
            query = body.query || '';
            standardAnswer = body.standardAnswer || '';
            user = body.user || null;
            documentContent = body.documentContent || null;
        }

        // Validation
        if (!query) {
            return NextResponse.json({ error: '问题 (Query) 不能为空' }, { status: 400 });
        }

        if (!standardAnswer && !documentContent) {
            return NextResponse.json({ error: '请提供标准答案或上传案例文档' }, { status: 400 });
        }

        // Check if Query already exists for THIS user
        const existing = await prisma.config.findFirst({
            where: {
                query,
                user: user || null
            },
        });
        if (existing) {
            return NextResponse.json({ error: '该问题已存在于数据集中' }, { status: 409 });
        }

        // 立即保存到数据库，标准答案可能为空（文档上传场景）
        const newConfig = await prisma.config.create({
            data: {
                query,
                skill: '',
                standardAnswer: standardAnswer || '',
                rootCauses: null,
                keyActions: null,
                user: user || null,
                parseStatus: 'parsing'
            } as any
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

        // Fire and forget: 全部后台异步处理
        processConfigAsync(newConfig.id, query, standardAnswer, documentContent, user);

        return NextResponse.json(formattedConfig);

    } catch (error: any) {
        console.error('Config Create Error:', error);
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}

