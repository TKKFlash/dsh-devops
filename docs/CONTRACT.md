# dsh-devops 内部接口契约（冻结版 v1）

> 本文件是**唯一权威**。所有并行开发者必须先读本文件，并只修改自己 scope 内的文件。
> 任何接口变更必须由 lead 更新本文件后再实施，禁止单方面改签名。

## 0. 全局约定

- 纯 ESM（`"type": "module"`），**零构建**（除前端拼接脚本外）。Node >= 22。
- 除 `ssh2`（可选、惰性 import）外**无运行时依赖**。glob 与文件锁为自研零依赖实现。
- 所有面向宿主的注册必须包在 `ctx.effect()` 内（热重载摘除）。
- 代码注释与用户可见文案用中文；标识符与键名用英文。
- 单元测试用 `node --test`，不得依赖网络或外部服务。

## 1. 目录与所有权（写入范围，互不重叠）

| 路径 | 所有者 |
|---|---|
| `package.json` `cordis.patch.yml` `icon.svg` `locale/**` `README.md` `CHANGELOG.md` `LICENSE` `.gitignore` `docs/**` | lead |
| `src/config.js` `src/model/**` `src/store/**` | host-core |
| `src/engine/dag.js` `src/engine/run.js` `src/engine/nodes/**` `src/engine/executors/index.js` `src/engine/executors/local.js` `src/logs/**` | engine |
| `src/engine/executors/ssh.js` `src/engine/executors/ssh/**` `src/engine/provision/**` | remote |
| `src/api/**` `src/tools.js` `src/skills.js` `index.js` | api-tools |
| `client.js` `src/client/**` `scripts/build-client.mjs` | client-ui |
| `test/**` | verifier |

## 2. 数据模型（JSON 形状即契约）

### 2.1 Pipeline
```jsonc
{
  "id": "build-deploy",            // [a-z0-9][a-z0-9-_]{0,63}
  "name": "构建并部署",
  "description": "",
  "category": "build",             // 自由字符串
  "tags": ["prod"],
  "favorite": false,
  "owner": null,                   // 预留给多用户
  "version": 1,                    // 定义格式版本
  "variables": [ { "name":"ENV","value":"prod","secret":false } ],
  "envSetRefs": ["prod-env"],      // 引用资源库环境变量组
  "defaults": { "server": "local", "timeoutMs": 600000 },
  "stages": [
    {
      "id": "build", "name": "构建", "parallel": false,
      "jobs": [
        {
          "id": "compile", "name": "编译",
          "node": "shell.exec",        // 节点类型
          "server": "local",           // 服务器 id，缺省用 defaults.server
          "needs": [],                 // job id 数组（跨阶段依赖）
          "retry": { "max": 0, "delayMs": 1000 },
          "timeoutMs": 600000,
          "allowFailure": false,
          "when": "on_success",        // on_success | always | manual
          "allowProvision": false,
          "env": [ { "name":"NODE_ENV","value":"production","secret":false } ],
          "envSetRefs": [],
          "with": { "script": "npm ci && npm run build" },   // 节点参数
          "artifacts": ["dist/**"],
          "cache": { "key": "", "paths": [] }
        }
      ]
    }
  ],
  "createdAt": 0, "updatedAt": 0
}
```
**调度模式**：任一 job 有非空 `needs` → 整条流水线走 DAG；否则阶段串行 + 阶段内 `parallel` 决定并/串行。**两种模式不得混用**（`validate()` 拒绝：同时存在 `needs` 与 `parallel:true` 阶段）。

### 2.2 Template
```jsonc
{
  "id": "tpl-node-build", "name":"Node 构建模板", "description":"", "category":"build",
  "tags": [], "icon": "box",
  "parameters": [
    { "name":"image_tag","label":"镜像标签","type":"string","required":true,
      "default":"latest","options":[],"field":"string","description":"" }
  ],
  "body": { /* 同 Pipeline，但用 ${{ params.image_tag }} 占位 */ },
  "usageCount": 0, "createdAt": 0, "updatedAt": 0
}
```
`parameters[].type` 取值见 §4 字段类型；`options` 仅 `enum` 用。

