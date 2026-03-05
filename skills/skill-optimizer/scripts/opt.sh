#!/usr/bin/env bash
# 此脚本用于包装 skill-optimizer main.py，自动处理环境依赖与执行。

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" &> /dev/null && pwd)"
OPT_DIR="$(dirname "$SCRIPT_DIR")"
VENV_DIR="$OPT_DIR/.opt"

# 1. 检查有没有安装 uv
if ! command -v uv &> /dev/null; then
    echo "⚠️ 错误: 未找到 'uv' 命令。"
    echo "Skill Optimizer 需要 'uv' 作为高性能的 Python 环境管理器。"
    echo "请执行以下命令进行安装："
    echo "curl -LsSf https://astral.sh/uv/install.sh | sh"
    echo "安装完成后，请打开一个新终端重试。"
    exit 1
fi

cd "$OPT_DIR"
if [ ! -d "$VENV_DIR" ]; then
    echo "⏳ 正在初始化隔离的 Python 虚拟环境 (.opt)..."
    uv venv "$VENV_DIR"
    echo "⏳ 正在安装底层依赖项..."
    # 强制静默或者显示进度安装依赖
    uv pip install -r requirements.txt
    echo "✅ 环境依赖准备完毕！"
else
    # 也可以轻量级地 verify 一下
    uv pip install -r requirements.txt > /dev/null 2>&1 || {
        echo "⏳ 正在更新底层依赖项..."
        uv pip install -r requirements.txt
    }
fi

echo "🚀 正在启动 Skill Optimizer..."
uv run scripts/main.py "$@"
