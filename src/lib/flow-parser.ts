import { OpenAI } from "openai";
import { getProxyConfig } from './proxy-config';
import { getActiveConfig } from './server-config';
import { db } from './prisma';
import { generateFlowParsePrompt, generateExecutionMatchPrompt, generateStepExtractPrompt, generateDynamicOnlyMatchPrompt } from '@/prompts/flow-parse-prompt';
import fs from 'fs';
import path from 'path';

const LOG_FILE = path.join(process.cwd(), 'data', 'flow_debug.jsonl');
const BATCH_SIZE = 10;

interface LogInput {
  skillId?: string;
  version?: number;
  executionId?: string;
}

interface LogOutput {
  raw_output?: string;
}

function appendLog(stage: string, input: LogInput, output: LogOutput): void {
  try {
    const logDir = path.dirname(LOG_FILE);
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    
    const record = {
      timestamp: new Date().toISOString(),
      stage,
      input,
      output
    };
    fs.appendFileSync(LOG_FILE, JSON.stringify(record) + '\n');
  } catch (e) { 
    console.error('Log error', e); 
  }
}

async function getLlmClient(user?: string | null) {
  const config = await getActiveConfig(user);
  if (!config) {
    return { client: null, model: null };
  }

  const apiKey = config.apiKey;
  if (!apiKey) return { client: null, model: null };

  const baseURL = config.baseUrl || "https://api.deepseek.com";
  const { customFetch } = getProxyConfig();
  
  return {
    client: new OpenAI({
      apiKey, 
      baseURL,
      fetch: customFetch,
    }),
    model: config.model || "deepseek-chat"
  };
}

export type ControlFlowType = 'required' | 'conditional' | 'loop' | 'optional' | 'handoff';

export interface FlowStep {
  id: string;
  name: string;
  description: string;
  type: 'action' | 'decision' | 'output';
  isOptional?: boolean;
  controlFlowType?: ControlFlowType;
}

export interface FlowBranch {
  condition: string;
  trueStepId: string;
  falseStepId: string;
}

export interface ConditionalGroupBranch {
  label: string;
  stepIds: string[];
}

export interface ConditionalGroup {
  id: string;
  condition: string;
  branches: ConditionalGroupBranch[];
}

export interface LoopGroup {
  id: string;
  loopCondition: string;
  bodyStepIds: string[];
  expectedMinCount: number;
  expectedMaxCount: number;
}

export interface ParsedFlowResult {
  steps: FlowStep[];
  branches?: FlowBranch[];
  conditionalGroups?: ConditionalGroup[];
  loopGroups?: LoopGroup[];
  summary?: string;
}

export interface ExtractedKeyAction {
  id: string;
  content: string;
  weight: number;
  controlFlowType: ControlFlowType;
  condition?: string;
  branchLabel?: string;
  loopCondition?: string;
  expectedMinCount?: number;
  expectedMaxCount?: number;
  skillSource?: string;
  groupId?: string;
}

export interface StepMatch {
  expectedStepId?: string;
  expectedStepName?: string;
  actualStepIndex: number;
  actualAction: string;
  matchStatus: 'matched' | 'partial' | 'unexpected' | 'skipped';
  matchReason: string;
}

export interface MatchSummary {
  totalSteps: number;
  matchedSteps: number;
  unexpectedSteps: number;
  skippedSteps: number;
  orderViolations: number;
  overallScore: number;
}

export interface ProblemStep {
  stepIndex: number;
  stepName: string;
  status: 'partial' | 'unexpected' | 'skipped';
  problem: string;
  suggestion: string;
}

export interface SkippedExpectedStep {
  expectedStepId: string;
  expectedStepName: string;
}

export interface ExecutionMatchResult {
  matches: StepMatch[];
  skippedExpectedSteps: SkippedExpectedStep[];
  summary: MatchSummary;
  problemSteps: ProblemStep[];
}