### 2.3 Server
```jsonc
{
  "id": "prod-01", "name": "生产机", "kind": "ssh",   // local | ssh
  "host": "10.0.0.5", "port": 22, "user": "deploy",
  "auth": { "type": "key", "keyRef": "PROD_SSH_KEY", "passwordRef": "" },
  "shell": "", "workdir": "/srv/app", "tags": ["prod"],
  "defaultEnv": [ { "name":"LANG","value":"C.UTF-8","secret":false } ],
  "customEnv":  [ { "name":"APP_ENV","value":"prod","secret":false } ],
  "envSetRefs": [],
  "probe": { "at": 0, "os": "", "arch": "", "shell": "", "workdir": "",
             "platform": "posix", "runtime": {}, "managers": [], "sudo": "none", "error": "" },
  "runtimes": {},                  // { "python:3.11": { "path": "...", "at": 0 } }
  "allowProvision": false,
  "workdirSource": "",             // 只读；内置 local 预置时写入来源，如 "workspace:my-project" / "session-directory" / "homedir"
  "createdAt": 0, "updatedAt": 0
}
```

**内置 `local` 服务器的 `workdir` 必须非空**（已修的可用性缺陷）：
`engine/run.js` 的 cwd 优先级是 `job.workdir || server.workdir || process.cwd()`。若留空，相对路径会落到**宿主进程启动目录**（实测 `~/.dsh` 这类隐藏配置目录），用户写 `base: 'src'` 会解析成 `~/.dsh/src` 而必然落空，报错还只说「命中 0 个」。
因此内置预置走 `describeLocalWorkdir(ctx, {session, workdir})`，来源优先级（每项都要求**存在且是目录**，否则跳过）：
0. 显式 `options.workdir` → 1. `ctx.workingDirectory.get(session)`（当前会话目录，最准）→ 2. `ctx.workspaceRegistry.list()` 中**按 `updatedAt` 最近使用**的工作区（注意其数组顺序是**创建顺序**，取 `list()[0]` 会选错）→ 3. `ctx.workingDirectory.defaultDirectory`（本机可能正好是 `~/.dsh`，故排在 workspace 之后）→ 4. `DSH_WORKSPACE` / `DSH_PROJECT_DIR` → 5. `homedir()` 兜底。
**任何情况下返回非空绝对路径**；用户显式设置过的 `workdir` 绝不被自动回填覆盖。`workdirSource` 供前端显示「自动探测自 X，可修改」；schema 容忍 server 的额外字段。

**`auth.type` 取值（已裁决，四个分支都必须可达）**：

| 值 | 含义 | 必需字段 |
|---|---|---|
| `key` | 私钥认证 | `keyRef` → `ctx.credentials` 引用 |
| `password` | 密码认证 | `passwordRef` → `ctx.credentials` 引用 |
| `agent` | SSH agent 认证（云服务器常用） | 无（读 `SSH_AUTH_SOCK`；Windows 为 `\\.\pipe\openssh-ssh-agent`） |
| `none` | 不认证 | 无 |

**约束**：`none` 仅对 `kind:'local'` 合法；`kind:'ssh'` 使用 `none` 必须校验失败（禁止"静默无认证连接"）。
`key`/`password` 的值一律只存 **credentials 引用名**，绝不存明文，也绝不落日志。

内置 `local` 服务器：`{id:"local",name:"本机",kind:"local",host:"127.0.0.1",auth:{type:"none"}}`，不可删除，不可改 `kind`。

