# Witty-Skill-Insight

Witty-Skill-Insight 是一个开源的 **Agent Skill 生成、优化、评估与观测平台**，帮助开发者量化评估 Skills 在 Agent 上的实际运行效果。通过自动采集执行轨迹、智能评分、深度归因分析，让 Skill 的每一次迭代都有据可依。

<p align="center">
  <img src="docs/images/dashboard_main.png" width="48%" />
  <img src="docs/images/dashboard_list.png" width="48%" />
</p>
<p align="center"><em>看板主界面：全景指标概览与执行历史列表</em></p>

---

## 🎯 我们在解决什么问题

| 挑战 | 描述 |
| :--- | :--- |
| **观测维度单一** | 业界同类产品主要聚焦于 Agent 单次执行细节展示，缺乏跨 Skill、框架、模型、任务的多维对比能力 |
| **评估依赖人工经验** | Agent 效果变化的根因依赖人工分析，标准不统一、效率低，缺乏智能评估 Agent 行为与 Skill 关联性的手段 |
| **数据采集侵入性强** | 接入观测平台往往需要复杂配置或侵入式修改，采集门槛高 |
| **高质量 Skill 编写难** | 运维领域复杂任务涉及多步骤、多指令与脚本，人工编写高质量 Skill 效率低 |
| **大量 Skill 召回不准** | 细分场景庞杂，大量 Skill 描述相似时精准召回困难 |

---

## ✨ 五大核心能力

### 🤖 1. Skill 自动生成

基于案例文档（一个或多个）自动提取 Skill 内容，并利用文本聚类算法对生成的多个 Skill 进行相似度分析，提示用户并自动合并高相似度的 Skill，**大幅降低 Skill 编写门槛**。

### 🔄 2. Skill 自动评估与优化

基于**动静态评估与反思**（动态运行轨迹 + Skill 质量标准），对 Skill 进行全方位评估，并自动优化为符合领域规范的高质量 Skill，实现 **Skill 迭代的闭环驱动**。

### 🔌 3. 透明代理，无感采集

**不用写一行代码**即可开始采集运行期数据。当前已支持主流 Agent 框架：

- **OpenCode** ✅ — 通过原生 Plugin 系统，毫秒级实时上报
- **Claude Code** ✅ — 通过底层本地日志旁路 Watcher 与 Alias Hook，无感实时上报能力与自动同步

### 📊 4. 多维对比

支持从 **Skill、框架、模型、用户任务**等维度，对准确率、Tokens、时延等关键指标进行**横向对比与趋势分析**，告别"只看单次执行"的局限。

### 🔍 5. 深度分析

基于 Agent 执行过程的深度分析，**挖掘 Agent 行为变化与 Skill 之间的关联**，智能区分扣分项是**模型问题**还是 **Skill 缺陷**，为后续优化提供精准依据。

---

## 🎨 功能展示

### 执行详情钻取

<p align="center">
  <img src="docs/images/execution_detail.png" width="48%" />
  <img src="docs/images/interaction_stream.png" width="48%" />
</p>
<p align="center"><em>执行详情：端到端对话轨迹回放 + 智能判题理由</em></p>

### 耗时 & Token 分析

<p align="center">
  <img src="docs/images/execution_steps.png" width="80%" />
</p>
<p align="center"><em>逐步拆解 LLM & Tool token和耗时，并支持 Top5 高亮 / 排序与数据详情联动跳转/em></p>

### 多维度指标对比

<p align="center">
  <img src="docs/images/metrics_comparison.png" width="80%" />
</p>
<p align="center"><em>指标对比：横向对比不同模型、版本的准确率 / 时延 / Token 消耗</em></p>

### Skill 管理

<p align="center">
  <img src="docs/images/skill_management.png" width="48%" />
  <img src="docs/images/skill_versioning.png" width="48%" />
</p>
<p align="center"><em>统一的 Skill 版本控制、详情查看与自动化导入</em></p>

---

## 🚀 快速开始

### 前置要求

- **Node.js** >= 18
- **npm** >= 9

