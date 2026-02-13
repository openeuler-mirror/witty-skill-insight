---
name: euleros-docker-hang-optimized
description: 诊断和修复 EulerOS 2.0 特定内核版本（5.10.0-136.12.0.86.h1687.eulerosv2r12.x86_64）中因调度缺陷导致的 Docker 容器卡住问题。该缺陷在使用 CPU cgroup 并设置 cfs bandwidth 时，会概率性触发死锁，表现为虚拟机卡住。本技能提供完整的诊断流程和修复方案，包括检查内核参数、修改 kernel.printk 配置等操作。
metadata:
  keywords: ["EulerOS", "Docker", "内核缺陷", "死锁", "CPU cgroup", "cfs bandwidth", "虚拟机卡住", "调度问题", "kernel.printk", "EulerOS 2.0", "x86_64", "aarch64"]
---

# EulerOS 2.0 内核缺陷导致 Docker 卡住修复技能

> 针对特定内核版本的调度缺陷进行诊断和修复

## 概述 (Overview)

本技能用于解决华为云 EulerOS 2.0 操作系统特定内核版本（5.10.0-136.12.0.86.h1687.eulerosv2r12.x86_64）中存在的调度缺陷问题。该缺陷在使用 CPU cgroup 并设置 cfs bandwidth 时，会概率性触发死锁，导致 Docker 容器或虚拟机卡住。技能提供完整的诊断流程和修复方案，通过修改内核参数 `kernel.printk` 来规避此问题。

## 何时使用此技能 (When to Use)

- **场景 1**：用户报告 EulerOS 2.0 节点上的 Docker 容器或虚拟机出现卡住、无响应的现象
- **场景 2**：用户环境为 EulerOS 2.0，且使用了 CPU cgroup 的 cfs bandwidth 功能
- **场景 3**：需要诊断和修复因内核调度缺陷导致的系统稳定性问题
- **场景 4**：用户明确提及内核版本为 `5.10.0-136.12.0.86.h1687.eulerosv2r12.x86_64` 或类似版本

**重要限制**：
- 仅适用于 EulerOS 2.0 特定内核版本（5.10.0-136.12.0.86.h1687.eulerosv2r12.x86_64）
- 非该版本匹配的故障不可使用本技能
- 该缺陷为概率性触发，不需要确认具体现象即可应用修复

## 核心概念

### 问题根因
EulerOS 特定版本内核存在调度相关问题，在使用 CPU cgroup 场景下，设置 cfs bandwidth 并触发 CPU 带宽管控时，会概率性触发 warn 级别告警打印。该流程会持有调度的 rq 锁，跟其他进程发生死锁（x86_64 下为 ABBA 锁，aarch64 下为 AA 锁）。

### 修复原理
通过修改 `kernel.printk` 参数值，调整内核日志输出级别，避免触发特定的告警打印流程，从而规避死锁问题。

## 诊断阶段 (Diagnosis Phase)

### 步骤 1：确认系统环境与内核版本

首先确认系统是否为受影响的 EulerOS 特定内核版本。

```bash
# 检查操作系统版本
cat /etc/os-release | grep -i euler

# 检查内核版本（必须精确匹配）
uname -r
```

### 步骤 2：检查当前 kernel.printk 配置

检查系统当前的 `kernel.printk` 参数配置，并**记录原始值**以便回滚。

```bash
# 检查 /etc/sysctl.conf 文件中的配置
grep "kernel.printk" /etc/sysctl.conf

# 检查当前系统运行时的值并记录
CURRENT_PRINTK=$(sysctl -n kernel.printk)
echo "当前 kernel.printk 运行时值: $CURRENT_PRINTK"
echo "请记录此值以便需要时回滚: $CURRENT_PRINTK"

# 检查系统架构
ARCH=$(uname -m)
echo "系统架构: $ARCH"
```

## 修复阶段 (Repair Phase)

### 步骤 3：删除现有配置并重新设置

根据系统架构执行相应的修复操作。

#### 场景 A: x86_64 架构修复流程

```bash
# 1. 删除配置文件中的现有设置
sed -i '/^kernel.printk/d' /etc/sysctl.conf

# 2. 确认删除成功（应无回显）
grep "kernel.printk" /etc/sysctl.conf

# 3. 设置新的 kernel.printk 参数
sysctl -w kernel.printk="4 4 1 7"

# 4. 验证设置是否生效
sysctl -a | grep kernel.printk
# 预期结果：kernel.printk = 4 4 1 7
```

#### 场景 B: aarch64 (ARM) 架构修复流程

