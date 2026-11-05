---
name: devops-pipeline-authoring
description: 编写与修改 dsh-devops 流水线配置（Pipeline JSON）。当用户要求「创建流水线」「生成 CI 流程」「加一个构建/部署步骤」「把这段脚本变成流水线节点」「检查我的流水线配置」「导出/导入流水线」「绑定服务器执行」时使用。
---

# 编写 dsh-devops 流水线

本技能让 AI 直接产出**可被 `devops_create_pipeline` / `devops_update_pipeline` 工具保存**的流水线配置。请严格按下面的 JSON 形状产出，因为工具会先做 schema 校验，字段不符会被拒绝。

## 何时使用

- 用户描述一个构建/测试/部署流程，希望你生成流水线。
- 用户要修改已有流水线（先 `devops_list_pipelines` 找到它，再让用户贴出当前 JSON，或用 `devops_status`/`devops_logs` 观察它上次运行的结果）。
- 用户给的是一段 shell/python/node 脚本，希望变成流水线节点。
- 用户要排查流水线为什么失败（配合 `devops_status` / `devops_logs`）。

## 标准工作流

1. **先看现状**：`devops_list_pipelines` 看是否已有同名流水线；`devops_servers` 看有哪些服务器可用（决定步骤跑在哪）。
2. **确认关键信息**：目标服务器（本地用 `local`）、代码目录、需要哪个运行时版本（`python`/`node`）。缺信息就问用户，不要猜。
3. **产出配置**：按下面的形状写完整 JSON。
4. **先校验再保存**：调 `devops_validate_pipeline`。若有 `errors`，按 `path` 与 `code` 逐条修正后重试，直到 `ok:true`。
5. **保存**：`devops_create_pipeline`（新建）或 `devops_update_pipeline`（更新）。
6. **不要擅自运行**：创建/修改完成后，把「要点 + 如何运行」告诉用户，由用户决定是否运行（或用户明确要求你运行时才调 `devops_run`）。

## 流水线 JSON 形状

```jsonc
{
  "id": "build-and-deploy",        // 必填，[a-z0-9][a-z0-9-_]{0,63}
  "name": "构建并部署",             // 必填，人可读名称
  "description": "",               // 可选
  "category": "build",             // 可选，分类
  "tags": ["prod"],                // 可选
  "version": 1,
  "variables": [                   // 可选，流水线级变量
    { "name": "ENV", "value": "prod", "secret": false }
  ],
  "envSetRefs": [],                // 可选，引用资源库里的环境变量组 id
  "defaults": { "server": "local", "timeoutMs": 600000 },
  "stages": [
    {
      "id": "build", "name": "构建",
      "parallel": false,           // 阶段内是否并行
      "jobs": [
        {
          "id": "compile", "name": "编译",
          "node": "shell.exec",    // 节点类型，见下表
          "server": "local",       // 服务器 id；缺省继承 defaults.server
          "needs": [],             // 依赖的 job id；跨阶段用
          "retry": { "max": 0, "delayMs": 1000 },
          "timeoutMs": 600000,
          "allowFailure": false,   // true = 失败不阻断下游
          "when": "on_success",    // on_success | always | manual
          "allowProvision": false, // true = 缺运行时允许自动安装
          "env": [ { "name": "NODE_ENV", "value": "production", "secret": false } ],
          "envSetRefs": [],
          "with": { "script": "npm ci && npm run build" },  // 节点参数
          "artifacts": [ "dist/**" ],
          "cache": { "key": "npm", "paths": ["~/.npm"] }
        }
      ]
    }
  ]
}
```

### 调度规则的硬约束（很容易写错）

- **不要混用两种模式**：要么所有 job 都不写 `needs`（此时按「阶段串行、阶段内由 `parallel` 决定」执行），要么用 `needs` 表达完整依赖图（DAG 模式）。同时出现非空 `needs` 和 `parallel:true` 的阶段会被校验拒绝（`mixed-scheduling`）。
- `needs` 里只能写**已经存在的 job id**，且不能形成环（会被 `cycle` 拒绝）。
- 同一 `stages[].jobs[].id` 在整个流水线内必须唯一。

### 变量插值

在**节点的字符串参数**里用单花括号 `${ ... }` 引用（注意是**单层**花括号）：

