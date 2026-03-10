# Skill 优化器 (Skill Optimizer)

本工具用于优化 Agent Skill 定义文件（SKILL.md），通过静态分析、质量评估和运行时反馈来持续改进 Skill 的质量。

---

## 1. 框架概览

`skill-optimizer` 采用了 **"Static/Dynamic" 双模优化架构**，旨在通过静态代码分析和动态运行时反馈来持续改进 Agent 的 Skill。该框架不仅支持传统的文本重写，还引入了 Agentic Workflow 来执行复杂的代码修改任务。

### 核心组件

1. **SkillOptimizer (核心控制器)**: 整个优化流程的总指挥，负责调度冷/热启动策略
2. **EvaluationAdapter (评估适配器)**: 负责对 Skill 进行全方位的"体检"，输出结构化的诊断结果
3. **ExperienceCrystallizer (经验结晶器)**: 负责处理运行时反馈，将非结构化的测试报告转化为可执行的优化建议
4. **DiagnosticMutator (诊断式变异器)**: 一个具备工具调用能力的 Agent，负责根据诊断结果对代码进行精准修改

---

## 2. 优化分层

框架支持三个层次的优化，覆盖了从语法合规到业务逻辑的完整生命周期。

| 层次   | 名称                              | 描述                                                                       | 适用场景                     |
| :----- | :-------------------------------- | :------------------------------------------------------------------------- | :--------------------------- |
| **L1** | **Static Compliance (静态合规)**  | 基于硬规则（Hard Rules）的检查，确保 Skill 符合基本的格式和规范。          | 代码提交前、初次创建时       |
| **L2** | **Static Quality (静态质量)**     | 基于 LLM 的软性评估，从 5 个维度分析 Skill 的逻辑质量和清晰度。            | 代码审查、冷启动优化         |
| **L3** | **Dynamic Adaptation (动态适应)** | 基于运行时 Trace 和人工反馈的优化，解决实际运行中的 Edge Case 和逻辑漏洞。 | 集成测试、线上运行、人工干预 |

---

## 3. 评估方式

框架采用多种评估手段相结合的方式，确保优化的准确性和全面性。

### 3.1 Static Linter (静态检查器)

* **原理**: 使用正则表达式 (Regex) 和 YAML 解析器对代码进行 AST 级别的检查。
* **检查项**:
  * **YAML Frontmatter**: 检查 `name`, `description` 是否存在且格式正确（如 kebab-case）。
  * **Length Check**: 检查内容长度是否超过阈值（如 5000 字符），防止 Context Window 溢出。
  * **Header Structure**: 检查是否包含必要的章节标题。

### 3.2 LLM 5D Assessment (五维评估)

* **原理**: 调用 LLM 对 Skill 内容进行语义分析，并根据预设的 Rubric 打分。
* **五个维度 (5D)**:
  1. **Role (职责)**: 角色定义是否清晰？
  2. **Structure (结构)**: 格式是否规范？
  3. **Instruction (指令)**: 推理逻辑 (CoT) 是否连贯？
  4. **Content (内容)**: 知识库/少样本是否充分？
  5. **Risk (风险)**: 安全边界和权限控制是否完备？

### 3.3 Human Feedback (人工反馈/人在回路)

* **原理**: 允许人类专家直接提供自然语言建议。该建议会被作为最高优先级的 reflection 传递给 Mutator，强制 LLM 在修改代码时遵循该指令。

### 3.4 Runtime Feedback (运行时反馈)

* **原理**: 解析测试报告中的 `skill_issues` (技能缺陷) 和 `failures` (运行时异常)。
* **机制**:
  * **Issue Parsing**: 将非结构化的错误描述转化为 `SkillDefect` 诊断。
  * **Anomaly Parsing**: 将工具调用失败等异常转化为 `RuntimeAnomaly` 诊断，通常建议增加新的 Constraint（约束规则）。

---

## 4. 实现细节

### 4.1 SkillOptimizer (Facade Pattern)

`SkillOptimizer` 是一个门面（Facade），它屏蔽了底层组件的复杂性。它提供统一的入口方法：
* `optimize_static`: 执行 Linter -> 5D Evaluation -> Mutation 的冷启动循环。
* `optimize_dynamic`: 执行 Report Parsing -> Crystallization -> Mutation 的动态运行循环。
* `optimize_hybrid`: 先冷后热，全流程优化。

### 4.2 DiagnosticMutator (Agentic Workflow)

与传统的 "Prompt-based Rewrite" 不同，`DiagnosticMutator` 被设计为一个 Agent。

* **Agentic Capabilities**: 它使用 LangChain 的 `create_agent` 构建。
* **Tools (工具箱)**:
  * `update_skill_content`: 修改 `SKILL.md` 主文件。
  * `write_auxiliary_file`: 创建或更新辅助脚本（如 Python/Shell 脚本）。
  * `delete_auxiliary_file`: 删除废弃文件。
  * `record_fix`: **关键工具**，强制 Agent 在修改代码时记录变更日志 (Changelog)，确保每次修改都有迹可循。

### 4.3 ExperienceCrystallizer (RAG-like Injection)

`ExperienceCrystallizer` 的核心在于将"经验"（Experience）固化为"代码"（Code）。
* 它不直接运行 Skill，而是消费运行后的产物（Report）。
* 它通过 LLM 将自然语言的错误报告（如 "Process failed to start"）翻译为具体的代码修改建议（如 "Add check for lock file existence"），从而实现经验的结晶。

---

## 5. 使用方法

可以通过 `scripts/main.py` 脚本运行 Skill 优化。

### 命令行参数

