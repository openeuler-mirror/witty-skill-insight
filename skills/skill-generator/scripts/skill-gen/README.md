# Skill-Gen 模块说明

Skill 自动生成模块，支持从文档（PDF、Markdown、HTML、TXT、URL）自动生成 Agent Skill。该系统采用 **“资产提取 + 智能分析”** 的双轨制处理模式，将运维故障文档转化为标准化的 Agent Skill。

---

## 1. 核心功能与架构

系统流程被设计为两个核心轨道，最终在构建阶段合并：

1.  **物理资产提取 (Asset Extraction)**: 负责从原始文档中精准提取代码块（Scripts）、截图（Assets）和长篇参考资料（References）。
2.  **智能语义分析 (Intelligence Analysis)**: 基于 LLM，负责深度理解文档语义，提取结构化的故障案例（Failure Case）并提炼通用故障模式（Failure Pattern）。

### 支持的生成模式
- **单文档生成 (Single Mode)**: 一个文档生成一个 Skill。
- **批量生成 (Batch Mode)**: 多个文档分别生成多个独立的 Skill。
- **合并生成 (Merge Mode)**: **[NEW]** 将多个相关文档（如同一故障的不同案例）合并，提取多个 Failure Case，最终归纳为一个通用的 Failure Pattern (Skill)。
- **直接生成 (Direct Mode)**: **[NEW]** 直接使用已有的 `failure_pattern.yaml` 文件生成 Skill，支持注入通用经验 (General Experience)。

---

## 2. 目录结构

```
.
├── skill_gen/                        # Python 实现（包名 skill_gen）
│   ├── __init__.py
│   ├── skill_generation.py           # 核心生成逻辑与统一入口 run_skill_generation
│   ├── case_extractor.py             # [Core] 故障案例提取器 (LLM)
│   ├── pattern_merger.py             # [Core] 故障模式归纳与合并器 (LLM)
│   ├── schema.py                     # [Core] 数据结构定义 (FailureCase, FailurePattern)
│   ├── deepseek_skill_adapter.py     # DeepSeek 适配器
│   ├── doc_quality_validator.py      # 文档质量预检
│   ├── html_extractor.py             # URL → Markdown 提取
│   ├── markdown_formatter.py         # 文本 → Markdown 转换
│   ├── skill_name_gen.py             # Skill 名称生成
│   ├── skill_formatter.py            # SKILL.md 渲染器
│   ├── utils.py                      # 工具函数
│   └── third_party/
│       └── Skill_Seekers/            # 第三方依赖（物理资产提取器）
├── skill_gen_cli.py                  # [Entry] 主命令行入口
├── extract_cases.py                  # [Tool] 独立工具：仅提取故障案例
└── merge_patterns.py                 # [Tool] 独立工具：仅合并模式生成 Skill
```

---

## 3. 安装与依赖

### 3.1 Python 依赖

```bash
# 使用 pip
pip install -r requirements.txt
```

### 3.2 环境变量

```bash
# LLM API 配置 (以 DeepSeek 为例)
export LLM_API_KEY=sk-xxxx-xxxx
export LLM_MODEL=deepseek-chat
export LLM_BASE_URL=https://api.deepseek.com/v1

# 可选：默认输出目录
export CUSTOM_SKILL_PATHS=./output_skills
```

---

## 4. 使用方法

### 4.1 主 CLI 入口 (`skill_gen_cli.py`)

#### (1) 单文档/批量独立生成 (默认模式)
适用于一个文档对应一个 Skill 的场景。

```bash
# 单文件
python skill_gen_cli.py -i document.pdf -o ./skills -n my-skill

# 目录批量（生成多个 Skill）
python skill_gen_cli.py -i ./documents/ -o ./skills
```

#### (2) 多文档合并生成 (Merge 模式)
适用于将多个文档（如 `case1.pdf`, `case2.md`）合并为一个 Skill 的场景。

```bash
# 指定多个文件
python skill_gen_cli.py \
  --input doc1.pdf doc2.md \
  --mode merge \
  --output ./skills/merged_skill

# 指定目录（合并目录下所有文件）
python skill_gen_cli.py \
  --input ./related_docs/ \
  --mode merge \
  --output ./skills/merged_skill
```

### 4.2 独立工具链 (Advanced)

如果您需要更细粒度的控制，可以使用分步工具。

#### (1) 步骤 1：提取故障案例 (`extract_cases.py`)
从文档中提取结构化的 `FailureCase` 数据。

```bash
python extract_cases.py \
  -i doc1.pdf doc2.md \
  -o ./temp/cases.yaml
```
输出：
- `./temp/cases.yaml`: 包含提取出的案例列表。
- `./temp/assets_metadata.json`: 提取出的脚本和资源元数据。

#### (2) 步骤 2：合并生成模式 (`merge_patterns.py`)
将提取的案例合并生成最终的 `SKILL.md`。

```bash
python merge_patterns.py \
  -i ./temp/cases.yaml \
  -o ./final_skill
```
输出：
- `./final_skill/SKILL.md`: 最终的 Skill 文档。
- `./final_skill/references/`: 包含 yaml 数据和引用文件。

### 4.3 直接生成模式 (Direct Generation)
适用于已经有故障模式定义 (`failure_pattern.yaml`)，希望直接生成 `SKILL.md` 的场景。此模式支持注入通用经验 (`General Experience`)。

```bash
# 从 pattern 文件直接生成 skill
python skill_gen_cli.py \
  --pattern-file ./references/failure_pattern.yaml \
  --output ./skills/my_skill

# 注入通用经验 (推荐)
python skill_gen_cli.py \
  --pattern-file ./references/failure_pattern.yaml \
  --general-experience ./inputs/experience.md \
  --output ./skills/my_skill
```

---

## 5. 参数说明

| 参数 | 简写 | 说明 |
|------|------|------|
| `--input` | `-i` | 输入路径。支持文件、目录、URL。**Merge 模式下支持传入多个文件路径**。 |
| `--output` | `-o` | 输出目录路径。 |
| `--mode` | | 生成模式：`single` (默认，单/多文档生成对应数量Skill) / `merge` (多文档合并生成一个Skill)。 |
| `--name` | `-n` | Skill 名称（仅 Single 模式单文件时有效）。 |
| `--concurrency` | `-c` | 批量处理时的并发数，默认 3。 |
| `--quality-threshold` | `-q` | 文档质量评估阈值 (0~1)，默认 0.5。 |
| `--pattern-file` | `-p` | **[NEW]** 故障模式 YAML 文件路径（直接生成模式）。 |
| `--general-experience` | `-g` | **[NEW]** 通用经验文件路径（Markdown/Text），内容将注入到 Skill 的参考资料中。 |