export async function parseSkillFlow(
  skillContent: string,
  skillId: string,
  version: number,
  user?: string | null
): Promise<{ success: boolean; flow?: ParsedFlowResult; mermaidCode?: string; error?: string }> {
  const { client, model } = await getLlmClient(user);
  
  if (!client || !client.apiKey) {
    return { success: false, error: "请在首页左上角的设置中配置 LLM" };
  }

  if (!skillContent || skillContent.trim().length === 0) {
    return { success: false, error: "Skill 内容为空" };
  }

  try {
    await db.upsertParsedFlow({
      skillId,
      version,
      user: user || null,
      // Use empty strings for the "parsing" placeholder so legacy SQLite
      // schemas with NOT NULL columns remain compatible.
      flowJson: '',
      mermaidCode: ''
    });

    const prompt = generateFlowParsePrompt(skillContent);
    
    const response = await client.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: model,
      temperature: 0.3
    });

    const content = response.choices?.[0]?.message?.content;
    
    if (!content) {
      return { success: false, error: "LLM 返回内容为空" };
    }

    appendLog('flow_parse', { skillId, version }, { raw_output: content });

    let jsonStr = content.trim();
    const match = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (match) {
      jsonStr = match[1];
    } else {
      const first = jsonStr.indexOf('{');
      const last = jsonStr.lastIndexOf('}');
      if (first !== -1 && last !== -1 && last >= first) {
        jsonStr = jsonStr.substring(first, last + 1);
      }
    }

    const flow: ParsedFlowResult = JSON.parse(jsonStr);
    
    if (!flow.steps || !Array.isArray(flow.steps) || flow.steps.length === 0) {
      return { success: false, error: "解析结果中未找到有效步骤" };
    }

    const validStepIds = new Set(flow.steps.map(s => s.id));

    if (flow.conditionalGroups && Array.isArray(flow.conditionalGroups)) {
      for (const cg of flow.conditionalGroups) {
        if (!cg.branches || !Array.isArray(cg.branches)) {
          console.warn(`[FlowParse] ConditionalGroup ${cg.id} has invalid branches, degrading to required`);
        }
      }
    } else {
      flow.conditionalGroups = [];
    }

    if (!flow.loopGroups || !Array.isArray(flow.loopGroups)) {
      flow.loopGroups = [];
    }

    const loopBodyStepIds = new Set<string>();
    for (const lg of flow.loopGroups) {
      if (!lg.bodyStepIds || !Array.isArray(lg.bodyStepIds)) {
        console.warn(`[FlowParse] LoopGroup ${lg.id} has invalid bodyStepIds, degrading to required`);
        continue;
      }
      for (const sid of lg.bodyStepIds) {
        if (!validStepIds.has(sid)) {
          console.warn(`[FlowParse] LoopGroup ${lg.id} references invalid stepId ${sid}, degrading to required`);
        } else {
          loopBodyStepIds.add(sid);
        }
      }
    }

    const conditionalStepIds = new Set<string>();
    if (flow.conditionalGroups) {
      for (const cg of flow.conditionalGroups) {
        if (!cg.branches) continue;
        for (const branch of cg.branches) {
          if (!branch.stepIds) continue;
          for (const sid of branch.stepIds) {
            if (!validStepIds.has(sid)) {
              console.warn(`[FlowParse] ConditionalGroup ${cg.id} references invalid stepId ${sid}, degrading to required`);
            } else {
              conditionalStepIds.add(sid);
            }
          }
        }
      }
    }

    for (const step of flow.steps) {
      if (step.controlFlowType) continue;

      if (loopBodyStepIds.has(step.id)) {
        step.controlFlowType = 'loop';
      } else if (conditionalStepIds.has(step.id)) {
        step.controlFlowType = 'conditional';
      } else if (step.isOptional) {
        step.controlFlowType = 'optional';
      } else {
        step.controlFlowType = 'required';
      }
    }

    const mermaidCode = generateMermaidCode(flow);

    await db.upsertParsedFlow({
      skillId,
      version,
      user: user || null,
      flowJson: JSON.stringify(flow),
      mermaidCode
    });

    return { success: true, flow, mermaidCode };
    
  } catch (error) {
    const message = error instanceof Error ? error.message : "解析失败";
    console.error("Flow parse error:", error);
    return { success: false, error: message };
  }
}

