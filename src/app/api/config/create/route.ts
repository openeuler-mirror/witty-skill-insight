
import { db } from '@/lib/prisma';
import { getProxyConfig } from '@/lib/proxy-config';
import { getActiveConfig } from '@/lib/server-config';
import { generateAnswerExtractionPrompt, generateConfigExtractionPrompt } from '@/prompts/config-extraction-prompt';
import { configSupportsDatasetType, normalizeConfigDatasetType, type ConfigDatasetType } from '@/lib/config-dataset';
import { getConfigSubjectLabel, normalizeConfigQuery, normalizeConfigSkillName, normalizeOptionalSkillVersion } from '@/lib/config-target';
import { deriveRoutingSignature } from '@/lib/routing-signature';
import { NextResponse } from 'next/server';
import { OpenAI } from "openai";
const pdfParse = require('pdf-parse/lib/pdf-parse.js');

export const dynamic = 'force-dynamic';

async function processConfigAsync(
    configId: string, 
    query: string | null,
    standardAnswer: string, 
    documentContent: string | null,
    datasetType: ConfigDatasetType,
    skill: string | null,
    skillVersion: number | null,
    user?: string | null
) {
    try {
        const settings = await getActiveConfig(user);
        if (!settings) {
            console.error(`[ConfigCreate] No model configuration for user: ${user}`);
            await db.updateConfig(configId, { parseStatus: 'failed' });
            return;
        }

        const { customFetch } = getProxyConfig();
        const openaiClient = new OpenAI({
            apiKey: settings.apiKey || 'no-api-key-required',
            baseURL: settings.baseUrl || 'https://api.deepseek.com',
            fetch: customFetch,
        });
        const modelName = settings.model || 'deepseek-chat';

        const taskContext = getConfigSubjectLabel({ query, skill, skillVersion });
        const updates: Record<string, unknown> = {};

        if (configSupportsDatasetType(datasetType, 'routing')) {
            if (!query) {
                throw new Error('Routing dataset requires query for semantic signature extraction');
            }
            const routingSignature = await deriveRoutingSignature(query, user);
            if (!routingSignature) {
                throw new Error('Failed to derive routing semantic signature');
            }

            updates.routingIntent = routingSignature.intent;
            updates.routingAnchors = JSON.stringify(routingSignature.anchors);
        }

        if (configSupportsDatasetType(datasetType, 'outcome') && documentContent && !standardAnswer) {
            try {
                const prompt = generateAnswerExtractionPrompt(taskContext, documentContent);
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

                updates.standardAnswer = standardAnswer;

                console.log(`[ConfigCreate] Successfully extracted standard answer for config ${configId}`);
            } catch (e: any) {
                console.error(`[ConfigCreate] Failed to extract standard answer for config ${configId}:`, e.message);
                await db.updateConfig(configId, { parseStatus: 'failed' }).catch(() => {});
                return;
            }
        }

        if (configSupportsDatasetType(datasetType, 'outcome')) {
            const prompt = generateConfigExtractionPrompt(taskContext, standardAnswer);

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

            updates.rootCauses = JSON.stringify(rootCauses);
            updates.keyActions = JSON.stringify(keyActions);

            console.log(`[ConfigCreate] Successfully extracted key points for config ${configId}`);
        }

        await db.updateConfig(configId, {
            ...updates,
            parseStatus: 'completed'
        });
    } catch (error: any) {
        console.error(`[ConfigCreate] Failed to process config ${configId}:`, error.message);
        await db.updateConfig(configId, { parseStatus: 'failed' }).catch(() => {});
    }
}

