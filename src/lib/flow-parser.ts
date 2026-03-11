import { OpenAI } from "openai";
import { getProxyConfig } from './proxy-config';
import { getActiveConfig } from './server-config';
import { db } from './prisma';
import { generateFlowParsePrompt, generateExecutionMatchPrompt } from '@/prompts/flow-parse-prompt';
import fs from 'fs';
import path from 'path';

const LOG_FILE = path.join(process.cwd(), 'data', 'flow_debug.jsonl');

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

export interface FlowStep {
  id: string;
  name: string;
  description: string;
  type: 'action' | 'decision' | 'output';
  isOptional?: boolean;
}

export interface FlowBranch {
  condition: string;
  trueStepId: string;
  falseStepId: string;
}

export interface ParsedFlowResult {
  steps: FlowStep[];
  branches?: FlowBranch[];
  summary?: string;
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

export interface ExecutionMatchResult {
  matches: StepMatch[];
  summary: MatchSummary;
  analysis: string;
}

export async function parseSkillFlow(
  skillContent: string,
  skillId: string,
  version: number,
  user?: string | null
): Promise<{ success: boolean; flow?: ParsedFlowResult; mermaidCode?: string; error?: string }> {
  const { client, model } = await getLlmClient(user);
  
  if (!client || !client.apiKey) {
    return { success: false, error: "LLM 未配置或不可用" };
  }

  if (!skillContent || skillContent.trim().length === 0) {
    return { success: false, error: "Skill 内容为空" };
  }

  try {
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
    const label = sanitizeMermaidLabel(`${index + 1}. ${step.name}`);
    const nodeType = step.type === 'decision' ? '{' + label + '}' : 
                     step.type === 'output' ? '((' + label + '))' :
                     '[' + label + ']';
    lines.push(`    ${nodeId}${nodeType}`);
  });

  for (let i = 0; i < flow.steps.length - 1; i++) {
    const currentNode = `S${i + 1}`;
    const nextNode = `S${i + 2}`;
    
    const branch = flow.branches?.find(b => 
      b.trueStepId === flow.steps[i + 1]?.id || 
      b.falseStepId === flow.steps[i + 1]?.id
    );
    
    if (branch && flow.steps[i].type === 'decision') {
      lines.push(`    ${currentNode} -->|是| ${nextNode}`);
      const falseStepIndex = flow.steps.findIndex(s => s.id === branch.falseStepId);
      if (falseStepIndex !== -1 && falseStepIndex !== i + 1) {
        lines.push(`    ${currentNode} -->|否| S${falseStepIndex + 1}`);
      }
    } else {
      lines.push(`    ${currentNode} --> ${nextNode}`);
    }
  }

  lines.push('');
  lines.push('    style S1 fill:#38bdf8,color:#0f172a');
  
  const lastStep = `S${flow.steps.length}`;
  if (flow.steps[flow.steps.length - 1]?.type === 'output') {
    lines.push(`    style ${lastStep} fill:#4ade80,color:#0f172a`);
  }

  return lines.join('\n');
}

export function generateDynamicMermaidCode(
  flow: ParsedFlowResult,
  matches: StepMatch[]
): string {
  const lines: string[] = ['flowchart LR'];
  
  const statusColor: Record<string, string> = {
    'matched': '#4ade80',
    'partial': '#fbbf24',
    'unexpected': '#f87171',
    'skipped': '#94a3b8'
  };

  lines.push('    subgraph 静态预期流程');
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
  
  const actualSteps: { id: string; label: string; status: string; targetStep?: string }[] = [];
  
  const sortedMatches = [...matches].sort((a, b) => a.actualStepIndex - b.actualStepIndex);
  
  sortedMatches.forEach((match, idx) => {
    const nodeId = `A${idx + 1}`;
    const status = match.matchStatus;
    const label = sanitizeMermaidLabel(`${idx + 1}. ${match.actualAction.substring(0, 20)}`);
    actualSteps.push({
      id: nodeId,
      label,
      status,
      targetStep: match.expectedStepId
    });
    
    lines.push(`        ${nodeId}[${label}]`);
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
        const linkStyle = step.status === 'matched' ? '-.->' : '-->';
        lines.push(`    ${targetNode} ${linkStyle} ${step.id}`);
      }
    }
  });
  
  lines.push('');
  flow.steps.forEach((step, index) => {
    const nodeId = `S${index + 1}`;
    const match = matches.find(m => m.expectedStepId === step.id);
    const status = match?.matchStatus || 'skipped';
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
    return { success: false, error: "LLM 未配置或不可用" };
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
    
    const interactionSummary = summarizeInteractions(interactions);
    
    const flow: ParsedFlowResult = JSON.parse(parsedFlow.flowJson);
    
    const prompt = generateExecutionMatchPrompt(flow, interactionSummary, skillId);
    
    const response = await client.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: model,
      temperature: 0.3
    });

    const content = response.choices?.[0]?.message?.content;
    
    if (!content) {
      return { success: false, error: "LLM 返回内容为空" };
    }

    appendLog('execution_match', { executionId, skillId }, { raw_output: content });

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

    const result: ExecutionMatchResult = JSON.parse(jsonStr);
    
    const dynamicMermaid = generateDynamicMermaidCode(flow, result.matches);

    await db.upsertExecutionMatch({
      executionId,
      skillId,
      skillVersion,
      user: user || null,
      mode: 'compare',
      matchJson: JSON.stringify(result),
      staticMermaid: parsedFlow.mermaidCode,
      dynamicMermaid,
      analysisText: result.analysis,
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
    return { success: false, error: "LLM 未配置或不可用" };
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
    
    const interactionSummary = summarizeInteractions(interactions);
    
    const prompt = generateDynamicOnlyPrompt(interactionSummary);
    
    const response = await client.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: model,
      temperature: 0.3
    });

    const content = response.choices?.[0]?.message?.content;
    
    if (!content) {
      return { success: false, error: "LLM 返回内容为空" };
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

    const result: DynamicAnalysisResult = JSON.parse(jsonStr);
    
    const dynamicMermaid = generateDynamicOnlyMermaidCode(result.steps);

    await db.upsertExecutionMatch({
      executionId,
      skillId: null,
      skillVersion: null,
      user: user || null,
      mode: 'dynamic',
      matchJson: null,
      staticMermaid: null,
      dynamicMermaid,
      analysisText: null,
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

function generateDynamicOnlyPrompt(interactions: string): string {
  return `
你是一个专家，擅长分析 Agent 执行轨迹并提取执行流程。

实际执行轨迹：
---
${interactions}
---

你的任务是：
1. 分析执行轨迹，提取实际执行的步骤序列
2. 为每个步骤命名（简洁的中文描述）
3. 提供整体分析

请只用 JSON 对象回复，格式如下：
{
  "steps": [
    {
      "id": "step-1",
      "name": "简短的步骤名称（用中文）",
      "type": "action"
    }
  ],
  "analysis": "详细分析执行过程，包括：执行的主要步骤、是否有异常操作、执行效率评估、改进建议等。"
}

指南：
- "type" 可以是: "action"（做某事）, "decision"（做出选择）, "output"（产生结果）
- 步骤名称要简洁（2-5个字），必须用中文
- 根据实际交互内容提取关键步骤，忽略无关细节
- 最多10个步骤
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
