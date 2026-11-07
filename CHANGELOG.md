# 更新日志

本文件记录 dsh-devops 的所有重要变更。
格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [未发布]

本轮修复**控制端环境变量跨机泄漏**、**流水线详情页空白**与**节点运行态不显示**。

### 修复

**控制端环境变量泄漏到远端（阻断级）**
- **`NODE_OPTIONS` 跨机泄漏**：运行环境组装把宿主的整个 `process.env` 作为最低优先级层并入，再由 SSH 以 `env 'K=V'` 原样转发到目标机，且全链路没有键名过滤。Windows 控制端的 `NODE_OPTIONS=--require="C:/.../explorer-visibility-*.cjs"` 因此抵达 Linux 目标，`node` 在启动期就去 require 一个只存在于控制端的路径，抛 `MODULE_NOT_FOUND`（`Require stack: - internal/preload`），凡是用到 `node`/`npm` 的步骤立即失败（实测 `npm ci` 199ms 即退出码 1）。`node -v` 不加载 preload 所以仍正常，这正是日志里 `node v22.22.1 / npm ` 中 npm 版本为空的原因。
- 注意区分**阻断**与**静默**：同一根因下，首行为 `set -u`（无 `-e`）的步骤会因命令替换失败不中止而**报成功**（预检步骤即如此），首行为 `set -eu` 的步骤则立即失败——排查时不能被「前面步骤都成功」误导。
- 本轮先以流水线侧缓解（变量 `NODE_OPTIONS` 置空 + 脚本内 `unset NODE_OPTIONS NODE_REPL_EXTERNAL_MODULE`）；代码层「只对 local 并入宿主环境」的根治尚未合入，见「已知问题」。

**流水线详情与运行态（界面）**
- **列表「阶段」列恒为 `0/0`**：列表接口（`GET /api/pipelines`）为减载荷**刻意不返回 `stages`**，只给 `stageCount`/`jobCount`，而界面读的是 `stages.length`。现按摘要字段渲染，并在缺失时回退。
- **详情页空白、显示「这条流水线还没有阶段」**：详情优先使用了不含 `stages` 的列表缓存，且 `openDetail` 命中缓存即提前返回，从不取完整定义。现始终按 id 现取完整定义，缓存仅作兜底；取数期间显示「加载中…」，不再闪现空态。
- **节点永不变色、无计时**：运行摘要只有步骤**计数**（`stepCounts`）而无步骤明细，前端因此永远推导不出节点状态。现 `listRuns` 摘要附带**轻量 `steps`**（仅 `id/name/status/startedAt/finishedAt/exitCode/error`，剔除 `logPath/with/env` 等重字段）。
- 节点卡片按状态着色（成功绿 / 运行中蓝并呼吸 / 失败红 / 未执行或跳过灰），运行中显示实时累计耗时（仅在存在运行中节点时开启计时器），并补状态徽标以兼顾色觉障碍。
- **运行历史**改为按 `pipelineId` 单独获取该流水线全部运行（不再受全局列表 `limit` 截断），列出 id/状态/触发/开始/耗时，整行可点（含键盘可达）进入运行详情查看参数与日志。

### 已知问题
- 控制端环境变量的**代码层根治**尚未实现：环境组装仍会把宿主 `process.env` 并入并发往远端。当前依赖流水线侧显式清理；建议后续改为「仅 `local` 执行器并入宿主环境，远端只传显式声明的变量」。

### 修复

