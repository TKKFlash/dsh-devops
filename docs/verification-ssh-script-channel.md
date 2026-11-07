# SSH 脚本通道修复 —— Lead 端到端验收证据

日期：2026-11-06 ｜ 环境：Windows 控制端 node v26 ｜ 目标：server-erp（阿里云 Ubuntu 26.04.1，120.25.212.233）

## 0. 回归基线
- 修复前：node --test "test/*.test.mjs" → 610 pass / 0 fail（与交接文档 §9.1.1 口径一致）
- 核心通道修复后：610 pass / 0 fail（零回归）

## 1. 根因确认（本地源码逐条实锤）
| 根因 | 文档位置 | 本地实际位置 | 结论 |
|---|---|---|---|
| 0 缺 await | run.js:447 | **run.js:447** `const handle = executor.run({` | 成立 |
| 1 脚本只落控制端 | shell.exec.js:61-75 | 同 | 成立 |
| 2 cwd 回落控制端 | run.js:394-403 | run.js:394-403 | 成立 |
| 附加（文档漏） | — | executors/index.js:141-157 惰性代理无能力标志 | 已补 |

## 2. 修复后行为（mock transport 静态验证）
原状（修复前）远端收到：
```
cd 'D:\software\Deepseek' && env 'BRANCH=...' 'cmd.exe' '/d' '/s' '/c' 'C:\...\Temp\dsh-devops-xxx\script.cmd'
```
修复后远端收到：
```
cd '/root' && env 'BRANCH=test/dingding-join' 'bash' -c 'set -eu
echo "it'\''s ok"
echo "$BRANCH"'
```
- 不含控制端盘符 ✅　不含 os.tmpdir() ✅　不含 cmd.exe ✅
- 节点的 argv 为 undefined（改走 spec.script）✅

## 3. 真机端到端（修复后的真实执行器 + 真实 server-erp）
### 3.1 单步脚本通道
```
supportsScript = true
exitCode = 0 | signal = null | timedOut = false
MARKER-OK
whoami=root
host=iZwz92cwsz06j9kw9oelqwZ
shell=bash
pwd=/root
```
旧形态对照（argv 传控制端 cmd.exe 临时路径）：**exitCode = 127** ✅ 与文档「引擎异常 → 127 → 0」三段信号吻合。

### 3.2 完整引擎栈（两阶段流水线，绑 SSH）
```
RUN STATUS : success
  step remote-echo   -> success
  step workdir-check -> success
日志：
  STAGE1-OK
  branch=[test/e2e-lead]     ← 运行时变量覆盖生效
  who=root
  shell=bash
  it's ok                    ← 单引号转义正确
  STAGE2-OK
  pwd=/tmp                   ← job.workdir 修复前被静默丢弃，现在真的生效
```

## 4. 结论
根因 0 / 1 / 2 全部修复并经真机验证；文档 §10 的静态层与真机层主要条款达成。
## 5. 补充修复（Lead 在真机/边界矩阵中新发现）

在完成上述三根因修复后，Lead 又发现并修掉两处**方案 A 引入或连带的**缺陷：

### 5.1 超长 / 含 NUL 脚本：发送前拦截（`ssh.js`）
脚本文本改走命令行后受 OpenSSH `MaxCommandLength`（约 256KB）约束，超限时 sshd **直接断连**，
客户端只看到 `exec request failed on channel 0`，用户看不出原因。现在在发送前拦截：
- `> 200KB` → `REMOTE_COMMAND_TOO_LARGE`（带可照做建议）
- 含 NUL 字节 → `SCRIPT_CONTAINS_NUL`

引擎层实测：300KB 脚本 → `step.status=failed`，`step.error` 为可读中文提示，且 mock transport 的 `exec` **未被调用**（发车前拦下）；150KB 正常通过（未误伤）。

### 5.2 无解释器 + 有 env 前缀：脚本首行被吃掉（`ssh/shell.js`）
脚本未指定解释器且步骤带附加环境变量时，曾拼成 `env 'A=1' set -eu` 开头——
`env` 把脚本**首行当成要执行的命令名**，真机报 `env: 'set': No such file or directory`，
第一行被静默吃掉（退出码仍为 0）。现改为由 `sh -c '<script>'` 承载，脚本始终是独立参数。

真机复验（server-erp）通过项：单引号 `it's ok`、`${UNSET_ONE:-默认值}`、`$(...)`、反引号、多行、空值守卫、`exit 42` 退出码传播；
且该错误行已消失。

### 5.3 新增回归用例（30 条）与捕获力证明
`test/ssh-script-channel.test.mjs` 现为 **30 条**（队友 24 条 + Lead 补 6 条：env 前缀 1、纯 argv 对照 1、长度/NUL 拦截 4）。
逐条回退验证（「用例真能捕获缺陷」的唯一证明）：
| 回退的改动 | 结果 |
|---|---|
| env 前缀修复（5.2） | 25 pass / **1 fail**（正是该用例）|
| 长度拦截 + NUL 拦截（5.1） | 28 pass / **2 fail**（正是那两条）|
| 队友在 3a78920 未修复态跑全部用例 | 7 pass / **19 fail** |

## 6. 独立验证（verifier teammate，非本文件作者）
- **修复前可捕获**：`git worktree add 3a78920` 复现三条根因，全部转红；26 条用例在未修复态 **7 pass / 19 fail**。
- **修复后复核**：全量 636/0（当时口径）、10 个改动 src + 测试文件 `node --check` 11/11、自写独立断言 14/14、真实 Git bash 转义实证 5/5。
- **`local.js` 与 HEAD 逐字节相同**（23771 bytes，SHA 一致）——本地路径零回归的硬证据。
- **真机验收**（只读）：单步 exitCode 0、旧形态对照 127、完整引擎栈 success 且 `job.workdir` 生效、node/python 跨机 exit 0。
- **判定：可以发布。** 未能复现的 Lead 结论：无。

## 7. 最终基线
```
node --test "test/*.test.mjs"  →  640 tests / 640 pass / 0 fail / 101 suites
```
（610 原有基线 + 30 条新增 SSH 通道用例，零回归）
