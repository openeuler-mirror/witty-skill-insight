---
name: skill-generator
description: 从文档生成Agent Skills。支持单文档生成或多文档合并模式，能够从PDF、Markdown、HTML、TXT或URL提取知识，自动生成符合规范的skill。
---

# Skill Generator

从文档自动生成Agent Skills，使用LLM提取知识。支持将多个相关文档（如故障案例）合并为一个综合技能。

## 何时使用

当用户提出以下类型请求时触发此技能：

- "生成一个[主题]的skill"
- "将这些文档合并为一个技能"
- "从[文档1]和[文档2]创建skill"
- "帮我写个关于[主题]的技能"
- "把[文档]转换成agent skill"
- 直接提供文档路径要求生成skill

**关键触发词**：skill、技能、生成、创建、合并、从文档、PDF、Markdown

## 工作流程

### 第1步：运行环境依赖检查

**Python 工具链依赖**：需要预先安装 `uv` 命令行工具。
首次运行推荐直接使用下方的集成包装脚本，它会自动处理 Python 虚拟环境（Virtual Environment）并在其中安装 `requirements.txt` 里的所有依赖：

```bash
# 检测 uv 以及自动安装所需依赖环境，直接透传参数给 Python 命令行程序
./scripts/gen.sh --help
```

如果检测到提示“未找到 'uv' 命令”，请先通过终端引导用户手动安装 uv：
```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```
(安装完成后请用户打开新终端或者自行 `source` 相关环境变量以使其生效)。

### 第2步：获取模型配置

**尝试从 AI 平台获取配置（优先级最高）**

首先需要判断当前所在的 AI 平台或工具，然后选择相应的配置获取方式：

#### 1. 判断当前 AI 平台

**检查当前环境特征**：

- **OpenCode 平台**：
  - 通常有特定的环境变量或文件结构
  - 可以使用检测脚本：`node scripts/opencode-model-detector.cjs`
  - 如果脚本能正常运行并返回配置，说明是 OpenCode 环境

- **Claude Code 平台**：
  - 通常有 `CLAUDE_CODE` 或类似的环境变量
  - **模型配置通过以下环境变量传递**：
    - `ANTHROPIC_AUTH_TOKEN` 或 `ANTHROPIC_API_KEY`：API Key
    - `ANTHROPIC_BASE_URL`：API 基础 URL
    - `ANTHROPIC_MODEL`：模型名称
  - 检查环境变量：`echo $ANTHROPIC_AUTH_TOKEN` 或查看 Claude Code 设置
  - 如果找到这些变量，说明是 Claude Code 环境

- **Cursor / Windsurf / 其他 AI 编程工具**：
  - 模型配置通常通过工具界面设置
  - 检查常见的环境变量：`OPENAI_API_KEY`、`DEEPSEEK_API_KEY` 等

- **无法确定平台**：
  - 如果无法确定当前平台，跳过平台配置获取
  - 直接进入第3步验证 .env 文件

#### 2. 根据平台获取配置

**如果确定是 OpenCode 平台**：
```bash
# 运行检测脚本获取当前会话的模型配置
node scripts/opencode-model-detector.cjs
```

检测脚本会输出：
- providerID: 提供商 ID
- modelID: 模型 ID
- apiKey: API Key
- baseUrl: API 基础 URL

**如果确定是 Claude Code 平台**：
从环境变量获取配置：
- API Key: `ANTHROPIC_AUTH_TOKEN` 或 `ANTHROPIC_API_KEY`
- Base URL: `ANTHROPIC_BASE_URL`
- 模型名称: `ANTHROPIC_MODEL`

**检查 Claude Code 环境变量**：
```bash
echo "API Key: $ANTHROPIC_AUTH_TOKEN"
echo "Base URL: $ANTHROPIC_BASE_URL"
echo "Model: $ANTHROPIC_MODEL"
```

**如果环境变量未设置**，可能需要：
1. 在 Claude Code 设置中配置模型
2. 或通过命令行设置：
   ```bash
   export ANTHROPIC_AUTH_TOKEN="your_token_here"
   export ANTHROPIC_BASE_URL="https://api.anthropic.com"
   export ANTHROPIC_MODEL="claude-3.5-sonnet"
   ```

**如果确定是 Cursor / Windsurf / 其他平台**：
这些平台需要首先获取到模型配置（模型名、API Key、Base URL等），然后通过命令行方式传递给 skill-gen。

#### 3. 使用获取到的配置

**如果获取到了平台配置**，将配置传递给包装脚本 `gen.sh`：

```bash
./scripts/gen.sh \
  --input document.pdf \
  --mode merge \
  --output ./my-skill \
  --llm-api-key="sk-xxxx" \
  --llm-model="deepseek-chat" \
  --llm-base-url="https://api.deepseek.com/v1"
```

**如果获取不到平台配置**，继续执行第3步，验证 .env 文件配置。

### 第3步：验证 .env 配置

如果 AI 平台没有提供配置，验证 .env 文件：

**.env 配置文件结构（推荐方式）**：

