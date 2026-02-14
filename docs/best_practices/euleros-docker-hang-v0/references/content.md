# openEuler内核缺陷导致docker卡住

## 故障现象
openEuler节点上，由于内核存在调度相关的社区问题，有低概率会触发死锁，表现为虚拟机卡住。

## 影响范围
EulerOS 版本内核存在调度相关问题，使用CPU cgroup场景下，设置cfs bandwidth，并触发CPU带宽管控，会概率性触发warn级别告警打印，该流程会持有调度的rq锁，跟其他进程发生死锁（x86_64下为ABBA锁，aarch64下为AA锁）。

## 解决方法
您可以修改配置文件中的kernel.printk参数值进行修复。kernel.printk参数用于控制内核日志信息的输出级别和方式。

1.  检查配置文件中kernel.printk参数的当前配置。
    回显中kernel.printk参数值为“7 4 1 7”，如下：

    ```bash
    grep "kernel.printk" /etc/sysctl.conf
    ```

2.  删除kernel.printk配置。

    ```bash
    sed -i '/^kernel.printk/d' /etc/sysctl.conf
    ```

3.  确认配置文件是否修改成功，执行以下命令无回显。

    ```bash
    grep "kernel.printk" /etc/sysctl.conf
    ```

4.  重新配置kernel.printk参数。
    *   **x86_64版本：**
        a. 执行以下命令：

            ```bash
            sysctl -w kernel.printk="4 4 1 7"
            ```

        b. 检查修改是否成功，执行以下命令，确认kernel.printk参数为“4 4 1 7”。

            ```bash
            sysctl -a | grep kernel.printk
            ```

    *   **arm版本：**
        a. 执行以下命令：

            ```bash
            sysctl -w kernel.printk="1 4 1 7"
            ```

        b. 检查修改是否成功，执行以下命令，确认kernel.printk参数为“1 4 1 7”。

            ```bash
            sysctl -a | grep kernel.printk
            ```