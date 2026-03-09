import { readConfig, saveExecutionRecord } from '@/lib/data-service';
import { analyzeFailures, analyzeSession, extractSkillsFromClaudeSession, extractSkillsFromOpenClawSession, extractSkillsFromOpencodeSession, judgeAnswer, normalizeInteractions } from '@/lib/judge';
import { db, prisma } from '@/lib/prisma';
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
    
    let username = undefined;
    if (apiKey) {
      const user = await db.findUserByApiKey(apiKey);
      if (user) {
        username = user.username;
        data.user = username;
        console.log(`[Upload-API] User resolved via API Key: ${username}`);
      } else {
        console.warn(`[Upload-API] API Key provided but no matching user found in DB`);
      }
    }
    
    if (!username && data.user) {
        username = data.user;
        console.log(`[Upload-API] Using user from request body: ${username}`);
    }
    
    if (!username) {
        try {
            const client = db.getClient();
            if ('query' in client) {
                const res = await (client as any).query(
                    `SELECT * FROM "UserSettings" WHERE "settingsJson" != '{"activeConfigId":null,"configs":[]}' LIMIT 1`
                );
                if (res.rows[0]) {
                    username = res.rows[0].user;
                    data.user = username;
                    console.log(`[Upload-API] Fallback: Using user with active settings: ${username}`);
                }
            } else {
                const userWithSettings = await (client as any).userSettings.findFirst({
                    where: { settingsJson: { not: '{"activeConfigId":null,"configs":[]}' } }
                });
                if (userWithSettings) {
                    username = userWithSettings.user;
                    data.user = username;
                    console.log(`[Upload-API] Fallback: Using user with active settings: ${username}`);
                }
            }
        } catch (e) {
            console.warn(`[Upload-API] Fallback user lookup failed:`, e);
        }
    }

    console.log(`[Upload-API] 📥 Received data from ${data.framework || 'unknown'}: task_id=${data.task_id}, query=${data.query?.substring(0, 50)}..., user=${username || '(none)'}`);
    
    let interactions = data.interactions || [];
    const normalized = normalizeInteractions(interactions);
    
    normalized.forEach((turn, idx) => {
        const hasRespTool = !!turn.responseMessage?.tool_calls?.length;
        const reqToolCount = turn.requestMessages?.filter((m: any) => m.role === 'assistant' && m.tool_calls?.length).length || 0;
        console.log(`[Upload-Debug] Turn ${idx}: ReqMsgs=${turn.requestMessages?.length}, RespRole=${turn.responseMessage?.role}, RespTool=${hasRespTool}, AssistantReqTools=${reqToolCount}`);
    });

    const quickData = { ...data, skip_evaluation: true };
    try {
        await saveExecutionRecord(quickData);
    } catch (e) {
        console.warn(`[Upload-API] Quick initial save failed:`, e);
    }

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

async function processUploadAsync(data: any, username: any, normalized: any, interactions: any) {
    console.log(`[Upload-Async] Starting background analysis for ${data.task_id}`);

    const analysis = await analyzeSession(normalized, username);
    
    if (!data.query && analysis.query) data.query = analysis.query;
    if (!data.final_result && analysis.final_result) data.final_result = analysis.final_result;
    
    let skills: string[] = [];
    if (data.framework === 'opencode') {
        skills = extractSkillsFromOpencodeSession(normalized);
    } else if (data.framework === 'claudecode' || data.framework === 'claude') {
        skills = extractSkillsFromClaudeSession(normalized);
    } else if (data.framework === 'openclaw') {
        skills = extractSkillsFromOpenClawSession(normalized);
    }
    
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

    let skillDef = undefined;
    const primarySkillName = data.skill;
    if (primarySkillName) {
          const skillRecord = await db.findSkill(primarySkillName, username || null);
          if (skillRecord && skillRecord.versions && skillRecord.versions.length > 0) {
             skillDef = skillRecord.versions[0].content;
             data.skill_version = skillRecord.versions[0].version;
         }
    }

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

        if (cfg) {
            const judgmentResult = await judgeAnswer(data.query, criteria, data.final_result, username);
            data.is_answer_correct = judgmentResult.is_correct;
            data.answer_score = judgmentResult.score;
            data.judgment_reason = judgmentResult.reason || 'Judged by Evaluation Model';
        } else {
            console.log(`[Upload-Async] No config match for query: "${data.query.substring(0, 20)}...". Skipping judgment to preserve potential existing score.`);
        }
    }

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

    data.skip_evaluation = false;
    data.force_judgment = true;
    await saveExecutionRecord(data);
    
    console.log(`[Upload-Async] ✅ Completed async analysis: task_id=${data.task_id}, score=${data.answer_score}, failures=${(data.failures || []).length}`);

}