```
${env.BUILD_MODE}                  生效环境变量（含 env.set 设置的）
${variables.IMAGE_TAG}             流水线/阶段/步骤变量
${steps.<jobId>.outputs.<name>}    上游节点输出（如 shell.exec 的 exitCode、env.set 的 set）
${server.id}  ${server.host}       当前步骤所在服务器
${run.id}     ${run.pipelineId}    本次运行信息
${step.id}    ${step.name}         当前步骤信息
```

要点：

- **不要写双花括号**。双花括号 `${{ ... }}` 只用于**模板**（`templates[].body` 里的 `${{ params.x }}`），在普通流水线的节点参数里不会被识别。
- 引用一个**不存在的**变量会直接报错（不会静默变成空字符串），这是刻意设计——避免生成出"看起来跑了其实参数丢了"的流水线。
- `condition.if` 的 `condition` 字段是**表达式**（`env.BUILD_MODE == "release"`），**不要**加 `${}`：
  ```jsonc
  { "node": "condition.if", "with": { "condition": "env.BUILD_MODE == \"release\"" } }
  ```
- 分隔符相关提醒：脚本内容里如果本身要用 shell 的 `${VAR}`，会被当作流水线占位符**先行插值**。要输出字面量请转义或改用 shell 的 `$VAR` 形式。


## 环境变量优先级（写配置时的心智模型）

后者覆盖前者：

```
进程环境（宿主已剔除 DSH_* 与凭证形状变量）
  → 服务器默认环境变量 server.defaultEnv
  → 服务器自定义环境变量 server.customEnv
  → 引用 envSets
  → pipeline.variables → stage.variables → job.env → job.envSetRefs
  → 节点默认环境变量（node.env）
  → 运行时注入（PATH、解释器路径）
```

把值设为 `null` 或空串 = **删除该键**。标记 `secret: true` 的值必须由 `ctx.credentials` 提供（只存引用名，不存明文）。

## 内置节点与参数

下面是 18 个内置节点的**权威参数表**（由真实节点描述符生成）。节点参数放在 job 的 `with` 对象里。

> 参数名必须完全一致。写错参数名不会报"未知参数"，而是被当作多余字段忽略，导致节点用了默认值——这类错误很隐蔽，所以请以下表为准，不要凭印象写。

### 执行（`execute`）

#### `shell.exec` — 执行 Shell
在目标服务器执行一段 Shell 脚本

- **必填**：`script`

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `script` | code(shell) | 是 | 脚本文本会写入临时文件后交给解释器执行，不拼接进命令行 |
| `shell` | enum | 否 | auto 按目标系统选择：Windows→PowerShell/cmd，Linux/macOS→bash。取值：auto / sh / bash / powershell / cmd（默认 `"auto"`） |
| `snippetRef` | ref:snippet | 否 | 从资源库选择一段脚本并拼接到脚本开头 |
| `workdir` | path.dir | 否 | 留空则使用服务器默认 workdir |
| `env` | keyvalue | 否 | 仅对本步骤生效；同名覆盖流水线变量 |
| `timeoutMs` | number | 否 | 0 表示沿用 job 的超时设置（默认 `0`） |
| `successExitCodes` | string | 否 | 可接受的退出码（默认 `"0"`） |
| `allowDangerous` | boolean | 否 | 关闭时拒绝 `rm -rf /`、`mkfs`、`dd` 等破坏性命令（默认 `false`） |

#### `node.exec` — 执行 Node 脚本
用指定版本的 Node.js 运行一段脚本

- **必填**：`script`

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `script` | code(javascript) | 是 | 脚本写入临时 `.mjs` 文件后由 node 执行；可用 ESM 语法 |
| `nodeVersion` | runtime | 否 | 留空使用 PATH 上的 node；指定版本时需环境供给能力 |
| `allowInstall` | boolean | 否 | 关闭时缺少运行时会直接失败并给出建议（默认 `false`） |
| `workdir` | path.dir | 否 | 工作目录 |
| `env` | keyvalue | 否 | 附加环境变量 |
| `timeoutMs` | number | 否 | 超时（默认 `0`） |
| `successExitCodes` | string | 否 | 可接受的退出码（默认 `"0"`） |

#### `python.exec` — 执行 Python 脚本
用指定版本的 Python 运行一段脚本