**跨机执行（阻断级）**
- **缺少 `await`**：`engine/run.js` 调用 SSH 执行器的 `run()`（async）时未 await，拿到的是 pending Promise，`handle.done` 为 undefined 并抛「引擎异常」——SSH 路径上第一步就崩。（契约 §3.7）
- **脚本从不抵达远端**：`shell.exec` 只把脚本写成**控制端**临时文件，再把该路径当 argv 交给执行器；目标机上永远不存在这个文件。现在接入契约本来就留好的 `spec.script` 通道（`argv` 与 `script` 二选一）：`shell.exec` / `node.exec` / `python.exec` 在声明 `supportsScript` 的执行器上直接交付脚本文本。`local` 执行器**保持不变**（其 Windows 编码与 `$LASTEXITCODE` 退出码传播逻辑已验证，改它会丢退出码）。
- **执行器能力标志贯通惰性代理**：`executors/index.js` 的惰性 SSH 代理此前不暴露任何能力字段，`supportsScript` 必须同时声明在代理与真实执行器上，否则路由静默失效。
- **工作目录回落到控制端**：`normalizePipeline` 对 job 采字段白名单却漏掉 `workdir`，导致「作业级工作目录」静默失效；`run.js` 的 cwd 优先级补入 `server.probe.workdir` 回退（探测已拿到目标机真实目录）。
- **控制端 PATH 跨机泄漏**：`run.js` 的 PATH 兜底原先把控制端 `process.env.PATH` 注入并发往远端（远端 `git`/`systemctl` 可能找不到）。现在兜底只对 `kind === 'local'` 生效。
- **解释器解析不再按控制端平台挑**：SSH 目标上 `python` 常不存在（只有 `python3`），远端按 POSIX 顺序解析。
- **`shell` 值不再静默降级**：无法识别的解释器名、以及 Windows 控制端上的 POSIX shell 名（`sh`/`bash`/`zsh`/…）此前会被静默当成 `cmd.exe` 执行**且报成功**。现在抛出 `SHELL_UNSUPPORTED` 并给出可照做的建议；显式给出 Git bash 绝对路径时按其真实意图执行。
- **脚本包裹按解释器家族**：SSH 侧按 `sh/bash/zsh`→`-c`、`cmd`→`/d /s /c`、PowerShell→`-Command`（附 `exit $LASTEXITCODE` 以传播退出码）分别构造，脚本始终作为独立参数，不做字符串拼接。
- **无解释器 + 有环境变量时脚本首行被吃掉**：`env 'A=1' set -eu` 开头的脚本会让 `env` 把首行当成要执行的命令名（实测 `env: 'set': No such file or directory`，且退出码仍为 0 属静默错误）。未显式指定解释器时改为由 `sh -c` 承载脚本文本。
- **超长 / 含 NUL 的脚本给出可读错误**：脚本文本改走命令行后受 OpenSSH `MaxCommandLength`（约 256KB）约束，超限时 sshd 会**直接断连**且只回一句 `exec request failed on channel 0`。现在在发送前拦下，报 `REMOTE_COMMAND_TOO_LARGE` / `SCRIPT_CONTAINS_NUL` 并给出「先把脚本落到目标机再执行」的建议。

### 文档
- 修正 `shell.exec` 字段描述与实际行为不符之处（脚本落盘位置、`auto` 的判定平台）。

## [0.2.0] - 2026-11-05

本轮聚焦三件事：**把编排界面做成真正好用的工作台**、**补齐 SSH 认证与互操作缺口**、**修掉一批交互硬伤**。

### 新增

**编排界面**
- 画布改为**横向布局**：阶段成列、节点为块状卡片；列头、列间、画布末尾三处都能就地插入新阶段（含并行开关），`needs` 依赖边按列布局重算走线（forward / vertical / backward）。
- 节点编辑改为**覆盖画布的编辑浮层**：点节点浮出、背景虚化；**点浮层外部即自动保存并收起**，Esc 同样关闭；默认宽度 620px，可拖拽调整并记住宽度。
- 流水线**详情页**与编辑器同构（阶段列 + 块状卡片）但只读；点节点从右侧滑出**圆角悬浮抽屉**，内部可在「节点信息 / 日志」间切换。
- 流水线列表可点名称进详情；运行详情可一键跳转编辑对应流水线。
- 状态色体系：节点/步骤卡片、阶段列头、列表行、状态点按 running / success / failed / canceled / pending 着色，运行中带呼吸动效（尊重 `prefers-reduced-motion`）。

**执行与认证**
- **SSH 私钥支持选择本机文件**：`auth.keyPath` 显式路径 → 凭据引用 → `keyRef` 本身为文件路径 → 插件配置，四级优先级；路径不存在 / 是目录 / 超限（>1MB）都有稳定错误码与可读原因，私钥内容只进打码列表、绝不落日志（契约 §2.3）。
- 新增字段类型 **`ref:pipeline`**：`pipeline.call` 节点的「子流水线」改为可搜索下拉，按名字 / ID / 描述**模糊匹配**、命中高亮、显示名字而非只有 ID，同时允许手填未知 ID。

