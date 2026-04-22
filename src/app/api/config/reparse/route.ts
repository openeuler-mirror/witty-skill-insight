
import { db } from '@/lib/prisma';
import { getProxyConfig } from '@/lib/proxy-config';
import { getActiveConfig } from '@/lib/server-config';
import { generateAnswerExtractionPrompt, generateConfigExtractionPrompt } from '@/prompts/config-extraction-prompt';
import { extractKeyActionsFromFlow, mergeKeyActionsFromMultipleSkills, type ExtractedKeyAction, type ParsedFlowResult } from '@/lib/flow-parser';
import { NextResponse } from 'next/server';
import { OpenAI } from "openai";

export const dynamic = 'force-dynamic';

async function processConfigAsync(
    configId: string, 
    query: string, 
    standardAnswer: string, 
    documentContent: string | null,
    expectedSkills: { skill: string; version: number | null }[] | null,
    user?: string | null
) {
    try {
        const settings = await getActiveConfig(user);
        if (!settings) {
            console.error(`[ConfigReparse] No model configuration for user: ${user}`);
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
                const matchParse = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
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

                console.log(`[ConfigReparse] Successfully extracted standard answer for config ${configId}`);
            } catch (e: any) {
                console.error(`[ConfigReparse] Failed to extract standard answer for config ${configId}:`, e.message);
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
        const matchParse = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
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
        const keyActionsFromAnswer = extractedData.key_actions || [];

        let finalKeyActions = keyActionsFromAnswer;
        let extractedKeyActionsData: ExtractedKeyAction[] | null = null;

        const skillNamesToExtract = expectedSkills && expectedSkills.length > 0
            ? expectedSkills.map(e => e.skill.trim()).filter(Boolean)
            : [];

        if (skillNamesToExtract.length > 0) {
            try {
                const allActions: { name: string; actions: ExtractedKeyAction[] }[] = [];

                for (const skillName of skillNamesToExtract) {
                    const skill = await db.findSkill(skillName, user || null);
                    if (!skill) {
                        console.warn(`[ConfigReparse] Skill "${skillName}" not found, skipping extraction`);
                        continue;
                    }

                    const targetVersion = skill.activeVersion || 0;
                    const sv = skill.versions?.find((v: any) => v.version === targetVersion) || skill.versions?.[0];
                    if (!sv?.content) continue;

                    const parsedFlow = await db.findParsedFlow(skill.id, sv.version, user || null);
                    if (parsedFlow) {
                        const flow: ParsedFlowResult = JSON.parse(parsedFlow.flowJson);
                        const actions = extractKeyActionsFromFlow(flow);
                        allActions.push({ name: skillName, actions });
                    } else {
                        console.warn(`[ConfigReparse] No parsed flow for skill "${skillName}" v${sv.version}, skipping`);
                    }
                }

                if (allActions.length > 0) {
                    let extractedActions: ExtractedKeyAction[];
                    if (allActions.length === 1) {
                        extractedActions = allActions[0].actions;
                    } else {
                        extractedActions = mergeKeyActionsFromMultipleSkills(allActions);
                    }

                    finalKeyActions = extractedActions.map(a => ({
                        content: a.content,
                        weight: a.weight,
                        ...(a.controlFlowType !== 'required' ? { controlFlowType: a.controlFlowType } : {}),
                        ...(a.condition ? { condition: a.condition } : {}),
                        ...(a.branchLabel ? { branchLabel: a.branchLabel } : {}),
                        ...(a.loopCondition ? { loopCondition: a.loopCondition } : {}),
                        ...(a.expectedMinCount !== undefined ? { expectedMinCount: a.expectedMinCount } : {}),
                        ...(a.expectedMaxCount !== undefined ? { expectedMaxCount: a.expectedMaxCount } : {}),
                        ...(a.groupId ? { groupId: a.groupId } : {}),
                    }));
                    extractedKeyActionsData = extractedActions;

                    console.log(`[ConfigReparse] Extracted ${extractedActions.length} key actions from Skill(s): ${skillNamesToExtract.join(', ')}`);
                }
            } catch (err) {
                console.error('[ConfigReparse] Error extracting key actions from Skill:', err);
            }
        }

        const updateData: any = {
            rootCauses: JSON.stringify(rootCauses),
            keyActions: JSON.stringify(finalKeyActions),
            parseStatus: 'completed'
        };

        if (extractedKeyActionsData) {
            updateData.extractedKeyActions = JSON.stringify(extractedKeyActionsData);
        }

        await db.updateConfig(configId, updateData);

        console.log(`[ConfigReparse] Successfully extracted key points for config ${configId}`);
    } catch (error: any) {
        console.error(`[ConfigReparse] Failed to process config ${configId}:`, error.message);
        await db.updateConfig(configId, { parseStatus: 'failed' }).catch(() => {});
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { id, user } = body;

        if (!id) {
            return NextResponse.json({ error: '缺少配置ID' }, { status: 400 });
        }

        const config = await db.findConfigById(id);
        if (!config) {
            return NextResponse.json({ error: '配置不存在' }, { status: 404 });
        }

        await db.updateConfig(id, { parseStatus: 'parsing' });

        let expectedSkills = null;
        if (config.expectedSkills) {
            try {
                expectedSkills = JSON.parse(config.expectedSkills);
            } catch (e) {
                console.error('Failed to parse expectedSkills:', e);
            }
        }

        processConfigAsync(
            id, 
            config.query, 
            config.standardAnswer, 
            null,
            expectedSkills,
            user
        );

        return NextResponse.json({ 
            success: true, 
            message: '重新解析已启动' 
        });

    } catch (error: any) {
        console.error('Reparse Error:', error);
        return NextResponse.json({ 
            error: error.message || 'Internal Server Error' 
        }, { status: 500 });
    }
}
