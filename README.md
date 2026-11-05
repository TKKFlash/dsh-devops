# dsh-devops

> DeepSeek Harness 的 **AI 原生 DevOps 流水线工作台**：可视化编排流水线、本地与 SSH 远端执行、环境探测与自动供给、实时日志、模板与资源库、导出导入。

纯 ESM、**零运行时依赖**（`ssh2` 为可选依赖）、零构建（前端由自带脚本拼接）。Node ≥ 22.13。

---

## 目录

- [功能一览](#功能一览)
- [安装](#安装)
- [快速开始](#快速开始)
- [核心概念](#核心概念)
- [节点目录](#节点目录)
- [AI 用法](#ai-用法)
- [模板与资源库](#模板与资源库)
- [导出导入格式](#导出导入格式)
- [配置项](#配置项)
- [HTTP API](#http-api)
- [安全说明](#安全说明)
- [进一步的文档](#进一步的文档)
- [License](#license)
- [English Summary](#english-summary)

---

## 功能一览

| 能力 | 说明 |
|---|---|
| 可视化编排 | 三栏编辑器：左侧节点面板 + 结构树，中间**横向编排画布**（阶段成列、节点为块状卡片；拖拽排序与跨列移动、列间可就地插入并行阶段、`needs` 依赖边用 SVG 贝塞尔按列布局绘制、零依赖 CSS 动效并尊重 reduced-motion），右侧按节点字段描述符渲染检查器表单 |
| 两种调度模式 | **staged**（阶段串行 + 阶段内并行）与 **DAG**（跨阶段 `needs` 依赖），两者不得混用 |
| 本地 + SSH 执行 | 本机直接 `spawn`；远端经 SSH，命令一律以 **argv 数组**传递，用户输入绝不进入 shell 解释 |
| 环境探测与供给 | 探测远端 OS/架构/Shell/运行时/包管理器/sudo；缺失运行时按 `uv → pyenv → 发行版包` 顺序供给，**默认不擅自安装** |
| 实时日志 | JSONL 落盘 + 内存环，SSE 推送到界面，支持断线续传（`Last-Event-ID`）、`gap` 事件、关键字过滤、下载 |
| 状态可视化 | 全局状态栏（活跃运行数、当前步骤、实时耗时、服务器健康灯、失败徽标）、页内状态条、卡住诊断（phase 流转 +「已 Xm Ys 无输出」+ 超时倒计时） |
| 模板与资源库 | 从模板按参数类型渲染表单创建流水线；环境变量组、脚本片段、历史输入 |
| 类型化控件 | 15 种字段类型（`string`/`text`/`code`/`path.dir`/`path.file`/`glob`/`enum`/`boolean`/`number`/`server`/`runtime`/`keyvalue`/`multiselect`/`ref:envset`/`ref:snippet`），由字段描述符驱动，新增节点无需改前端 |
| 导出导入 | 单文件 JSON（`pipeline`/`template`/`bundle`），带格式版本校验；**导出物只含凭据引用名，绝不含密钥明文** |
| AI 联动 | 1 个技能 + 10 个 Agent 工具；编辑器内「让 AI 帮我写」「用 AI 解释失败」入口 |

---

## 安装

### 从市场 / npm 安装（推荐）

```bash
dsh plugin --profile web add dsh-devops
```

### 本地开发安装

```bash
dsh plugin --profile web add link:/绝对路径/dsh-devops
```

### 在 Web 界面安装

插件 → 添加插件 → 搜索 `dsh-devops`。

安装后 `cordis.patch.yml` 会把插件插入 Web profile 的配置树：

```yaml
- insert:
    - id: dsh-devops
      name: dsh-devops
      config: {}
```

**可选依赖**：只有使用 SSH 服务器时才需要 `ssh2`。

```bash
npm i ssh2
```

未安装时，把步骤的服务器指向远端会得到明确提示：「未安装可选依赖 ssh2，无法使用 SSH 服务器……或把该步骤的服务器改为『本机（local）』」。本地流水线不受影响。

---

## 快速开始

1. **打开面板**：安装后侧边栏出现 **DevOps** 入口，点击进入工作台；页面内左侧为二级导航：概览 / 流水线 / 模板 / 运行 / 服务器 / 资源库 / 节点库 / 设置。
2. **确认执行位置**：内建 **本机（local）** 服务器开箱可用。要跑在远端，先去「服务器」页新增 SSH 服务器并点「测试连接」。
3. **建一条流水线**：在「流水线」页新建，拖入一个 `shell.exec` 节点，脚本写 `echo hello`，服务器选「本机」。
4. **运行**：点「运行」，在「运行」页点开步骤卡片展开实时日志。
5. **看状态**：底部全局状态栏显示当前运行与当前步骤；长时间无输出会提示「已 Xm Ys 无输出」。

也可以直接让 AI 帮你生成（见 [AI 用法](#ai-用法)）。

---

## 核心概念

### 阶段、并行与 needs

```jsonc
{
  "stages": [
    {
      "id": "build", "name": "构建",
      "parallel": false,          // 阶段内是否并行；与 needs 互斥
      "jobs": [
        { "id": "compile", "name": "编译", "node": "shell.exec",
          "server": "local",
          "needs": [],            // 跨阶段依赖的 job id 数组
          "retry": { "max": 0, "delayMs": 1000 },
          "timeoutMs": 600000,
          "allowFailure": false,
          "when": "on_success",   // on_success | always | manual
          "with": { "script": "npm ci && npm run build" },
          "artifacts": ["dist/**"] }
      ]
    }
  ]
}
```

- **staged 模式**（默认）：没有任何 job 带非空 `needs` 时，**阶段串行**执行，阶段内由 `parallel` 决定并行或串行。
- **DAG 模式**：任一 job 带非空 `needs` 时，整条流水线转为 DAG 调度，跨阶段依赖生效。
- **不得混用**：同时存在 `needs` 与 `parallel: true` 阶段时 `validate()` 会以 `mixed-scheduling` 拒绝。
- `when` 语义：`on_success`（默认，上游失败即跳过）、`always`（无论上游成败都执行，适合清理/通知/归档）、`manual`（等待人工确认）。
- `allowFailure: true` 的步骤失败不阻塞下游，但失败本身仍记录在案。

### 变量五层优先级

合并顺序（后者覆盖前者）：

```
processEnv
  → server.defaultEnv
  → server.customEnv
  → 引用的 envSets
  → pipeline.variables
  → stage.variables
  → job.env
  → job.envSetRefs
  → node.env
  → runtime 注入（PATH / 解释器）
```

- 值为 `null` 或**空串**表示**删除该键**（最终映射为 `undefined`），可用来清掉远端登录 Shell 里的遗留变量。
- `secret: true` 的条目其 `value` 存的是**引用名**（如 `PROD_TOKEN`），真值来自 `ctx.credentials`，并在写日志前打码。
- `runtime` 注入是**前置合并**：指定运行时的 bin 目录排在最前，系统 `PATH` 仍然保留（否则 `git`、`sh` 等系统工具会找不到）。

### 执行位置判定

每个步骤的 `server` 决定在哪执行。缺省用 `defaults.server`（默认 `local`）。

- `kind: "local"` → 本机 `spawn`。
- `kind: "ssh"` → 经 SSH 执行；`host` 为本机地址时也按本地处理。

命令一律以 **argv 数组**传递。SSH 侧对每个参数独立做 POSIX 单引号转义（`'` → `'\''`），因此 `;`、`$()`、反引号、换行都只是字面量。唯一按原意执行的是节点里显式的用户脚本内容。

### 环境供给

`server.ensureRuntime` 与 `python.exec` / `node.exec` 的 `*Version` 字段会触发供给：

```
Python → uv python install → pyenv install → 发行版包（apt/yum/dnf/apk）
Node   → nvm / fnm / mise → 系统 node
依赖   → 系统包管理器
```

**默认 `allowInstall: false`**：缺失时**不擅自改远端系统**，而是返回 `{ ok:false, error, suggestion }`，`suggestion` 是可直接照做的说明（含具体命令）。在服务器上设置 `allowProvision` 并在步骤里打开 `allowInstall` 后才会真正安装，全过程经 `onLog` 上报，界面能显示「这个 Python 3.11 是怎么来的」。

---

## 节点目录

18 个内置节点。带 `*` 的为必填字段。

### 执行（category: execute）

| 节点 | 说明 | 主要字段 |
|---|---|---|
| `shell.exec` | 在目标服务器执行一段 Shell 脚本 | `script*`、`shell`、`snippetRef`、`workdir`、`env`、`timeoutMs`、`successExitCodes`、`allowDangerous` |
| `node.exec` | 执行 Node 脚本（自动解析解释器） | `script*`、`nodeVersion`、`allowInstall`、`workdir`、`env`、`timeoutMs`、`successExitCodes` |
| `python.exec` | 执行 Python 脚本（自动解析解释器） | `script*`、`pythonVersion`、`allowInstall`、`workdir`、`env`、`timeoutMs`、`successExitCodes` |

### 文件（category: files）

| 节点 | 说明 | 主要字段 |
|---|---|---|
| `file.pick` | 按 glob 选择文件 | `server`、`base*`、`pattern*`、`failIfEmpty`、`minCount`、`includeDirs`、`maxEntries` |
| `file.write` | 写入文件 | `path*`、`content*`、`format`、`mode`、`createDirs`、`env` |
| `file.copy` | 复制文件/目录 | `from*`、`to*`、`overwrite`、`recursive`、`failIfMissing` |
| `artifact.collect` | 收集产物（可打包） | `base*`、`pattern*`、`name`、`failIfEmpty`、`archive`、`archiveDir`、`maxFiles` |

### 缓存（category: cache）

| 节点 | 说明 | 主要字段 |
|---|---|---|
| `cache.save` | 保存缓存 | `key*`、`base`、`paths`、`cacheDir`、`failIfEmpty` |
| `cache.restore` | 恢复缓存 | `key*`、`base`、`paths`、`cacheDir`、`failIfMiss` |

### 流程（category: flow）

| 节点 | 说明 | 主要字段 |
|---|---|---|
| `condition.if` | 条件判断（安全迷你表达式，**不用 eval**） | `condition*`、`failWhenFalse`、`message` |
| `wait.delay` | 等待指定时长 | `ms`、`reason` |
| `wait.approval` | 人工审批 | `message*`、`approvers`、`timeoutMs`、`onTimeout` |
| `pipeline.call` | 调用子流水线（带环检测） | `pipelineId*`、`wait`、`timeoutMs`、`variables`、`inheritEnv`、`failOnChildFailure` |

### 供给（category: provision）

| 节点 | 说明 | 主要字段 |
|---|---|---|
| `server.ensureRuntime` | 准备运行时/依赖包 | `server*`、`pythonVersion`、`nodeVersion`、`packages`、`allowInstall`、`failIfMissing` |

### 网络（category: network）

| 节点 | 说明 | 主要字段 |
|---|---|---|
| `http.request` | HTTP 请求 | `url*`、`method`、`headers`、`body`、`expectStatus`、`timeoutMs`、`retries`、`retryDelayMs` |
| `notify.webhook` | 发送通知 | `url*`、`kind`、`message*`、`onStatus`、`timeoutMs`、`failOnError` |

### 通用（category: utility）

| 节点 | 说明 | 主要字段 |
|---|---|---|
| `log.message` | 输出日志 | `message*`、`level` |
| `env.set` | 设置后续步骤可见的变量 | `variables*`、`export` |

### 字段类型与控件（前端据此渲染）

| `type` | 控件 | 额外键 |
|---|---|---|
| `string` | 单行输入 | `placeholder`、`maxLength` |
| `text` | 多行输入 | `rows` |
| `code` | 代码编辑器（行号 + 着色） | `language: shell\|python\|javascript\|json` |
| `path.dir` | 目录选择器（浏览 + 补全 + 校验） | `serverField` |
| `path.file` | 文件选择器 | `serverField` |
| `glob` | glob 输入 + 命中预览 | `baseField`、`preview` |
| `enum` | 下拉 | `options` 或 `optionsFrom` |
| `boolean` | 开关 | — |
| `number` | 数字 | `min`、`max`、`unit`（`ms` 显示为秒） |
| `server` | 服务器选择器 | — |
| `runtime` | 运行时选择器 | `runtime: python\|node` |
| `keyvalue` | 键值表 | `secret: true` 允许标记密钥 |
| `multiselect` | 标签多选 | `options` |
| `ref:envset` | 环境变量组引用 | — |
| `ref:snippet` | 脚本片段引用 | — |

### 自定义节点

自定义节点文件必须放在 `<dataDir>/nodes/*.mjs`，且需显式开启 `allowCustomNodeCode`（默认关闭，属安全约束）。

---

## AI 用法

### 技能

插件注册 `skills/devops-pipeline-authoring/SKILL.md`。当你说「创建流水线」「生成 CI 流程」「把这段脚本变成流水线节点」「检查我的流水线配置」时，AI 会按技能里冻结的 JSON 形状产出配置，并**先校验再保存**。

技能的标准工作流：先 `devops_list_pipelines` / `devops_servers` 看现状 → 确认服务器与运行时版本 → 产出 JSON → `devops_validate_pipeline` 按 `path`/`code` 逐条修正 → 保存 → **不擅自运行**，把要点与运行方式告诉你。

### Agent 工具（10 个）

| 工具 | 作用 |
|---|---|
| `devops_list_pipelines` | 列出流水线 |
| `devops_create_pipeline` | 新建流水线 |
| `devops_update_pipeline` | 更新流水线 |
| `devops_validate_pipeline` | 校验配置（返回 `ok`/`errors`） |
| `devops_run` | 触发运行（创建后不自动等待结果） |
| `devops_status` | 查询运行与步骤状态 |
| `devops_logs` | 读取日志（已打码） |
| `devops_cancel` | 取消运行 |
| `devops_servers` | 列出服务器 |
| `devops_provision` | 触发环境供给 |

### 三种联动方式

1. **在界面里点名 AI**：流水线编辑器内的「**让 AI 帮我写**」按钮——尝试用客户端会话服务创建会话并预填提示词；不可用时降级为「复制提示词到剪贴板」，你贴给任意 AI 即可。
2. **用 AI 解释失败**：运行详情页失败时的「**用 AI 解释失败**」按钮，把当前 run 的日志摘要送入会话（或复制）。
3. **直接对话**：在会话里说「帮我建一条 部署到 prod-01 的流水线」，AI 自动调用上面的技能与工具。

---

## 模板与资源库

### 模板

模板 = 参数化的流水线 + 参数定义。

```jsonc
{
  "id": "tpl-node-build", "name": "Node 构建模板",
  "category": "build", "tags": [], "icon": "box",
  "parameters": [
    { "name": "image_tag", "label": "镜像标签", "type": "string",
      "required": true, "default": "latest", "options": [], "description": "" }
  ],
  "body": { /* 同 Pipeline，用 ${{ params.image_tag }} 占位 */ },
  "usageCount": 0
}
```

- `parameters[].type` 用上表的字段类型；`options` 仅 `enum`/`multiselect` 需要非空。
- 从模板创建时，前端**按参数类型渲染表单**，只填关键参数 → 预览 → 创建。
- 编辑器里有「**提升为参数**」（把流水线某处字段抽成参数）与「**存为模板**」。
- 模板占位符 `${{ params.x.y }}`（**双**花括号）未定义时**直接报错**，不会静默留空。
- 注意区分两种占位语法：
  - **节点参数**里用**单**花括号：`${env.X}`、`${variables.X}`、`${steps.<jobId>.outputs.<key>}`、`${run.id}`、`${server.host}`。
  - **模板 body** 里才用双花括号：`${{ params.x }}`。


### 资源库

| 类型 | 用途 |
|---|---|
| 环境变量组（envsets） | 一组变量的集合，被 `envSetRefs` 引用；组内变量可标记 `secret` |
| 脚本片段（snippets） | 可复用的脚本内容，节点里用 `snippetRef` 引用 |
| 历史输入（recent） | 按字段语义记录最近输入值，表单里直接下拉直选 |

---

## 导出导入格式

### 导出

`GET /dsh-devops/api/export?kind=pipeline|template|bundle&id=`

单文件 JSON，带 `formatVersion` 与 `kind`：

```jsonc
{
  "formatVersion": 1,
  "kind": "bundle",              // pipeline | template | bundle
  "exportedAt": 1700000000000,
  "generator": "dsh-devops",
  "pipelines": [ /* ... */ ],
  "templates": [ /* ... */ ],
  "envsets":   [ /* ... */ ],
  "snippets":  [ /* ... */ ],
  "servers":   [ /* ... */ ]     // 不含内置 local
}
```

**密钥处理**：导出前做深度清洗，`password`、`privateKey`、`passphrase`、`secretValue`、`token`、`apiKey` 等字段被剔除；`secret: true` 的变量只保留**引用名**（如 `PROD_TOKEN`），`keyRef`/`passwordRef` 这类引用名照常导出。因此导出物可安全入库。

### 导入

`POST /dsh-devops/api/import`

```jsonc
{ "document": { /* 导出的 JSON */ }, "mode": "new", "includeNodes": false }
```

- 先做完整校验（格式版本、必填、id 合法性、环检测、节点是否存在），列出冲突与缺失。
- **任一条目校验失败即整体拒绝**，不会留下导到一半的半成品。
- `mode: "new"`：id 冲突时换一个不冲突的 id 新增，**不覆盖**既有数据。
- `mode: "overwrite"`：同 id 覆盖。

---

## 配置项

在插件配置里设置（也可在「设置」页调整一部分）：

| 配置项 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `dataDir` | path.dir | `<DSH_HOME>/data/dsh-devops` | 存储与运行日志的根目录 |
| `defaultServer` | server | `local` | 未显式指定时使用的服务器 id |
| `maxConcurrentRuns` | number | `2` | 同时运行的流水线数量上限（1–64） |
| `maxParallelSteps` | number | `4` | 单个运行内并行步骤上限（1–128） |
| `defaultShell` | enum | `auto` | `auto` 按目标系统探测；可选 `bash`/`sh`/`zsh`/`fish`/`pwsh`/`powershell`/`cmd` |
| `logRingBytes` | number | `524288` | 日志内存环上限，超出后旧日志只留磁盘（64 KiB–64 MiB） |
| `logRetentionDays` | number | `30` | 日志保留天数，`0` 表示不自动清理（0–3650） |
| `stuckSilenceSec` | number | `60` | 超过该时长无输出即提示「可能卡住」（5–86400） |
| `statusBar` | boolean | `true` | 是否显示界面底部状态栏 |
| `allowLanAccess` | boolean | `false` | 关闭时 API 仅接受 loopback 请求 |
| `allowCustomNodeCode` | boolean | `false` | 开启后才加载 `<dataDir>/nodes/*.mjs` |

数据布局：

```
<dataDir>/
  store/     pipelines.json  templates.json  servers.json  envsets.json
             snippets.json  recent.json  runs.json  settings.json
  runs/<runId>/steps/<stepId>.log        # JSONL，每行 {seq,ts,stream,text}
  nodes/*.mjs                            # 自定义节点（需 allowCustomNodeCode）
```

---

## HTTP API

基址 `/dsh-devops/api`。统一响应：成功 `{"ok":true,"value":...}`；失败 `{"ok":false,"message":"...","code":"..."}`（HTTP 400/404/409/413/500/503）。

```
GET  /meta
GET  /pipelines                 POST /pipelines
GET  /pipelines/:id             PUT|DELETE /pipelines/:id
POST /pipelines/:id/runs        POST /pipelines/validate
GET  /templates                 POST /templates
GET  /templates/:id             PUT|DELETE /templates/:id
POST /templates/:id/instantiate POST /templates/from-pipeline
GET  /runs?pipelineId=&status=&limit=
GET  /runs/:id
POST /runs/:id/cancel | /runs/:id/retry | /runs/:id/retry-step
GET  /runs/:id/logs?stepId=&from=
GET  /runs/:id/events           # SSE
GET  /servers                   POST /servers
GET|PUT|DELETE /servers/:id
POST /servers/:id/test | /servers/:id/provision
GET  /servers/:id/env           # 合并预览
GET  /envsets | /snippets | /recent | /nodes
POST /nodes/custom              DELETE /nodes/custom/:type
GET  /fs/list?server=&path=     GET /fs/stat
POST /fs/match
GET  /export?kind=pipeline|bundle&id=
POST /import
GET|PUT /settings
```

请求体 JSON 上限 **1 MiB**（超限 413）。默认仅允许 loopback 访问。

### SSE 协议（`/api/runs/:id/events`）

```
event: run       data: {"run": <Run 摘要>}
event: step      data: {"stepId":"compile","step": <Step>}
event: log       data: {"stepId":"compile","seq":12,"ts":0,"stream":"stdout","text":"..."}
event: gap       data: {"stepId":"compile","from":1,"to":9}   // 断线跳跃
event: ping      data: {}                                     // 每 15s
```

`id:` 行写全局 `seq`，客户端用 `Last-Event-ID` 头续传；内存环已被冲掉时先补一个 `gap` 事件再继续。

---

## 安全说明

1. **命令一律以 argv 数组传递**，用户输入绝不拼进 shell 命令行。SSH 侧逐参数单引号转义；`env` 中的 `undefined` 用显式 `unset`。
2. **密钥只来自 `ctx.credentials`**；日志、SSE、工具输出、导出**在写盘前打码**。导出物中只有引用名，没有明文。
3. **路径访问做 containment 校验**（词法 + 远端 realpath），越界即失败。
4. **自定义节点与导入的 `.mjs` 需 `allowCustomNodeCode` 显式开启**，且文件必须位于 `dataDir/nodes` 内。
5. **所有宿主注册挂在 `ctx.effect()` 内**，热重载时自动摘除，不会残留重复路由。
6. **默认 `allowInstall: false`**：缺失运行时只给建议，不擅自改远端系统。
7. **`kind: "ssh"` 不允许 `auth.type: "none"`**，避免退化成静默无认证连接；`none` 仅对本机服务器合法。
8. **默认仅 loopback 访问**；`allowLanAccess: true` 才放行局域网。
9. 高危方案（如 `curl | sh` 安装 uv/NodeSource）**默认关闭**，需显式开启 `allowRemoteInstallerScripts`。
10. 前端只允许 `require('react')`，不得引入其它第三方库。

---

## 进一步的文档

本 README 只讲**怎么用**。维护性内容一律不放这里：

| 想看什么 | 去哪 |
|---|---|
| 排障、常见问题与错误码 | [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) |
| 运行边界与已知问题 | [`docs/KNOWN-ISSUES.md`](docs/KNOWN-ISSUES.md) |
| 版本变更与修复记录 | [`CHANGELOG.md`](CHANGELOG.md) |
| 内部接口契约（唯一权威） | [`docs/CONTRACT.md`](docs/CONTRACT.md) |
| 参与开发、构建与测试 | [`CONTRIBUTING.md`](CONTRIBUTING.md) |

---

## License

[MIT](./LICENSE) © dsh-devops contributors

---

## English Summary

**dsh-devops** is an AI-native DevOps pipeline workbench plugin for DeepSeek Harness. It provides visual pipeline authoring (horizontal stage columns with block cards, drag-and-drop, DAG dependency edges), local and SSH remote execution, runtime probing and provisioning, real-time logs over SSE with resume support, templates and a resource library, and versioned export/import.

Highlights:

- **Zero runtime dependencies** (optional `ssh2` for remote servers), pure ESM, Node ≥ 22.13.
- **Security first**: commands are always passed as argv arrays — user input never reaches a shell; path access is containment-checked; secrets come only from `ctx.credentials` and are masked before any persistence, so exports contain credential *references* only.
- **Safe by default**: runtime installation is off unless explicitly enabled (`allowInstall`), the API only accepts loopback traffic unless `allowLanAccess` is set, and custom node code requires `allowCustomNodeCode`.
- **AI integration**: one skill (`devops-pipeline-authoring`) and ten agent tools (`devops_list_pipelines`, `devops_create_pipeline`, `devops_update_pipeline`, `devops_validate_pipeline`, `devops_run`, `devops_status`, `devops_logs`, `devops_cancel`, `devops_servers`, `devops_provision`).
- **Install**: `dsh plugin --profile web add dsh-devops`, or install from the Web UI plugin market. Then open the **DevOps** entry in the sidebar.
- **Tests**: `node --test test/*.test.mjs` — built-in runner, no network, no external dependencies.
