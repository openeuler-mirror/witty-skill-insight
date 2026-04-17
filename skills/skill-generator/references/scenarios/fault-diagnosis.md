# 故障诊断场景：Skill 生成工作流

> 本文件由 `skill-generator` 的 SKILL.md 加载。适用于：故障排查、异常诊断、告警分析等场景。
>
> **两条执行路径**：
> - **路径 A（Agent 驱动）**：用户提供故障模式列表（表格/YAML/自由文本）→ Agent 直接生成
> - **路径 B（文档流水线）**：用户提供文档（PDF/MD/TXT/URL）→ 调用轻量解析器后由 Agent 自主提取生成

---

## 如何选择路径

| 用户输入 | 选择 |
|---|---|
| 故障模式列表、专家整理的失效模型、YAML/表格形式的故障场景 | 路径 A |
| PDF/MD/TXT 文档、URL、故障案例报告 | 路径 B |
| 只说了一句话描述（如"帮我做个 SSH 登录失败的排查 Skill"）| 路径 A（向用户确认后） |

---

## 路径 A：Agent 驱动（从故障模式生成）

整个生成分四步：**扫描 → 查资料 → 确认 → 生成**。不要跳步。

### Step A-1：解析输入 + 质量扫描

拿到用户的故障模式后，先做输入质量扫描。**不要直接开始生成**。

**解析**：不论用户给的是表格、YAML、JSON 还是自由文本，提取出这些字段：
- 故障域（一级/二级分类）
- 每个失效模型的：名称、描述、影响、检测方法（可能缺失）、恢复方法（可能缺失）

**质量扫描**——检查以下 5 类问题（详细规则见 `templates/fault-diagnosis/quality_scan.md`）：

1. **重复**：相同名称出现多次 → 分析差异，准备合并方案
2. **层级关系**：多个模型之间有"先查A再查B/C/D"的隐含关系 → 识别出来
3. **缺失字段**：检测方法或恢复方法为空 → 用你的知识预填充
4. **内部工具**：出现无法识别的工具名/缩写 → 推测候选并准备确认
5. **模糊描述**："需要人为介入"这类笼统内容 → 细化为具体操作

### Step A-2：查资料补全

扫描完成后，对每个失效模型评估：**我对这个故障的检测方法和恢复方法有多大把握？**

**触发搜索的条件**（满足任一即搜索）：
1. 用户只给了一句话描述，没有检测方法、恢复方法 → 必须搜索
2. 你不确定具体的命令或参数 → 搜索确认
3. 涉及特定版本/发行版差异 → 搜索确认
4. 故障模式描述模糊，无法直接映射到具体排查命令 → 搜索理解

每个失效模型最多搜 2 次。搜索策略：
```
# 缺检测方法时
搜索: "{故障现象} linux troubleshoot command"

# 缺恢复方法时
搜索: "{故障现象} linux fix resolve"

# 不确定命令参数时
搜索: "{具体命令} usage example"
```

### Step A-3：预填充审核

将质量问题转为**选择题**呈现给用户。核心原则：**用户永远不需要从空白开始写**。

三种题型（≤ 8 题，超过时高置信问题自动采纳）：

**单选题**（结构性决策）：
```
Q: "用户态内存泄漏"出现3次，应如何处理？
(A) 合并为1个step ← 推荐
(B) 拆为2个step
(C) 保持3个独立step
```

**确认题**（高置信推断）：
```
Q: 排查顺序为"先用户态后内核态"，确认？[Y/N] ← 推荐Y
```

**填空预填充题**（缺失内容）：
```
Q: "total内存不足"缺少检测方法，建议：
  dmidecode -t memory | grep "Size:"
  grep MemTotal /proc/meminfo
(A) 采纳 ← 推荐
(B) 修改为：______
```

如果用户说"自动"或"--auto"，全部采纳推荐选项，跳过交互。

### Step A-4：生成 Skill

> 注：此时 `references/skill-template.md` 已在 Step 2 中加载，所有产物需符合其标准。

用确认后的数据，生成完整的 Skill 目录：

```
{skill_name}/
  SKILL.md                    # 排查骨架（符合 skill-template.md 规范）
  scripts/
    _lib.sh                   # 从 templates/fault-diagnosis/_lib.sh 复制
    collect.sh                # 信息采集脚本
    check_{category}.sh       # 每个排查类别一个脚本
  references/                 # 按需生成
    {topic}.md                # 深度知识文档（背景知识 > 5行时拆出）
```

详细的产出结构和脚本生成规则见 `templates/fault-diagnosis/output_structure.md`。

排查决策树生成规则见 `templates/fault-diagnosis/triage_prompt.md`。

#### A-4.1 SKILL.md 生成规范

必须包含 YAML frontmatter（参考 `references/skill-template.md`）。主体结构：

```markdown
# {故障域}排查

> 适用: {环境} | 版本: v1.0

## 概述 (Overview)
{故障域简介，2-3行}

## 核心指令 (Core Instructions)

### 信息收集

```bash
sudo bash scripts/collect.sh | tee /tmp/diag_collect.json
```

> **追问原则**：命中故障后不要停。继续问三个问题：
> 1. 什么时候开始的？— 用 timeline 回溯
> 2. 什么触发的？— 查最近变更
> 3. 还影响了什么？— 检查跨层传播

### 排查流程 [条件分支]

**Step 1: {名称}**
执行: `bash scripts/check_{name}.sh`
命中条件: {一句话}
- ✅ 命中 → {恢复方案}
- ❌ 未命中 → Step 2

...

**兜底**
1. `bash scripts/collect.sh --full`
2. 上报至 {路径}

### 诊断结论模板
故障根因:
故障组件:
故障时间: [首次] → [确认]
故障链:   [T1]A → [T2]B → [T3]C
已排除:   {项}: {依据}
定位依据: {关键证据}
修复建议: 临时 / 根因 / 预防

## 参考文件说明
- `scripts/_lib.sh`: 排查脚本通用函数库
- `scripts/collect.sh`: 系统信息采集
- `scripts/check_*.sh`: 各类别排查脚本
- `references/{topic}.md`: {主题}深度知识（如有）
```