export async function POST(request: Request) {
    try {
        const contentType = request.headers.get('content-type') || '';
        
        let query: string | null = null;
        let standardAnswer = '';
        let user: string | null = null;
        let documentContent: string | null = null;
        let datasetType: ConfigDatasetType = 'combined';

        let skill: string | null = null;
        let skillVersion: number | null = null;
        let expectedSkills: { skill: string; version: number | null }[] | null = null;

        if (contentType.includes('multipart/form-data')) {
            const formData = await request.formData();
            query = normalizeConfigQuery(formData.get('query'));
            standardAnswer = formData.get('standardAnswer') as string || '';
            user = formData.get('user') as string || null;
            datasetType = normalizeConfigDatasetType(formData.get('datasetType') as string || null);
            skill = normalizeConfigSkillName(formData.get('skill'));
            skillVersion = normalizeOptionalSkillVersion(formData.get('skillVersion'));
            
            const expectedSkillsStr = formData.get('expectedSkills') as string || null;
            if (expectedSkillsStr) {
                try {
                    expectedSkills = JSON.parse(expectedSkillsStr);
                    if (expectedSkills && Array.isArray(expectedSkills)) {
                        for (const item of expectedSkills) {
                            if (!item || typeof item !== 'object') {
                                return NextResponse.json({ error: 'expectedSkills 数组中的每个元素必须是对象' }, { status: 400 });
                            }
                            if (!item.skill || typeof item.skill !== 'string' || !item.skill.trim()) {
                                return NextResponse.json({ error: 'expectedSkills 中的每个技能必须包含 skill 名称' }, { status: 400 });
                            }
                        }
                        expectedSkills = expectedSkills.map((item: any) => ({
                            ...item,
                            version: normalizeOptionalSkillVersion(item.version)
                        }));
                    } else if (expectedSkills !== null) {
                        return NextResponse.json({ error: 'expectedSkills 必须是 JSON 数组' }, { status: 400 });
                    }
                } catch (e) {
                    console.error('Failed to parse expectedSkills:', e);
                    return NextResponse.json({ error: 'expectedSkills JSON 格式无效' }, { status: 400 });
                }
            }

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
            query = normalizeConfigQuery(body.query);
            standardAnswer = body.standardAnswer || '';
            user = body.user || null;
            documentContent = body.documentContent || null;
            datasetType = normalizeConfigDatasetType(body.datasetType);
            skill = normalizeConfigSkillName(body.skill);
            skillVersion = normalizeOptionalSkillVersion(body.skillVersion);
            expectedSkills = body.expectedSkills || null;
            if (expectedSkills && Array.isArray(expectedSkills)) {
                expectedSkills = expectedSkills.map((item: any) => ({
                    ...item,
                    version: normalizeOptionalSkillVersion(item.version)
                }));
            }
        }

        if (datasetType === 'routing') {
            if (!query) {
                return NextResponse.json({ error: '路由评测数据需要填写问题 (Query)' }, { status: 400 });
            }
            const hasExpectedSkills = Array.isArray(expectedSkills) && expectedSkills.some(item => item?.skill?.trim());
            const hasLegacySkill = !!skill?.trim();
            if (!hasExpectedSkills && !hasLegacySkill) {
                return NextResponse.json({ error: '路由评测数据需要至少配置一个预期技能' }, { status: 400 });
            }
        } else {
            if (!skill?.trim()) {
                return NextResponse.json({ error: '效果评测数据需要绑定目标 skill' }, { status: 400 });
            }
            if (!standardAnswer && !documentContent) {
                return NextResponse.json({ error: '请提供标准答案或上传案例文档' }, { status: 400 });
            }
        }

        const existingConfigs = await db.findConfigs({
            OR: [
                { user: user || null }
            ]
        });
        const existing = existingConfigs.find((c: any) => {
            if (normalizeConfigDatasetType(c.datasetType) !== datasetType) {
                return false;
            }

            if (datasetType === 'routing') {
                return normalizeConfigQuery(c.query) === query;
            }

            return normalizeConfigSkillName(c.skill) === skill
                && (c.skillVersion ?? null) === (skillVersion ?? null);
        });
        if (existing) {
            return NextResponse.json({
                error: datasetType === 'routing'
                    ? '该问题已存在于当前数据集类型中'
                    : '该目标 skill 已存在于当前效果数据集中'
            }, { status: 409 });
        }

        const parseStatus = 'parsing';
        const newConfig = await db.createConfig({
            query,
            skill: skill || '',
            skillVersion: skillVersion || null,
            datasetType,
            routingIntent: null,
            routingAnchors: null,
            expectedSkills: expectedSkills ? JSON.stringify(expectedSkills) : null,
            standardAnswer: standardAnswer || '',
            rootCauses: null,
            keyActions: null,
            user: user || null,
            parseStatus
        });

        await processConfigAsync(newConfig.id, query, standardAnswer, documentContent, datasetType, skill, skillVersion, user);

        const refreshedConfig = await db.findConfigById(newConfig.id);
        let routingAnchors: string[] = [];
        let rootCauses: any[] = [];
        let keyActions: any[] = [];

        try {
            if (refreshedConfig?.routingAnchors) routingAnchors = JSON.parse(refreshedConfig.routingAnchors);
            if (refreshedConfig?.rootCauses) rootCauses = JSON.parse(refreshedConfig.rootCauses);
            if (refreshedConfig?.keyActions) keyActions = JSON.parse(refreshedConfig.keyActions);
        } catch (error) {
            console.error('[ConfigCreate] Failed to parse refreshed config payload:', error);
        }

        return NextResponse.json({
            id: refreshedConfig?.id || newConfig.id,
            query: refreshedConfig?.query ?? newConfig.query ?? null,
            dataset_type: datasetType,
            skill: refreshedConfig?.skill || newConfig.skill,
            skillVersion: refreshedConfig?.skillVersion ?? newConfig.skillVersion ?? null,
            routing_intent: refreshedConfig?.routingIntent || null,
            routing_anchors: routingAnchors,
            expectedSkills: expectedSkills,
            standard_answer: refreshedConfig?.standardAnswer || standardAnswer || '',
            root_causes: rootCauses,
            key_actions: keyActions,
            parse_status: refreshedConfig?.parseStatus || parseStatus
        });

    } catch (error: any) {
        console.error('Config Create Error:', error);
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}