### 2.4 资源库与其它
```jsonc
// envsets
{ "id":"prod-env","name":"生产环境变量","description":"","tags":[],
  "vars":[{"name":"API_HOST","value":"x","secret":false}],"createdAt":0,"updatedAt":0 }
// snippets
{ "id":"sn-1","name":"清理缓存","language":"shell","description":"","tags":[],
  "body":"rm -rf node_modules","usageCount":0,"createdAt":0,"updatedAt":0 }
// recent（历史输入）
{ "key":"field:path.dir:/srv","values":["/srv/app","/srv/web"],"updatedAt":0 }
// settings（global 单例）
{ "defaultServer":"local","maxConcurrentRuns":2,"maxParallelSteps":4,
  "logRingBytes":524288,"logRetentionDays":30,"defaultShell":"auto",
  "statusBar":true,"stuckSilenceSec":60,"allowCustomNodeCode":false }
```

### 2.5 Run / Step
```jsonc
// run
{ "id":"run-20261104-xxxx","pipelineId":"build-deploy","pipelineName":"构建并部署",
  "status":"queued|running|success|failed|canceled",
  "trigger":"manual|api|ai","startedAt":0,"finishedAt":0,
  "variables":{ "ENV":"prod" },
  "steps": {
    "compile": { "id":"compile","name":"编译","stage":"build","node":"shell.exec",
      "server":"local","status":"pending|running|success|failed|skipped|canceled",
      "phase":"queued|connecting|provisioning|transferring|running|draining|settled",
      "startedAt":0,"finishedAt":0,"exitCode":null,"attempt":1,
      "lastOutputAt":0,"bytes":0,"logPath":"","spillPath":"",
      "outputs":{},"error":"","detail":"" }
  },
  "parentRunId":null, "parentStepId":null }
```
`steps` 用**对象（id → step）**而非数组，便于按 id 增量更新与 SSE 推送。

## 3. 模块接口（import 契约）

### 3.1 `src/model/schema.js`
```js
export function validatePipeline(pipeline) // → { ok:true, value } | { ok:false, errors:[{path,code,message}] }
export function validateTemplate(t)         // 同上
export function validateServer(s)           // 同上
export function normalizePipeline(p)        // 补默认值、去重 id、稳定排序；返回新对象
export function newId(prefix)               // "prefix-<8位随机>"
export function detectScheduling(pipeline)  // → 'dag' | 'staged'
```
`errors[].path` 用点路径（`stages[0].jobs[1].node`）；`code` 用短横线小写（`missing-field`、`unknown-node`、`mixed-scheduling`、`cycle`、`bad-id`、`bad-type`）。

### 3.2 `src/model/variables.js`
```js
export function resolveEnv({ processEnv, server, envSets, pipeline, stage, job, node, credentials, runtime })
// → { env: Record<string,string|undefined>, masked: string[], report: [{name,source,overridden}] }
// report[].overridden 必须是**布尔**（该键是否被更高优先级层覆盖过），不是计数。
export async function resolveEnvAsync(input)   // 真实凭据链路用这个：先 await 解析全部密钥引用，再走同一内核
// → resolveEnv 的超集，额外含 unresolved: string[]（未解析成功的密钥引用，供提示"密钥未配置"）
```
合并顺序（后者覆盖前者）：`processEnv` → `server.defaultEnv` → `server.customEnv` → 引用的 envSets → `pipeline.variables` → `stage.variables` → `job.env` → `job.envSetRefs` → `node.env` → runtime 注入（`PATH`/解释器）。
值为 `null` 或空串表示**删除该键**（映射为 `undefined`）。

**密钥解析（重要）**：DSH 真实的 `ctx.credentials.resolve(ref)` 返回 **Promise**，而 `resolveEnv` 是同步函数。因此：
- **生产链路必须用 `resolveEnvAsync`**（`engine/run.js`、`src/tools.js`、`api/handlers/servers.js` 都已如此）。
- 同步 `resolveEnv` 遇到返回值是 Promise 时**跳过**该键（不得记成已解析），并可回退到同步读取器 / `processEnv[ref]`。
- **凭据解析抛错必须向上抛出**，绝不允许"静默留空密钥"（否则会以匿名身份继续运行）。
- 无论走哪条路，secret 的真值都要进 `masked`，供写日志前打码。
- `report[].source` 词汇表：`process` / `server.defaultEnv` / `server.customEnv` / `envset:<id>` / `pipeline` / `stage` / `job` / `job.envSet:<id>` / `node` / `runtime`。


