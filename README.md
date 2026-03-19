# Witty-Skill-Insight

Witty-Skill-Insight 是一个开源的 **Agent Skill 生成、优化、观测与分析平台**，帮助开发者量化评估 Skills 在 Agent 上的实际运行效果。通过自动采集执行轨迹、智能评分、深度归因分析，让 Skill 的每一次迭代都有据可依。

<p align="center">
  <img src="docs/images/dashboard_main.png" width="48%" />
  <img src="docs/images/dashboard_list.png" width="48%" />
</p>
<p align="center"><em>主界面：全景指标概览与执行历史列表</em></p>

---

## 🎯 我们在解决什么问题

在 AI 时代，Agent 正在成为新的生产力载体，而 Skill 作为 Agent 执行能力的最小可复用单元，正在快速膨胀。然而，随着Skill 数量增多，不同 Skill 间存在重复与相似内容，执行过程黑盒、评测结果不可追溯，导致 Skill 效果无法量化感知，难以持续优化。

### 核心挑战

| 挑战 | 描述 |
| :--- | :--- |
| **1. Skill 数量爆炸，召回率下降与 Token 成本飙升** | 基于大量文档生成的 Skill 往往语义高度相似，导致召回率从 95% 急剧下降至 30% 以下，Token 成本显著增加。 |
| **2. 评测维度不全面，缺乏可解释与可追溯能力** | 当前评测大多停留在"成功或失败"的结果导向，缺乏 ROI、执行路径偏差等过程级评测，无法定位问题根因。 |
| **3. Skill 优化缺乏执行过程数据输入** | 优化主要依赖"最终结果是否正确"这一单一信号，缺乏分步骤数据，无法判断瓶颈来源，影响优化效果。 |

---

## ✨ 三大核心能力

### 🤖 1. 基于语义聚合的模式抽取

**核心思路**：去冗余、合相似、抽模式

- **去冗余**：从海量案例文档中剔除重复描述、无关上下文与噪声信息
- **合相似**：基于文本聚类相似度算法结合大模型语义理解，合并语义高度相近的 Skill
- **抽模式**：提炼通用问题模式与标准解决路径，生成可复用的模式化 Skill

**效果**：将 Skill 数量降低至少一个数量级，提升召回率的同时有效降低 Token 消耗成本。