function sanitizeMermaidLabel(label: string): string {
  return label
    .replace(/\\/g, '\\\\')
    .replace(/"/g, "'")
    .replace(/\(/g, '（')
    .replace(/\)/g, '）')
    .replace(/\[/g, '［')
    .replace(/\]/g, '］')
    .replace(/\{/g, '｛')
    .replace(/\}/g, '｝')
    .replace(/</g, '＜')
    .replace(/>/g, '＞')
    .replace(/\|/g, '｜')
    .replace(/\n/g, ' ')
    .trim();
}

export function generateMermaidCode(flow: ParsedFlowResult): string {
  const lines: string[] = ['flowchart TD'];
  
  flow.steps.forEach((step, index) => {
    const nodeId = `S${index + 1}`;
    const cfType = step.controlFlowType || 'required';
    const prefix = cfType === 'loop' ? '🔄 ' : '';
    const label = sanitizeMermaidLabel(`${prefix}${index + 1}. ${step.name}`);
    const nodeType = step.type === 'decision' ? '{' + label + '}' : 
                     step.type === 'output' ? '((' + label + '))' :
                     '[' + label + ']';
    lines.push(`    ${nodeId}${nodeType}`);
  });

  const branchStepIds = new Set<string>();
  const branchStepsMap = new Map<string, string[]>();

  if (flow.conditionalGroups) {
    for (const cg of flow.conditionalGroups) {
      for (const branch of cg.branches) {
        if (branch.stepIds && branch.stepIds.length > 0) {
          branchStepsMap.set(branch.label, branch.stepIds);
          for (const stepId of branch.stepIds) {
            branchStepIds.add(stepId);
          }
        }
      }
    }
  }

  for (let i = 0; i < flow.steps.length - 1; i++) {
    const currentStep = flow.steps[i];
    const nextStep = flow.steps[i + 1];
    const currentNode = `S${i + 1}`;
    const nextNode = `S${i + 2}`;
    
    const branch = flow.branches?.find(b => 
      b.trueStepId === nextStep?.id || 
      b.falseStepId === nextStep?.id
    );
    
    if (branch && currentStep.type === 'decision') {
      lines.push(`    ${currentNode} -->|是| ${nextNode}`);
      const falseStepIndex = flow.steps.findIndex(s => s.id === branch.falseStepId);
      if (falseStepIndex !== -1 && falseStepIndex !== i + 1) {
        lines.push(`    ${currentNode} -->|否| S${falseStepIndex + 1}`);
      }
    } else {
      const currentIsBranch = branchStepIds.has(currentStep.id);
      const nextIsBranch = branchStepIds.has(nextStep.id);

      // 【新增拦截逻辑】：防止向分支起点画出多余的默认连线
      if (!currentIsBranch && nextIsBranch) {
        continue;
      }

      if (currentIsBranch && nextIsBranch) {
        let sameBranch = false;
        for (const [_, stepIds] of branchStepsMap) {
          const currentIndex = stepIds.indexOf(currentStep.id);
          const nextIndex = stepIds.indexOf(nextStep.id);
          if (currentIndex !== -1 && nextIndex !== -1 && nextIndex === currentIndex + 1) {
            sameBranch = true;
            break;
          }
        }
        if (!sameBranch) {
          continue;
        }
      }

      lines.push(`    ${currentNode} --> ${nextNode}`);
    }
  }

  if (flow.conditionalGroups) {
    for (const cg of flow.conditionalGroups) {
      let maxStepIndex = -1;
      let minStepIndex = flow.steps.length;

      // 1. 遍历计算当前条件组在整个数组中的边界索引
      for (const branch of cg.branches) {
        if (!branch.stepIds || branch.stepIds.length === 0) continue;
        
        const firstStepIndex = flow.steps.findIndex(s => s.id === branch.stepIds[0]);
        if (firstStepIndex !== -1 && firstStepIndex < minStepIndex) {
          minStepIndex = firstStepIndex;
        }

        branch.stepIds.forEach(id => {
          const idx = flow.steps.findIndex(s => s.id === id);
          if (idx > maxStepIndex) {
            maxStepIndex = idx;
          }
        });
      }

      // 确定属于该组的 Decision 节点
      let decisionIndex = -1;
      if (minStepIndex > 0 && flow.steps[minStepIndex - 1].type === 'decision') {
          decisionIndex = minStepIndex - 1;
      } else {
          // 降级回退：找最近的一个 decision 节点
          const dStep = flow.steps.find(s => s.type === 'decision');
          if (dStep) decisionIndex = flow.steps.indexOf(dStep);
      }

      // 2. 画线：Decision 节点 -> 各个分支起始节点
      if (decisionIndex !== -1) {
        for (const branch of cg.branches) {
           if (!branch.stepIds || branch.stepIds.length === 0) continue;
           const firstStepIndex = flow.steps.findIndex(s => s.id === branch.stepIds[0]);
           if (firstStepIndex !== -1) {
               lines.push(`    S${decisionIndex + 1} -->|${branch.label}| S${firstStepIndex + 1}`);
           }
        }
      }

      // 3. 将各个分支的最后一个节点，连向后续的公共节点进行汇合
      const commonStepIndex = maxStepIndex + 1;
      if (commonStepIndex > 0 && commonStepIndex < flow.steps.length) {
        const commonNode = `S${commonStepIndex + 1}`;
        for (const branch of cg.branches) {
          if (!branch.stepIds || branch.stepIds.length === 0) continue;
          
          const lastStepId = branch.stepIds[branch.stepIds.length - 1];
          const lastStepIndex = flow.steps.findIndex(s => s.id === lastStepId);
          
          // 排除数组里自然相连的最后一个分支，避免重复画线
          if (lastStepIndex !== -1 && lastStepIndex !== commonStepIndex - 1) {
            lines.push(`    S${lastStepIndex + 1} --> ${commonNode}`);
          }
        }
      }
    }
  }

  lines.push('');
  lines.push('    style S1 fill:#38bdf8,color:#0f172a');
  
  const lastStep = `S${flow.steps.length}`;
  if (flow.steps[flow.steps.length - 1]?.type === 'output') {
    lines.push(`    style ${lastStep} fill:#4ade80,color:#0f172a`);
  }

  flow.steps.forEach((step, index) => {
    const nodeId = `S${index + 1}`;
    const cfType = step.controlFlowType || 'required';
    if (cfType === 'optional') {
      lines.push(`    style ${nodeId} stroke-dasharray: 5 5`);
    } else if (cfType === 'loop') {
      lines.push(`    style ${nodeId} fill:#a78bfa,color:#0f172a`);
    } else if (cfType === 'conditional') {
      lines.push(`    style ${nodeId} fill:#fbbf24,color:#0f172a`);
    } else if (cfType === 'handoff') {
      lines.push(`    style ${nodeId} fill:#4ade80,color:#0f172a`);
    }
  });

  return lines.join('\n');
}

export function extractKeyActionsFromFlow(flow: ParsedFlowResult): ExtractedKeyAction[] {
  const actions: ExtractedKeyAction[] = [];
  const stepIdToGroup = new Map<string, { type: ControlFlowType; group: ConditionalGroup | LoopGroup }>();

  if (flow.conditionalGroups) {
    for (const cg of flow.conditionalGroups) {
      for (const branch of cg.branches) {
        for (const stepId of branch.stepIds) {
          stepIdToGroup.set(stepId, { type: 'conditional', group: cg });
        }
      }
    }
  }

  if (flow.loopGroups) {
    for (const lg of flow.loopGroups) {
      for (const stepId of lg.bodyStepIds) {
        stepIdToGroup.set(stepId, { type: 'loop', group: lg });
      }
    }
  }

  const validStepIds = new Set(flow.steps.map(s => s.id));

  if (flow.conditionalGroups) {
    for (const cg of flow.conditionalGroups) {
      for (const branch of cg.branches) {
        for (const stepId of branch.stepIds) {
          if (!validStepIds.has(stepId)) {
            console.warn(`[FlowParse] ConditionalGroup ${cg.id} references invalid stepId ${stepId}, degrading to required`);
            stepIdToGroup.delete(stepId);
          }
        }
      }
    }
  }

  if (flow.loopGroups) {
    for (const lg of flow.loopGroups) {
      for (const stepId of lg.bodyStepIds) {
        if (!validStepIds.has(stepId)) {
          console.warn(`[FlowParse] LoopGroup ${lg.id} references invalid stepId ${stepId}, degrading to required`);
          stepIdToGroup.delete(stepId);
        }
      }
    }
  }

  const branchCountMap = new Map<string, number>();
  if (flow.conditionalGroups) {
    for (const cg of flow.conditionalGroups) {
      branchCountMap.set(cg.id, cg.branches.length);
    }
  }

  for (const step of flow.steps) {
    const groupInfo = stepIdToGroup.get(step.id);

    if (step.isOptional && !groupInfo) {
      actions.push({
        id: step.id,
        content: step.name,
        weight: 0,
        controlFlowType: 'optional',
      });
      continue;
    }

    if (groupInfo?.type === 'conditional') {
      const cg = groupInfo.group as ConditionalGroup;
      const branch = cg.branches.find(b => b.stepIds.includes(step.id));
      const branchCount = branchCountMap.get(cg.id) || 1;
      actions.push({
        id: step.id,
        content: step.name,
        weight: 1.0 / branchCount,
        controlFlowType: 'conditional',
        condition: cg.condition,
        branchLabel: branch?.label,
        groupId: cg.id,
      });
      continue;
    }

    if (groupInfo?.type === 'loop') {
      const lg = groupInfo.group as LoopGroup;
      actions.push({
        id: step.id,
        content: step.name,
        weight: 1.0,
        controlFlowType: 'loop',
        loopCondition: lg.loopCondition,
        expectedMinCount: lg.expectedMinCount,
        expectedMaxCount: lg.expectedMaxCount,
        groupId: lg.id,
      });
      continue;
    }

    if (step.isOptional) {
      actions.push({
        id: step.id,
        content: step.name,
        weight: 0,
        controlFlowType: 'optional',
      });
      continue;
    }

    actions.push({
      id: step.id,
      content: step.name,
      weight: 1.0,
      controlFlowType: 'required',
    });
  }

  return actions;
}

export function mergeKeyActionsFromMultipleSkills(
  skills: { name: string; actions: ExtractedKeyAction[] }[]
): ExtractedKeyAction[] {
  const merged: ExtractedKeyAction[] = [];

  for (let i = 0; i < skills.length; i++) {
    const { name, actions } = skills[i];

    for (const action of actions) {
      merged.push({
        ...action,
        id: `${name}-${action.id}`,
        skillSource: name,
      });
    }

    if (i < skills.length - 1) {
      const nextName = skills[i + 1].name;
      merged.push({
        id: `handoff-${name}-to-${nextName}`,
        content: `从 ${name} 输出衔接至 ${nextName} 输入`,
        weight: 1.0,
        controlFlowType: 'handoff',
        skillSource: `${name}->${nextName}`,
      });
    }
  }

  return merged;
}

export function generateDynamicMermaidCode(
  flow: ParsedFlowResult,
  matches: StepMatch[],
  skippedExpectedSteps: SkippedExpectedStep[],
  extractedSteps: ExtractedStep[]
): string {
  const lines: string[] = ['flowchart LR'];
  
  const statusColor: Record<string, string> = {
    'matched': '#4ade80',
    'partial': '#fbbf24',
    'unexpected': '#f87171',
    'skipped': '#94a3b8'
  };

  lines.push('    subgraph Skill流程');
  lines.push('        direction LR');
  
  flow.steps.forEach((step, index) => {
    const nodeId = `S${index + 1}`;
    const label = sanitizeMermaidLabel(`${index + 1}. ${step.name}`);
    const nodeType = step.type === 'decision' ? '{' + label + '}' : 
                     step.type === 'output' ? '((' + label + '))' :
                     '[' + label + ']';
    lines.push(`        ${nodeId}${nodeType}`);
  });
  
  for (let i = 0; i < flow.steps.length - 1; i++) {
    const currentNode = `S${i + 1}`;
    const nextNode = `S${i + 2}`;
    lines.push(`        ${currentNode} --> ${nextNode}`);
  }
  lines.push('    end');
  
  lines.push('');
  lines.push('    subgraph 实际执行轨迹');
  lines.push('        direction LR');
  
  const actualSteps: { id: string; label: string; status: string; targetStep?: string; dialogIndex: number; type: string }[] = [];
  
  const validMatches = matches.filter(m => m.matchStatus !== 'skipped');
  const sortedMatches = [...validMatches].sort((a, b) => a.actualStepIndex - b.actualStepIndex);
  
  sortedMatches.forEach((match, idx) => {
    const nodeId = `A${idx + 1}`;
    const status = match.matchStatus;
    const dialogIndex = match.actualStepIndex;
    const label = sanitizeMermaidLabel(`#${dialogIndex} ${match.actualAction}`);
    
    // 从 extractedSteps 获取步骤类型
    const extractedStep = extractedSteps.find(s => 
      s.dialogStartIndex <= dialogIndex && s.dialogEndIndex >= dialogIndex
    );
    const stepType = extractedStep?.type || 'action';
    
    actualSteps.push({
      id: nodeId,
      label,
      status,
      targetStep: match.expectedStepId,
      dialogIndex,
      type: stepType
    });
    
    // 根据类型生成不同形状的节点
    const nodeType = stepType === 'decision' ? '{' + label + '}' : 
                     stepType === 'output' ? '((' + label + '))' :
                     '[' + label + ']';
    lines.push(`        ${nodeId}${nodeType}`);
  });
  
  if (actualSteps.length > 1) {
    for (let i = 0; i < actualSteps.length - 1; i++) {
      lines.push(`        ${actualSteps[i].id} --> ${actualSteps[i + 1].id}`);
    }
  }
  lines.push('    end');
  
  lines.push('');
  actualSteps.forEach((step) => {
    if (step.status !== 'unexpected' && step.targetStep) {
      const targetIndex = flow.steps.findIndex(s => s.id === step.targetStep);
      if (targetIndex !== -1) {
        const targetNode = `S${targetIndex + 1}`;
        lines.push(`    ${targetNode} -.- ${step.id}`);
      }
    }
  });
  
  lines.push('');
  flow.steps.forEach((step, index) => {
    const nodeId = `S${index + 1}`;
    const isSkipped = skippedExpectedSteps.some(s => s.expectedStepId === step.id);
    const partialMatch = matches.find(m => m.expectedStepId === step.id && m.matchStatus === 'partial');
    
    let status: string;
    if (isSkipped) {
      status = 'skipped';
    } else if (partialMatch) {
      status = 'partial';
    } else {
      status = 'matched';
    }
    
    const color = statusColor[status];
    lines.push(`    style ${nodeId} fill:${color},color:#0f172a`);
  });
  
  actualSteps.forEach((step) => {
    const color = statusColor[step.status];
    lines.push(`    style ${step.id} fill:${color},color:#0f172a`);
  });

  return lines.join('\n');
}

interface InteractionMessage {
  role?: string;
  content?: string | InteractionContent[];
}

interface InteractionContent {
  type: string;
  text?: string;
  name?: string;
}

export async function analyzeExecutionMatch(
  executionId: string,
  skillId: string,
  skillVersion: number,
  user?: string | null
): Promise<{ success: boolean; result?: ExecutionMatchResult; staticMermaid?: string; dynamicMermaid?: string; interactionCount?: number; error?: string }> {
  const { client, model } = await getLlmClient(user);
  
  if (!client || !client.apiKey) {
    return { success: false, error: "请在首页左上角的设置中配置 LLM" };
  }

  try {
    const parsedFlow = await db.findParsedFlow(skillId, skillVersion, user || null);
    
    if (!parsedFlow) {
      return { success: false, error: "请先解析 Skill 流程" };
    }

    const session = await db.findSessionByTaskId(executionId);
    if (!session || !session.interactions) {
      return { success: false, error: "未找到执行记录或交互数据" };
    }

    let interactions: InteractionMessage[];
    try {
      interactions = typeof session.interactions === 'string' 
        ? JSON.parse(session.interactions) 
        : session.interactions;
    } catch {
      return { success: false, error: "交互数据解析失败" };
    }

    const interactionCount = Array.isArray(interactions) ? interactions.length : 0;
    
    const flow: ParsedFlowResult = JSON.parse(parsedFlow.flowJson);
    
    // 不继承动态轨迹数据，每次都重新分析
    const allExtractedSteps = await extractStepsInBatches(client, model, interactions);
    const mergedSteps = mergeSteps(allExtractedSteps);
    
    // 统一匹配
    const result = await matchStepsWithFlow(client, model, flow, mergedSteps, skillId);
    
    const dynamicMermaid = generateDynamicMermaidCode(flow, result.matches, result.skippedExpectedSteps, mergedSteps);

    await db.upsertExecutionMatch({
      executionId,
      skillId,
      skillVersion,
      user: user || null,
      mode: 'compare',
      matchJson: JSON.stringify(result),
      staticMermaid: parsedFlow.mermaidCode,
      dynamicMermaid,
      analysisText: JSON.stringify(result.problemSteps),
      extractedSteps: JSON.stringify(mergedSteps),
      interactionCount
    });

    return { 
      success: true, 
      result, 
      staticMermaid: parsedFlow.mermaidCode, 
      dynamicMermaid,
      interactionCount
    };
    
  } catch (error) {
    const message = error instanceof Error ? error.message : "分析失败";
    console.error("Execution match error:", error);
    return { success: false, error: message };
  }
}

async function extractStepsInBatches(
  client: OpenAI,
  model: string,
  interactions: InteractionMessage[]
): Promise<ExtractedStep[]> {
  if (!Array.isArray(interactions) || interactions.length === 0) {
    return [];
  }

  const batches: InteractionMessage[][] = [];
  for (let i = 0; i < interactions.length; i += BATCH_SIZE) {
    batches.push(interactions.slice(i, i + BATCH_SIZE));
  }

  const batchPromises = batches.map(async (batch, batchIndex) => {
    const startIndex = batchIndex * BATCH_SIZE;
    const batchSummary = summarizeBatch(batch, startIndex);
    const prompt = generateStepExtractPrompt(batchSummary, batchIndex, startIndex);
    
    try {
      const response = await client.chat.completions.create({
        messages: [{ role: "user", content: prompt }],
        model: model,
        temperature: 0.3
      });

      const content = response.choices?.[0]?.message?.content;
      if (!content) return [];

      let jsonStr = content.trim();
      const match = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
      if (match) {
        jsonStr = match[1];
      } else {
        const first = jsonStr.indexOf('{');
        const last = jsonStr.lastIndexOf('}');
        if (first !== -1 && last !== -1 && last >= first) {
          jsonStr = jsonStr.substring(first, last + 1);
        }
      }

      const result: BatchExtractResult = JSON.parse(jsonStr);
      return result.steps || [];
    } catch (e) {
      console.error(`Batch ${batchIndex} extract error:`, e);
      return [];
    }
  });

  const results = await Promise.all(batchPromises);
  return results.flat();
}

function summarizeBatch(batch: InteractionMessage[], startIndex: number): string {
  const summaries: string[] = [];
  
  batch.forEach((interaction, idx) => {
    const globalIndex = startIndex + idx;
    const role = interaction.role || 'unknown';
    
    let content = '';
    if (typeof interaction.content === 'string') {
      content = interaction.content.substring(0, 300);
    } else if (Array.isArray(interaction.content)) {
      const textParts = interaction.content
        .filter((c: InteractionContent) => c.type === 'text')
        .map((c: InteractionContent) => c.text || '')
        .join(' ');
      content = textParts.substring(0, 300);
      
      const toolCalls = interaction.content.filter((c: InteractionContent) => 
        c.type === 'toolCall' || c.type === 'tool_use'
      );
      if (toolCalls.length > 0) {
        content += ` [工具调用: ${toolCalls.map((t: InteractionContent) => t.name).join(', ')}]`;
      }
    }
    
    summaries.push(`[${globalIndex}] ${role.toUpperCase()}: ${content}${content.length >= 300 ? '...' : ''}`);
  });

  return summaries.join('\n');
}

function mergeSteps(steps: ExtractedStep[]): ExtractedStep[] {
  if (steps.length === 0) {
    return [];
  }

  return [...steps].sort((a, b) => a.dialogStartIndex - b.dialogStartIndex);
}

async function matchStepsWithFlow(
  client: OpenAI,
  model: string,
  flow: ParsedFlowResult,
  steps: ExtractedStep[],
  skillId: string
): Promise<ExecutionMatchResult> {
  const stepsJson = JSON.stringify(steps, null, 2);
  const prompt = generateExecutionMatchPrompt(flow, stepsJson, skillId);

  const response = await client.chat.completions.create({
    messages: [{ role: "user", content: prompt }],
    model: model,
    temperature: 0.3
  });

  const content = response.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("LLM 返回内容为空");
  }

  appendLog('execution_match', { skillId }, { raw_output: content });

  let jsonStr = content.trim();
  const match = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (match) {
    jsonStr = match[1];
  } else {
    const first = jsonStr.indexOf('{');
    const last = jsonStr.lastIndexOf('}');
    if (first !== -1 && last !== -1 && last >= first) {
      jsonStr = jsonStr.substring(first, last + 1);
    }
  }

  return JSON.parse(jsonStr);
}

