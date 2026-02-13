
export const FAILURE_EXTRACTION_PROMPT = `
你是一位专家级的日志分析师。你的任务是分析用户与 AI 助手之间的对话历史（包括工具输出），并提取任何“中间故障”或“异常过程”。

“中间故障”或“异常过程”定义如下：
1. **工具执行错误**：代理尝试运行工具（例如 bash 命令、python 脚本）但失败了（非零退出代码、堆栈跟踪、错误消息）。
2. **逻辑/推理修正**：代理意识到自己犯了错误并明确纠正自己（例如，“我犯了一个错误...”，“之前的方法失败了...”）。
3. **超时/卡住**：代理提到等待太久或进程卡住。
4. **无效参数**：代理尝试使用带有无效参数的工具并被系统拒绝。

你将获得包含完整对话历史的最后一次交互内容。

逐步分析历史记录。对于发现的每个故障，提取：
- failure_type: (Tool Error / Reasoning Error / Timeout / Invalid Usage)
- description: 用中文简要总结出了什么问题。
- context: 导致失败的具体命令或推理内容。
- recovery: 代理如何尝试恢复（如果有）。

仅以以下 JSON 格式响应：
{
  "failures": [
    {
      "failure_type": "Tool Error",
      "description": "无法安装包 'xyz'",
      "context": "pip install xyz",
      "recovery": "代理尝试改用 apt-get。"
    },
    ...
  ]
}

如果未发现故障，请返回：
{
  "failures": []
}
`;

export function generateFailureAnalysisPrompt(
  conversationHistory: string
): string {
  return `
${FAILURE_EXTRACTION_PROMPT}

Conversation History:
${conversationHistory}
`;
}
