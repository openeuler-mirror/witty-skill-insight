---
name: skill-generator
description: 从文档生成Agent Skills。当用户要求从PDF、Markdown、HTML、TXT或URL创建新技能时触发，例如"生成一个git使用教程的skill"、"从API文档创建skill"等。基于LLM自动提取知识并生成符合规范的SKILL.md。
---

# Skill Generator

从文档自动生成Agent Skills，使用LLM提取知识。

## 何时使用

当用户提出以下类型请求时触发此技能：

- "生成一个[主题]的skill"
- "从[文档]创建skill"
- "帮我写个关于[主题]的技能"
- "把[文档]转换成agent skill"
- 直接提供文档路径要求生成skill

**关键触发词**：skill、技能、生成、创建、从文档、PDF、Markdown

## 工作流程

### 第1步：检查和安装依赖

**Python 版本要求**：需要 Python 3.11 或更高版本，以确保 langchain>=1.0 正确安装。

首先检查系统是否已安装uv：

```bash
uv --version
```

**如果没有uv，需要先安装**：

```bash
# Linux/macOS
curl -LsSf https://astral.sh/uv/install.sh | sh

# 或使用pip
pip install uv
```

然后创建 uv 虚拟环境并安装项目依赖：

```bash
# 创建虚拟环境（如果不存在）
uv venv

# 激活虚拟环境
# Linux/macOS:
source .venv/bin/activate

# Windows:
# .venv\Scripts\activate

# 安装项目依赖
uv pip install -r scripts/skill-gen/requirements.txt
```

**初始化 Git Submodule（Skill_Seekers）**：

skill-gen 依赖 Skill_Seekers 第三方库，需要初始化 git submodule：

```bash
cd scripts/skill-gen
git submodule update --init --recursive
```

如果 git submodule 初始化失败，可以手动下载：

```bash
cd scripts/skill-gen/skill_gen/third_party
git clone https://github.com/ICEORY/Skill_Seekers.git
```

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
  - 可能有特定的项目结构或配置文件
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

**如果获取到了平台配置**：

将配置传递给 skill-gen CLI（通过参数）：

```bash
uv run scripts/skill-gen/skill_gen_cli.py \
  --input document.pdf \
  --output ./my-skill \
  --llm-api-key="sk-xxxx" \
  --llm-model="deepseek-chat" \
  --llm-base-url="https://api.deepseek.com/v1"
```

**如果获取不到平台配置**：

继续执行第3步，验证 .env 文件配置。

### 第3步：验证 .env 配置

如果 AI 平台没有提供配置，验证 .env 文件：

```bash
uv run scripts/verify_config.py
```

**.env 配置文件结构**：

```bash
# 必需配置
LLM_API_KEY=your_api_key_here

# 可选配置
LLM_MODEL=deepseek-chat
LLM_BASE_URL=https://api.deepseek.com/v1
```

**处理配置缺失**：

如果验证失败（LLM_API_KEY 未设置），通过自然语言引导用户提供配置：

```
请提供以下信息：

1. LLM_API_KEY: 你的 API Key (必需)
2. LLM_MODEL: 模型名称 (可选，默认 deepseek-chat)
3. LLM_BASE_URL: API 基础 URL (可选，默认 https://api.deepseek.com/v1)

示例格式：
  LLM_API_KEY=sk-xxxx
  LLM_MODEL=deepseek-chat
  LLM_BASE_URL=https://api.deepseek.com/v1
```

等待用户提供配置后，保存到 .env 文件：

```bash
# 将用户提供的配置保存到 .env
echo "LLM_API_KEY=sk-xxxx" >> .env
echo "LLM_MODEL=deepseek-chat" >> .env
echo "LLM_BASE_URL=https://api.deepseek.com/v1" >> .env
```

然后重新验证：

```bash
uv run scripts/verify_config.py
```

### 第4步：识别输入来源

根据用户请求确定输入来源：

**情况A：用户直接提供了文档路径或URL**

直接进入第5步处理文档。

**情况B：用户只描述了需求，未提供文档**

需要交互询问用户：

```
请提供以下信息之一：
1. 文档文件路径（如：/path/to/document.pdf）
2. 文档URL（如：https://example.com/docs）
3. 或者提供文档内容直接处理
```

等待用户提供输入后，再进入第5步。

### 第5步：生成技能

**重要提示**：skill_gen_cli.py 运行时间可能较长（10分钟以上），这是正常现象。**在前台运行并等待命令执行完成**，不要中途终止进程。

**关键原则**：
1. **在前台运行**：直接运行命令并等待完成
2. **耐心等待**：10分钟以上的运行时间是正常的
3. **不要中途终止**：即使输出看起来暂停，也要继续等待
4. **不要过早编辑**：等待进程完全完成后才检查生成的skill
5. **进程卡住的判断**：只有在命令完全无响应超过30分钟时，才考虑终止

#### 5.1 在前台运行技能生成

**直接在前台运行命令**：

```bash
uv run scripts/skill-gen/skill_gen_cli.py --input document.pdf --output ./my-skill
```

命令会一直运行直到完成。你可以看到实时输出，了解处理进度。

**如果通过参数传递了平台配置**：

```bash
uv run scripts/skill-gen/skill_gen_cli.py \
  --input document.pdf \
  --output ./my-skill \
  --llm-api-key="sk-xxxx" \
  --llm-model="deepseek-chat" \
  --llm-base-url="https://api.deepseek.com/v1"
```

#### 5.2 等待和监控指导

**在前台等待时**：
- 命令会输出处理日志到终端
- 你可以看到文档处理、质量评估、技能生成等各个阶段
- 即使输出暂停几分钟，也不要终止进程
- 等待命令自然退出（返回命令行提示符）

