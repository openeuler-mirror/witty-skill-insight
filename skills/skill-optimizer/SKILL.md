---
name: skill-optimizer
description: Use when optimizing Agent Skill definitions, including static compliance checks, quality evaluations, and experience-based improvements based on runtime feedback.
---

# Skill 优化器 (Skill Optimizer)

## 概述 (Overview)

本技能用于优化 Agent Skill 定义文件（SKILL.md），通过静态分析、质量评估和运行时反馈来持续改进 Skill 的质量。该框架支持"冷/热"双模优化架构，确保 Skill 从语法合规到业务逻辑的全面优化。

## 优化框架架构

### 核心组件

1. **SkillOptimizer (核心控制器)**: 整个优化流程的总指挥，负责调度冷/热启动策略
2. **EvaluationAdapter (评估适配器)**: 负责对 Skill 进行全方位的"体检"，输出结构化的诊断结果
3. **ExperienceCrystallizer (经验结晶器)**: 负责处理运行时反馈，将非结构化的测试报告转化为可执行的优化建议
4. **DiagnosticMutator (诊断式变异器)**: 一个具备工具调用能力的 Agent，负责根据诊断结果对代码进行精准修改

## 优化分层

框架支持三个层次的优化，覆盖了从语法合规到业务逻辑的完整生命周期。

| 层次 | 名称 | 描述 | 适用场景 |
| :--- | :--- | :--- | :--- |
| **L1** | **Static Compliance (静态合规)** | 基于硬规则的检查，确保 Skill 符合基本的格式和规范 | 代码提交前、初次创建时 |
| **L2** | **Static Quality (静态质量)** | 基于 LLM 的软性评估，从 5 个维度分析 Skill 的逻辑质量和清晰度 | 代码审查、冷启动优化 |
| **L3** | **Dynamic Adaptation (动态适应)** | 基于运行时 Trace 和人工反馈的优化，解决实际运行中的 Edge Case 和逻辑漏洞 | 集成测试、线上运行、人工干预 |

## 评估方式

### Static Linter (静态检查器)

**检查项：**
- **YAML Frontmatter**: 检查 `name`, `description` 是否存在且格式正确（如 kebab-case）
- **Length Check**: 检查内容长度是否超过阈值（如 5000 字符），防止 Context Window 溢出
- **Header Structure**: 检查是否包含必要的章节标题

### LLM 5D Assessment (五维评估)

**五个维度 (5D)：**
1. **Role (职责)**: 角色定义是否清晰？
2. **Structure (结构)**: 格式是否规范？
3. **Instruction (指令)**: 推理逻辑 (CoT) 是否连贯？
4. **Content (内容)**: 知识库/少样本是否充分？
5. **Risk (风险)**: 安全边界和权限控制是否完备？

### Human Feedback (人工反馈/人在回路)

允许人类专家直接提供自然语言建议。该建议会被作为最高优先级的 reflection 传递给 Mutator，强制 LLM 在修改代码时遵循该指令。

### Runtime Feedback (运行时反馈)

解析测试报告中的 `skill_issues` (技能缺陷) 和 `failures` (运行时异常)，将非结构化的错误描述转化为可执行的优化建议。

## 准备工作

在运行任何优化命令之前，请先完成以下准备工作。

### 第1步：运行环境依赖检查

**Python 工具链依赖**：需要预先安装 `uv` 命令行工具。
首次运行推荐直接使用集成包装脚本，它会自动处理 Python 虚拟环境并安装依赖：

```bash
./scripts/opt.sh --help
```

如果检测到提示“未找到 'uv' 命令”，请按如下格式询问用户：

```
Question: "Skill Optimizer 需要 'uv' 作为 Python 环境管理器，但当前系统未安装。是否现在安装？"
Options: "是，执行安装命令", "否，取消操作"
```

