import { readConfig, saveExecutionRecord } from '@/lib/data-service';
import { analyzeFailures, analyzeSession, extractSkillsFromClaudeSession, extractSkillsFromOpenClawSession, extractSkillsFromOpencodeSession, judgeAnswer, normalizeInteractions } from '@/lib/judge';
import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();
    let data;
    try {
        data = JSON.parse(rawBody);
    } catch (e) {
        console.error('JSON Parse Error:', e);
        console.error('Raw Body:', rawBody);
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    const headers = request.headers;
    const apiKey = headers.get('x-witty-api-key');
    
    // Identify user via API Key
    let username = undefined;
    if (apiKey) {
      const user = await prisma.user.findUnique({
        where: { apiKey: apiKey }
      });
      if (user) {
        username = user.username;
        data.user = username;
        console.log(`[Upload-API] User resolved via API Key: ${username}`);
      } else {
        console.warn(`[Upload-API] API Key provided but no matching user found in DB`);
      }
    }
    
    // Fallback 1: if API key didn't resolve a user, try data.user from request body
    if (!username && data.user) {
        username = data.user;
        console.log(`[Upload-API] Using user from request body: ${username}`);
    }
    
    // Fallback 2: if still no user, find a user that has evaluation settings configured
    if (!username) {
        try {
            const userWithSettings = await prisma.userSettings.findFirst({
                where: { settingsJson: { not: '{"activeConfigId":null,"configs":[]}' } }
            });
            if (userWithSettings) {
                username = userWithSettings.user;
                data.user = username;
                console.log(`[Upload-API] Fallback: Using user with active settings: ${username}`);
            } else {
                console.warn(`[Upload-API] No user resolved - evaluation will be skipped`);
            }
        } catch (e) {
            console.warn(`[Upload-API] Fallback user lookup failed:`, e);
        }
    }

    console.log(`[Upload-API] 📥 Received data from ${data.framework || 'unknown'}: task_id=${data.task_id}, query=${data.query?.substring(0, 50)}..., user=${username || '(none)'}`);
    
    // 1. Session Analysis (Extraction)
    let interactions = data.interactions || [];
    const normalized = normalizeInteractions(interactions);
    
    // Debug: log exact message roles and tool call presence
    normalized.forEach((turn, idx) => {
        const hasRespTool = !!turn.responseMessage?.tool_calls?.length;
        const reqToolCount = turn.requestMessages?.filter((m: any) => m.role === 'assistant' && m.tool_calls?.length).length || 0;
        console.log(`[Upload-Debug] Turn ${idx}: ReqMsgs=${turn.requestMessages?.length}, RespRole=${turn.responseMessage?.role}, RespTool=${hasRespTool}, AssistantReqTools=${reqToolCount}`);
    });

    // First quick save so it appears on Dashboard immediately!
    const quickData = { ...data, skip_evaluation: true };
    try {
        await saveExecutionRecord(quickData);
    } catch (e) {
        console.warn(`[Upload-API] Quick initial save failed:`, e);
    }

    // Fire and forget deep analysis to prevent blocking plugin
    processUploadAsync(data, username, normalized, interactions).catch(e => {
        console.error('[Upload-API] Async analysis failed:', e);
    });

    return NextResponse.json({ 
        success: true, 
        message: 'Upload received and analyzing in background',
        upload_id: data.task_id 
    }, { status: 200 });

  } catch (error) {
    console.error('[Upload-API] ❌ Error:', error);
    return NextResponse.json({ error: 'Failed to process data' }, { status: 500 });
  }
}

/**
 * 后台异步处理分析与评估
 */
