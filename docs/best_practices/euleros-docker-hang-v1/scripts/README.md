# Euleros-Docker-Hang - Bash Scripts

本目录包含从参考文档中提取的数据采集和分析相关的bash脚本。

## 可用脚本

| 脚本 | 描述 |
|------|------|
| [check_kernel_printk.sh](check_kernel_printk.sh) | 检查系统内核参数 kernel.printk 的配置，包括 /etc/sysctl.conf 文件中的设置和当前系统运行时的值。 |

## 使用说明

### 参数说明

脚本支持以下参数：

- 脚本功能：检查系统内核参数 kernel.printk 的配置
- 参数：无
- 步骤2：检查当前系统内核参数 kernel.printk 的值

**使用示例：**

```bash
步骤1：检查 /etc/sysctl.conf 中的 kernel.printk 配置
```


### 执行脚本

```bash
# 查看脚本使用说明
./check_kernel_printk.sh --help

# 执行脚本（根据脚本要求传入参数）
./check_kernel_printk.sh [参数]
```

## 注意事项

- 脚本只包含数据采集和分析相关的命令（查看、检查、诊断、监控等）
- 脚本中的参数需要根据实际情况提供
- 单个命令失败不会中断整个脚本执行
- 所有命令都会尝试执行，失败时输出警告信息
- 脚本从参考文档中严格提取，不包含文档中未出现的命令

---

*由 BashExtractor 自动生成*