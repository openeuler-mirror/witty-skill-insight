#!/bin/bash
set -u

# 脚本功能：检查系统内核参数 kernel.printk 的配置
# 参数：无
# 使用示例：./check_kernel_printk.sh

# 步骤1：检查 /etc/sysctl.conf 中的 kernel.printk 配置
echo "步骤1: 检查 /etc/sysctl.conf 中的 kernel.printk 配置"
if [ -f "/etc/sysctl.conf" ]; then
    if command -v grep > /dev/null 2>&1; then
        grep "kernel.printk" /etc/sysctl.conf || echo "警告: 在 /etc/sysctl.conf 中未找到 kernel.printk 配置"
    else
        echo "警告: 命令 grep 未找到，跳过此步骤"
    fi
else
    echo "警告: 文件 /etc/sysctl.conf 不存在，跳过此步骤"
fi

# 步骤2：检查当前系统内核参数 kernel.printk 的值
echo "\n步骤2: 检查当前系统内核参数 kernel.printk 的值"
if command -v sysctl > /dev/null 2>&1; then
    sysctl -a | grep kernel.printk || echo "警告: 执行 sysctl -a | grep kernel.printk 失败或未找到匹配项"
else
    echo "警告: 命令 sysctl 未找到，跳过此步骤"
fi