function summarizeInteractions(interactions: InteractionMessage[]): string {
  if (!Array.isArray(interactions) || interactions.length === 0) {
    return "无交互记录";
  }

  const summaries: string[] = [];
  
  interactions.forEach((interaction, index) => {
    const msg = interaction;
    const role = msg.role || 'unknown';
    
    let content = '';
    if (typeof msg.content === 'string') {
      content = msg.content.substring(0, 200);
    } else if (Array.isArray(msg.content)) {
      const textParts = msg.content
        .filter((c: InteractionContent) => c.type === 'text')
        .map((c: InteractionContent) => c.text || '')
        .join(' ');
      content = textParts.substring(0, 200);
      
      const toolCalls = msg.content.filter((c: InteractionContent) => 
        c.type === 'toolCall' || c.type === 'tool_use'
      );
      if (toolCalls.length > 0) {
        content += ` [工具调用: ${toolCalls.map((t: InteractionContent) => t.name).join(', ')}]`;
      }
    }
    
    summaries.push(`[${index}] ${role.toUpperCase()}: ${content}${content.length >= 200 ? '...' : ''}`);
  });

  return summaries.join('\n');
}

export async function getParsedFlow(skillId: string, version: number, user?: string | null) {
  return db.findParsedFlow(skillId, version, user || null);
}