**判断运行状态**：
- ✅ **正常进行**：有日志输出，即使输出缓慢
- ✅ **正常暂停**：几分钟没有新输出，但进程还在运行
- ❌ **可能卡住**：30分钟完全无任何输出，命令无响应
- ❌ **已出错**：命令显示错误信息并退出

**如果命令长时间无响应（超过30分钟）**：
1. 按 `Ctrl+C` 终止命令
2. 检查是否有部分输出文件生成
3. 尝试简化输入文档或调整参数重新运行

**重要**：在前台运行可以更好地监控进度，避免后台进程管理的问题。

#### 5.3 根据输入类型选择命令

**从单个文件生成**（使用平台配置或 .env）：

```bash
uv run scripts/skill-gen/skill_gen_cli.py --input document.pdf --output ./my-skill
```

**从URL生成**：

```bash
uv run scripts/skill-gen/skill_gen_cli.py --input https://example.com/docs --output ./web-skill
```

**从文本内容生成**（直接提供内容）：

```bash
# 先将内容写入临时文件
echo "你的文档内容" > /tmp/input.md
# 然后在前台运行生成
uv run scripts/skill-gen/skill_gen_cli.py --input /tmp/input.md --output ./my-skill
```

**批量生成**：

```bash
uv run scripts/skill-gen/skill_gen_cli.py --input ./docs/*.pdf --output ./skills --concurrency 3
```

## 核心参数

- `--input, -i`：输入文档路径或URL（必需）
- `--output, -o`：输出目录（必需）
- `--name, -n`：技能名称（可选，默认自动生成）
- `--concurrency, -c`：并发数，默认3
- `--quality-threshold, -q`：质量阈值0~1，默认0.7

**平台配置参数（AI 平台传递）**：
- `--llm-api-key`：LLM API Key
- `--llm-model`：LLM 模型名称
- `--llm-base-url`：LLM API 基础 URL

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

**输出目录检查**：
生成完成后，检查输出目录是否包含以下内容：
1. **SKILL.md**：技能主文件，包含完整的技能描述
2. **目录结构**：scripts/, examples/, references/ 等子目录（如果生成）
3. **文件完整性**：所有文件都应该是可读的，没有损坏

**验证生成的skill**：
```bash
# 检查SKILL.md格式
head -20 ./my-skill/SKILL.md

# 检查目录结构
ls -la ./my-skill/

# 检查文件大小（确保不是空文件）
du -sh ./my-skill/
```

## 常见错误处理

**1. 配置缺失**
```
错误：未找到 LLM_API_KEY
解决：
  1. 判断当前 AI 平台并获取配置：
     - OpenCode: node scripts/opencode-model-detector.cjs
     - Claude Code: 检查环境变量 ANTHROPIC_AUTH_TOKEN, ANTHROPIC_BASE_URL, ANTHROPIC_MODEL
     - Cursor/其他: 从工具设置获取配置
  2. 或验证 .env 配置：uv run scripts/verify_config.py
  3. 手动配置：echo "LLM_API_KEY=sk-xxxx" >> .env
```

**2. 依赖缺失**
```
错误：ModuleNotFoundError: No module named 'xxx'
解决：
  1. 创建虚拟环境：uv venv
  2. 激活环境：source .venv/bin/activate
  3. 安装依赖：uv pip install -r scripts/skill-gen/requirements.txt
```

**6. uv 虚拟环境错误**
```
错误：No virtual environment found; run `uv venv` to create an environment
解决：
  1. 创建虚拟环境：uv venv
  2. 激活环境：source .venv/bin/activate
  3. 重新安装依赖
```

**3. uv未安装**
```
错误：uv: command not found
解决：curl -LsSf https://astral.sh/uv/install.sh | sh
```

**4. 文档处理失败**
```
错误：无法处理文档格式
解决：uv run scripts/skill-gen/skill_gen_cli.py --input doc.pdf --output ./test
```

**5. 权限问题**
```
错误：Permission denied
解决：chmod +x scripts/skill-gen/skill_gen_cli.py
  或使用：uv run scripts/skill-gen/skill_gen_cli.py
```

**7. 输出文件问题**
```
问题：生成的skill目录为空或不完整
解决：
  1. 确认输入文档格式支持：PDF/Markdown/HTML/TXT/URL
  2. 检查API配置是否正确：uv run scripts/verify_config.py
  3. 增加质量阈值：--quality-threshold 0.3
  4. 尝试简化输入文档
```

**8. 内存不足问题**
```
错误：MemoryError 或进程被杀死
解决：
  1. 减少并发数：--concurrency 1
  2. 处理较小的文档
  3. 分批处理大文档
  4. 增加系统可用内存
```

**9. 进程长时间无响应**
```
问题：命令运行30分钟以上完全无输出
解决：
  1. 按 Ctrl+C 终止命令
  2. 检查输入文档是否过大或复杂
  3. 尝试使用更简单的文档测试
  4. 检查系统资源（内存、CPU）
```

## 使用技巧

1. **在前台运行**：直接运行命令并等待完成，不要使用后台运行
2. **优先使用平台配置**：AI 平台配置优先级最高，无需手动设置
3. **OpenCode 检测**：在 OpenCode 平台使用 node scripts/opencode-model-detector.cjs
4. **首次使用**：先安装依赖，再获取配置，最后生成技能
5. **交互询问**：如果用户没有提供文档，主动询问输入来源
6. **批量处理**：使用`--concurrency`提高效率，但不要超过5
7. **质量控制**：通过`--quality-threshold`调整生成质量（0.5-0.9）
8. **输出检查**：生成后检查SKILL.md的description是否符合预期

## 参考资源

详细使用示例和故障排查：`examples/basic-usage.md`