### 3.2.1 `src/engine/dag.js` 实际返回形状（与实现对齐，务必按此调用）

```js
const g = buildGraph(pipeline)
// g = { mode:'dag'|'staged'|'invalid', jobs: {[id]:Node}, order:[id], levels:[[id]],
//       stagePlan:[...], errors:[...] }
//   Node = { id, stageId, stageIndex, jobIndex, job, needs:[id], dependents:[id], optional:boolean }
detectCycle(g)        // → { cyclic:boolean, cycle:string[] }   ← 注意是对象，不是 null/路径数组
detectPipelineCallCycle(pipelines)  // 子流水线引用环
topoOrder(g)          // → string[]（局部顺序，不等同于调度顺序）
topoLevels(g)         // → string[][]
scheduleMode(pipeline)          // → 'dag' | 'staged' | 'invalid'
readySet(...)         // 见实现签名
isSatisfied(step, skipped, decision)  // 依赖是否满足（allowFailure 的 failed 视为通过）
isSettled(step, skipped)              // step 是否已结束
whenDecision(step, upstream)          // → 'run' | 'skip' | 'hold'
stagedPlan(g)         // staged 模式的执行计划
```


### 3.3 `src/model/template.js`
```js
export function interpolate(str, ctx)      // "${{ x.y }}" 替换；未定义抛错（不静默留空）
export function buildContext({ variables, params, steps, env, server, run })
export function instantiate(template, params)  // → { ok, value: Pipeline } | { ok:false, errors }
export function extractParameter(pipeline, path) // 编辑器「提升为参数」用
```

### 3.4 `src/model/glob.js`
```js
export function compile(pattern)            // → { test(path):boolean, negated:boolean, source }
export function matchOne(pattern, path)     // 支持 ** * ? {a,b} 与 ! 前缀取反
export function filterPaths(patterns, paths, { caseSensitive=true } = {})
// → { matched:string[], ignored:string[], patterns }
```

### 3.5 `src/store/store.js`
```js
export function createStore({ dataDir, log, storageDomain })  // → Store（异步工厂）
// Store 接口（全部异步，除 get/list 同步快照）
store.pipelines  // Table<Pipeline>
store.templates  store.servers  store.envsets  store.snippets  store.recent
store.settings   // { get(): Settings, set(patch): Promise<Settings> }  （global 单例）
store.runs       // Table<Run>
// Table<T>:
//   get(id): T|undefined        list(): T[]        entries(): [id,T][]
//   put(id, value): Promise<T>  update(id, fn): Promise<T>   delete(id): Promise<boolean>
store.close(): Promise<void>
export function createFileTable(...)  // 内部用，测试可单独引用
```
- **实现**：文件后端（默认）——`<dataDir>/store/<table>.json`，写入用「临时文件 + rename」原子替换，跨进程用 `<table>.lock`（`mkdir` 独占）互斥；内存为权威读快照。
- 每次写入后发 `store/changed`（`ctx.emit`，若 ctx 可用），携带 `{ table, id, action:'put'|'delete' }`。

### 3.6 `src/logs/logstore.js`
```js
export function createLogStore({ dataDir, ringBytes = 524288, mask = [] })
await log.ensureRun(runId)                       // 建目录
log.append(runId, stepId, { text, stream })      // 追加（写盘前打码）
log.read({ runId, stepId, from = 0 })            // → { lines:[{seq,ts,stream,text}], next, lossy, bytes }
log.readRun(runId, fromStep)                     // 多步合并（按 seq 全局有序）
log.listRuns()                                   // → runId[]
log.pathFor(runId, stepId)                       // 绝对路径
await log.cleanup(retentionDays)
```
- 落盘格式：`<dataDir>/runs/<runId>/steps/<stepId>.log`，**JSONL**，每行 `{"seq":1,"ts":0,"stream":"stdout","text":"..."}`。
- `seq` 全局单调递增（跨 run 用 `timestamp<<20 | counter` 保证有序且可续传）。
- 内存环有上限；`read` 落后于环时 `lossy:true` 且返回 `spillPath`。