### 1. 安装与启动

```bash
# 克隆代码
git clone https://gitcode.com/openeuler/witty-skill-insight.git
cd witty-skill-insight

# 安装依赖
npm install

# 使用开发模式启动服务（内置环境初始化与数据库同步）
bash scripts/restart_dev.sh
```

> `restart_dev.sh` 会自动从 `.env.example` 复制一份初始化的 `.env` 文件。您可以按需编辑 `.env`，设置以下核心配置：

| 变量名               | 必填 | 说明                                                    |
| :------------------- | :--- | :------------------------------------------------------ |
| `DATABASE_URL`       | ✅   | SQLite 数据库路径，默认 `file:../data/witty_insight.db` |

> 💡 **LLM 判题配置**：启动看板后，在「Settings」页面配置评分用的模型和 API Key（支持 DeepSeek、OpenAI 等）。

---

## 📡 接入数据采集

### 方式一：一键配置（推荐）

无需克隆代码，在任意终端运行以下命令即可自动完成 **OpenCode** 和 **Claude Code** 的自动采集装载与配置：

```bash
curl -sSf http://<DASHBOARD_IP>:3000/api/setup | bash
```

安装过程会提示输入您的 `WITTY_INSIGHT_API_KEY`（可在看板右上角获取）。

<p align="center">
  <img src="docs/images/api_key_modal.png" width="60%" />
</p>
<p align="center"><em>在看板右上角获取您的专属 API Key</em></p>

### 方式二：手动配置

1. **获取 API Key**：登录看板，点击右上角头像获取 API Key

2. **配置身份文件** `~/.witty/.env`：

   ```env
   WITTY_INSIGHT_API_KEY=sk-xxxx-xxxx
   WITTY_INSIGHT_HOST=<DASHBOARD_IP>:3000
   ```

3. **安装 OpenCode 插件**：将 `scripts/opencode_plugin.ts` 复制到 `~/.opencode/plugins/`：

   ```bash
   cp scripts/opencode_plugin.ts ~/.opencode/plugins/Witty-Skill-Insight.ts
   ```

### 开始使用

配置完成后，正常使用 Agent 即可自动上报数据：

```bash
# OpenCode 无头模式
opencode run "帮我分析下这个项目"

# OpenCode 交互模式
opencode
# 会话结束退出后，数据会自动上报到看板
```

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

## 🛠️ 配置管理

在看板的 **Config** 标签页中，您可以配置评测标准：

| 配置项 | 说明 |
| :--- | :--- |
| **Standard Answer** | 定义该问题的判题标准（如"结果中必须包含 XX 操作"） |
| **Root Causes** | 预期的根因关键点 |
| **Key Actions** | 预期的关键操作步骤 |

系统会根据这些配置对上报的数据进行**全自动评分与归因分析**。

---

## 🗺️ Roadmap

### 当前已实现 ✅

- [x] 无感采集（OpenCode / ClaueCode）
- [x] 多维指标监测与对比（Latency / Token / Accuracy）
- [x] LLM 自动评分与 Skill 深度归因
- [x] Skill 版本管理与跨框架同步
- [x] 多用户隔离与 API Key 认证

### 计划中 🚧

- [ ] **Skill 自动生成** — 从文档（PDF/Markdown）自动提取并生成 Skill，自动聚类合并相似 Skill
- [ ] **Skill 自动评估与优化** — 基于动静态评估与反思，自优化为高质量 Skill
- [ ] **Skill 流程可视化** — 独立展示 Skill 的执行流程

更多愿景请参阅 [VISION.md](docs/VISION.md)。

---

## 🤝 贡献指南

欢迎提交 Issue 和 Pull Request！

```bash
# 开发模式启动
npm run dev

# 类型检查
npx tsc --noEmit

# 代码规范检查
npm run lint
```

---

## 📄 License

[MIT](LICENSE)

---

<p align="center">
  <strong>Witty-Skill-Insight</strong> — 让每一次 Skill 迭代都有据可依
</p>
