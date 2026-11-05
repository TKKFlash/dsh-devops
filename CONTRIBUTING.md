# 参与开发

## 环境要求

- Node ≥ 22.13（纯 ESM，无构建步骤）
- 零运行时依赖；`ssh2` 为**可选依赖**（SSH 远端执行需要）

```bash
# 安装可选依赖（需要 SSH 远端执行时）
npm i ssh2
```

## 构建与测试

```bash
# 前端拼接（读 src/client/*.js → 输出根目录 client.js）
node scripts/build-client.mjs

# 只校验产物是否最新，不写盘（CI 用；有差异退出码 1）
node scripts/build-client.mjs --check

# 语法检查
node --check client.js

# 测试（Node 内置 test runner，零外部依赖、零网络）
node --test test/*.test.mjs
# 或
npm test
```

**重要**：`client.js` 是构建产物，改 `src/client/*.js` 后必须重新拼接，否则界面不会变化。
后端改动（executor / 引擎 / handler）需要**重启宿主进程**才会加载。

### 测试约定

- 测试**不联网、不依赖浏览器**：SSH 用注入的 mock transport，客户端组件用「桩 h + 桩 hooks」在 Node 里渲染。
- 涉及宿主机行为（Cordis context、凭据）的用例要装**真实实现**而非假桩，避免「桩对了、生产路径没测」。
- 修 bug 的用例应能**抓住该 bug**：理想的验证方式是临时注释掉修复分支，确认用例变红。
- 提交前请让全量测试保持全绿；`node --test` 的进程必须能自然退出（有未清理的定时器会挂住）。

### 测试覆盖

schema 校验与错误码/path、变量十层合并与密钥打码、glob（`**`/`*`/`?`/`{a,b}`/`!`）、
模板插值与实例化、Store 文件后端（原子写、并发、重启持久化）、日志存储（JSONL、环溢出、打码、按天清理）、
DAG（拓扑序、环检测、`when`/`allowFailure` 传播）、运行引擎（定义快照、重试、取消）、
本地执行器（退出码、超时、取消真的终止进程、env 透传与删除）、
SSH（注入 mock transport：转义、分帧、取消、路径越界、指纹、私钥文件、执行器解析回归）、
provision（多发行版探测解析、方案优先级、默认不安装）、
节点注册表（字段类型白名单、`condition.if` 注入防护）、导出导入（往返一致、密钥不外泄、冲突与原子性）、
HTTP/SSE（状态码、body 超限、非 loopback 拒绝、续传与 gap）、
前端（语法着色引擎、日志终端渲染、代码编辑器、横向画布、编辑浮层、滚动分区、视图持久化、流水线引用模糊匹配）。

## 发版纪律

- **版本只有一个来源：`package.json`。** 不要在代码里另写版本常量——`index.js` 的插件版本就是从
  `package.json` 读的，`/api/meta` 返回的也是它。历史上曾因硬编码 `VERSION = '0.1.0'` 而
  `package.json` 已是 0.2.0，导致插件自报旧版本、下载用户看到「版本信息错乱」。
- 发版时同步三处：`package.json` 版本号、`CHANGELOG.md`（新增版本标题 + 正确的对比链接）、
  git tag。`test/version.test.mjs` 会校验它们一致，不一致直接红。
- `package.json` 的 `files` 白名单需包含 `package.json` 自身（版本读取依赖它）。
- 后端改动（executor / 引擎 / handler）需重启宿主才生效；前端改动需重建 `client.js`。

## 目录结构

```
dsh-devops/
  index.js                  装配入口（store→log→nodes→executors→engine→router→tools→skills）
  client.js                 打包后的前端单文件（由 scripts/build-client.mjs 生成）
  src/
    config.js               配置解析与默认值
    model/                  schema 校验、变量合并、模板、glob
    store/                  文件后端存储（原子写 + mkdir 锁）
    logs/                   JSONL 日志存储 + 内存环
    engine/                 DAG、运行引擎、执行器（local/ssh）、节点、供给
    api/                    HTTP 路由、SSE、各域 handler
    client/                 前端源码（按页面拆分）
  test/                     测试套件
  skills/                   技能
  docs/CONTRACT.md          内部接口契约（唯一权威）
  docs/TROUBLESHOOTING.md   故障排查与常见问题
  docs/KNOWN-ISSUES.md      运行边界与已知问题
```

接口以 `docs/CONTRACT.md` 为唯一权威；**任何签名变更必须先更新该文件**，再改实现。