### 3.7 `src/engine/executors/index.js`
```js
export function createExecutorRegistry({ ctx, log, provisioner, config })
registry.resolve(server)          // → Executor
registry.list()                   // → [{id,kind,serverId}]
```
**Executor 接口**（local 与 ssh 必须完全实现）：
```js
{
  id: 'local' | 'ssh:<serverId>',
  kind: 'local' | 'ssh',
  async probe(server)            // → { os, arch, shell, workdir, runtime:{}, managers:[], sudo, error }
  async run(spec)                // → handle
  async readDir(server, path)    // → [{name,isDir,size,mtime}]  越界抛错
  async stat(server, path)       // → { exists,isDir,size,mtime }
  async match(server, base, patterns, opts)  // patterns: string | string[]
                                 // → { matched:[{path,size}], ignored:[{path,size}], truncated, total, patterns }
  async transferIn(server, localPath, remotePath)
  async transferOut(server, remotePath, localPath)
  async dispose()
}
// spec: { argv, cwd, env, timeoutMs, signal, label, onData(chunk:{text,stream}) }
// handle: { done: Promise<{exitCode,signal}>, cancel(), phase }   // phase 可读写，见 §3.8
```
实现要求：**绝不拼 shell 字符串传递用户输入**（除显式 `script` 本身，那是用户脚本内容）；`env` 中的 `undefined` 值表示删除。

#### 3.7.1 glob 匹配口径（已裁决，engine 与 remote 必须一致）

采纳 `filterPaths` 作为唯一权威语义，理由：只有它能正确表达"包含 + 排除"的组合，而单模式布尔对取反是反直觉的。

```
executor.match(server, base, patterns, opts)
  patterns: string | string[]        // 单字符串与单元素数组等价
```

规则（与 `src/model/glob.js` 的 `filterPaths` 完全一致）：
1. 先枚举 `base` 下的候选路径（不含目录时 `includeDirs:false`）。
2. 对每个候选，**按顺序评估所有模式，最后一个命中的模式决定归属**：命中正模式 → `matched`；命中 `!` 模式 → `ignored`；都没命中 → 两者都进不去。
3. **仅含取反模式时隐式补 `**`**：`['!**/*.map']` 等价于 `['**', '!**/*.map']`，结果是"除 .map 外全部"。否则用户写"排除 .map"会得到空集，属反直觉。
4. `opts.caseSensitive` 默认 `true`；`opts.maxEntries` 限制枚举数量，超限时 `truncated:true`。
5. 返回 `ignored`，便于界面对用户解释"为什么这些文件没被收集"。

调用点约定：节点里的 `paths` / `pattern` 字段为 **`glob` 类型可多值**，直接透传给 `executor.match`；**不要在节点或引擎层用 `matchOne` 做过滤**（单模式布尔无法表达取反组合）。`matchOne` 只保留给"判断单个路径是否符合某个模式"的原子场景（如远端遍历时的逐条判断），且必须清楚它对取反返回反转布尔。