- **必填**：`script`

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `script` | code(python) | 是 | 脚本写入临时 `.py` 文件后由解释器执行 |
| `pythonVersion` | runtime | 否 | 留空使用 PATH 上的 python；指定版本时走环境供给（uv / pyenv / 发行版包） |
| `allowInstall` | boolean | 否 | 默认关闭：缺失时返回建议而不改动系统（默认 `false`） |
| `workdir` | path.dir | 否 | 工作目录 |
| `env` | keyvalue | 否 | 附加环境变量 |
| `timeoutMs` | number | 否 | 超时（默认 `0`） |
| `successExitCodes` | string | 否 | 可接受的退出码（默认 `"0"`） |

### 文件（`file`）

#### `file.pick` — 按 glob 挑选文件
在目标机上按通配符挑选文件；命中数可作为校验

- **必填**：`base`、`pattern`

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `server` | server | 否 | 覆盖 job 的服务器 |
| `base` | path.dir | 是 | 搜索根目录 |
| `pattern` | glob/多值 | 是 | 支持 `**`、`*`、`?`、`{a,b}`；`!` 前缀为排除。可多值 |
| `failIfEmpty` | boolean | 否 | 无命中即失败（默认 `true`） |
| `minCount` | number | 否 | 最少命中数（默认 `0`） |
| `includeDirs` | boolean | 否 | 是否把目录计入（默认 `false`） |
| `maxEntries` | number | 否 | 枚举上限 |

#### `file.write` — 写文件
在目标机写文件

- **必填**：`path`、`content`

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `server` | server | 否 | 覆盖 job 的服务器 |
| `path` | path.file | 是 | 目标路径 |
| `content` | code(text) | 是 | 文件内容 |
| `format` | enum | 否 | text / json（json 会先校验并格式化） |
| `mode` | enum | 否 | overwrite / append（默认 `"overwrite"`） |
| `createDirs` | boolean | 否 | 自动创建父目录（默认 `true`） |
| `env` | keyvalue | 否 | 供内容插值使用的变量 |

#### `file.copy` — 复制文件
在目标机上复制文件或目录

- **必填**：`from`、`to`

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `server` | server | 否 | 覆盖 job 的服务器 |
| `from` | path.file | 是 | 源路径 |
| `to` | path.file | 是 | 目标路径 |
| `overwrite` | boolean | 否 | 覆盖已存在目标（默认 `true`） |
| `recursive` | boolean | 否 | 目录递归复制 |
| `failIfMissing` | boolean | 否 | 源不存在即失败（默认 `true`） |

### 制品与缓存（`artifact`）

#### `artifact.collect` — 收集制品
按 glob 收集制品并归档

- **必填**：`base`、`pattern`

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `server` | server | 否 | 覆盖 job 的服务器 |
| `base` | path.dir | 是 | 搜索根目录 |
| `pattern` | glob/多值 | 是 | 支持排除模式（`!`） |
| `name` | string | 否 | 制品名（便于在运行详情里识别） |
| `failIfEmpty` | boolean | 否 | 无命中即失败（默认 `true`） |
| `archive` | boolean | 否 | 打包为压缩文件 |
| `archiveDir` | path.dir | 否 | 归档输出目录 |
| `maxFiles` | number | 否 | 文件数上限 |

#### `cache.save` — 保存缓存
按 key 保存缓存

- **必填**：`key`

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `server` | server | 否 | 覆盖 job 的服务器 |
| `key` | string | 是 | 缓存键（建议含依赖清单哈希） |
| `base` | path.dir | 否 | 搜索根目录 |
| `paths` | glob/多值 | 否 | 要缓存的路径 |
| `cacheDir` | path.dir | 否 | 缓存存放目录 |
| `failIfEmpty` | boolean | 否 | 无命中即失败 |

#### `cache.restore` — 恢复缓存
按 key 恢复缓存

- **必填**：`key`

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `server` | server | 否 | 覆盖 job 的服务器 |
| `key` | string | 是 | 缓存键（需与 save 一致） |
| `base` | path.dir | 否 | 恢复根目录 |
| `paths` | glob/多值 | 否 | 要恢复的路径 |
| `cacheDir` | path.dir | 否 | 缓存存放目录 |
| `failIfMiss` | boolean | 否 | 未命中即失败（默认 `false`，缓存 miss 通常可容忍） |

### 流程控制（`flow`）