```bash
# DeepSeek API 配置（推荐，系统会自动识别）
DEEPSEEK_API_KEY=sk-xxxx-xxxx-xxxx-xxxx
DEEPSEEK_BASE_URL="https://api.deepseek.com/"
DEEPSEEK_MODEL="deepseek-chat"
```

**或者使用通用 LLM 配置**：

```bash
# 通用 LLM 配置（优先级最高）
LLM_API_KEY=sk-xxxx-xxxx-xxxx-xxxx
LLM_MODEL=deepseek-chat
LLM_BASE_URL=https://api.deepseek.com/v1
```

**配置优先级**：
1. 命令行参数：`--llm-api-key`（最高优先级）
2. 环境变量：`LLM_API_KEY`
3. 环境变量：`DEEPSEEK_API_KEY`（自动回退）

**处理配置缺失**：
如果验证失败（未找到任何 API Key），请询问用户提供配置（推荐 DeepSeek）。

### 第3.5步：模型连通性测试

在获取到模型配置后，先进行模型连通性测试：

```bash
python scripts/test_model_connectivity.py --env-file .env
```
*(如果从平台或命令行参数中直接获得了配置，也可通过 `--api-key="xxx" --base-url="xxx" --model="xxx"` 的方式传入)*

如果测试通过，再进行后续任务。

如果测试不通过，则停止生成，并要求与用户交互，提供下列选项：
```
Question: "模型连通性测试未通过，请重新配置以确保后续流程顺利进行："
Options: "获取 DeepSeek 的 api_key", "获取符合 OpenAI 规范的 LLM 的 base_Url、api_key、model_name", "取消"
```
用户提供后，再次执行该脚本进行连通性测试，只有连通性测试通过，才可进行后续生成，确保后续不会有模型调用问题。

### 第4步：识别输入来源

根据用户请求确定输入来源：

**情况A：用户提供了文档路径或URL**
- 单个文件：`document.pdf`
- 多个文件：`doc1.pdf`, `doc2.md`
- 目录：`./docs/`

直接进入第5步处理文档。

**情况B：用户只描述了需求，未提供文档**
需要询问用户提供文档路径、URL或直接提供文本内容。

### 第5步：生成技能 (支持合并模式)

**重要提示**：skill_gen_cli.py 运行时间可能较长（10分钟以上），这是正常现象。**在前台运行并等待命令执行完成**，不要中途终止进程。

#### 5.1 推荐：合并模式 (Merge Mode)
**默认推荐使用此模式**。将多个相关文档（如同一问题的不同故障案例）合并，提取共性故障模式，生成一个高质量的 Skill。

```bash
# 指定多个文件进行合并
./scripts/gen.sh \
  --input doc1.pdf \
  --input doc2.md \
  --mode merge \
  --output ./merged-skill

# 指定目录（合并目录下所有文件）
./scripts/gen.sh \
  --input ./related_docs/ \
  --mode merge \
  --output ./merged-skill
```

#### 5.2 单一模式 (Single Mode)
一个文档生成一个独立的 Skill。适用于处理互不相关的文档。

```bash
./scripts/gen.sh \
  --input document.pdf \
  --mode single \
  --output ./my-skill
```

#### 5.3 直接生成模式 (Direct Generation)
如果你已经有提取好的 `failure_pattern.yaml` 或希望注入通用经验：

```bash
# 从 pattern 文件直接生成 skill，并注入通用经验
./scripts/gen.sh \
  --pattern-file ./references/failure_pattern.yaml \
  --general-experience ./inputs/experience.md \
  --output ./my-skill
```

#### 5.4 等待和监控指导
- **在前台运行**：直接运行命令并等待完成。
- **耐心等待**：10分钟以上的运行时间是正常的。
- **不要中途终止**：即使输出看起来暂停，也要继续等待。

### 第6步：询问是否加载到本地项目（推荐）

在技能生成成功后，询问用户是否将生成的skill直接加载到当前项目的 `.opencode/skills` 目录下，以便立即使用。

**询问方式**：
```
Question: "✅ Skill生成成功！(位于 <output-path>/<skill-name>)。是否将此技能加载到当前项目的 .opencode/skills 目录下以便立即使用（需要重启）？"
Options: "是，加载到 .opencode/skills 目录", "否，保持当前位置"
```

**如果用户同意（加载到本地）**：
1. 检查并创建 `.opencode/skills` 目录。
2. 移动生成的 skill 目录。
3. 提醒用户重启 opencode。

### 第7步：上传至 Insight 平台（如果用户要求）

如果用户在生成技能的指令中明确要求**"上传"、"同步"或"保存到 Insight"**，在生成完成且验证通过后，调用 `skill-sync` 技能。

```bash
node ../skill-sync/scripts/push.js <生成的技能路径>
```

## 核心参数

- `--input, -i`：输入路径。支持文件、目录、URL。**可多次使用指定多个输入** (e.g., `--input a.pdf --input b.md`)。
- `--output, -o`：输出目录（必需）。
- `--mode`：生成模式。
  - `merge`：**[推荐]** 多文档合并生成一个 Skill。
  - `single`：单/多文档生成对应数量的独立 Skill。