### 3.8 `src/engine/provision/ensure.js`
```js
export function createProvisioner({ ctx, getServer })
await provisioner.ensure(server, requirement, { allowInstall, onLog, signal })
// requirement: { python?: "3.11", node?: "20", packages?: ["git"] }
// → { ok:true, resolved:{ "python":"/abs/path" }, actions:[{kind,command,exitCode}] }
//   | { ok:false, error, suggestion, actions }
await provisioner.probe(server)   // → probe 对象，写回 server.probe
```
策略（按顺序尝试，全失败才返回 `ok:false`）：Python → `uv python install` → `pyenv install` → 发行版包；Node → `nvm`/`fnm`/`mise` → 系统 node；依赖 → `apt-get`/`yum`/`dnf`/`apk`。
**默认 `allowInstall:false`**：缺失时返回 `ok:false` 且带 `suggestion`（可一键执行的说明），不擅自改远端系统。

### 3.9 `src/engine/nodes/index.js`
```js
export function createNodeRegistry({ executors, provisioner, log, store, config })
registry.list()                   // → NodeDescriptor[]（含 field 描述符，供前端渲染表单）
registry.get(type)                // → NodeDescriptor | undefined
registry.register(descriptor)     // → disposer（自定义节点用）
await registry.loadCustom(dir)    // 加载 <dataDir>/nodes/*.mjs
```
**NodeDescriptor**：
```js
{ type:'shell.exec', title:'执行 Shell', category:'execute', icon:'terminal',
  description:'在目标服务器执行一段 Shell 脚本',
  fields:[ { name:'script', label:'脚本', type:'code', language:'shell', required:true,
             placeholder:'', description:'', default:'' } ],
  outputs:[ { name:'exitCode', type:'number' } ],
  env:[ { name:'CI', value:'1', description:'' } ],   // 节点默认环境变量
  runtime: null,                                       // 或 { python:'', node:'' }
  async run(rt, inputs)          // → { exitCode, outputs?:{}, error?:string }
}
```
`rt`（运行时上下文）由引擎提供：
```js
rt = { executor, server, env, cwd, signal, log(text, stream), setPhase(phase),
       resolvePath(p), spawn(argv, opts), provision(req, opts), store, run, step, config }
```

### 3.10 `src/api/router.js`
```js
export function createRouter({ ctx, store, engine, log, nodes, executors, provisioner, config })
router.handle(req, res)   // 已由 index.js 绑定到 /dsh-devops 前缀路由
```
统一响应：成功 `{"ok":true,"value":...}`；失败 `{"ok":false,"message":"...","code":"..."}`（HTTP 400/404/409/500）。
请求体 JSON 上限 1 MiB（超限 413）。仅 loopback 允许（`allowLanAccess` 显式开启才放行）。

**路由表**：
```
GET  /dsh-devops/api/meta
GET  /dsh-devops/api/pipelines                        列表
POST /dsh-devops/api/pipelines                        {pipeline} → 保存
GET  /dsh-devops/api/pipelines/:id
PUT  /dsh-devops/api/pipelines/:id                    {pipeline}
DELETE /dsh-devops/api/pipelines/:id
POST /dsh-devops/api/pipelines/:id/runs               {variables} → {runId}
POST /dsh-devops/api/pipelines/validate               {pipeline} → {ok,errors}
GET  /dsh-devops/api/templates
POST /dsh-devops/api/templates                        {template}
GET  /dsh-devops/api/templates/:id
PUT  /dsh-devops/api/templates/:id
DELETE /dsh-devops/api/templates/:id
POST /dsh-devops/api/templates/:id/instantiate        {params} → {pipeline}
POST /dsh-devops/api/templates/from-pipeline          {pipelineId, name,...} → {template}
GET  /dsh-devops/api/runs?pipelineId=&status=&limit=
GET  /dsh-devops/api/runs/:id
POST /dsh-devops/api/runs/:id/cancel
POST /dsh-devops/api/runs/:id/retry
POST /dsh-devops/api/runs/:id/retry-step              {stepId}
GET  /dsh-devops/api/runs/:id/logs?stepId=&from=
GET  /dsh-devops/api/runs/:id/events                  SSE
GET  /dsh-devops/api/servers
POST /dsh-devops/api/servers                          {server}
GET|PUT|DELETE /dsh-devops/api/servers/:id
POST /dsh-devops/api/servers/:id/test                 → probe 结果
POST /dsh-devops/api/servers/:id/provision            {runtime:'python:3.11'}
GET  /dsh-devops/api/servers/:id/env                  → 合并预览
GET  /dsh-devops/api/envsets  POST /api/envsets  PUT|DELETE /api/envsets/:id
GET  /dsh-devops/api/snippets POST /api/snippets PUT|DELETE /api/snippets/:id
GET  /dsh-devops/api/recent?key=                      POST /api/recent
GET  /dsh-devops/api/nodes
POST /dsh-devops/api/nodes/custom                     {descriptor}
DELETE /dsh-devops/api/nodes/custom/:type
GET  /dsh-devops/api/fs/list?server=&path=
GET  /dsh-devops/api/fs/stat?server=&path=
POST /dsh-devops/api/fs/match                         {server,base,glob}
GET  /dsh-devops/api/export?kind=pipeline|bundle&id=
POST /dsh-devops/api/import                           {document, mode:'new'|'overwrite', includeNodes}
GET|PUT /dsh-devops/api/settings
```