如果用户同意，执行：
```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

### 第2步：获取模型配置

**尝试自动获取配置（推荐）**

运行模型配置检测脚本，自动从当前 AI 平台获取 API Key：

```bash
python scripts/model_config_detector.py
```

该脚本会按优先级检测以下平台：

1. **Claude Code 平台**：检测环境变量 `ANTHROPIC_AUTH_TOKEN`、`ANTHROPIC_API_KEY`、`ANTHROPIC_BASE_URL`、`ANTHROPIC_MODEL`
2. **OpenCode 平台**：运行 `node scripts/opencode-model-detector.cjs`（如果存在）
3. **Cursor/Windsurf 平台**：检测 `DEEPSEEK_API_KEY`、`OPENAI_API_KEY` 等环境变量

检测成功后，配置会自动写入本技能根目录的 `.env` 文件（即 `skills/skill-optimizer/.env`）。

**手动配置（如果自动检测失败）**

如果自动检测失败，按如下格式询问用户提供配置：

```
Question: "未找到有效的模型配置 (API Key)。请选择如何提供配置？"
Options: "方式1（推荐）：提供 DeepSeek API Key", "方式2：提供通用 LLM API Key", "取消操作"
```

用户选择后，将配置写入本技能根目录的 `.env` 文件（请注意**必须**放在 `skill-optimizer` 的首层目录中）：

```bash
# 注意：务必确保是将配置写入到 skill-optimizer 目录下的 .env 中
echo "DEEPSEEK_API_KEY=sk-xxxx" >> skills/skill-optimizer/.env
echo "DEEPSEEK_BASE_URL=https://api.deepseek.com/" >> skills/skill-optimizer/.env
echo "DEEPSEEK_MODEL=deepseek-chat" >> skills/skill-optimizer/.env
```

### 第3步：模型连通性测试

在获取到模型配置后，必须先进行模型连通性测试，以确保后续操作顺利执行：

```bash
python scripts/test_model_connectivity.py --env-file skills/skill-optimizer/.env
```

如果测试通过，再进行后续任务。

如果测试不通过，则说明模型调用可能面临网络或配置问题，请停止优化并与用户交互，提示以下选项：
```
Question: "模型连通性测试未通过，请重新配置以确保后续流程顺利进行："
Options: "获取 DeepSeek 的 api_key", "获取符合 OpenAI 规范的 LLM 的 base_Url、api_key、model_name", "取消"
```
用户提供信息后，将配置更新至 `.env` 文件，并**再次执行连通性测试脚本**。只有且必须在该连通性测试通过后，才可进入接下来的优化流程，确保后续不会有模型调用问题。

## 优化模式与使用流程

### 1. 静态优化 (Static/Cold Start)

**适用场景：** 初次创建 Skill 或仅需基于静态规则和 LLM 评估进行优化。

**执行命令：**
```bash
./scripts/opt.sh --mode static --input path/to/your/skill_dir
```

**操作步骤：**
1. 解析输入路径的 Skill.md 文件
2. 执行 Linter 静态检查（YAML 格式、长度限制等）
3. 执行 LLM 5D 质量评估
4. 生成诊断报告（Diagnoses）
5. 使用 DiagnosticMutator 进行代码修复
6. 保存优化后的 SKILL.md 和辅助文件
7. 生成 OPTIMIZATION_REPORT.md 和 diagnoses.json
8. 上传到 Witty Insight 平台并获取版本号

### 2. 动态优化 (Dynamic/Experience Crystallization)

**适用场景：** 已有运行日志 (Trace/Logs)，希望根据历史运行结果进行针对性优化。

**执行命令：**
```bash
./scripts/opt.sh --mode dynamic --input path/to/your/skill_dir
```

**操作步骤：**
1. 解析输入路径的 Skill.md 文件
2. 从 Witty Insight 平台获取历史运行日志（最近 3 条）
3. 使用 ExperienceCrystallizer 解析运行日志
4. 将运行时错误转化为优化建议
5. 使用 DiagnosticMutator 进行代码修复
6. 保存优化后的 SKILL.md 和辅助文件
7. 生成 OPTIMIZATION_REPORT.md 和 diagnoses.json
8. 上传到 Witty Insight 平台并获取版本号

### 3. 混合优化 (Hybrid)

**适用场景：** 同时执行静态评估和基于运行日志的优化。

**执行命令：**
```bash
./scripts/opt.sh --mode hybrid --input path/to/your/skill_dir
```

**操作步骤：**
1. 首先执行静态优化流程（包括人工反馈处理）
2. 然后执行热启动优化流程（基于运行日志）
3. 合并所有诊断结果
4. 保存最终优化的 Skill
5. 生成完整的优化报告
6. 上传到 Witty Insight 平台并获取版本号

### 4. 带人工反馈的优化

**适用场景：** 有人工提供的改进建议（存放在文本文件中）。

**执行命令：**
```bash
./scripts/opt.sh --mode static --input path/to/your/skill_dir --feedback path/to/feedback.txt
```

**操作步骤：**
1. 从指定路径读取人工反馈内容
2. 执行静态优化流程
3. 将人工反馈作为最高优先级的 reflection 传递给 Mutator
4. 根据人工反馈进行针对性修改
5. 保存优化结果并上传

## 环境变量配置

### LLM (大模型) 配置

**自动配置（推荐）**

运行 `python scripts/model_config_detector.py` 自动检测并配置 API Key。支持的平台：
- Claude Code（检测 `ANTHROPIC_AUTH_TOKEN` 环境变量）
- OpenCode（运行 `node scripts/opencode-model-detector.cjs`）
- Cursor/Windsurf（检测 `DEEPSEEK_API_KEY`、`OPENAI_API_KEY` 环境变量）

**手动配置**

| 变量名 | 必选 | 说明 |
| :--- | :--- | :--- |
| `DEEPSEEK_API_KEY` | 是 | DeepSeek API 密钥（若不使用 DeepSeek，可配置 `OPENAI_API_KEY`） |
| `DEEPSEEK_BASE_URL` | 否 | DeepSeek API 基础 URL，默认 `https://api.deepseek.com/` |
| `DEEPSEEK_MODEL` | 否 | 使用的模型名称，默认 `deepseek-chat` |

