# 产出目录结构模板

生成排查型 Skill 时，按以下结构输出文件。

## 目录结构

```
{skill_name}/
  SKILL.md                    # 排查骨架（<500行）
  scripts/
    _lib.sh                   # 从 templates/_lib.sh 复制，不修改
    collect.sh                # 信息采集（通用+域特定）
    check_{category_1}.sh     # 按排查层级/类别拆分
    check_{category_2}.sh
    ...
  reference/                  # 按需，0~N 个文件
    {topic_1}.md
    {topic_2}.md
```

## 文件生成顺序

1. 复制 `templates/_lib.sh` → `scripts/_lib.sh`
2. 生成 `scripts/collect.sh`（信息采集）
3. 生成决策树 YAML（中间产物，不输出给用户）
4. 从决策树转换生成 `scripts/check_*.sh`（排查脚本）
5. 从决策树转换生成 `SKILL.md`（排查骨架）
6. 判断是否需要 reference，按需生成

## 脚本拆分策略

- 按排查层级拆：如网络故障按 OSI 层拆（physical/datalink/network/transport）
- 按安全类别拆：如安全故障按类别拆（auth/permissions/firewall/audit）
- 按系统组件拆：如 OOM 按用户态/内核态拆
- 每个脚本覆盖 2-4 个相关 step，不要一个 step 一个脚本

## collect.sh 结构

```bash
#!/bin/bash
source "$(dirname "$0")/_lib.sh"

echo "=== 信息采集 $(date) ==="

# --- 通用采集（所有故障域共用）---
record "sysinfo" "INFO" "$(uname -a)"
record "os_release" "INFO" "$(cat /etc/os-release 2>/dev/null)"
record "uptime" "INFO" "$(uptime)"
record "memory_overview" "INFO" "$(free -h)"
record "disk_overview" "INFO" "$(df -h)"
record "top_processes" "INFO" "$(ps aux --sort=-%mem | head -15)"
record "recent_errors" "INFO" "$(journalctl -p err --since '1 hour ago' --no-pager 2>/dev/null | tail -30)"

# --- 域特定采集（Generator 填充）---
# {根据故障域生成}

if [ "${1:-}" = "--full" ]; then
    # 完整采集模式（兜底时使用）
    record "full_dmesg" "INFO" "$(dmesg -T 2>/dev/null | tail -200)"
    record "full_journal" "INFO" "$(journalctl --since '24 hours ago' --no-pager 2>/dev/null | tail -500)"
    # {域特定完整采集}
fi

dump_json
```

## check_*.sh 结构

```bash
#!/bin/bash
source "$(dirname "$0")/_lib.sh"

echo "=== {类别名}排查 $(date) ==="

# --- Check: {失效模型名} ---
output=$(run_cmd "{描述}" {命令1} {参数})
if {判断条件}; then
    hit "{失效模型名}" "$output"
    # 苏格拉底追问
    echo "--- 时间线 ---"
    timeline "{关键词}" 24
else
    miss "{失效模型名}" "$output"
fi

# --- Check: {下一个失效模型} ---
# ...

dump_json
```
