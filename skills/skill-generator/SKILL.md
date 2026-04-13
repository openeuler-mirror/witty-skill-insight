---
name: skill-generator
description: >
  从文档或结构化知识自动生成符合规范的 Agent Skills / 技能。
  当用户表达以下意图时使用：
  - 说"生成一个 [主题] 的 skill"
  - 提供故障模式列表/失效模型，想生成 skill
  - 提供单个或多个文档（PDF/MarkDown/TXT）或 URL，想生成可用的 skill
  - 说"把这些故障场景做成 skill"、"从文档创建技能"、"合并这些案例为一个技能"
---

# Skill Generator

## 概述 (Overview)

从文档或结构化知识生成符合规范的 Agent Skills。

### 什么是 Skill

Skill 是一个给 AI Agent 动态加载的**指令目录**，遵循 Agent Skills 开放标准（agentskills.io）。

核心机制——**渐进式加载 (Progressive Disclosure)**：
1. Agent 只看 `name` + `description`（~100 tokens）决定是否激活
2. 激活后加载 `SKILL.md` 主体（< 500 行）
3. 按需读取 `scripts/` 和 `references/` 下的文件

标准目录结构：
```
skill-name/
  SKILL.md          # 必需：技能主文档（含 YAML frontmatter + 操作指令）
  scripts/          # 可选：可执行脚本（幂等、只读优先）
  references/       # 可选：参考文档（Agent 按需懒加载）
```

> 完整的输出规范见 `references/skill-template.md`。

## 核心指令 (Core Instructions)

### Step 1：场景识别

根据用户输入判断场景：

| 输入信号 | 场景 | 加载模块 |
|---|---|---|
| 故障/排查/异常/告警/OOM/宕机/失效模型/故障模式/故障案例/从文档生成/PDF/URL/Pipeline | 诊断技能生成 | `references/scenarios/fault-diagnosis.md` |
| 其他（指定主题/通用需求/直接描述 Skill 内容） | 通用 | `references/scenarios/general.md` |

> 如果无法判断场景，询问用户："请问您的输入是故障案例/故障模式，还是其他类型的系统操作或管理需求？"

### Step 2：加载规范和场景模块

按以下顺序读取：

1. **先读取** `references/skill-template.md` — 了解标准输出规范（frontmatter 格式、章节结构、约束条件）
2. **再读取**对应的场景模块文件 — 了解该场景的完整工作流

这样在后续生成时，产出直接符合规范，无需二次调整。

### Step 3：执行场景工作流

按已加载的场景模块中的步骤执行。**不要跳步，不要提前开始生成。**

### Step 4：验证输出合规性

生成完成后，对产出目录运行验证脚本：

```bash
bash scripts/validate_skill.sh <生成的skill目录路径>
```

**根据验证结果处理：**
- 全部 ✅ → 告知用户完成，附上输出路径
- 有 ❌ → 根据失败项逐一修正，再次验证，直到通过
- 只有 ⚠️ → 告知用户警告内容，询问是否需要补充

## 参考文件说明

- `scripts/validate_skill.sh`：**Skill 输出合规验证器**（验证 frontmatter 格式、章节结构、行数、脚本语法等，生成后必须运行）
- `references/skill-template.md`：所有场景共用的标准输出规范（frontmatter 格式、章节结构、约束条件）
- `references/scenarios/fault-diagnosis.md`：诊断技能场景统一工作流（适用于任意非结构化自然语言、文档知识或结构化故障清单，内置交互式扩展和智能归纳）
- `references/scenarios/general.md`：通用场景工作流（Agent 驱动：需求理解 → 知识搜集 → 结构设计 → 确认 → 生成，适合任意非诊断主题的 Skill）
- `templates/fault-diagnosis/_lib.sh`：排查脚本通用函数库（hit/miss/timeline等）
- `templates/fault-diagnosis/triage_prompt.md`：排查决策树生成的 LLM Prompt 参考
- `templates/fault-diagnosis/output_structure.md`：排查型 Skill 的产出目录结构规范
- `templates/fault-diagnosis/quality_scan.md`：故障模式质量扫描详细规则