### Witty Insight 平台对接

用于获取历史运行日志（Dynamic 模式需要）。在获取时，优化器会自动从 `~/.witty/.env` 中的 `WITTY_INSIGHT_HOST` 读取平台服务器 IP 进行请求，不需要再在本技能下重复配置。

> **⚠️ 环境配置重要提示**：所有以上介绍的环境变量，**必须**配置在 `skills/skill-optimizer/.env` 文件中。如果不确定位置，优化器会在抛出错误时提示你预期的 `.env` 绝对路径。

### 监控与反馈 (可选)

| 变量名 | 必选 | 说明 |
| :--- | :--- | :--- |
| `LANGFUSE_PUBLIC_KEY` | 否 | Langfuse 公钥，用于记录优化 Trace |
| `LANGFUSE_SECRET_KEY` | 否 | Langfuse 私钥 |
| `HUMAN_FEEDBACK_FILE` | 否 | 默认的人工反馈文件路径 |

### 路径与策略配置 (参考)

| 变量名 | 说明 |
| :--- | :--- |
| `OPT_SKILLS_DIR` | 待优化的 Skill 默认目录路径（可选） |
| `OPT_OUTPUT_DIR` | 优化结果默认输出目录（可选） |
| `OPTIMIZATION_MAX_WORKERS` | 并行优化的最大工作线程数 |

## 输出产物

优化完成后，会在指定的输出目录（或输入目录同级）创建一个新的文件夹，命名格式为 `{original_name}-v{version}`，其中包含：

- **SKILL.md**: 优化后的技能定义文件
- **OPTIMIZATION_REPORT.md**: 详细的优化报告，记录了诊断结果和修改建议
- **diagnoses.json**: 结构化的诊断数据
- **VERSION.TXT**: 当前 Skill 的版本号
- **辅助脚本**: 优化过程中创建或更新的相关 Python/Shell 脚本

## 优化原则

### 1. Generalize, Don't Hardcode (泛化，不要硬编码)

如果特定文件路径（如 `/mnt/data/file.txt`）或进程 ID（如 `12345`）在 trace 中失败，**不要**硬编码该特定值。相反，写一个通用检查（例如，"检查所需配置文件是否存在"）。

### 2. Graceful Degradation (优雅降级)

