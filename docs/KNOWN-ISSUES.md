# 已知限制与已知问题

本文承接原本堆在 README 里的「已知限制」。README 面向使用者讲怎么用；运行边界、
尚未解决的问题、以及修复历史属于维护信息，落在这里与 [CHANGELOG](../CHANGELOG.md)。

记录原则：**如实记录，不美化**。确定性边界（设计如此）与真实缺陷分开写。

## 设计边界（预期行为，不是 bug）

| 项 | 说明 |
|---|---|
| SSH 远端 pid | SSH 通道拿不到可靠的远端 pid（命令由登录 shell 承载），取消是「尽力终止」；步骤结果里如实标注 `pidKnown: false`。本地执行器用进程树终止（Windows `taskkill /t`），取消是确定的。 |
| `when: manual` 与 `wait.approval` | 需要人工确认，会一直等待，属预期行为而非卡住；配了 `timeoutMs` 才会超时。 |
| 高危安装方案 | `curl \| sh` 安装 uv / NodeSource 默认**关闭**，需显式开启 `allowRemoteInstallerScripts`，且方案会带 `highRisk` 标记。 |
| 自定义节点 | 需 `allowCustomNodeCode` 显式开启；未开启时 `registry.loadCustom` 不加载。 |
| 内置本机服务器 | `port` 为 `0`（本机不经 TCP），schema 对 `kind: "local"` 允许 0 或省略；`kind: "ssh"` 才要求 1–65535。 |
| 日志内存环 | `logRingBytes` 之外的旧日志只留在磁盘；SSE 落后于环时先发 `gap` 事件再继续，界面据此提示「日志有跳跃」。 |
| 导出物 | 只含凭据**引用名**，不含明文；导入后需要在目标环境重新配置对应凭据。 |
| 单实例数据目录 | `<dataDir>` 用 `mkdir` 独占目录做跨进程锁；同一目录被多个宿主进程同时写入不在支持范围内。 |

## 尚未解决

| 项 | 影响 | 现状 |
|---|---|---|
| 同步 `resolveEnv` 遇到「只有异步凭据读取器」时静默留空 | 调用方可能误以为密钥为空，而非「未解析」 | 已上报 host-core；当前建议改用 `resolveEnvAsync`。测试 `test/variables.test.mjs` 对此有显式用例与告警。 |