**可观测与状态**
- 日志面板改为**深色终端**观感：固定深色底（不再随浅色主题变白）、等宽字体、`tab-size:2`。
- 新增**共享语法着色引擎** `src/client/syntax.js`（零依赖纯函数）：识别 shell / python / javascript / json / yaml，区分关键字、字符串、注释、数字、函数、内置命令、操作符、变量、类型；10 类 token 由 CSS 调色板着色（注释斜体、关键字加粗）。日志与代码编辑器共用同一套。
- 代码编辑器升级为「着色层 + 透明 textarea 叠加」：语法高亮、行号、随内容自动增高、**一键放大到全屏编辑器**。
- 运行创建时保存**流水线定义快照** `run.pipelineSnapshot`：**编辑流水线不再影响已运行或运行中的运行**（契约 §2.5）。
- 离开 DevOps 界面再回来**保留视图状态**：当前页签、正在编辑 / 查看的流水线、选中节点、列表筛选，重进时按 id 重新取数（不缓存陈旧数据）。

### 修复

- 修复新增 SSH 服务器后「测试连接」**必然失败**：解析执行器时漏传 `server`，任何 SSH 服务器都会报 `createSshExecutor 需要 server 参数`（与网络、凭据无关）。
- 修复私钥路径 `keyPath` 被 API 白名单丢弃：`safeAuth` 同时用于写入与读取，不修则字段永远存不下来。
- 修复删除阶段**没有二次确认**且**不清理悬空 `needs`**：删除后校验报 `missing-field`、运行报「依赖了不存在的 job」。
- 修复点击节点 / 新增节点后报 `cannot get property "snippets" without inject`：字段控件曾把宿主 Cordis context 当数据包读取，现由 App 用 state 构造 `fieldCtx` 下发，并在字段层做保护性读取。
- 修复右下角状态栏：不再在没有活跃运行时拿「最近一次失败」冒充当前状态；活跃运行全部平铺可点（超过 3 条折叠）；导航未注册时点击不再静默失效；新增显式「收起 / 显示状态栏」入口。
- 修复**滚动区域未隔离**：`.dsh-devops-body[data-flush="true"]` 早已定义却从未被设置，导致整页滚动、编辑区无法各自滚动；画布横向滚到底后够不着「添加阶段」。
- 修复 `start({ pipeline })` 用调用方活对象执行的问题：现在以提交时的冻结副本建图并执行。
- 修复运行详情「全部展开」实际只展开第一条；从模板页跳转无故弹出「新建流水线」模态框；「重试此步」按钮自身无 handler。
- 修复 `stderr` 行用后代选择器改整行颜色、**吃掉整行语法着色**的问题（改为左色条 + 淡底）。
- 修复 `template.instantiate` 连续两次 `Date.now()` 导致同一次实例化 `createdAt` 与 `updatedAt` 可能差 1ms，进而让「确定性」用例跨毫秒随机变红（实测竞态率约 0.44%）。
- 修复测试定时器泄漏：`RunDetail` 的每秒 `setInterval` 在桩环境下无人清理，导致 `node --test` 进程挂死。
- 修复 `ssh2` 缺失时错误信息被上一层掩盖，用户看不到真实原因。
- 修复**插件对外自报版本错乱**：`index.js` 硬编码 `VERSION = '0.1.0'`，而 package.json 已是 0.2.0，
  `/api/meta` 返回旧版本，导致下载用户看到版本对不上。现改为从 package.json 读取（单一事实源），
  并加版本一致性回归测试锁死。
- 修复 SSH 私钥路径选了公钥（`.pub`）时只在连接阶段报模糊失败的问题：现直接识别并提示
  「所选文件是公钥，请选去掉 .pub 的私钥」（错误码 `private-key-file-is-public`）。

### 变更

**文档归位：README 只讲「怎么用」**
- `docs/TROUBLESHOOTING.md`（新增）：**故障排查**整节从 README 迁出——步骤卡住不动（phase 流转）、
  连接失败归因表、常见问题表；并补充「测试连接」按错误码的排查顺序、删阶段遗留 `needs`、
  改源码后没生效（需重建 `client.js` / 重启宿主）等新条目。
- `CONTRIBUTING.md`（新增）：**开发与测试**节与**目录结构**从 README 迁出，并补充测试约定
  （真实实现优先于假桩、修 bug 用例要能抓住该 bug、测试进程必须能自然退出）。