```bash
# 1. 删除配置文件中的现有设置
sed -i '/^kernel.printk/d' /etc/sysctl.conf

# 2. 确认删除成功（应无回显）
grep "kernel.printk" /etc/sysctl.conf

# 3. 设置新的 kernel.printk 参数
sysctl -w kernel.printk="1 4 1 7"

# 4. 验证设置是否生效
sysctl -a | grep kernel.printk
# 预期结果：kernel.printk = 1 4 1 7
```

### 步骤 4：持久化配置（推荐）

为确保重启后配置依然生效，将配置写入 sysctl 配置文件。

```bash
# 根据架构写入相应配置
if [ "$ARCH" = "x86_64" ]; then
    echo "kernel.printk = 4 4 1 7" >> /etc/sysctl.conf
elif [ "$ARCH" = "aarch64" ]; then
    echo "kernel.printk = 1 4 1 7" >> /etc/sysctl.conf
else
    echo "不支持的架构: $ARCH"
    exit 1
fi

# 重新加载配置
sysctl -p
```

## 回滚机制 (Rollback Procedure)

如果修复后出现意外问题，可按以下步骤回滚到原始配置：

### 步骤 1：恢复运行时配置
```bash
# 使用诊断阶段记录的原始值（替换 YOUR_ORIGINAL_VALUE）
sysctl -w kernel.printk="YOUR_ORIGINAL_VALUE"
```

### 步骤 2：恢复配置文件
```bash
# 删除修复时添加的配置行
sed -i '/^kernel.printk/d' /etc/sysctl.conf

# 如果原始配置文件中曾有配置，需要手动恢复
# 或者重新启动系统（未持久化的运行时修改会在重启后失效）
```

### 步骤 3：验证回滚
```bash
# 验证配置已恢复
sysctl -a | grep kernel.printk
grep "kernel.printk" /etc/sysctl.conf
```

## 可执行脚本工具

本技能包含一个辅助脚本，可用于自动化检查 `kernel.printk` 参数的配置状态。

### 脚本位置
- `scripts/check_kernel_printk.sh`

### 脚本功能
检查系统内核参数 `kernel.printk` 的配置，包括 `/etc/sysctl.conf` 文件中的设置和当前系统运行时的值，并记录原始值。

### 使用说明
```bash
# 查看脚本使用说明
./scripts/check_kernel_printk.sh --help

# 执行脚本（无参数）
./scripts/check_kernel_printk.sh
```

### 脚本特点
- 只包含数据采集和分析相关的命令（查看、检查、诊断、监控等）
- 单个命令失败不会中断整个脚本执行
- 所有命令都会尝试执行，失败时输出警告信息
- 严格基于参考文档提取，不包含文档中未出现的命令
- **新增功能**：自动记录当前 kernel.printk 值用于回滚

**建议**：在执行修复操作前后使用此脚本验证配置状态。

## 参考文件说明

本技能基于以下参考文档构建，包含完整的故障现象、影响范围、问题根因和解决方案：

1. **`references/content.md`** (3页)
   - **内容概述**：完整的故障处理文档，包含：
     - 故障现象描述：EulerOS节点上 Docker 容器卡住或无响应
     - **影响范围说明**：**具体的受影响内核版本列表**（关键信息）
     - 问题根因分析：CPU cgroup 的 cfs bandwidth 设置触发死锁
     - 详细解决方案：修改 `kernel.printk` 参数的完整步骤
     - 架构差异处理：x86_64 和 aarch64 的不同参数值设置
   - **包含代码示例**：所有必要的命令行操作示例

2. **`references/index.md`**
   - **内容概述**：文档结构索引和统计信息
   - 总页数：3页
   - 代码块数量：1个
   - 平均代码质量：8.0/10

3. **`scripts/README.md`**
   - **内容概述**：bash 脚本的使用说明文档
   - 可用脚本：`check_kernel_printk.sh`
   - 脚本功能描述和参数说明
   - 使用示例和注意事项

## 注意事项

1.  **版本特异性**：本修复方案仅适用于 EulerOS **特定受影响的内核版本**。执行前务必确认版本匹配。具体版本请以 `references/content.md` 中的官方信息为准。
2.  **架构差异**：x86_64 和 aarch64 架构需要设置不同的 `kernel.printk` 参数值，切勿混淆。
3.  **持久化重要性**：使用 `sysctl -w` 设置的参数在重启后会失效，必须写入 `/etc/sysctl.conf` 文件。
4.  **风险提示**：修改内核参数可能影响系统日志输出行为，请确保了解修改的影响。
5.  **验证要求**：每个操作步骤后都应验证执行结果，确保配置正确生效。
6.  **回滚准备**：在执行修复前，**务必记录**当前的 kernel.printk 值。
7.  **适用范围**：本技能专门针对 Docker 容器卡住或无响应问题，不适用于其他类型的系统卡顿。
8.  **指令遵循**：此为低自由度固定脚本，请严格按步骤操作，勿自行发挥。