export async function getExecutionMatch(executionId: string) {
  return db.findExecutionMatch(executionId);
}

interface DynamicStep {
  id: string;
  name: string;
  type: 'action' | 'decision' | 'output';
}

interface ExtractedStep {
  name: string;
  description: string;
  dialogStartIndex: number;
  dialogEndIndex: number;
  type: 'action' | 'decision' | 'output';
}

interface BatchExtractResult {
  steps: ExtractedStep[];
}

interface DynamicAnalysisResult {
  steps: DynamicStep[];
  analysis: string;
}

export async function analyzeDynamicOnly(
  executionId: string,
  user?: string | null
): Promise<{ success: boolean; dynamicMermaid?: string; analysisText?: string; interactionCount?: number; error?: string }> {
  const { client, model } = await getLlmClient(user);
  
  if (!client || !client.apiKey) {
    return { success: false, error: "请在首页左上角的设置中配置 LLM" };
  }

  try {
    const session = await db.findSessionByTaskId(executionId);
    if (!session || !session.interactions) {
      return { success: false, error: "未找到执行记录或交互数据" };
    }

    let interactions: InteractionMessage[];
    try {
      interactions = typeof session.interactions === 'string' 
        ? JSON.parse(session.interactions) 
        : session.interactions;
    } catch {
      return { success: false, error: "交互数据解析失败" };
    }

    const interactionCount = Array.isArray(interactions) ? interactions.length : 0;

    await db.upsertExecutionMatch({
      executionId,
      skillId: null,
      skillVersion: null,
      user: user || null,
      mode: 'dynamic',
      matchJson: null,
      staticMermaid: null,
      dynamicMermaid: null,
      analysisText: null,
      extractedSteps: null,
      interactionCount
    });
    
    // 使用分批并行提取步骤（与 Skill 对比相同的逻辑）
    const allExtractedSteps = await extractStepsInBatches(client, model, interactions);
    const mergedSteps = mergeSteps(allExtractedSteps);
    
    // 调用匹配 LLM 生成 actualAction（使用与 Skill 对比相同规则的提示词）
    const matchResult = await generateDynamicOnlyMatchResult(client, model, mergedSteps);
    
    // 生成 Mermaid 图
    const dynamicMermaid = generateActualTrajectoryMermaidCode(matchResult.matches, mergedSteps);

    // 保存提取的步骤数据
    const stepsJson = JSON.stringify(mergedSteps);
    
    await db.upsertExecutionMatch({
      executionId,
      skillId: null,
      skillVersion: null,
      user: user || null,
      mode: 'dynamic',
      matchJson: JSON.stringify(matchResult),
      staticMermaid: null,
      dynamicMermaid,
      analysisText: null,
      extractedSteps: stepsJson,
      interactionCount
    });

    return { 
      success: true, 
      dynamicMermaid,
      interactionCount
    };
    
  } catch (error) {
    const message = error instanceof Error ? error.message : "分析失败";
    console.error("Dynamic analysis error:", error);
    return { success: false, error: message };
  }
}

