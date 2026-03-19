#!/bin/bash

# 修改 /etc/sysctl.conf 中的 kernel.printk 设置
SYSCTL_FILE="/etc/sysctl.conf"
PRINTK_VALUE="kernel.printk=7 4 1 7"

# 检查文件是否存在
if [ ! -f "$SYSCTL_FILE" ]; then
    echo "错误: $SYSCTL_FILE 不存在"
    exit 1
fi

# 检查是否已存在 kernel.printk 配置
if grep -q "^kernel\.printk" "$SYSCTL_FILE"; then
    # 如果存在，则替换
    sed -i "s/^kernel\.printk.*/$PRINTK_VALUE/" "$SYSCTL_FILE"
    echo "已更新 kernel.printk 配置"
else
    # 如果不存在，则追加到文件末尾
    echo "$PRINTK_VALUE" >> "$SYSCTL_FILE"
    echo "已添加 kernel.printk 配置"
fi

# 应用配置（可选）
# sysctl -p "$SYSCTL_FILE" 2>/dev/null

echo "kernel.printk 已设置为: $PRINTK_VALUE"