import { readConfig, readRecords } from '@/lib/data-service';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const skillName = searchParams.get('skill');
    const skillVersionParam = searchParams.get('skill_version'); // e.g., "v1"
    const limitStr = searchParams.get('limit');
    let limit = 10;

    const user = searchParams.get('user') || undefined;

    if (!skillName) {
      return NextResponse.json({ error: 'Skill name is required' }, { status: 400 });
    }

    if (limitStr) {
        const parsed = parseInt(limitStr, 10);
        if (!isNaN(parsed) && parsed > 0) {
            limit = parsed;
        }
    }

    const records = await readRecords(user);
    const configs = await readConfig(user);
    
    // Create a map for quick config lookup by query
    const configMap = new Map();
    configs.forEach(c => {
        const criteria = {
            root_causes: c.root_causes || [],
            key_actions: c.key_actions || []
        };
        // Store by full query
        configMap.set(c.query, criteria);
        // Also store by clean query if it contains a pipe
        if (c.query.includes('|')) {
            configMap.set(c.query.split('|')[0], criteria);
        }
    });
    
    // Filter records
    const filtered = records.filter(r => {
        const inList = r.skills?.some(s => s === skillName);
        const inSingle = r.skill === skillName;
        if (!inList && !inSingle) return false;

        // Skill Version Filter (v1, v2, etc.)
        if (skillVersionParam) {
             const versionNum = parseInt(skillVersionParam.replace(/^v/, ''), 10);
             if (!isNaN(versionNum) && r.skill_version !== undefined) {
                 return r.skill_version === versionNum;
             }
             return false;
        }

        return true;
    });

    // Sort by timestamp descending (newest first)
    filtered.sort((a, b) => {
        const tA = new Date(a.timestamp || 0).getTime();
        const tB = new Date(b.timestamp || 0).getTime();
        return tB - tA;
    });

    const result = filtered.slice(0, limit).map(r => {
        // Construct display label
        const verStr = r.skill_version !== undefined ? `v${r.skill_version}` : '';
        const displayLabel = r.label || verStr;
        
        // Get criteria from configMap
        const criteria = configMap.get(r.query) || { root_causes: [], key_actions: [] };

        return {
            timestamp: r.timestamp,
            query: r.query,
            final_result: r.final_result,
            answer_score: r.answer_score,
            judgment_reason: r.judgment_reason,
            failures: r.failures || [],
            skill_issues: r.skill_issues || [],
            label: displayLabel || null,
            skill_version: r.skill_version,
            criteria: criteria // Added: root_causes and key_actions
        };
    });

    return NextResponse.json(result);

  } catch (error) {
    console.error('Skill logs fetch error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