#### `condition.if` — 条件判断
按条件决定是否失败或跳过

- **必填**：`condition`

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `condition` | string | 是 | 安全表达式，只允许比较与 `&&`/`\|\|`/`!`，如 `env.ENV == "prod"`。**不得写可执行代码** |
| `failWhenFalse` | boolean | 否 | 条件为假时失败（默认 `true`）；设为 false 则为"不满足就跳过" |
| `message` | string | 否 | 不满足时输出的说明 |

#### `wait.delay` — 延时
等待指定毫秒

- 无必填参数

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `ms` | number | 否 | 等待毫秒数（默认 `1000`） |
| `reason` | string | 否 | 等待原因，会记入日志 |

#### `wait.approval` — 等待人工确认
暂停流水线等待人工确认

- **必填**：`message`

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `message` | string | 是 | 展示给确认人的说明 |
| `approvers` | string | 否 | 期望的确认人 |
| `timeoutMs` | number | 否 | 超时毫秒 |
| `onTimeout` | enum | 否 | 超时行为（fail / proceed） |

#### `pipeline.call` — 调用子流水线
运行另一条流水线作为子流水线

- **必填**：`pipelineId`

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `pipelineId` | string | 是 | 被调用的流水线 id |
| `wait` | boolean | 否 | 等待子流水线完成（默认 `true`） |
| `timeoutMs` | number | 否 | 超时 |
| `variables` | keyvalue | 否 | 传入的变量（覆盖子流水线默认值） |
| `inheritEnv` | boolean | 否 | 继承父运行的环境变量 |
| `failOnChildFailure` | boolean | 否 | 子流水线失败时本步失败（默认 `true`） |

### 环境（`environment`）

#### `server.ensureRuntime` — 确保运行时可用
检查目标机运行时，缺失时按配置安装

- **必填**：`server`

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `server` | server | 是 | 目标服务器 |
| `pythonVersion` | runtime | 否 | 需要的 Python 版本，如 `3.11` |
| `nodeVersion` | runtime | 否 | 需要的 Node 版本，如 `20` |
| `packages` | string | 否 | 需要安装的系统包（自由文本） |
| `allowInstall` | boolean | 否 | 允许实际安装（**默认 `false`**，只探测并给建议） |
| `failIfMissing` | boolean | 否 | 缺失即失败（默认 `true`） |

### 集成（`integration`）

#### `http.request` — HTTP 请求
发起 HTTP 请求并按状态码判定

- **必填**：`url`

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `url` | string | 是 | 请求地址 |
| `method` | enum | 否 | GET / POST / PUT / PATCH / DELETE（默认 `"GET"`） |
| `headers` | keyvalue | 否 | 请求头 |
| `body` | code(json) | 否 | 请求体 |
| `expectStatus` | string | 否 | 期望状态码（默认 `"2xx"`） |
| `timeoutMs` | number | 否 | 超时 |
| `retries` | number | 否 | 重试次数 |
| `retryDelayMs` | number | 否 | 重试间隔 |

### 通知（`notify`）

#### `notify.webhook` — 发送 Webhook 通知
向 Webhook 推送消息

- **必填**：`url`、`message`

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `url` | string | 是 | Webhook 地址 |
| `kind` | enum | 否 | 渠道类型：generic / wecom / dingtalk / feishu / slack |
| `message` | code(text) | 是 | 消息内容 |
| `onStatus` | enum | 否 | 触发时机：always / success / failure（默认 `"failure"`） |
| `timeoutMs` | number | 否 | 超时 |
| `failOnError` | boolean | 否 | 通知失败是否让步骤失败（默认 `false`） |

### 通用（`utility`）

#### `log.message` — 输出日志
向步骤日志输出一条消息

- **必填**：`message`

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `message` | code(text) | 是 | 消息内容，支持 `${{ }}` 插值 |
| `level` | enum | 否 | info / warn / error（默认 `"info"`） |

#### `env.set` — 设置变量
为后续步骤设置运行级变量

- **必填**：`variables`

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `variables` | keyvalue | 是 | 键值对；可标记密钥（值会被打码）。注意是**键值对形式**，不是 `name`/`value` |
| `export` | boolean | 否 | 同时导出到后续步骤的环境变量（默认 `true`） |

### 运行时版本声明（关键能力）