### 3.11 SSE 协议（`/api/runs/:id/events`）
```
event: run       data: {"run": <Run 摘要>}
event: step      data: {"stepId":"compile","step": <Step>}
event: log       data: {"stepId":"compile","seq":12,"ts":0,"stream":"stdout","text":"..."}
event: gap       data: {"stepId":"compile","from":1,"to":9}     // 断线跳跃
event: ping      data: {}                                        // 每 15s
```
`id:` 行写全局 `seq`，客户端用 `Last-Event-ID` 头续传。

### 3.12 `src/tools.js` / `src/skills.js` / `index.js`
```js
// src/tools.js
export function registerTools({ ctx, store, engine, log, nodes, executors, provisioner, config })
// 工具：devops_list_pipelines devops_create_pipeline devops_update_pipeline
//       devops_validate_pipeline devops_run devops_status devops_logs
//       devops_cancel devops_servers devops_provision
// 每个工具必须有 output.schema + output.render（宿主强制）
// 只读工具（list/status/logs/servers）可声明 isConcurrencySafe: () => true；
// 写入类工具保持 undefined（独占执行）。
// src/skills.js
export function registerSkills({ ctx, pluginDir })
// 注册 skills/<name>/SKILL.md（YAML frontmatter: name/description），
// 目录名必须等于 name；用 ctx.skills.register({name,description,content,
//   resourceBase:{kind:'directory',path},source:'runtime'})
// 返回 disposer 并收进 ctx.effect。
// 注意：宿主不会自动扫描插件包内的 skills/ 目录，必须自行注册。
// src/commands.js
export function registerCommands({ ctx, store, engine })
// 注册 /devops 斜杠命令（ctx.commands.register({name,description,handler})）
// 子命令：list | run <pipelineId> | status [runId] | ai <需求>
// handler 收到 { commandId, agent, rawInput, attachments, signal }，
// 返回 {kind:'success',text,sourceEventSeq?} | {kind:'error',text}
// ctx.commands 缺失时跳过并 warn。
// index.js
export const name = 'dsh-devops'
export const inject = ['webServer']
export function apply(ctx, config)          // 装配：store→log→nodes→executors→engine→router→tools→skills→commands
export const Config = ...                   // schemastery（若可用则用，否则普通对象）
```

### 3.12.1 AI 联动 API（已核实，实现必须用这些签名）

**宿主侧（index.js / tools.js / commands.js）**
```js
// 建会话（与 Web UI 同一条业务路径）
ctx.sessionController.create({ cwd?, sessionId?, agentPreset? }) → Promise<SessionId>
// 以用户身份提交消息
ctx.sessionController.prompt({ requestId, sessionId, mode:'queue'|'steer', content }, signal)
// 或直接驱动 agent（保证必达；inject 不唤醒且有丢失窗口）
const agent = ctx.agents.get(sessionId)
agent.followup(createUserMessage({ content:[{type:'text',text}], source:{kind:'devops'} }))
await ctx.sessions.flush(agent.session)     // 确认落地
// 注入长期上下文（作用域=注册 scope，适合"当前流水线定义"）
ctx.systemPrompt.context({ name, order, text })   // 持久 user-role 快照
ctx.systemPrompt.section({ name, order, text })   // 每次 assembly 求值
```
`ctx.get(...)` 取这些服务，任一缺失必须降级而不是抛错。

