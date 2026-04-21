import { readConfig, saveExecutionRecord, findBestMatchConfig } from '@/lib/data-service';
import { analyzeFailures, extractSkillsFromClaudeSession, extractSkillsFromOpencodeSession, extractSkillsWithVersionsFromClaudeSession, extractSkillsWithVersionsFromOpencodeSession, InvokedSkill, judgeAnswer, normalizeInteractions } from '@/lib/judge';
import { NextResponse } from 'next/server';

import { db } from '@/lib/prisma';

export async function POST(request: Request) {
  try {
    const data = await request.json();
    console.log(`[Rejudge] Received request for task: ${data.task_id || data.upload_id}`);

    const taskId = data.task_id || data.upload_id;
    if (!taskId) return NextResponse.json({ error: 'taskId required' }, { status: 400 });

    const existingRecord = await db.findExecutionById(taskId);
    if (!existingRecord) return NextResponse.json({ error: 'Record not found' }, { status: 404 });

    const session = await db.findSessionByTaskId(taskId);
    if (!session || !session.interactions) {
        return NextResponse.json({ error: 'Session log not found. Cannot rejudge without interactions.' }, { status: 400 });
    }

    const rawInteractions = JSON.parse(session.interactions);
    const normalized = normalizeInteractions(rawInteractions);

    // Try to use existing invokedSkills, otherwise re-extract
    let invokedSkills: InvokedSkill[] = [];
    if (existingRecord.invokedSkills) {
        try {
            const parsed = JSON.parse(existingRecord.invokedSkills);
            if (Array.isArray(parsed)) {
                invokedSkills = parsed;
            } else {
                console.warn('[Rejudge] invokedSkills is not an array, resetting to empty array');
                invokedSkills = [];
            }
        } catch (e) {
            console.warn('[Rejudge] Failed to parse invokedSkills:', e);
            invokedSkills = [];
        }
    }
    
    if (invokedSkills.length === 0) {
        if (existingRecord.framework === 'opencode') {
            invokedSkills = extractSkillsWithVersionsFromOpencodeSession(normalized);
        } else if (existingRecord.framework === 'claudecode' || existingRecord.framework === 'claude') {
            invokedSkills = extractSkillsWithVersionsFromClaudeSession(normalized);
        }
    }
    
    const skills = invokedSkills.map(s => s.name);
    const skillName = skills[0] || (existingRecord.skill || '').trim();
    let skillVersion = invokedSkills[0]?.version ?? existingRecord.skillVersion ?? undefined;

    console.log(`[Rejudge] Extracted skills: ${JSON.stringify(invokedSkills)}, skillName: ${skillName || 'none'}, skillVersion: ${skillVersion}`);

    const actionUser = data.currentUser || existingRecord.user || null;
    let skillDef = undefined;

    if (skillName) {
         console.log(`[Rejudge] Looking for skill: ${skillName} for user: ${actionUser || 'null'}`);
         try {
             const skillRecord = await db.findSkill(skillName, actionUser);
             console.log(`[Rejudge] Skill record found: ${skillRecord ? 'yes' : 'no'}, versions: ${skillRecord?.versions?.length || 0}`);
             
             if (skillRecord && skillRecord.versions && skillRecord.versions.length > 0) {
                 skillDef = skillRecord.versions[0].content;
                 console.log(`[Rejudge] Skill definition found, length: ${skillDef.length}`);
                 if (skillVersion === undefined) {
                     skillVersion = skillRecord.versions[0].version;
                     console.log(`[Rejudge] Using skill version: ${skillVersion}`);
                 }
             } else {
                 console.warn(`[Rejudge] Skill record found but no versions available`);
             }
         } catch (e) {
             console.error('[Rejudge] Error fetching skill definition:', e);
         }
    } else {
         console.warn(`[Rejudge] No skillName found, skipping skill definition lookup`);
    }

    const criteria: any = { skill_definition: skillDef };
    const configs = await readConfig(actionUser);
    const query = existingRecord.query || '';
    const cfg = findBestMatchConfig(configs, query);
    
    if (!cfg) {
        console.warn(`[Rejudge] No matching evaluation configuration found for query: ${query}`);
        return NextResponse.json({ 
            error: 'No matching evaluation configuration found for this query. Please ensure a valid configuration exists before re-judging.' 
        }, { status: 400 });
    }

    if (cfg) {
         criteria.root_causes = cfg.root_causes;
         criteria.key_actions = cfg.key_actions;
         criteria.standard_answer_example = cfg.standard_answer;
    }

    let executionSteps: { name: string; description: string; type: string }[] | null = null;
    try {
        const matchRecord = await db.findExecutionMatch(existingRecord.taskId || existingRecord.uploadId || '');
        if (matchRecord?.extractedSteps) {
            executionSteps = typeof matchRecord.extractedSteps === 'string' 
                ? JSON.parse(matchRecord.extractedSteps) 
                : matchRecord.extractedSteps;
        }
    } catch (e) {
        console.warn('[Rejudge] Failed to load execution steps for KA evaluation:', e);
    }

    const judgment = await judgeAnswer(query, criteria, existingRecord.finalResult || '', actionUser, executionSteps);
    const score = typeof judgment?.score === 'number' ? judgment.score : 0;
    
    console.log(`[Rejudge] Judgment result - score: ${score}, is_correct: ${judgment?.is_correct}, reason length: ${judgment?.reason?.length || 0}`);
    console.log(`[Rejudge] Judgment reason preview: ${judgment?.reason?.substring(0, 200) || 'none'}...`);
    
    if (score === 0 && (judgment.reason?.includes('failed') || judgment.reason?.includes('disabled') || judgment.reason?.includes('禁用'))) {
          return NextResponse.json({ 
              error: `Judgment failed: ${judgment.reason}` 
          }, { status: 500 });
    }
    
    console.log(`[Rejudge] Before analyzeFailures - skillName: ${skillName || 'none'}, skillDef: ${skillDef ? 'present' : 'absent'}, score: ${score}, judgmentReason: ${judgment.reason ? 'present' : 'absent'}`);
    
    const failureAnalysis = await analyzeFailures(
        normalized,
        skillName,
        skillDef,
        score,
        judgment.reason || '',
        query,
        existingRecord.finalResult || '',
        actionUser
    );
    
    console.log(`[Rejudge] After analyzeFailures - failures: ${failureAnalysis.failures?.length || 0}, skill_issues: ${failureAnalysis.skill_issues?.length || 0}`);

    const result = await saveExecutionRecord({
        task_id: taskId,
        skills: skills,
        invokedSkills: invokedSkills,
        skill: skillName,
        skill_version: skillVersion,
        answer_score: score,
        is_answer_correct: judgment.is_correct,
        judgment_reason: judgment.reason || 'Rejudged',
        failures: failureAnalysis.failures,
        skill_issues: failureAnalysis.skill_issues,
        force_judgment: false
    });

    return NextResponse.json({ 
        success: true, 
        message: 'Rejudged and re-analyzed successfully',
        record: result.record
    }, { status: 200 });

  } catch (error) {
    console.error('Rejudge Error:', error);
    return NextResponse.json({ error: 'Failed to rejudge' }, { status: 500 });
  }
}
