---
name: skill-generator
description: >
  从需求描述或文档自动生成符合规范的 Agent Skills。
  当用户表达以下意图时使用：
  - 说"生成一个 [主题] 的 skill"、"帮我做个 skill"
  - 提供故障模式/失效模型/故障案例，想生成诊断类 skill
  - 提供文档（PDF/MD/TXT）或 URL，想从中提取生成 skill
  - 说"把这些场景做成 skill"、"从文档创建技能"
---

# Skill Generator

从需求描述或文档生成符合规范的 Agent Skills。

## 什么是 Skill

Skill 是给 AI Agent 动态加载的**指令目录**，遵循 Agent Skills 开放标准（agentskills.io）。

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

完整的输出规范见 `references/skill-template.md`。

## 核心指令

### Step 1：场景识别

根据用户输入判断场景：

| 输入信号 | 场景 | 加载模块 |
|---|---|---|
| 故障/排查/异常/告警/故障模式 | 故障诊断 | `references/scenarios/fault-diagnosis.md` |
| 其他（指定主题/通用需求/直接描述 Skill 内容） | 通用 | `references/scenarios/general.md` |

**关于文档输入的判断**：用户提供文档（PDF/MD/TXT）或 URL 链接时，根据内容和意图判断：
- 文档内容是故障案例、排障记录、告警分析 → 故障诊断场景
- 文档内容是其他（部署指南、API 文档、操作手册等）→ 通用场景

如果单从用户描述实在无法判断，询问用户："需要生成故障排查相关的 skill，还是通用类型的？"不要默认走故障诊断。

### Step 2：加载规范和场景模块

按以下顺序读取：

1. **先读取** `references/skill-template.md` — 标准输出规范（frontmatter 格式、章节结构、约束条件）
2. **再读取**对应的场景模块文件 — 该场景的完整工作流

### Step 3：执行场景工作流

按已加载的场景模块中的步骤执行。**不要跳步，不要提前开始生成。**

### Step 4：验证输出

生成完成后，运行验证脚本：

```bash
bash scripts/validate_skill.sh <生成的skill目录路径>
```

- 全部 ✅ → 告知用户完成，附上输出路径
- 有 ❌ → 根据失败项逐一修正，再次验证，直到通过
- 只有 ⚠️ → 告知用户警告内容，询问是否需要补充

## 参考文件说明

- `scripts/validate_skill.sh`：Skill 输出合规验证器
- `scripts/parse_doc.py`：文档解析脚本（PDF/MD/TXT 文本提取，故障诊断场景路径 B 使用）
- `references/skill-template.md`：所有场景共用的标准输出规范
- `references/scenarios/fault-diagnosis.md`：故障诊断场景工作流
- `references/scenarios/general.md`：通用场景工作流
- `templates/fault-diagnosis/_lib.sh`：排查脚本通用函数库（hit/miss/timeline 等）
- `templates/fault-diagnosis/triage_prompt.md`：排查决策树生成的 Prompt 参考
- `templates/fault-diagnosis/output_structure.md`：排查型 Skill 的产出目录结构规范
- `templates/fault-diagnosis/quality_scan.md`：故障模式质量扫描详细规则