- `docs/KNOWN-ISSUES.md`：运行边界与已知问题从 README 迁出。
- README 的目录同步更新；正文不写任何关于文档分工的说明性文字，只在末尾留一组文档链接。

- `scripts/build-client.mjs` 模块顺序登记 `syntax.js`。
- 字段类型白名单（`nodes/index.js`、`model/schema.js`、`test/nodes.test.mjs` 三处）同步加入 `ref:pipeline`。

### 测试

测试套件从 328 增至 **605** 条，新增覆盖：语法着色引擎、日志终端渲染、代码编辑器、横向画布、编辑浮层、滚动分区、视图持久化、流水线引用模糊匹配、SSH 私钥文件与执行器解析回归。

## [0.1.0] - 2026-11-04

首个版本。定位是 **AI 原生的 DevOps 流水线工作台**，而不是又一个传统 CI 界面。

### 新增

**流水线引擎**
- 可视化流水线定义：阶段（stage）→ 作业（job）→ 节点（node），支持阶段内并行/串行。
- 跨阶段依赖 `needs`（DAG 模式）；与阶段模式互斥，混用会被校验拒绝。
- 失败传播、`allowFailure`、`when`（`on_success`/`always`/`manual`）、重试（指数退避）、超时、取消。
- 模板插值：模板 body 用 `${{ params.x }}`；节点参数用 `${env.X}` / `${variables.X}` / `${steps.<jobId>.outputs.<key>}` 等单花括号占位（未定义变量直接报错，不静默留空）。
- 子流水线调用（`pipeline.call`），含引用环检测与深度限制。

**执行位置：地址决定一切**
- `127.0.0.1` / `localhost` / `::1` / 本机主机名 → 本地执行器。
- 其它地址 → SSH 远端执行器（基于 `ssh2`，可选依赖，缺失时给出明确提示）。
- 两种执行器共享同一契约，节点与引擎代码不区分本地/远端，日志格式完全一致。
- 远端 stdout/stderr 实时回传，与本地日志走同一条管线。

**环境供给（provisioner）**
- 连接后自动探测：OS/发行版、shell、工作目录、已装运行时版本、可用包管理器/版本管理器、`sudo` 是否免密。
- 按需安装或切换运行时：Python 优先 `uv`，其次 `pyenv`，再次发行版包管理器；Node 优先 `nvm`/`fnm`/`mise`。
- **默认不擅自安装**：缺少运行时会让该步骤失败并给出可一键执行的建议；只有显式开启 `allowProvision` 才自动安装。
- 安装结果（解释器绝对路径）缓存复用，并完整记录命令与输出，可回溯"这个 Python 3.11 是怎么来的"。

**节点系统**
- 18 个内置节点，覆盖执行、文件、制品缓存、流程控制、环境、集成、通知、变量 8 个分类。
- 节点字段由描述符声明类型，前端按类型渲染控件；**新增节点无需改动前端**。
- 自定义节点：界面内创建，落盘为数据目录内的 `.mjs`；默认禁用（`allowCustomNodeCode`），开启需显式确认。

**界面**
- 侧栏 DevOps 图标进入整页工作台，页内二级导航：概览 / 流水线 / 模板 / 运行 / 服务器 / 资源库 / 节点库 / 设置。
- 三栏流水线编辑器：节点面板 + 阶段泳道画布（拖拽排序、跨泳道移动、并行开关、`needs` 依赖边）+ 按字段描述符渲染的检查器。
- 运行详情：进度环、阶段泳道、步骤卡片；**点击卡片展开实时日志面板**（SSE 流式、自动滚动、暂停跟随、关键字过滤、下载）。
- 状态可视化：全局悬浮状态栏（活跃运行、当前步骤、实时耗时、服务器健康灯、失败徽标）+ 页内状态条。
- 卡住诊断：步骤 phase 流转（连接中/供给中/传输中/执行中/收尾中）、"已多久无输出"、临近超时倒计时、失败归因与建议动作。
- 类型化控件：目录/文件选择器（可浏览、可校验）、glob 输入（**实时命中预览**）、运行时版本选择（含一键安装）、服务器选择器、键值对、引用选择器。
- 按节点定制的表单：只展示该节点真正需要的字段。

