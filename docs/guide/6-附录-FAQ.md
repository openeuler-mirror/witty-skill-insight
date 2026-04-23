# 附录 - 常见问题（FAQ）

> **版本**: v5.0.0
> **更新日期**: 2026年4月

---

## 安装与部署

### Q1: 端口被占用怎么办？

如果启动时提示 `Port 3000 is already in use`，可以查找并终止占用端口的进程，或者换一个端口启动：

```bash
# 查找占用端口的进程
lsof -i :3000

# 终止进程
kill -9 <PID>

# 或换端口启动
npx @witty-ai/skill-insight start --port 3001
```

### Q2: 如何卸载平台？

```bash
# 停止服务
npx @witty-ai/skill-insight stop

# 删除配置文件
rm -rf ~/.skill-insight
rm ~/.opencode/plugins/Skill-Insight.ts

# 卸载 NPM 包
npm uninstall @witty-ai/skill-insight
```

### Q3: 如何查看服务日志？

```bash
# 查看平台服务日志
npx @witty-ai/skill-insight logs

# 查看数据上报日志
tail -f ~/.skill-insight/logs/claude_watcher.log
tail -f ~/.skill-insight/logs/openclaw_watcher.log
```

---

## 数据采集

### Q4: 数据采集没有上报怎么办？

按以下步骤排查：

1. 检查配置文件是否存在：`cat ~/.skill-insight/.env`
2. 检查 API Key 是否正确：`grep SKILL_INSIGHT_API_KEY ~/.skill-insight/.env`
3. 检查 Watcher 进程是否在运行（用于排查 Claude Code、OpenClaw 上报失败）：`ps aux | grep watcher`
4. 查看上报日志：`tail -f ~/.skill-insight/logs/claude_watcher.log`

### Q5: 如何修改 API Key？

**方式一：重新执行安装命令**

```bash
# Linux / macOS
curl -sSf http://<IP>:3000/api/setup | bash

# Windows
irm http://<IP>:3000/api/setup | iex
```

**方式二：手动修改配置文件**

```bash
# 编辑配置文件
nano ~/.skill-insight/.env

# 修改 SKILL_INSIGHT_API_KEY 的值
SKILL_INSIGHT_API_KEY=sk-new-key-here

### Q6: OpenCode 执行中断后，看板上看不到数据？

这通常是因为直接用 `Ctrl+C` 关闭了 OpenCode 进程，会导致数据上报失效。

正确的中断方式是：先连按两次 `Esc` 键，之后再 `Ctrl+C` 退出，就不会影响数据上报。

---

## 评测相关

### Q7: 为什么准确率显示"--"？

可能的原因：

- 未配置评估模型
- 该问题未在数据集管理中配置标准答案
- 评估模型调用失败

解决方法：检查是否已在 Settings 中配置并激活了评估模型；在数据集管理中为该问题添加标准答案；或点击"重评"按钮重新评估。

### Q8: 如何提高评测准确性？

- 使用能力较强的模型作为评测模型
- 设计清晰、明确的标准答案
- 合理设置评分项权重
- 定期对评测结果进行人工校验

### Q9: Skill Analysis 显示"No Skill Issues Detected"是什么意思？

说明所有扣分项都不是 Skill 定义的问题，而是由模型推理能力或其他因素（如网络、权限等）导致的。你可以尝试更换更强的模型，或优化提示词。

### Q10: 如何判断评测模型是否合适？

参考以下几点：评分结果是否符合你的预期；判题理由是否合理；多次评测结果是否稳定；模型调用成本是否可接受。

### Q11: 评测结果如何导出？

进入执行记录详情页，点击右上角"📤 导出"按钮，选择保存位置。导出的 HTML 文件可以离线查看。

---

## 评估模型

### Q12: 评估模型连接失败怎么办？

按以下步骤排查：

1. 检查 API Key 是否正确
2. 检查 Base URL 是否正确（不要包含 `/chat/completions` 后缀）
3. 检查网络是否可达
4. 检查模型名称是否正确

可以用 curl 命令手动测试连接：

```bash
curl https://api.deepseek.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{"model": "deepseek-chat", "messages": [{"role": "user", "content": "Hello"}], "max_tokens": 10}'
```

---

## 数据库

### Q13: 如何从 SQLite 迁移到 OpenGauss？

1. 导出 SQLite 数据：`sqlite3 data/skill_insight.db .dump > backup.sql`
2. 在 `.env` 文件中配置 OpenGauss 连接信息
3. 将数据导入 OpenGauss

---

## Skill 生成与优化

### Q14: Agent 无法触发 Skill 生成或优化？

优先检查两项：

1. 是否已执行 `npx skills add https://gitcode.com/openeuler/skill-insight.git`
2. `~/.skill-insight/.env` 是否存在，且 `WITTY_INSIGHT_HOST` 和 `WITTY_INSIGHT_API_KEY` 配置正确

### Q15: Skill 优化器反复修不好或输出不稳定？

在指令中补充以下信息通常能改善效果：

- 贴上终端中最后几行关键报错
- 说明哪些已有行为不能改变（例如"不要改变已有成功路径"）
- 要求优化后跑一次自检并展示关键输出
