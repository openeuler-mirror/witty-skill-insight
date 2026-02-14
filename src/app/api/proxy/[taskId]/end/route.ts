
import { readConfig, saveExecutionRecord } from '@/lib/data-service';
import { analyzeFailures, analyzeSession, judgeAnswer } from '@/lib/judge';
import { prisma } from '@/lib/prisma';
import { endSession } from '@/lib/proxy-store';
import { getActiveConfig } from '@/lib/server-config';
import { NextResponse } from 'next/server';

import { SKILLS_EXTRACT_PROMPT } from '@/prompts/skills-prompt';

const SKILLS_EXTRACT_QUERY = SKILLS_EXTRACT_PROMPT;

function getBaseUrl(taskId: string): string {
  if (taskId.startsWith('claude')) return 'https://api.deepseek.com/anthropic';
  return 'https://api.deepseek.com';
}

/** 从模型回复中解析出 skill 名称列表，支持 JSON 数组或每行一个 */
function parseSkillsFromModelResponse(content: string): string[] {
  if (!content || typeof content !== 'string') return [];
  const raw = content.trim();
  const cleaned = raw.replace(/^```\w*\n?|```\s*$/g, '').trim();
  let list: string[] = [];
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) list = parsed;
    else if (parsed && Array.isArray(parsed.skills)) list = parsed.skills;
    else if (parsed && typeof parsed.skills === 'string') list = [parsed.skills];
  } catch {
    list = cleaned.split(/\n+/).map((s) => s.replace(/^[\s\-*•\d.)]+|[\s\-*•]+$/g, '').trim());
  }
  const normalized = list
    .filter((s) => s != null && String(s).trim() !== '')
    .map((s) => String(s).trim().replace(/^['"]+|['"]+$/g, ''));
  // 仅保留符合 skill name 格式的项（字母数字、下划线、连字符、点）
  const skillNamePattern = /^[a-zA-Z0-9_\-\.]+$/;
  return normalized.filter((s) => skillNamePattern.test(s));
}

const SKILLS_FETCH_TIMEOUT_MS = 25_000;

/** Witty 无交互：从会话中提取 tool_name === "load_skill" 的 tool call，从 args 取 skill_name，去重为 skills 列表 */
function extractSkillsFromWittySession(session: {
  interactions: { toolCalls?: any[]; responseMessage?: { tool_calls?: any[] } }[];
}): string[] {
  const seen = new Set<string>();
  const skills: string[] = [];
  const skillNamePattern = /^[a-zA-Z0-9_\-\.]+$/;

  for (const interaction of session.interactions) {
    const calls =
      interaction.toolCalls ??
      interaction.responseMessage?.tool_calls ??
      [];
    for (const tc of calls) {
      const name = tc?.function?.name ?? tc?.name;
      if (name !== 'load_skill') continue;
      const raw = tc?.function?.arguments ?? tc?.arguments ?? '';
      if (!raw || typeof raw !== 'string') continue;
      try {
        const args = typeof raw === 'string' ? JSON.parse(raw) : raw;
        const skillName = args?.skill_name ?? args?.skillName ?? args?.name;
        if (skillName != null && String(skillName).trim()) {
          const s = String(skillName).trim().replace(/^['"]+|['"]+$/g, '');
          if (skillNamePattern.test(s) && !seen.has(s)) {
            seen.add(s);
            skills.push(s);
          }
        }
      } catch {
        // ignore malformed args
      }
    }
  }
  return skills;
}

/** OpenEncode：从会话中提取 function.name === "skill" 的 tool call，从 arguments 的 name 取 skill 名，去重为 skills 列表 */
function extractSkillsFromOpencodeSession(session: {
  interactions: { toolCalls?: any[]; responseMessage?: { tool_calls?: any[] } }[];
}): string[] {
  const seen = new Set<string>();
  const skills: string[] = [];
  const skillNamePattern = /^[a-zA-Z0-9_\-\.]+$/;

  for (const interaction of session.interactions) {
    const calls =
      interaction.toolCalls ??
      interaction.responseMessage?.tool_calls ??
      [];
    for (const tc of calls) {
      const name = tc?.function?.name ?? tc?.name;
      if (name !== 'skill') continue;
      const raw = tc?.function?.arguments ?? tc?.arguments ?? '';
      if (!raw || typeof raw !== 'string') continue;
      try {
        const args = typeof raw === 'string' ? JSON.parse(raw) : raw;
        const skillName = args?.name ?? args?.skill_name ?? args?.skillName ?? args?.skill;
        if (skillName != null && String(skillName).trim()) {
          const s = String(skillName).trim().replace(/^['"]+|['"]+$/g, '');
          if (skillNamePattern.test(s) && !seen.has(s)) {
            seen.add(s);
            skills.push(s);
          }
        }
      } catch {
        // ignore malformed args
      }
    }
  }
  return skills;
}

/** 从单条消息的 content（数组）中收集 type=tool_use、name=Skill 的 input.skill，去重写入 seen 与 skills */
function collectSkillToolUseFromContent(
  content: unknown,
  seen: Set<string>,
  skills: string[]
): void {
  if (!content || !Array.isArray(content)) return;
  const skillNamePattern = /^[a-zA-Z0-9_\-\.]+$/;
  for (const block of content) {
    if (block?.type !== 'tool_use' || block?.name !== 'Skill') continue;
    const input = block.input;
    const skillName = input?.skill ?? input?.skill_name ?? input?.skillName ?? input?.name;
    if (skillName == null || !String(skillName).trim()) continue;
    const s = String(skillName).trim().replace(/^['"]+|['"]+$/g, '');
    if (skillNamePattern.test(s) && !seen.has(s)) {
      seen.add(s);
      skills.push(s);
    }
  }
}

/** Claude：从会话中提取 type 为 tool_use、name 为 Skill 的 content 块，从 input.skill 取 skill 名，去重为 skills 列表（与 DeepAgent 处理方式一致）。
 *  兼顾两种存储：responseMessage.content 与 requestMessages 中 role=assistant 的 content（扁平对话） */
function extractSkillsFromClaudeSession(session: {
  interactions: {
    requestMessages?: { role?: string; content?: unknown }[];
    responseMessage?: { content?: unknown };
  }[];
}): string[] {
  const seen = new Set<string>();
  const skills: string[] = [];

  for (const interaction of session.interactions) {
    collectSkillToolUseFromContent(interaction.responseMessage?.content, seen, skills);
    const reqMsgs = interaction.requestMessages ?? [];
    for (const msg of reqMsgs) {
      if (msg?.role !== 'assistant') continue;
      collectSkillToolUseFromContent(msg.content, seen, skills);
    }
  }
  return skills;
}

/** 从单条消息中提取纯文本（兼容 content 为 string 或 Anthropic 的 content 数组） */
function messageContentToText(msg: { content?: string | { type?: string; text?: string }[] }): string {
  if (!msg?.content) return '';
  if (typeof msg.content === 'string') return msg.content;
  if (!Array.isArray(msg.content)) return '';
  return msg.content
    .filter((c: any) => c?.type === 'text' && c?.text)
    .map((c: any) => c.text)
    .join('\n')
    .trim();
}

/** 用完整会话历史 + 一条「提取 skills」的用户消息调用模型，得到 skills 列表 */
async function fetchSkillsViaModel(
  taskId: string,
  interactions: { requestMessages: any[]; responseMessage: any }[]
): Promise<string[]> {
  if (!interactions.length) return [];

  // 从所有 interactions 构建完整对话（OpenAI 格式：role + content 字符串），供模型从整段对话中推断激活的 skills
  const history: { role: 'user' | 'assistant' | 'system'; content: string }[] = [];
  for (const interaction of interactions) {
    const reqMsgs = interaction.requestMessages || [];
    const userParts: string[] = [];
    for (const m of reqMsgs) {
      if (m.role !== 'user') continue;
      const text = messageContentToText(m);
      if (text && !text.startsWith('<system-reminder>') && !text.includes('[SUGGESTION MODE:')) {
        userParts.push(text);
      }
    }
    if (userParts.length) {
      history.push({ role: 'user', content: userParts.join('\n\n') });
    }
    const resMsg = interaction.responseMessage;
    if (resMsg?.content) {
      const assistantText = messageContentToText(resMsg);
      if (assistantText) {
        history.push({ role: 'assistant', content: assistantText });
      }
    }
  }

  // 若历史过长，只保留最后若干轮，避免超出上下文
  const maxTurns = 30;
  const trimmedHistory =
    history.length > maxTurns ? history.slice(-maxTurns) : history;
  const messages = [...trimmedHistory, { role: 'user' as const, content: SKILLS_EXTRACT_QUERY }];

  const baseUrl = getBaseUrl(taskId);
  const chatUrl = `${baseUrl}/v1/chat/completions`;

  // 从界面配置获取 API Key（不再依赖环境变量）
  const activeConfig = await getActiveConfig();
  const apiKey = activeConfig?.apiKey;
  if (!apiKey) {
    console.warn('No model API Key configured in Settings, skipping skills extraction via model.');
    return [];
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SKILLS_FETCH_TIMEOUT_MS);

  try {
    const body: Record<string, unknown> = {
      model: baseUrl.includes('anthropic') ? 'claude-sonnet-4-20250514' : 'deepseek-chat',
      max_tokens: 1024,
      stream: false,
      messages,
    };
    const res = await fetch(chatUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!res.ok) {
      const err = await res.text();
      console.error('Skills extraction error', res.status, err);
      return [];
    }
    const data = await res.json();
    const content =
      data.choices?.[0]?.message?.content ??
      data.content?.find((c: any) => c.type === 'text')?.text ??
      data.content?.[0]?.text ??
      '';
    return parseSkillsFromModelResponse(String(content));
  } catch (e) {
    clearTimeout(timeoutId);
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('abort')) {
      console.warn('fetchSkillsViaModel timeout, skipping skills');
    } else {
      console.error('fetchSkillsViaModel error', e);
    }
    return [];
  }
}

export const maxDuration = 60;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const taskId = (await params).taskId;
    const session = await endSession(taskId);

    if (!session) {
      return NextResponse.json({ error: 'Session not found or empty' }, { status: 404 });
    }

    const endTime = Date.now();
    const duration = (endTime - session.startTime) / 1000;

    let totalTokens = 0;
    for (const interaction of session.interactions) {
      const usage = interaction.usage || interaction.responseMessage?.usage;
      if (usage) {
        // Handle case where usage is a JSON string (sometimes happens with DB storage)
        let parsedUsage = usage;
        if (typeof usage === 'string') {
             try { parsedUsage = JSON.parse(usage); } catch(e) {}
        }
        
        const anyUsage = parsedUsage as any;
        const t = (anyUsage.total_tokens || anyUsage.total || 0);
        
        // Log found tokens for debug
        // console.log(`[Proxy-End] Found tokens: ${t} in interaction`);
        
        totalTokens += Number(t);
      }
    }

    let framework = taskId.split('-')[0] || 'unknown';
    if (framework === 'claude') framework = 'claudecode';

    const analysis = await analyzeSession(session.interactions, session.user);
    
    // If session doesn't have a query but we extracted one, update the session
    if (!session.query && analysis.query) {
        try {
            await prisma.session.update({
                where: { taskId },
                data: { query: analysis.query }
            });
            console.log(`[End] Updated session query for ${taskId}: ${analysis.query.substring(0, 50)}...`);
        } catch (e) {
            console.warn(`[End] Failed to update session query: ${e}`);
        }
    }

    // 1. Extract Skills First
    const isWittyLike =
      framework === 'deepagent(langgraph)' ||
      framework === 'witty' ||
      framework === 'witty(deepagents)';
    let skills: string[];
    if (framework === 'claude') {
      skills = extractSkillsFromClaudeSession(session);
      if (skills.length === 0) {
        console.log(`No Skill tool_use in Claude session for ${taskId}, falling back to model extraction...`);
        skills = await fetchSkillsViaModel(taskId, session.interactions);
      }
      console.log(`Skills from Claude session for ${taskId}:`, skills);
    } else if (framework === 'opencode') {
      skills = extractSkillsFromOpencodeSession(session);
      console.log(`Skills from OpenEncode session for ${taskId}:`, skills);
    } else if (isWittyLike) {
      skills = extractSkillsFromWittySession(session);
      console.log(`Skills from Witty session for ${taskId}:`, skills);
    } else {
      console.log(`Fetching skills via model for ${taskId}...`);
      skills = await fetchSkillsViaModel(taskId, session.interactions);
      console.log(`Skills from model for ${taskId}:`, skills);
    }

    const primarySkillName = skills.length > 0 ? skills[0] : analysis.skill;

    // 2. Fetch Skill Definition & SOP
    let skillDef = undefined;
    console.log(`[End] Primary skill name for ${taskId}: ${primarySkillName || '(none)'}`);
    if (primarySkillName) {
         const skillRecord = await prisma.skill.findFirst({
             where: { 
                 name: primarySkillName,
                 OR: [
                     { user: session.user || null },
                     { visibility: 'public' }
                 ]
             },
             include: { versions: { orderBy: { version: 'desc' }, take: 1 } }
         });
         if (skillRecord && skillRecord.versions.length > 0) {
             skillDef = skillRecord.versions[0].content;
             console.log(`[End] Skill definition found for ${primarySkillName}, length: ${skillDef?.length || 0}`);
         } else {
             console.warn(`[End] Skill definition NOT FOUND for ${primarySkillName}. Attribution will be skipped.`);
         }
    } else {
         console.warn(`[End] No primarySkillName extracted. Attribution will be skipped.`);
    }

    // 3. Judge Answer (Auto Evaluation)
    let evaluation = { is_skill_correct: false, is_answer_correct: false, answer_score: 0, judgment_reason: "Auto-eval skipped (missing query/result/skill)" };
    
    // Normalize query/skill fields
    if (session.query) analysis.query = session.query;
    if (analysis.query) analysis.query = analysis.query.trim().replace(/^['"]+|['"]+$/g, '').trim();
    if (primarySkillName) analysis.skill = primarySkillName;

    // Load Evaluation Config if matches
    let criteria: any = { skill_definition: skillDef };
    
    // Try to find a matching config
    try {
        const configs = await readConfig(session.user);
        const cfg = configs.find(c => c.query && analysis.query && c.query.trim() === analysis.query.trim());
        
        if (cfg) {
             criteria.root_causes = cfg.root_causes;
             criteria.key_actions = cfg.key_actions;
             criteria.standard_answer_example = cfg.standard_answer;
        }
    } catch (e) { console.warn("Config load error", e); }


    if (analysis.query && analysis.final_result) {
        const judgmentResult = await judgeAnswer(analysis.query, criteria, analysis.final_result, session.user);
        evaluation = {
            is_skill_correct: false,
            is_answer_correct: judgmentResult.is_correct,
            answer_score: judgmentResult.score,
            judgment_reason: judgmentResult.reason || 'Judged by DeepSeek'
        };
    }

    // 4. Failure Analysis with Attribution
    console.log(`[End] Calling analyzeFailures: skillName=${primarySkillName || 'none'}, skillDef=${skillDef ? 'present' : 'absent'}, answerScore=${evaluation.answer_score}`);
    const failureAnalysis = await analyzeFailures(
        session.interactions, 
        primarySkillName, 
        skillDef, 
        evaluation.answer_score,
        String(evaluation.judgment_reason || ""),
        analysis.query,         // 新增: 用户问题
        analysis.final_result,   // 新增: Agent 回答
        session.user
    );
    console.log(`[End] analyzeFailures result: ${failureAnalysis.failures.length} failures, ${failureAnalysis.skill_issues?.length || 0} skill issues`);

    let body = {};
    try {
      body = await request.json();
    } catch (e) {}

    const result = await saveExecutionRecord({
      task_id: taskId,
      framework,
      query: analysis.query,
      skills: skills.length > 0 ? skills : (primarySkillName ? [primarySkillName] : undefined),
      skill: primarySkillName,
      final_result: analysis.final_result,
      tokens: totalTokens,
      latency: duration,
      timestamp: new Date(session.startTime).toISOString(),
      user: session.user, // Pass user 
      failures: failureAnalysis.failures,
      
      // Evaluation Results
      is_skill_correct: evaluation.is_skill_correct,
      is_answer_correct: evaluation.is_answer_correct,
      answer_score: evaluation.answer_score,
      judgment_reason: evaluation.judgment_reason,
      force_judgment: false, // Already judged

      ...body,
    });

    const response = NextResponse.json({
      status: 'ok',
      summary: {
        task_id: taskId,
        framework,
        duration,
        tokens: totalTokens,
        skills,
        query_preview: analysis.query?.substring(0, 50),
      },
      upload_result: result,
    });

    console.log(`[Proxy-End] ✅ Task completed: task_id=${taskId}, framework=${framework}, score=${evaluation.answer_score}, duration=${duration.toFixed(1)}s`);
    return response;
  } catch (e) {
    console.error('[Proxy-End] ❌ Error:', e);
    const message = e instanceof Error ? e.message : 'Internal server error';
    return NextResponse.json(
      { error: 'Failed to process end signal', details: message },
      { status: 500 }
    );
  }
}