| 参数         | 缩写 | 必选 | 说明                                                                  |
| :----------- | :--- | :--- | :-------------------------------------------------------------------- |
| `--mode`     | -    | 是   | 优化模式：`static` (静态), `dynamic` (基于 Trace), `hybrid` (混合)     |
| `--input`    | `-i` | 是   | 输入路径（包含 `SKILL.md` 的目录或文件路径）                          |
| `--output`   | `-o` | 否   | 输出目录（默认为输入目录的同级或子目录）                              |
| `--feedback` | `-f` | 否   | 人工反馈文件路径（可选，也可通过环境变量 `HUMAN_FEEDBACK_FILE` 指定） |

### 使用示例

#### 1. 静态优化 (Static/Cold Start)

适用于初次创建 Skill 或仅需基于静态规则和 LLM 评估进行优化。

```bash
python scripts/main.py --mode static --input path/to/your/skill_dir
```

#### 2. 动态优化 (Dynamic/Experience Crystallization)

适用于已有运行日志 (Trace/Logs)，希望根据历史运行结果进行针对性优化。

```bash
python scripts/main.py --mode dynamic --input path/to/your/skill_dir
```

#### 3. 混合优化 (Hybrid)

同时执行静态评估和基于运行日志的优化。

```bash
python scripts/main.py --mode hybrid --input path/to/your/skill_dir
```

#### 4. 带人工反馈的优化

如果有人工提供的改进建议（存放在文本文件中），可以通过 `-f` 参数注入。

```bash
python scripts/main.py --mode static --input path/to/your/skill_dir --feedback path/to/feedback.txt
```

---

## 6. 前置条件与配置

### 6.1 必要的 Python 依赖

确保已安装以下 Python 包：

```bash
pip install langchain langchain-openai langfuse python-dotenv httpx
```

### 6.2 环境变量配置 (.env)

为了使优化框架正常运行，建议在项目根目录的 `.env` 文件中配置以下环境变量。

#### LLM (大模型) 配置

| 变量名              | 必选 | 说明                                                            |
| :------------------ | :--- | :-------------------------------------------------------------- |
| `DEEPSEEK_API_KEY`  | 是   | DeepSeek API 密钥（若不使用 DeepSeek，可配置 `OPENAI_API_KEY`） |
| `DEEPSEEK_BASE_URL` | 否   | DeepSeek API 基础 URL，默认 `https://api.deepseek.com/`         |
| `DEEPSEEK_MODEL`    | 否   | 使用的模型名称，默认 `deepseek-chat`                            |

#### Witty Insight 平台对接

用于上传优化后的 Skill 版本以及获取历史运行日志（Dynamic 模式必需）。

| 变量名               | 必选 | 说明                             |
| :------------------- | :--- | :------------------------------- |
| `MODEL_PROXY_IP`     | 是   | 平台服务器 IP 地址               |
| `WITTY_INSIGHT_USER` | 是   | 用户邮箱标识，用于上传和查询日志 |

#### 监控与反馈 (可选)

| 变量名                | 必选 | 说明                              |
| :-------------------- | :--- | :-------------------------------- |
| `LANGFUSE_PUBLIC_KEY` | 否   | Langfuse 公钥，用于记录优化 Trace |
| `LANGFUSE_SECRET_KEY` | 否   | Langfuse 私钥                     |
| `HUMAN_FEEDBACK_FILE` | 否   | 默认的人工反馈文件路径            |

#### 路径与策略配置 (参考)

| 变量名                     | 说明                        |
| :------------------------- | :-------------------------- |
| `OPT_SKILLS_DIR`           | 待优化的 Skill 默认目录路径（可选） |
| `OPT_OUTPUT_DIR`           | 优化结果默认输出目录（可选）        |
| `OPTIMIZATION_MAX_WORKERS` | 并行优化的最大工作线程数    |

---

## 7. 输出产物

优化完成后，会在指定的输出目录（或输入目录同级）创建一个新的文件夹，命名格式为 `{original_name}-v{version}`，其中包含：

* **SKILL.md**: 优化后的技能定义文件。
* **OPTIMIZATION_REPORT.md**: 详细的优化报告，记录了诊断结果和修改建议。
* **diagnoses.json**: 结构化的诊断数据。
* **VERSION.TXT**: 当前 Skill 的版本号。
* **辅助脚本**: 优化过程中创建或更新的相关 Python/Shell 脚本。

---

## 8. 特色与优势

### 8.1 分层优化

通过 L1/L2/L3 三层优化，从静态合规到动态适应，全方位提升 Skill 质量。

### 8.2 Agentic 代码修复

不仅是文本重写，而是通过具备工具使用能力的 Agent 来执行复杂的代码修改，支持创建辅助脚本和删除废弃文件。

### 8.3 经验结晶

将运行时反馈固化为代码，通过 LLM 将自然语言错误描述转化为具体的代码修改建议。

### 8.4 人机协作

支持人工反馈注入，将专家建议作为最高优先级指令，确保优化方向符合预期。

### 8.5 版本管理

自动上传优化结果到 Witty Insight 平台并获取版本号，支持 Skill 的版本追溯。

---

## 9. 注意事项

1. **LLM 成本**: 优化过程涉及多次 LLM 调用，建议关注 API 使用成本。
2. **环境配置**: 确保所有必需的环境变量已正确配置，特别是 API 密钥和平台地址。
3. **备份原始文件**: 优化会生成新版本，建议保留原始 Skill 文件作为备份。
4. **人工审核**: 优化后的建议仅供参考，建议人工审核后再正式使用。
5. **平台依赖**: Dynamic 模式和混合模式依赖 Witty Insight 平台的运行日志，确保平台服务可用。
