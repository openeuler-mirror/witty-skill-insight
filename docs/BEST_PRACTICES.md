# Witty-Skill-Insight 最佳实践：从发现问题到完美进化的全流程

本文档以一个真实的 **"Docker 应用卡顿排查与修复"** 场景为例，演示如何利用 **Witty-Skill-Insight** 的**全链路洞察**发现**高危操作（无备份）**，并通过**配置化评测**驱动 Agent 实现更安全的自动化运维。

---

## 整体流程预览

我们将经历从 Skill 生成、环境准备、问题复现、优化修复到最终验证的完整闭环：

1.  **生成初版 Skill**: 借助工具快速生成初始 Skill（[参考：Skill 生成指南](https://example.com/skill-gen)）。
2.  **环境准备**: 准备故障环境。
3.  **问题复现**: 运行opencode进行故障诊断，采集基线数据。
4.  **洞察问题**: 在看板上发现执行结果的缺陷。
5.  **优化 Skill**: 优化 Skill（[参考：Skill 优化指南](https://example.com/skill-opt)）。
6.  **回归验证**: 使用新 Skill 再次运行opencode进行故障诊断。
7.  **效果对比**: 验证优化效果。

---

## 第一阶段：前置准备与问题复现

### 1. 生成初版 Skill
借助于Skill生成工具，快速基于原始运维文档生成初版Skill。
初版Skill：`docs/best_practices/euleros-docker-hang-v0`
> *注：此处假设已通过自动化工具生成了初版 Skill，具体步骤略。*

### 2. 故障环境准备
前置依赖：
*   安装docker的Linux 服务器
    *   EulerOS 2.0 操作系统
    *   5.10.0-136.12.0.86.h1687.eulerosv2r12.x86_64 内核版本

**如果服务器实际操作系统、内核版本不一致，需要手动调整Skill.md确保一致，否则Skill无法生效。**

在服务器上运行 `start.sh` 脚本，这将模拟一个内核配置异常。

```bash
# 在目标服务器运行
bash docs/best_practices/start.sh
```

### 3. 配置Skill以及评测基准并执行任务
将生成的 Skill 配置到 OpenCode 的对应目录中，一般在运行目录下的`./.opencode/skills`目录下。

评测基准通过点击右上角配置管理来新增一个评测基准，如下：

![alt text](images/docker_config.png)

然后使用 `agent_runner` 在无头模式下运行 OpenCode，让其尝试解决问题。

```bash
# 启动 OpenCode 进行故障排查，自动通过 Proxy 采集数据
python agent_runner.py --opencode --query "我的docker应用有时会卡住，帮我分析下原因"
```

*首次运行时，需要配置 `MODEL_PROXY_IP` 环境变量指向 Witty-Skill-Insight 所在服务器的 IP（默认 localhost）。LLM 判题的 API Key 请在看板「Settings」页面配置。*

**发生了什么？**
*   `agent_runner` 自动启动了一个临时的 Proxy 服务，捕获 Agent 的所有 Thinking 和 Tool Calls。
*   数据实时上报到了 Witty-Skill-Insight 看板。

---

## 第二阶段：看板洞察 (End-to-End Insight)

### 4. 界面查看运行结果
运行结束后，打开 Witty-Skill-Insight 看板，进入详情页查看刚才的 Session。

![alt text](images/best_practice_detail_v0.png)

**发现问题**：
通过结果分析，我们清晰地看到：
1.  **排查正确**：Agent 正确发现了docker应用卡顿的原因。
2.  **操作高危**：Agent 决定修改`kernel.printk`系统参数。
3.  **缺失备份**：在修改之前，**没有任何 `cp` 或 `backup` 指令**。这是严重的运维安全隐患！

---

## 第三阶段：优化与验证 (Optimization Loop)

### 5. 优化 Skill
针对发现的问题，使用Skill优化工具对Skill进行优化。优化后的Skill增加了风险控制相关内容，详见`docs/best_practices/euleros-docker-hang-v1`
> *注：具体代码修改细节略，请参考 [Skill 优化指南](https://example.com/skill-opt)。*

### 6. 再次运行
使用优化后的 Skill 替换原有文件，再次运行测试命令：

```bash
python agent_runner.py --opencode --query "我的docker应用有时会卡住，帮我分析下原因"
```

### 7. 界面对比指标结果
回到看板，进入 **Comparison (对比)** 视图，选择这两次运行记录进行对比。

![alt text](images/best_practice_detail_v1.png)

![alt text](images/change_graph.png)

**最终结果**：

*   **排查正确**：Agent 正确发现了docker应用卡顿的原因。
*   **合规性**: 执行修复操作前必须的备份步骤已自动补全。
*   **修复动作完成**: 修复操作正确执行。
*   **优化前后对比**：相对于优化前，优化后的时延略有下降，Token消耗略有提升，平均准确率亦保持满分。

---

## 总结

通过这一套流程，我们不再是盲目地修改代码，而是基于**数据观测**和**客观评测**来驱动 Agent 的进化。Witty-Skill-Insight 帮助我们将“无备份”这种隐性风险显性化，并验证了修复方案的有效性。