**控制原则**：
- 每个 Step 不超过 6 行，详细说明放 references
- 整个 SKILL.md 控制在 500 行以内

#### A-4.2 排查脚本生成规范

**_lib.sh**：直接从 `templates/fault-diagnosis/_lib.sh` 复制，不修改。

**collect.sh**：
```bash
#!/bin/bash
source "$(dirname "$0")/_lib.sh"
record "sysinfo" "INFO" "$(uname -a; cat /etc/os-release)"
record "uptime" "INFO" "$(uptime)"
record "memory" "INFO" "$(free -h)"
record "disk" "INFO" "$(df -h)"
record "top_procs" "INFO" "$(ps aux --sort=-%mem | head -10)"
# {域特定采集}
dump_json
```

**check_{category}.sh**：
```bash
#!/bin/bash
source "$(dirname "$0")/_lib.sh"

output=$(run_cmd "{描述}" {命令})
if {判断条件}; then
    hit "{检查名}" "$output"
    timeline "{关键词}" 24
else
    miss "{检查名}" "$output"
fi

dump_json
```

**脚本约束**：
- 所有脚本用 bash，兼容 CentOS/RHEL/Ubuntu
- 不依赖第三方工具，只用系统自带命令
- 每次 `hit` 后紧跟 `timeline` 调用
- 按排查层级拆分脚本（每个脚本覆盖 2-4 个相关 step）

---

## 路径 B：Agent 文档流水线（从系统化文档生成）

当用户提供的是长篇文档（PDF、URL、Markdown）或系统化案例库时，使用此路径进行自主提取和归纳。

### Step B-1：调用解析工具提取文本

你不能直接阅读二进制/复杂文件，必须借用配套抽取脚本：
```bash
uv run python scripts/parse_doc.py <用户提供的文件路径或URL> -o /tmp/extracted_doc.md
```
*(如遇依赖缺失报错，引导用户 `uv pip install -r scripts/requirements.txt`)*

读取 `/tmp/extracted_doc.md` 进入你的上下文。

### Step B-2：知识提取与归纳思维链

在生成文件前，先在你的思考过程中严格照此逻辑梳理内容：

1. **提取故障案例 (Failure Cases)**
   提炼 `title` (`[组件] + [根因摘要] + [现象摘要]`)、`timeline`、`trigger_event`、`evidences` 和原始 `commands`。

2. **归纳故障模式 (Failure Pattern)**
   涵盖：
   - `pattern_name`: 泛化的模式名称（绝不包含真实IP）。
   - `summary`: 包含 1)诊断手段 2)问题分类 3)宏观因果描述。
   - `fault_mechanism`: 错误产生的纯技术原理解释。
   - `variation_vectors` (发散向量): 该故障在其他环境/参数下重现时的差异。
   - **`diagnosis_steps` (排查决策树)**: 将零散文本结构化为明确的 `action` -> `where` -> `command(必须带{{PLACEHOLDER}})` -> `expected_output` -> `critical(是否关键)`。

*(多文档场景：自动比对下一个文档，如果不跳出现在的作用域，则更新原有 Pattern 的发散向量，否则提醒或拆分为新的 Pattern。)*

### Step B-3：生成最终 Skill

完全参照 **Step A-4** 中的文件规范以及模板（`SKILL.md`，`scripts/check_.sh`，`references/failure_cases.yaml`），将刚刚思考总结中详尽且过于庞杂的发散向量和 Known instances 内容存放进 `references/pattern-detail.md` 中以保证主体的简洁。最后同样要求并指导执行 `validate_skill.sh`。

---

## 常见判断

**要不要生成 reference？**
- 故障域涉及多个子系统（如安全故障涉及 PAM/SELinux/iptables）→ 要
- 故障域技术面单一（如 OOM、网络连通性）→ 通常不需要

**脚本拆几个？**
- 按排查层级/安全类别拆，每个脚本覆盖 2-4 个相关 step
- 不要一个 step 一个脚本，也不要所有 step 塞一个脚本

**决策树线性还是树形？**
- 默认线性链（step1 → step2 → ... → escalate）
- 只有当某个 step 命中后需要进一步区分子场景时，才在该 step 内使用子判断

**用户只给了一句话怎么办？**
- 不要拒绝。先搜资料补全，再走标准 4 步流程。

---

## 示例

**示例 A：输入信息充足（网络故障）**
1. 扫描：故障域=OS>网络>IP层，9个失效模型，无重复无缺失
2. 查资料：基础操作，跳过
3. 确认（1题）："自底向上排查，确认？"
4. 生成：SKILL.md + 4个 check 脚本 + collect.sh

**示例 B：输入质量差（OOM 故障模式）**
1. 扫描：发现重复(3行同名)、层级关系、缺失(2处)
2. 查资料：对缺失的检测方法搜索补全
3. 确认（6题）：合并策略、层级结构、工具识别、缺失补全、排查顺序
4. 生成

**示例 C：用户只给了一句话**

用户输入：> "SELinux 导致服务启动失败"

1. 扫描：1个失效模型，检测方法和恢复方法全部缺失
2. 查资料：搜索补全出多个子场景（布尔值、文件上下文、端口、策略模块）
3. 确认（2题）：子场景范围确认、排查顺序确认
4. 生成：SKILL.md + check_selinux.sh + references/selinux_contexts.md
