#!/bin/bash
# ============================================================================
# update_round.sh - 更新当前轮次计数
#
# 用法:
#   bash update_round.sh              # CURRENT_ROUND + 1
#   bash update_round.sh --round 3    # 设置为指定值
#
# 读写 .iter-state.env 中的 CURRENT_ROUND
# ============================================================================

set -euo pipefail

STATE_FILE="./.iter-state.env"
NEW_ROUND=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --round) NEW_ROUND="$2"; shift 2 ;;
        *) shift ;;
    esac
done

if [[ ! -f "$STATE_FILE" ]]; then
    echo "[update_round] 错误: 状态文件不存在: $STATE_FILE，请先运行 init_workspace.sh"
    exit 1
fi

# 读取当前轮次
CURRENT=$(grep "^CURRENT_ROUND=" "$STATE_FILE" | cut -d= -f2-)

if [[ -n "$NEW_ROUND" ]]; then
    NEXT="$NEW_ROUND"
else
    NEXT=$((CURRENT + 1))
fi

# 更新状态文件
if [[ "$(uname)" == "Darwin" ]]; then
    sed -i '' "s/^CURRENT_ROUND=.*/CURRENT_ROUND=${NEXT}/" "$STATE_FILE"
else
    sed -i "s/^CURRENT_ROUND=.*/CURRENT_ROUND=${NEXT}/" "$STATE_FILE"
fi

# 创建本轮日志目录
WORK_DIR=$(grep "^WORK_DIR=" "$STATE_FILE" | cut -d= -f2-)
mkdir -p "${WORK_DIR}/round-${NEXT}"

echo "$NEXT"