如果非关键资源（如后台文档或可选配置）缺失，skill 不应崩溃或停止执行。添加步骤来"检查是否存在，如果不存在则警告并继续"，而不是"必须验证或停止"。仅在关键失败时阻止执行（例如，目标服务宕机）。

### 3. Atomic Steps (原子步骤)

将复杂操作分解为原子步骤（检查 -> 操作 -> 验证）。例如，不要写"终止进程"，而应写："1. 识别 PID。2. 终止 PID。3. 验证 PID 已消失。"

### 4. Use Auxiliary Files (使用辅助文件)

如果脚本或参考文档缺失或需要，创建它们！你有工具可以写入文件。不要害怕将复杂逻辑拆分为脚本或将文档移动到引用中。

## 使用示例

### 示例1：静态优化新创建的 Skill

**用户请求：** "帮我优化一下这个 Skill 文件 path/to/my-skill/SKILL.md"

**Agent响应：**
1. 运行包装脚本检查环境：`./scripts/opt.sh --help`
2. 自动获取模型配置：`python scripts/model_config_detector.py`
3. 确认输入路径指向包含 SKILL.md 的目录
4. 执行静态优化：`./scripts/opt.sh --mode static --input path/to/my-skill`
5. 等待优化完成，查看生成的优化报告
6. 询问用户是否加载到本地或上传

### 示例2：基于运行日志优化已有 Skill

**用户请求：** "这个 Skill 运行了几次有问题，帮我根据运行日志优化一下"

**Agent响应：**
1. 运行包装脚本检查环境
2. 自动获取模型配置
3. 确认 Skill 名称和路径
4. 执行动态优化：`./scripts/opt.sh --mode dynamic --input path/to/my-skill`
5. 优化器会自动获取历史运行日志
6. 返回优化结果和版本号

### 示例3：带人工反馈的优化

**用户请求：** "根据我提供的反馈优化这个 Skill，反馈内容是..."

**Agent响应：**
1. 运行包装脚本检查环境
2. 自动获取模型配置
3. 将用户的反馈内容写入临时文件
4. 执行优化：`./scripts/opt.sh --mode static --input path/to/my-skill --feedback path/to/feedback.txt`
5. 优化器会优先处理人工反馈
6. 返回优化结果

### 示例4：混合模式优化

**用户请求：** "全面优化这个 Skill，包括静态检查和运行日志分析"

**Agent响应：**
1. 运行包装脚本检查环境
2. 自动获取模型配置
3. 执行混合优化：`./scripts/opt.sh --mode hybrid --input path/to/my-skill`
4. 先执行静态优化，再执行热启动优化
5. 返回完整的优化结果

## 优化完成后的后续步骤

### 第5步：询问是否加载到本地项目（推荐）

在技能优化成功后，询问用户是否将优化后的skill直接加载到当前项目的 `.opencode/skills` 目录下，以便立即使用。

**询问方式**：

```
Question: "✅ Skill 优化完成！(位于 <output-path>/<skill-name>)。是否将此技能加载到当前项目的 .opencode/skills 目录下以便立即使用（需要重启）？"
Options: "是，加载到 .opencode/skills 目录", "否，保持当前位置"
```

**如果用户同意（加载到本地）**：

1. **确认项目结构**：检查当前项目是否有 `.opencode/skills` 目录
   ```bash
   # 检查 .opencode/skills 目录是否存在
   if [ ! -d ".opencode/skills" ]; then
       mkdir -p .opencode/skills
   fi
   ```

2. **移动技能目录**：将优化后的skill移动到 `.opencode/skills` 目录
   ```bash
   # 假设优化后的skill在 /path/to/optimized-skills/skill-name/
   # 移动到当前项目的 .opencode/skills/
   mv /path/to/optimized-skills/skill-name/ .opencode/skills/
   ```

3. **验证移动成功**：
   ```bash
   # 检查技能是否成功移动
   ls -la .opencode/skills/skill-name/
   ```

4. **提醒用户重启**：
   ```
   Question: "✅ 技能已成功加载到 .opencode/skills/<skill-name> ! 重要提示：需要重启 opencode 才能使技能生效。请选择后续操作："
   Options: "收到，我稍后会重启应用"
   ```