👉 *[了解详情：Skill 自动生成技术解析](https://gitcode.com/openeuler/witty-skill-insight/wiki/%E5%85%B3%E9%94%AE%E6%8A%80%E6%9C%AF%E8%A7%A3%E6%9E%90)*

### 📊 2. 多维评测与过程级可追溯

**核心思路**：构建多维评测体系 + 引入标准数据集 + 提供过程级可追溯能力

- **多维评测指标体系**：包括准确率、时延、Token 成本、ROI 等多维度评测方法
- **内置标准评测数据集**：集成 SkillsBench 等行业标准数据集，支持自定义扩展
- **执行过程可追溯**：实时生成动态执行流程图，清晰标识未按预期执行的步骤
- **偏差定位与原因分析**：逐步回溯执行路径，区分模型推理问题还是 Skill 定义不合理

**效果**：将评测从结果层提升到结果+过程的多维度评测，实现评测结果的全面客观分析。

👉 *[了解详情：多维观测与分析技术解析](https://gitcode.com/openeuler/witty-skill-insight/wiki/%E5%85%B3%E9%94%AE%E6%8A%80%E6%9C%AF%E8%A7%A3%E6%9E%90)*

### 🔄 3. 全链路数据驱动优化

**核心思路**：收集结果与执行过程的全链路数据，形成自动化反馈闭环

- **执行链路全追踪**：每一步操作、模型推理与工具调用都被记录，识别关键瓶颈
- **数据驱动优化闭环**：执行数据被结构化并反馈至 Skill 优化环节，支持问题定位和持续改进

**效果**：使 Skill 优化不再停留在"调文本、改结果"的浅层，而是基于执行数据的深度优化，数据驱动 Agent 自进化。

👉 *[了解详情：Skill 自优化技术解析](https://gitcode.com/openeuler/witty-skill-insight/wiki/%E5%85%B3%E9%94%AE%E6%8A%80%E6%9C%AF%E8%A7%A3%E6%9E%90)*

---

## 🎨 功能展示

### 执行详情钻取

<p align="center">
  <img src="docs/images/execution_detail.png" width="80%" />
</p>
<p align="center"><em>执行详情：端到端对话轨迹回放 + skill有效性分析</em></p>

### 耗时 & Token 分析

<p align="center">
  <img src="docs/images/execution_steps.png" width="80%" />
</p>
<p align="center"><em>逐步拆解 LLM & Tool token和耗时，并支持 Top5 高亮 / 排序与数据详情联动跳转</em></p>

### 多维度指标对比

<p align="center">
  <img src="docs/images/metrics_comparison.png" width="80%" />
</p>
<p align="center"><em>指标对比：横向对比不同模型、版本的准确率 / 时延 / Token 消耗</em></p>

---

## 🚀 快速开始

### 前置要求

- **Node.js** >= 18
- **npm** >= 9

### 一键安装

```bash
npx skill-insight install
```

### 快速体验

安装完成后，即可开始第一次观测（以OpenCode为例）：

1. **打开 OpenCode** 终端
2. **执行一个简单任务**：
   ```
   你好，请介绍一下你自己
   ```
3. **打开浏览器** 访问 `http://localhost:3000`，并登陆初始账号`admin`，在主页面可以看到刚才执行的记录

🎉 恭喜！您已完成第一次数据采集与观测。

*更多功能，请参考[用户手册](https://gitcode.com/openeuler/witty-skill-insight/wiki/%E7%94%A8%E6%88%B7%E4%BD%BF%E7%94%A8%E6%89%8B%E5%86%8C)*

---

## 📂 项目结构

```
.
├── src/                          # 看板前端 + 后端 API
│   ├── app/api/                  # API 路由
│   │   ├── setup/                # 一键配置脚本生成
│   │   ├── skills/               # Skill CRUD、版本管理、上传下载
│   │   ├── sync/                 # Skill 同步与 Manifest
│   │   ├── upload/               # 执行数据上报
│   │   ├── auth/                 # API Key 用户认证
│   │   └── ...                   # 评估、配置、设置等
│   ├── components/               # React UI 组件
│   └── lib/                      # 核心逻辑
│       ├── auth.ts               # 通用认证模块
│       ├── judge.ts              # LLM 自动判题引擎
│       ├── data-service.ts       # 数据读写服务
│       └── prisma.ts             # 数据库客户端
├── prisma/schema.prisma          # 数据库模型定义
├── scripts/                      # 核心采集脚本
│   └── opencode_plugin.ts        # OpenCode 原生插件
├── public/sync_skills.ts         # 客户端 Skill 同步工具
├── skill/                        # 预置 Skill 示例库
├── docs/                         # 文档与架构图
└── .env.example                  # 环境变量模板
```

---

## 🗺️ Roadmap

### 当前已实现 ✅

- [x] **无感采集与接入**：OpenCode, Claude Code, OpenClaw 无侵入数据采集
- [x] **多维指标监测与对比**：跨模型/框架维度的 Latency, Token, Accuracy 对比
- [x] **LLM 自动评分与深度归因**：基于标准的判题机制，精准区分模型能力缺失与 Skill 缺陷
- [x] **Skill 版本管理与同步**：版本隔离、跨框架代码分发
- [x] **数据集管理** — 统一管理和分享标准评测数据集
- [x] **Skill 自动生成**：基于案例文档自动提取 Skill 并执行文本聚类合并相似项
- [x] **Skill 自优化**：基于动静态评估反思机制，驱动 Agent 自动演化为高质量 Skill
- [x] **用户管理**：多用户隔离与 API Key 认证机制
- [x] **Skill 可视化** — 独立展示 Skill 的执行流程与控制流结构

### 计划中 🚧
- [ ] **团队协作** — 团队资源共享、权限隔离与防并发冲突机制
- [ ] **成本控制优化** — 细粒度 Token 消耗分布分析与改进建议
- [ ] **多Skill关联分析** — 分析 Skill 之间的依赖关系，优化执行效率

---

## 📄 License

[MIT](LICENSE)

---

<p align="center">
  <strong>Witty-Skill-Insight</strong> — 让每一次 Skill 迭代都有据可依
</p>
