
import { prisma } from '@/lib/prisma';
import { getProxyConfig } from '@/lib/proxy-config';
import { getActiveConfig } from '@/lib/server-config';
import { generateConfigExtractionPrompt } from '@/prompts/config-extraction-prompt';
import { NextResponse } from 'next/server';
import { OpenAI } from "openai";

export const dynamic = 'force-dynamic';


export async function POST(request: Request) {
  try {
    const { query, skillName, version, user } = await request.json();

    if (!query || !skillName || version === undefined) {
      return NextResponse.json({ error: 'Missing required fields: query, skillName, version' }, { status: 400 });
    }

    // 1. Check if Query already exists for THIS user
    const existing = await prisma.config.findFirst({
      where: { 
          query,
          user: user || null
      },
    });
    if (existing) {
      return NextResponse.json({ error: 'Query already exists in dataset.' }, { status: 409 });
    }

    // 2. Fetch Skill Content
    // Include user or public in skill fetch
    const skill = await prisma.skill.findFirst({
      where: { 
          name: skillName,
          OR: [
              { user: user || null },
              { visibility: 'public' }
          ]
      },
      include: {
        versions: {
          where: { version: Number(version) },
          take: 1
        }
      }
    });

    if (!skill || !skill.versions || skill.versions.length === 0) {
      return NextResponse.json({ error: 'Selected skill or version not found.' }, { status: 404 });
    }

    const skillContent = skill.versions[0].content;

    // 3. Extract Root Causes and Key Actions using LLM
    let openaiClient;
    let modelName;
    try {
      // Use user-scoped settings
      const settings = await getActiveConfig(user);
      if (!settings || !settings.apiKey) {
          return NextResponse.json({ error: 'Model configuration not found for user' }, { status: 500 });
      }
      
      const { customFetch } = getProxyConfig();
      openaiClient = new OpenAI({
         apiKey: settings.apiKey,
         baseURL: settings.baseUrl || 'https://api.deepseek.com',
         fetch: customFetch,
      });
      modelName = settings.model || 'deepseek-chat';
    } catch (e: any) {
      return NextResponse.json({ error: e.message || 'Model configuration not found' }, { status: 500 });
    }

    const prompt = generateConfigExtractionPrompt(query, skillName, skillContent);

    const response = await openaiClient.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: modelName,
      response_format: { type: "json_object" },
    });

    const content = response.choices[0].message.content;
    if (!content) {
        return NextResponse.json({ error: 'Failed to generate extraction from LLM' }, { status: 500 });
    }

    let extractedData;
    try {
        extractedData = JSON.parse(content);
    } catch (e) {
        return NextResponse.json({ error: 'Invalid JSON from LLM' }, { status: 500 });
    }

    const rootCauses = extractedData.root_causes || [];
    const keyActions = extractedData.key_actions || [];

    // 4. Save to Database
    const newConfig = await prisma.config.create({
      data: {
        query,
        skill: skillName, 
        standardAnswer: '', 
        rootCauses: JSON.stringify(rootCauses),
        keyActions: JSON.stringify(keyActions),
        user: user || null
      }
    });

    const formattedConfig = {
        id: newConfig.id,
        query: newConfig.query,
        skill: newConfig.skill,
        standard_answer: newConfig.standardAnswer,
        root_causes: rootCauses,
        key_actions: keyActions
    };

    return NextResponse.json(formattedConfig);

  } catch (error: any) {
    console.error('Config Create Error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
