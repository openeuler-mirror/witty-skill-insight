import { readConfig, saveExecutionRecord } from '@/lib/data-service';
import { analyzeDynamicOnly } from '@/lib/flow-parser';
import { analyzeFailures, analyzeSession, extractSkillsFromClaudeSession, extractSkillsFromOpenClawSession, extractSkillsFromOpencodeSession, extractSkillsWithVersionsFromClaudeSession, extractSkillsWithVersionsFromOpenClawSession, extractSkillsWithVersionsFromOpencodeSession, InvokedSkill, judgeAnswer, normalizeInteractions } from '@/lib/judge';
import { db, prisma } from '@/lib/prisma';
import { debounceByKey } from '@/lib/upload-analysis-debouncer';
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
    
    const interactions = data.interactions || [];
    const normalized = normalizeInteractions(interactions);
    
    normalized.forEach((turn, idx) => {
        const hasRespTool = !!turn.responseMessage?.tool_calls?.length;
        const reqToolCount = turn.requestMessages?.filter((m: any) => m.role === 'assistant' && m.tool_calls?.length).length || 0;
        console.log(`[Upload-Debug] Turn ${idx}: ReqMsgs=${turn.requestMessages?.length}, RespRole=${turn.responseMessage?.role}, RespTool=${hasRespTool}, AssistantReqTools=${reqToolCount}`);
    });

    let quickSkillsWithVersions: InvokedSkill[] = [];
    if (data.framework === 'opencode') {
        quickSkillsWithVersions = extractSkillsWithVersionsFromOpencodeSession(normalized);
    } else if (data.framework === 'claudecode' || data.framework === 'claude') {
        quickSkillsWithVersions = extractSkillsWithVersionsFromClaudeSession(normalized);
    } else if (data.framework === 'openclaw') {
        quickSkillsWithVersions = extractSkillsWithVersionsFromOpenClawSession(normalized);
    }
    
    console.log(`[Upload-API] Extracted skills: ${JSON.stringify(quickSkillsWithVersions)}`);
    
    const quickSkills = quickSkillsWithVersions.map(s => s.name);
    
    let quickSkillVersion = quickSkillsWithVersions[0]?.version ?? data.skill_version;
    console.log(`[Upload-API] Initial quickSkillVersion: ${quickSkillVersion} (from tool call: ${quickSkillsWithVersions[0]?.version}, from data: ${data.skill_version})`);
    
    if (quickSkillVersion === null || quickSkillVersion === undefined) {
        const primarySkillName = quickSkills.length > 0 ? quickSkills[0] : data.skill;
        console.log(`[Upload-API] No version from tool call, querying database for skill: ${primarySkillName}`);
        if (primarySkillName) {
            try {
                const skillRecord = await db.findSkill(primarySkillName, username || null);
                console.log(`[Upload-API] Skill record found: ${skillRecord ? skillRecord.name : 'null'}, activeVersion: ${skillRecord?.activeVersion}, versions: ${skillRecord?.versions?.map((v: any) => v.version).join(',')}`);
                if (skillRecord && skillRecord.versions && skillRecord.versions.length > 0) {
                    const targetVersion = skillRecord.activeVersion || 0;
                    const sv = skillRecord.versions.find((v: any) => v.version === targetVersion);
                    if (sv) {
                        quickSkillVersion = sv.version;
                        console.log(`[Upload-API] Quick save: using active version ${quickSkillVersion} for skill ${primarySkillName}`);
                    } else {
                        quickSkillVersion = skillRecord.versions[0].version;
                        console.log(`[Upload-API] Quick save: using fallback version ${quickSkillVersion} for skill ${primarySkillName}`);
                    }
                } else {
                    console.log(`[Upload-API] Skill record not found or no versions available`);
                }
            } catch (e) {
                console.warn(`[Upload-API] Failed to fetch skill version for ${primarySkillName}:`, e);
            }
        }
    }
    
    console.log(`[Upload-API] Final quickSkillVersion: ${quickSkillVersion}`);
    
    const quickData = { 
        ...data, 
        skip_evaluation: true,
        skills: quickSkills.length > 0 ? quickSkills : data.skills,
        invokedSkills: quickSkillsWithVersions.length > 0 ? quickSkillsWithVersions : data.invokedSkills,
        skill: quickSkills.length > 0 ? quickSkills[0] : data.skill,
        skill_version: quickSkillVersion
    };
    
    try {
        await saveExecutionRecord(quickData);
        if (quickSkills.length > 0) {
            console.log(`[Upload-API] Quick save with skills: ${JSON.stringify(quickSkillsWithVersions)}`);
        }
    } catch (e) {
        console.warn(`[Upload-API] Quick initial save failed:`, e);
    }

    const debounceMs = Number(process.env.UPLOAD_ASYNC_DEBOUNCE_MS || 15000);
    const safeDebounceMs = Number.isFinite(debounceMs) && debounceMs >= 0 ? debounceMs : 15000;
    const taskKey = String(data.task_id || '');
    debounceByKey(taskKey, safeDebounceMs, () => {
        const clonedData = JSON.parse(JSON.stringify(data));
        const clonedNormalized = JSON.parse(JSON.stringify(normalized));
        const clonedInteractions = JSON.parse(JSON.stringify(interactions));
        processUploadAsync(clonedData, username, clonedNormalized, clonedInteractions).catch(e => {
            console.error('[Upload-API] Async analysis failed:', e);
        });
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
    
    let skillsWithVersions: InvokedSkill[] = [];
    if (data.framework === 'opencode') {
        skillsWithVersions = extractSkillsWithVersionsFromOpencodeSession(normalized);
    } else if (data.framework === 'claudecode' || data.framework === 'claude') {
        skillsWithVersions = extractSkillsWithVersionsFromClaudeSession(normalized);
    } else if (data.framework === 'openclaw') {
        skillsWithVersions = extractSkillsWithVersionsFromOpenClawSession(normalized);
    }
    
    const skills = skillsWithVersions.map(s => s.name);
    
    if (skills.length === 0 && analysis.skill) {
        skills.push(analysis.skill);
        skillsWithVersions.push({ name: analysis.skill, version: null });
    }
    
    if (skills.length > 0) {
        data.skills = skills;
        data.invokedSkills = skillsWithVersions;
        if (!data.skill) data.skill = skills[0];
        console.log(`[Upload-Async] Extracted skills: ${JSON.stringify(skillsWithVersions)}`);
        console.log(`[Upload-Async] Current data.skill_version: ${data.skill_version}`);
        if (skillsWithVersions[0]?.version != null) {
            data.skill_version = skillsWithVersions[0].version;
            console.log(`[Upload-Async] Updated skill_version from tool call: ${data.skill_version}`);
        }
        console.log(`[Upload-Async] 🛠️ Extracted Skills: ${JSON.stringify(skillsWithVersions)} for task_id=${data.task_id}`);
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
    console.log(`[Upload-Async] Primary skill name: ${primarySkillName}, current skill_version: ${data.skill_version}`);
    if (primarySkillName) {
          const skillRecord = await db.findSkill(primarySkillName, username || null);
          console.log(`[Upload-Async] Skill record found: ${skillRecord ? skillRecord.name : 'null'}, activeVersion: ${skillRecord?.activeVersion}, versions: ${skillRecord?.versions?.map((v: any) => v.version).join(',')}`);
          if (skillRecord && skillRecord.versions && skillRecord.versions.length > 0) {
             // Use activeVersion if available, otherwise use the first/latest version
             const targetVersion = skillRecord.activeVersion || 0;
             const sv = skillRecord.versions.find((v: any) => v.version === targetVersion);
             if (sv && sv.content) {
                 skillDef = sv.content;
                 data.skill_version = sv.version;
                 console.log(`[Upload-Async] Using active version ${sv.version} for skill ${primarySkillName}`);
             } else {
                 // Fallback to first/latest version
                 skillDef = skillRecord.versions[0].content;
                 data.skill_version = skillRecord.versions[0].version;
                 console.log(`[Upload-Async] Using fallback version ${skillRecord.versions[0].version} for skill ${primarySkillName}`);
             }
         }
    }

    data.skip_evaluation = true;
    data.force_judgment = false;
    await saveExecutionRecord(data);

    try {
        const dynamicResult = await analyzeDynamicOnly(data.task_id, username);
        if (dynamicResult.success) {
            console.log(`[Upload-Async] Auto-parsed dynamic flow for ${data.task_id}`);
        } else {
            console.warn(`[Upload-Async] Auto-parse dynamic flow failed for ${data.task_id}: ${dynamicResult.error}`);
        }
    } catch (e) {
        console.warn(`[Upload-Async] Auto-parse dynamic flow error for ${data.task_id}:`, e);
    }

    if (data.query && data.final_result) {
        const criteria: any = { skill_definition: skillDef };
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
            let executionSteps: { name: string; description: string; type: string }[] | null = null;
            try {
                const matchRecord = await db.findExecutionMatch(data.task_id);
                if (matchRecord?.extractedSteps) {
                    executionSteps = typeof matchRecord.extractedSteps === 'string' 
                        ? JSON.parse(matchRecord.extractedSteps) 
                        : matchRecord.extractedSteps;
                    console.log(`[Upload-Async] Found ${executionSteps?.length || 0} execution steps for KA evaluation`);
                }
            } catch (e) {
                console.warn(`[Upload-Async] Failed to load execution steps for KA evaluation:`, e);
            }

            const judgmentResult = await judgeAnswer(data.query, criteria, data.final_result, username, executionSteps);
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