需要特定版本的 Python / Node 时，用对应节点的**独立字段**（不是 `with.runtime` 对象）：

```jsonc
{ "id": "test", "name": "测试", "node": "python.exec", "server": "prod-01",
  "with": { "script": "pytest -q", "pythonVersion": "3.11", "allowInstall": false } }
```

```jsonc
{ "id": "build", "name": "构建", "node": "node.exec",
  "with": { "script": "npm run build", "nodeVersion": "20" } }
```

若要在执行前**显式确保**环境就绪（并让缺失原因更清楚），可先用 `server.ensureRuntime` 节点：

```jsonc
{ "id": "ensure", "name": "确保 Python 3.11", "node": "server.ensureRuntime", "server": "prod-01",
  "with": { "server": "prod-01", "pythonVersion": "3.11", "allowInstall": false } }
```

执行前 provisioner 会探测远端环境：已满足就直接用；缺失时**默认不擅自安装**，而是让这一步失败并给出可一键执行的安装提示。只有 `allowProvision: true`（或 `server.allowProvision: true`）才允许自动安装。因此：

- 生成配置时，如果用户没说可以改服务器环境，**保持 `allowProvision: false`**。
- 若用户明确要求"装好环境再跑"，才设 `true`，并在回复里提醒这会修改远端系统。
- Python 安装优先用 `uv`，其次 `pyenv`，再次发行版包管理器；Node 优先 `nvm`/`fnm`/`mise`。

## 服务器与执行位置

- `server` 填服务器 id。内置 `local` 代表本机（`127.0.0.1`、`localhost`、`::1` 或本机 hostname 都会走到本地执行）。
- 其它地址默认按 SSH 远端执行。
- 用 `devops_servers` 查看可用服务器及其已探测到的环境（OS、已装运行时）。**不要编造服务器 id**。

## 产出配置时的检查清单

写完后逐项自检，能显著减少校验失败：

- [ ] `id` 合法且不与现有流水线冲突。
- [ ] 每个 job 的 `node` 是上表里的类型，且有必需的 `with` 参数。
- [ ] 没有同时用 `needs` 和 `parallel:true`。
- [ ] `needs` 引用的 job id 存在且无环。
- [ ] `server` 字段引用的服务器 id 真实存在（或省略以继承默认）。
- [ ] `${...}` 占位符引用的变量都存在，且用的是**单**花括号（双花括号只用于模板 body）。
- [ ] 需要特定运行时版本的步骤写了对应独立字段（`pythonVersion` / `nodeVersion`），且 `allowInstall` 的取值符合用户意愿（默认 `false`）。
- [ ] `secret: true` 的变量只给引用名，不写明文。
- [ ] 需要产物的步骤写了 `artifacts`，需要缓存的写了 `cache`。
- [ ] 用相对路径（`file.pick` 的 `base`、`file.write` 的 `path` 等）时，确认目标服务器的工作目录是用户预期的那个（内置「本机」服务器会自动探测；远端服务器需在其「工作目录」字段里设置）。

## 常见失败与含义

| 报错关键词 | 含义与处理 |
|---|---|
| `mixed-scheduling` | 同时用了 needs 与 parallel，二选一 |
| `cycle` | `needs` 成环，检查依赖方向 |
| `unknown-node` | 节点类型不存在，比对上表 |
| `missing-field` | 必填参数缺失，看 `path` 指到哪个字段 |
| `undefined-variable` | `${{ }}` 引用了不存在的变量 |
| `command not found` | 远端没有该命令；用 `server.ensureRuntime` 或 `runtime` 声明，或换用已装工具 |
| 步骤长时间无输出 | 用 `devops_status` 看 phase（connecting/provisioning/transferring/running），可能卡在连接或等待输入 |

## 与其他能力配合

- **模板**：如果用户要"以后复用"，建议把关键值抽成参数并存为模板（界面里可「提升为参数」→「存为模板」）。
- **资源库**：服务器、环境变量组、脚本片段集中维护；配置里用 `envSetRefs` 引用，而不是到处复制粘贴。
- **导出/导入**：界面可把流水线导出成单文件 JSON 交给别人导入；导出格式与本技能描述的形状一致，因此你也可以直接改导出的 JSON 再导入。
- **AI 边界**：你可以创建和修改流水线，但**触发运行必须由用户明确要求**。