interface DynamicOnlyMatchResult {
  matches: {
    actualStepIndex: number;
    actualAction: string;
    type: 'action' | 'decision' | 'output';
  }[];
}

async function generateDynamicOnlyMatchResult(
  client: OpenAI,
  model: string,
  steps: ExtractedStep[]
): Promise<DynamicOnlyMatchResult> {
  const stepsJson = JSON.stringify(steps, null, 2);
  const prompt = generateDynamicOnlyMatchPrompt(stepsJson);

  const response = await client.chat.completions.create({
    messages: [{ role: "user", content: prompt }],
    model: model,
    temperature: 0.3
  });

  const content = response.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("LLM 返回内容为空");
  }

  let jsonStr = content.trim();
  const match = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (match) {
    jsonStr = match[1];
  } else {
    const first = jsonStr.indexOf('{');
    const last = jsonStr.lastIndexOf('}');
    if (first !== -1 && last !== -1 && last >= first) {
      jsonStr = jsonStr.substring(first, last + 1);
    }
  }

  return JSON.parse(jsonStr);
}

function generateActualTrajectoryMermaidCode(
  matches: DynamicOnlyMatchResult['matches'],
  extractedSteps: ExtractedStep[]
): string {
  const lines: string[] = ['flowchart LR'];
  
  matches.forEach((match, index) => {
    const nodeId = `S${index + 1}`;
    const dialogIndex = match.actualStepIndex;
    const label = sanitizeMermaidLabel(`#${dialogIndex} ${match.actualAction}`);
    const nodeType = match.type === 'decision' ? '{' + label + '}' : 
                     match.type === 'output' ? '((' + label + '))' :
                     '[' + label + ']';
    lines.push(`    ${nodeId}${nodeType}`);
  });

  for (let i = 0; i < matches.length - 1; i++) {
    const currentNode = `S${i + 1}`;
    const nextNode = `S${i + 2}`;
    lines.push(`    ${currentNode} --> ${nextNode}`);
  }

  // 添加颜色样式
  lines.push('');
  matches.forEach((match, index) => {
    const nodeId = `S${index + 1}`;
    const color = '#38bdf8'; // 蓝色
    lines.push(`    style ${nodeId} fill:${color},color:#0f172a`);
  });

  return lines.join('\n');
}

