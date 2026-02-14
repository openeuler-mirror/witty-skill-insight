import { readConfig, saveExecutionRecord } from '@/lib/data-service';
import { analyzeFailures, analyzeSession, extractSkillsFromClaudeSession, extractSkillsFromOpencodeSession, judgeAnswer, normalizeInteractions } from '@/lib/judge';
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
      }
    }

    console.log(`[Upload-API] 📥 Received data from ${data.framework || 'unknown'}: task_id=${data.task_id}, query=${data.query?.substring(0, 50)}...`);
    
    // 1. Session Analysis (Extraction)
    let interactions = data.interactions || [];
    const normalized = normalizeInteractions(interactions);
    
    // Debug: log exact message roles and tool call presence
    normalized.forEach((turn, idx) => {
        const hasRespTool = !!turn.responseMessage?.tool_calls?.length;
        const reqToolCount = turn.requestMessages?.filter((m: any) => m.role === 'assistant' && m.tool_calls?.length).length || 0;
        console.log(`[Upload-Debug] Turn ${idx}: ReqMsgs=${turn.requestMessages?.length}, RespRole=${turn.responseMessage?.role}, RespTool=${hasRespTool}, AssistantReqTools=${reqToolCount}`);
    });

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
    }
    
    // If specialized failed, fallback to analysis.skill
    if (skills.length === 0 && analysis.skill) {
        skills = [analysis.skill];
    }
    
    if (skills.length > 0) {
        data.skills = skills;
        if (!data.skill) data.skill = skills[0];
        console.log(`[Upload-API] 🛠️ Extracted Skills: ${JSON.stringify(skills)} for task_id=${data.task_id}`);
    } else {
        console.log(`[Upload-API] ⚠️ No skills extracted for task_id=${data.task_id}`);
    }

    // Sanitize data
    if (data.query) {
        data.query = data.query.trim().replace(/^['"]+|['"]+$/g, '').trim();
    }
    if (data.skill) {
        data.skill = data.skill.trim().replace(/^['"]+|['"]+$/g, '').trim();
    }

    if (!data.query) {
        return NextResponse.json({ success: false, message: 'Empty query, skipped' }, { status: 200 });
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
            data.judgment_reason = judgmentResult.reason || 'Judged by DeepSeek';
        } else {
            console.log(`[Upload-API] No config match for query: "${data.query.substring(0, 20)}...". Skipping judgment to preserve potential existing score.`);
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

    // 5. Final Save
    const result = await saveExecutionRecord(data);
    
    const response = NextResponse.json({ 
        success: result.success, 
        message: 'Data analysed and saved successfully',
        upload_id: result.record.upload_id,
        judgment: {
            skill_correct: result.record.is_skill_correct,
            answer_correct: result.record.is_answer_correct,
            score: result.record.answer_score,
            reason: result.record.judgment_reason
        },
        analysis: {
            task_id: data.task_id,
            query: data.query,
            skill: data.skill,
            failures: (data.failures || []).length
        }
    }, { status: 200 });

    console.log(`[Upload-API] ✅ Success: task_id=${data.task_id}, score=${data.answer_score}, failures=${(data.failures || []).length}`);
    return response;

  } catch (error) {
    console.error('[Upload-API] ❌ Error:', error);
    return NextResponse.json({ error: 'Failed to process and save data' }, { status: 500 });
  }
}