- `--pattern-file, -p`：**[高级]** 故障模式 YAML 文件路径（用于直接生成）。
- `--general-experience, -g`：**[高级]** 通用经验文件路径（注入到 Skill 中）。
- `--concurrency, -c`：并发数，默认3。
- `--quality-threshold, -q`：质量阈值0~1，默认0.5。

**平台配置参数（AI 平台传递）**：
- `--llm-api-key`
- `--llm-model`
- `--llm-base-url`

## 支持的输入格式

- **PDF**: 从PDF文档提取内容
- **Markdown**: 解析.md文件
- **HTML**: 抓取并解析网页
- **TXT**: 处理纯文本
- **URL**: 自动获取并处理网页内容

## 输出结构

生成的技能遵循Agent Skills规范：

```
skill-name/
├── SKILL.md          # 技能主文档（必需）- 包含技能描述、使用场景等
├── scripts/           # 可执行脚本（可选）- 技能相关的工具脚本
├── examples/          # 使用示例（可选）- 技能使用示例和演示
└── references/        # 参考文档（可选）- 技能相关的参考文档
```

## 常见错误处理

**1. 配置缺失**
```
错误：未找到 LLM API Key
解决：
  方式1（推荐）：配置 DeepSeek API
    echo "DEEPSEEK_API_KEY=sk-xxxx" >> .env
    echo "DEEPSEEK_BASE_URL=https://api.deepseek.com/" >> .env
    echo "DEEPSEEK_MODEL=deepseek-chat" >> .env

  方式2：配置通用 LLM API
    echo "LLM_API_KEY=sk-xxxx" >> .env
    echo "LLM_MODEL=deepseek-chat" >> .env
    echo "LLM_BASE_URL=https://api.deepseek.com/v1" >> .env

  方式3：通过命令行参数传递
    ./scripts/gen.sh --input doc.pdf --output ./out --llm-api-key=sk-xxxx

  方式4：从 AI 平台获取配置
    - OpenCode: node scripts/opencode-model-detector.cjs
    - Claude Code: 检查环境变量 ANTHROPIC_AUTH_TOKEN
    - Cursor/其他: 从工具设置获取配置
```

**2. 依赖缺失或虚拟环境错乱**
```
错误：ModuleNotFoundError: No module named 'xxx' 或者是 No virtual environment found
解决：
  由于已经提供集成式包装脚本，几乎不会遇到此问题。如果你直接调用了 Python 文件，退回到使用包装脚本：
  ./scripts/gen.sh 
  （脚本会自动在 '.venv' 中处理依赖的安装和读取）
```

**3. uv未安装**
```
错误：uv: command not found
解决：curl -LsSf https://astral.sh/uv/install.sh | sh
```

**4. 文档处理失败**
```
错误：无法处理文档格式
解决：./scripts/gen.sh --input doc.pdf --output ./test
```

**5. 权限问题**
```
错误：Permission denied
解决：chmod +x scripts/gen.sh
```

**6. 输出文件问题**
```
问题：生成的skill目录为空或不完整
解决：
  1. 确认输入文档格式支持：PDF/Markdown/HTML/TXT/URL
  2. 检查API配置是否正确：uv run scripts/verify_config.py
  3. 增加质量阈值：--quality-threshold 0.3
  4. 尝试简化输入文档
```

**7. 内存不足问题**
```
错误：MemoryError 或进程被杀死
解决：
  1. 减少并发数：--concurrency 1
  2. 处理较小的文档
  3. 分批处理大文档
  4. 增加系统可用内存
```

**8. 进程长时间无响应**
```
问题：命令运行30分钟以上完全无输出
解决：
  1. 按 Ctrl+C 终止命令
  2. 检查输入文档是否过大或复杂
  3. 尝试使用更简单的文档测试
  4. 检查系统资源（内存、CPU）
```

## 使用技巧

1. **推荐使用 Merge 模式**：通过 `--mode merge` 将多个相关案例合并，生成的 Skill 质量更高，覆盖面更广。
2. **在前台运行**：直接运行命令并等待完成，不要使用后台运行
3. **优先使用平台配置**：AI 平台配置优先级最高，无需手动设置
4. **OpenCode 检测**：在 OpenCode 平台使用 node scripts/opencode-model-detector.cjs
5. **首次使用**：先安装依赖，再获取配置，最后生成技能
6. **交互询问**：如果用户没有提供文档，主动询问输入来源
7. **批量处理**：使用`--concurrency`提高效率，但不要超过5
8. **质量控制**：通过`--quality-threshold`调整生成质量（0.5-0.9）
9. **输出检查**：生成后检查SKILL.md的description是否符合预期
10. **本地加载**：生成后主动询问用户是否加载到 .opencode/skills 目录，方便立即使用

## 参考资源

详细使用示例和故障排查：`examples/basic-usage.md`