function generateDynamicOnlyPrompt(interactions: string): string {
  return `
你是一个专家，擅长分析 Agent 执行轨迹并提取执行流程。

实际执行轨迹：
---
${interactions}
---

你的任务是：
1. 分析执行轨迹，提取实际执行的步骤序列
2. 为每个步骤命名（具体、明确的中文描述）
3. 提供整体分析

步骤提取规则：

一、步骤划分原则
1. 完整性：一个步骤完成一个完整的子任务
2. 独立性：一个步骤可以独立理解和描述
3. 目的性：每个步骤有明确的业务目标
4. 原子性：步骤内部的操作是紧密相关的，不应再拆分

二、命名规范
1. 格式：动词 + 对象 + （可选）目的/结果
2. 必须具体、明确，禁止模糊命名
3. 正确示例：
   - "读取配置文件获取数据库连接参数"
   - "调用天气API获取城市天气数据"
   - "解析用户输入提取意图和实体"
4. 禁止示例：
   - "检查配置"（太模糊，应说明检查什么）
   - "分析结果"（太抽象，应说明分析什么结果）
   - "处理数据"（太笼统，应说明处理什么数据）

三、步骤类型
- action：执行操作（如：读取文件、调用API、写入数据库）
- decision：做出判断（如：判断权限、检查条件、验证数据）
- output：输出结果（如：生成报告、返回结果、输出错误信息）

四、步骤数量
- 不限制数量，但相似的连续操作应合并为一个步骤
- 同一操作多次执行（可能因为某些报错）应总结成一个步骤
- 每个步骤都应该有独立存在的价值

请只用 JSON 对象回复，格式如下：
{
  "steps": [
    {
      "id": "step-1",
      "name": "具体的步骤名称（动词+对象格式）",
      "type": "action"
    }
  ],
  "analysis": "详细分析执行过程，包括：执行的主要步骤、是否有异常操作、执行效率评估、改进建议等。"
}
`;
}

function generateDynamicOnlyMermaidCode(steps: DynamicStep[]): string {
  const lines: string[] = ['flowchart LR'];
  
  steps.forEach((step, index) => {
    const nodeId = `S${index + 1}`;
    const label = sanitizeMermaidLabel(`${index + 1}. ${step.name}`);
    const nodeType = step.type === 'decision' ? '{' + label + '}' : 
                     step.type === 'output' ? '((' + label + '))' :
                     '[' + label + ']';
    lines.push(`    ${nodeId}${nodeType}`);
  });

  for (let i = 0; i < steps.length - 1; i++) {
    const currentNode = `S${i + 1}`;
    const nextNode = `S${i + 2}`;
    lines.push(`    ${currentNode} --> ${nextNode}`);
  }

  lines.push('');
  
  steps.forEach((step, index) => {
    const nodeId = `S${index + 1}`;
    if (step.type === 'output') {
      lines.push(`    style ${nodeId} fill:#4ade80,color:#0f172a`);
    } else if (step.type === 'decision') {
      lines.push(`    style ${nodeId} fill:#fbbf24,color:#0f172a`);
    } else {
      lines.push(`    style ${nodeId} fill:#38bdf8,color:#0f172a`);
    }
  });

  return lines.join('\n');
}