async function processUploadAsync(data: any, username: any, normalized: any, interactions: any) {
    console.log(`[Upload-Async] Starting background analysis for ${data.task_id}`);

    // If it's a flat message list (which OpenCode/Claude report), analyze it
    const analysis = await analyzeSession(normalized, username);
    
    // Merge extracted data if not provided
    if (!data.query && analysis.query) data.query = analysis.query;
    if (!data.final_result && analysis.final_result) data.final_result = analysis.final_result;
    
    // Specialized Skill Extraction
    let skills: string[] = [];
    if (data.framework === 'opencode') {
        skills = extractSkillsFromOpencodeSession(normalized);
    } else if (data.framework === 'claudecode' || data.framework === 'claude') {
        skills = extractSkillsFromClaudeSession(normalized);
    } else if (data.framework === 'openclaw') {
        skills = extractSkillsFromOpenClawSession(normalized);
    }
    
    // If specialized failed, fallback to analysis.skill
    if (skills.length === 0 && analysis.skill) {
        skills = [analysis.skill];
    }
    
    if (skills.length > 0) {
        data.skills = skills;
        if (!data.skill) data.skill = skills[0];
        console.log(`[Upload-Async] 🛠️ Extracted Skills: ${JSON.stringify(skills)} for task_id=${data.task_id}`);
    } else {
        console.log(`[Upload-Async] ⚠️ No skills extracted for task_id=${data.task_id}`);
    }

    // Sanitize data
    if (data.query) {
        data.query = data.query.trim().replace(/^['"]+|['"]+$/g, '').trim();
    }
    if (data.skill) {
        data.skill = data.skill.trim().replace(/^['"]+|['"]+$/g, '').trim();
    }

    if (!data.query) {
        console.log(`[Upload-Async] Empty query after analysis, aborting task_id=${data.task_id}`);
        return;
    }

    // 2. Fetch Skill Definition & SOP
    let skillDef = undefined;
    const primarySkillName = data.skill;
    if (primarySkillName) {
         // Find skill belonging to this user
         const skillRecord = await prisma.skill.findFirst({
             where: { 
                 name: primarySkillName,
                 OR: [
                     { user: username || null },
                     { user: null },
                     { visibility: 'public' }
                 ]
             },
             include: { versions: { orderBy: { version: 'desc' }, take: 1 } }
         } as any) as any;
         if (skillRecord && skillRecord.versions.length > 0) {
             skillDef = skillRecord.versions[0].content;
             data.skill_version = skillRecord.versions[0].version;
         }
    }

    // 3. Judge Answer (Auto Evaluation)
    if (data.query && data.final_result) {
        let criteria: any = { skill_definition: skillDef };
        let cfg = undefined;
        try {
            const configs = await readConfig(username);
            cfg = configs.find(c => c.query && data.query && c.query.trim() === data.query.trim());
            if (cfg) {
                 criteria.root_causes = cfg.root_causes;
                 criteria.key_actions = cfg.key_actions;
                 criteria.standard_answer_example = cfg.standard_answer;
            }
        } catch (e) { console.warn("Config load error", e); }

        // Only judge if we have items to judge against (prevents 0 score overwrite on existing records if config missing)
        if (cfg) {
            const judgmentResult = await judgeAnswer(data.query, criteria, data.final_result, username);
            data.is_answer_correct = judgmentResult.is_correct;
            data.answer_score = judgmentResult.score;
            data.judgment_reason = judgmentResult.reason || 'Judged by Evaluation Model';
        } else {
            console.log(`[Upload-Async] No config match for query: "${data.query.substring(0, 20)}...". Skipping judgment to preserve potential existing score.`);
        }
    }

    // 4. Failure/Skill-Issue Analysis
    const failureAnalysis = await analyzeFailures(
        interactions, 
        primarySkillName, 
        skillDef, 
        data.answer_score,
        String(data.judgment_reason || ""),
        data.query,
        data.final_result,
        username
    );
    data.failures = failureAnalysis.failures;
    data.skill_issues = failureAnalysis.skill_issues;

    // 5. Final Save (Update Record)
    data.skip_evaluation = false;
    data.force_judgment = true; // explicitly save standard evaluations
    await saveExecutionRecord(data);
    
    console.log(`[Upload-Async] ✅ Completed async analysis: task_id=${data.task_id}, score=${data.answer_score}, failures=${(data.failures || []).length}`);

}