**模板与复用**
- 存为模板、把选中值「提升为参数」、从模板一键创建（只填关键参数）、分类/标签/搜索/收藏/使用次数。
- 资源库：服务器集中维护、环境变量组（改一处全体生效）、脚本片段、**历史输入记忆**（服务器地址、路径、glob、镜像名等下次直接选，无需从别的流水线复制）。

**导出 / 导入**
- 单文件 JSON（带 `formatVersion` 与 `kind`），支持流水线、模板、整包导出。
- 导入前校验并列出冲突与缺失；密钥只导出引用名，**绝不导出明文**。

**AI 原生联动**
- 随包提供技能 `devops-pipeline-authoring`，把流水线 JSON 规范、节点参数、变量优先级、常见失败全部写进技能正文，AI 因此能产出可直接保存的配置。
- 10 个工具：列出/创建/更新/校验/运行/查状态/读日志/取消/查服务器/装环境；AI 的产出能真正落库生效。
- 校验回环：AI 提交的定义先校验，失败时返回结构化错误（字段路径 + 原因），可自我修正。
- 界面上可「让 AI 帮我写」（创建会话并预填提示词，失败降级为复制提示词）与「用 AI 解释失败」。
- **边界**：AI 可以创建和修改流水线，但**触发运行必须由用户明确要求**。

### 修复

开发期发现并修复的问题，测试套件中保留了对应的回归用例（从 README 迁移至此）：

| 问题 | 修复 | 回归用例 |
|---|---|---|
| 命令输出每行被写两遍（stdout 重复落盘） | 修正输出管道 | `test/engine-run.test.mjs` › 回归：命令输出每行只写一次 |
| `log.message` 的中文落盘变成 `??` | 修正编码处理 | `test/engine-run.test.mjs` › 回归：中文输出落盘不乱码 |
| 内置 `local` 服务器（`port: 0`）无法通过 `validateServer` | schema 按 `kind` 分档校验端口 | `test/schema.test.mjs` › store 预置的 local 服务器必须能通过 |
| `report[].overridden` 返回计数而非布尔 | 改为布尔 | `test/variables.test.mjs` › report 记录来源 |
| `engine.start` 未校验非法流水线 | 补校验并抛 `流水线不可执行：…` | `test/engine-run.test.mjs` › 非法流水线 |
| `readySet` 忽略 `when`（`always` 不执行、`manual` 被自动执行） | 接入 `whenDecision` | `test/dag.test.mjs` › when=always / when=manual |
| `engine.start` 把「依赖成环」误报成「没有任何 job」 | 用 `jobs` 数量判断空图 | `test/dag.test.mjs` › detectCycle 成环 |
| `retryStep` 先重置再判断导致静默不生效 | 调整顺序并真正重跑下游 | `test/engine-run.test.mjs` |
| 标准 `SHA256:` 指纹格式无法通过校验 | 兼容指纹与公钥两种输入 | `test/ssh.test.mjs` › 标准的 SHA256: 指纹格式必须能被校验 |
| `glob` 的 `!` 取反在 `model/glob` 与 `ssh/glob` 之间语义相反 | 统一为「命中被排除项返回 false」 | `test/glob.test.mjs` › 取反语义跨模块一致 |
| `runtime` 的 PATH 注入混用平台分隔符、且混入宿主 PATH | 按目标平台选分隔符、以已合并层为基准 | `test/variables.test.mjs` › runtime 注入 |

**安全**
- 所有命令以 argv 传递，用户输入绝不拼进 shell 命令行。
- 密钥只从凭证服务解析，日志/SSE/工具输出/导出**在写盘前打码**。
- 路径访问做 realpath containment 校验；HTTP 路由默认仅限 loopback。
- 自定义节点与导入的代码默认禁用；所有宿主注册挂 `ctx.effect()`，卸载即清理。

**工程**
- 纯 ESM、零构建、除可选 `ssh2` 外零运行时依赖（glob 与文件锁为自研零依赖实现）。
- 测试：`node --test`，覆盖模型校验、变量合并、glob、模板、存储原子性、日志偏移与打码、DAG、本地执行器、供给策略、节点注册表、导出导入、HTTP 与 SSE。

[Unreleased]: https://github.com/TKKFlash/dsh-devops/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/TKKFlash/dsh-devops/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/TKKFlash/dsh-devops/releases/tag/v0.1.0