**如果用户不同意（保持当前位置）**：

```
Question: "✅ 技能已优化并保持在当前位置：<output-path>/<skill-name>。如需使用，请后续执行 mv <output-path>/<skill-name>/ .opencode/skills/ 移动。请选择后续操作："
Options: "收到"
```

### 第6步：上传至 Insight 平台（如果用户要求）

如果用户在优化技能的指令中明确要求**"上传"、"同步"或"保存到 Insight"**，你必须在优化完成（前述步骤结束）、验证通过且目录存在后，主动调用skill-sync技能对优化后的新技能目录进行上传处理。

**操作要求**：
1. 确认输出目录中确实生成了包含 `SKILL.md` 的技能文件夹。
2. 告知用户："正在启动 skill-sync 准备上传，由于涉及环境配置覆盖风险，我将调用系统上传组件。请关注接下来的终端询问确认。"
3. 跨技能调用 `skill-sync` 技能，通过如下路径执行：
   ```bash
   node ../skill-sync/scripts/push.js <你在这个技能里刚刚生成的绝对路径/相对路径>
   ```
4. 请不要在这个技能内处理接口或网络请求上传，这是 `skill-sync` 的专属责任。

## 诊断报告解读

优化报告 (OPTIMIZATION_REPORT.md) 包含以下信息：

### 1. 原始 Skill 概览

- Skill 名称和描述
- 原始内容的结构分析

### 2. 诊断结果列表

每个诊断项包含：
- **Dimension**: 评估维度（Role、Structure、Instruction、Content、Risk、Execution）
- **Issue Type**: 问题类型（如 Missing Section、Vague Instruction 等）
- **Severity**: 严重程度（Critical、High、Medium、Low）
- **Description**: 问题描述
- **Suggested Fix**: 建议修复方案

### 3. 优化后 Skill 概览

- 修改摘要
- 辅助文件变更列表

### 4. 版本信息

- 优化后的版本号
- 上传状态

## 故障排查

### 问题1：依赖未安装

**错误信息**：`ModuleNotFoundError: No module named 'langchain'` 或类似错误

**原因**：虚拟环境未创建或未激活，依赖未安装到正确的环境中。

**解决：**
1. 创建虚拟环境：`uv venv .opt`（只需执行一次）
2. 激活环境：`source .opt/bin/activate`（每次运行前执行）
3. 安装依赖：`uv pip install -r requirements.txt`（只需执行一次）

### 问题2：未安装 uv

**错误信息**：`uv: command not found`

**解决：**
```bash
# Linux/macOS
curl -LsSf https://astral.sh/uv/install.sh | sh

# 或使用 pip
pip install uv
```

### 问题3：API Key 未配置

**错误信息**：`Neither DEEPSEEK_API_KEY nor OPENAI_API_KEY set.`

**解决：**
1. 运行自动检测：`python scripts/model_config_detector.py`
2. 或手动编辑 `.env` 文件，填写 API Key

### 问题4：找不到 SKILL.md

**原因：** 输入路径不正确或不包含 SKILL.md 文件

**解决：**
- 确认输入路径是包含 SKILL.md 的目录，而不是 SKILL.md 文件本身
- 使用 `path/to/your/skill_dir` 而不是 `path/to/your/skill_dir/SKILL.md`

### 问题5：LLM API 调用失败

**原因：** API 密钥未配置或网络问题

**解决：**
- 检查 `.env` 文件中的 `DEEPSEEK_API_KEY` 或 `OPENAI_API_KEY`
- 确认网络连接正常
- 验证 `DEEPSEEK_BASE_URL` 设置正确

### 问题6：无法获取运行日志

**原因：** Witty Insight 平台连接失败或 Skill 名称不匹配

**解决：**
- 检查 `~/.witty/.env` 环境变量是否正确配置了 `WITTY_INSIGHT_HOST`。
- 确认 Skill 的 YAML frontmatter 中的 `name` 字段与平台注册的名称一致

### 问题7：上传失败

**原因：** 平台服务不可用或权限问题

**解决：**
- 检查平台服务状态
- 验证用户权限
- 查看错误日志中的详细信息