**前端（client.js）**
```js
// 新建会话并预填 composer（「让 AI 帮我写」的正解）
ctx.uiWorkspace.startSession(workspaceId?, { prompt, whenDraftExists, clearPreviousDraft, agentPreset })
ctx.uiWorkspace.openSession(target)          // 跳到已有会话
// 降级链：startSession → conversation draft/submit → navigator.clipboard + toast
```
只在 apply 里用到的客户端服务建议用嵌套 `ctx.inject([...], scoped => {...})`，避免宿主缺该服务时整个插件不挂载。


### 3.13 前端 `client.js`
```js
window.__ModuleLoader__.load({ id:'dsh-devops', factory:(require)=>{ ... return { inject:['slots'], apply } } })
// apply 内：
ctx.slots.inject('main',              () => ctx.slots.register({ name:'main', key:'devops' }, Panel))
ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name:'sidebar.panellist', id:'devops', order:40, label:'DevOps' }, Icon))
ctx.slots.inject('shell.overlay',     () => ctx.slots.register({ name:'shell.overlay', id:'devops-statusbar' }, StatusBar))
```
- `main` 是 **keyed 槽，只认 `key`**；必须与 `sidebar.panellist` 的 `id` 同值。
- 依赖只用 module table 白名单：`react`（`require('react')`）。**不得 import 其它第三方库**。
- API 基址：`new URL('dsh-devops/api/…', document.baseURI)`。
- 样式：一次性注入 `<style>`，类名前缀 `.dsh-devops-`，颜色只用 `--dsw-alias-*`。

## 4. 字段类型 → 控件映射（前端渲染依据）

| `type` | 控件 | 额外键 |
|---|---|---|
| `string` | 单行输入 | `placeholder`,`maxLength` |
| `text` | 多行输入 | `rows` |
| `code` | 代码编辑器（行号+着色） | `language: shell\|python\|javascript\|json` |
| `path.dir` | 目录选择器（浏览+补全+校验） | `serverField`（取哪个字段作为 server） |
| `path.file` | 文件选择器 | `serverField` |
| `glob` | glob 输入 + 命中预览 | `baseField`,`preview:true` |
| `enum` | 下拉 | `options: string[]` 或 `optionsFrom:'shell'\|'runtime:python'\|'server'` |
| `boolean` | 开关 | — |
| `number` | 数字 | `min`,`max`,`unit`（`ms` 显示为秒） |
| `server` | 服务器选择器 | — |
| `runtime` | 运行时选择器 | `runtime: 'python'\|'node'` |
| `keyvalue` | 键值表 | `secret:true` 允许标记密钥 |
| `multiselect` | 标签多选 | `options` |
| `ref:envset` | 环境变量组引用 | — |
| `ref:snippet` | 脚本片段引用 | — |

## 5. 安全约定（强制）

1. 命令一律以 argv 数组传递；**用户输入绝不拼进 shell 命令行**。
2. 密钥值只来自 `ctx.credentials`；日志/SSE/工具输出/导出**在写盘前打码**。
3. 路径访问做 realpath containment 校验，越界即失败。
4. 自定义节点与导入的 `.mjs` 需 `allowCustomNodeCode` 显式开启；文件必须位于 `dataDir/nodes` 内。
5. 所有宿主注册挂 `ctx.effect()`。
6. 前端不得注册 `root`/`sidebar`/`rightbar`/`shell.bottom`/`shell.leading` 等 single 槽。
