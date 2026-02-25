import { readConfig, saveExecutionRecord } from '@/lib/data-service';
import { analyzeFailures, extractSkillsFromClaudeSession, extractSkillsFromOpencodeSession, judgeAnswer, normalizeInteractions } from '@/lib/judge';
import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';

export async function POST(request: Request) {
  try {
    const data = await request.json();
    console.log(`[Rejudge] Received request for task: ${data.task_id || data.upload_id}`);

    // 1. Identify record
    const taskId = data.task_id || data.upload_id;
    if (!taskId) return NextResponse.json({ error: 'taskId required' }, { status: 400 });

    const existingRecord = await prisma.execution.findUnique({ where: { id: taskId } });
    if (!existingRecord) return NextResponse.json({ error: 'Record not found' }, { status: 404 });

    // 2. Retrieve session
    const session = await prisma.session.findUnique({ where: { taskId: taskId } });
    if (!session || !session.interactions) {
        return NextResponse.json({ error: 'Session log not found. Cannot rejudge without interactions.' }, { status: 400 });
    }

    const rawInteractions = JSON.parse(session.interactions);
    const normalized = normalizeInteractions(rawInteractions);

    // 3. Extract skills if missing or force?
    let skills = existingRecord.skills ? JSON.parse(existingRecord.skills) : [];
    if (skills.length === 0) {
        if (existingRecord.framework === 'opencode') {
            skills = extractSkillsFromOpencodeSession(normalized);
        } else if (existingRecord.framework === 'claudecode' || existingRecord.framework === 'claude') {
            skills = extractSkillsFromClaudeSession(normalized);
        }
    }
    const skillName = skills[0] || (existingRecord.skill || '').trim();

        // 4. Re-judgment Logic (Same as upload logic)
    const actionUser = data.currentUser || existingRecord.user || null;
    let skillDef = undefined;
    let skillVersion = existingRecord.skillVersion || undefined;

    if (skillName) {
         try {
             // Type cast to any to avoid strict type checking issues similar to data-service.ts
             const skillRecord = await prisma.skill.findFirst({
                 where: { 
                     name: skillName,
                     OR: [
                         { user: actionUser },
                         { user: null },
                         { visibility: 'public' }
                     ]
                 },
                 include: { versions: { orderBy: { version: 'desc' }, take: 1 } }
             } as any) as any;
             
             if (skillRecord && skillRecord.versions && skillRecord.versions.length > 0) {
                 skillDef = skillRecord.versions[0].content;
                 skillVersion = skillRecord.versions[0].version;
             }
         } catch (e) {
             console.error('[Rejudge] Error fetching skill definition:', e);
         }
    }

    let criteria: any = { skill_definition: skillDef };
    const configs = await readConfig(actionUser);
    const query = existingRecord.query || '';
    const cfg = configs.find((c: any) => c.query && query && c.query.trim() === query.trim());
    
    // Critical Fix: If no config matches, do not judge (which would result in 0 score)
    if (!cfg) {
        return NextResponse.json({ 
            error: 'No matching evaluation configuration found for this query. Please ensure a valid configuration exists before re-judging.' 
        }, { status: 400 });
    }

    if (cfg) {
         criteria.root_causes = cfg.root_causes;
         criteria.key_actions = cfg.key_actions;
         criteria.standard_answer_example = cfg.standard_answer;
    }

    const judgment = await judgeAnswer(query, criteria, existingRecord.finalResult || '', actionUser);
    
    // Critical Fix: If judgment failed due to API error or missing model, do not save 0 score
    if (judgment.score === 0 && (judgment.reason?.includes('failed') || judgment.reason?.includes('disabled') || judgment.reason?.includes('禁用'))) {
         return NextResponse.json({ 
             error: `Judgment failed: ${judgment.reason}` 
         }, { status: 500 });
    }
    
    // 5. Failure Analysis
    const failureAnalysis = await analyzeFailures(
        normalized,
        skillName,
        skillDef,
        judgment.score,
        judgment.reason || '',
        query,
        existingRecord.finalResult || '',
        actionUser
    );

    // 6. Save back to Execution table
    const result = await saveExecutionRecord({
        task_id: taskId,
        skills: skills,
        skill: skillName,
        skill_version: skillVersion,
        answer_score: judgment.score,
        is_answer_correct: judgment.is_correct,
        judgment_reason: judgment.reason || 'Rejudged',
        failures: failureAnalysis.failures,
        skill_issues: failureAnalysis.skill_issues,
        force_judgment: false // Already did it above
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
