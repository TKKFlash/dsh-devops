# 故障排查

## 步骤卡住不动

看运行详情页的 **phase 流转**：

| phase | 含义 |
|---|---|
| `queued` | 排队等待 |
| `connecting` | 正在建立连接（SSH 握手/认证） |
| `provisioning` | 正在准备运行时/安装依赖 |
| `transferring` | 正在传输文件 |
| `running` | 命令执行中 |
| `draining` | 命令已结束，正在收尾读取剩余输出 |
| `settled` | 已结束 |

- **卡在 `connecting`**：多为 DNS/网络/安全组问题。归因线索见下表。
- **卡在 `provisioning`**：正在跑安装命令，首次安装耗时较长（超时上限 10 分钟）。
- **`running` 且显示「已 Xm Ys 无输出」**：命令确实静默（如 `npm ci` 的某些阶段）或进程挂死。接近 `timeoutMs` 时界面显示倒计时；到点会先 `SIGTERM`，短暂宽限后 `SIGKILL`。
- **等待人工确认**：`when: manual` 或 `wait.approval` 节点会一直等待，属预期行为。

## 连接失败归因

| 现象 | 原因 | 处理 |
|---|---|---|
| `dns` | 主机名无法解析 | 检查主机名拼写、DNS/VPN |
| `refused` | 端口拒绝连接 | 确认 `sshd` 已启动、端口正确 |
| `unreachable` | 网络不可达 | 检查 VPN/防火墙/网段 |
| `timeout` | 连接超时 | 检查安全组、端口是否被拦截 |
| `auth` | 认证失败 | 检查用户名、私钥内容与权限、密码或 ssh-agent |
| `fingerprint` | 主机密钥校验失败 | 指纹与预期不一致（可能主机重装或中间人）；确认后用 `ssh-keyscan` 更新 |
| `crypto` | 算法协商失败 | 客户端与服务端无共同算法，检查 sshd 版本/配置 |

### 「测试连接」失败的排查顺序

按这个顺序看，能一次定位到原因（错误码是稳定的，可直接搜）：

1. **`ssh2` 未安装** → 错误码 `ssh2-missing`。执行 `npm i ssh2`，或把该服务器改用「本机（local）」。
2. **`createSshExecutor 需要 server 参数`** → 执行器解析漏传 server（历史 bug，已修）。若仍出现，
   说明运行的是旧代码：重启宿主进程后重试。
3. **`missing-password`** → 「密码凭据名」填的是凭据**引用名**，不是密码明文；
   请在凭据服务里创建条目，或改用私钥文件。
4. **`missing-private-key`** → 私钥既没从凭据解析到，`keyPath` 也不是可读文件。
5. **`private-key-file-not-found` / `-not-regular` / `-too-large` / `-empty` / `-unreadable`** →
   `keyPath` 指向的问题，错误里带路径与原因（超过 1MB 视为异常）。
6. **`insecure-auth-none`** → SSH 服务器用了 `auth.type: 'none'`；`none` 仅对 `kind: 'local'` 合法。
7. 以上都排除后，才是网络层问题（对照上面的「连接失败归因」表）。

## 常见问题

| 现象 | 原因与处理 |
|---|---|
| 报「未安装可选依赖 ssh2」 | 执行 `npm i ssh2`，或把该步骤服务器改成「本机（local）」 |
| 报 `mixed-scheduling` | 同时用了 `needs` 与 `parallel: true` 阶段；统一成一种调度模式 |
| 报 `unknown-node` | 节点类型不存在（可能是自定义节点未开启或未加载） |
| 报 `cycle` | `needs` 依赖成环，按错误里的 `path` 解开 |
| 报 `missing-field` / `bad-type` / `bad-id` | 按 `errors[].path`（点路径，如 `stages[0].jobs[1].node`）定位修正 |
| 报 `unknown-dependency`（依赖了不存在的 job） | 多半是删除了阶段/节点但留下了 `needs` 引用；界面删除阶段时会自动清理，若来自导入或手改 JSON 需自行修正 |
| 运行时缺失但没自动安装 | 这是**默认行为**（`allowInstall: false`）。按返回的 `suggestion` 手动执行，或在服务器上开启 `allowProvision` 并在步骤里打开 `allowInstall` |
| 视口中文乱码 | 已是增量 UTF-8 解码；若仍异常请附上该步骤的日志片段 |
| 端口/环境变量不生效 | 检查变量优先级，注意空串/`null` 表示**删除该键** |
| 页面打不开插件 | 确认 `cordis.patch.yml` 的 `name` 与实际包名一致；`dsh plugin list` 查看是否已挂载 |
| 改了源码但界面没变化 | `client.js` 是构建产物，改 `src/client/*.js` 后需运行 `node scripts/build-client.mjs` 并刷新页面 |
| 后端改动（executor / 引擎 / handler）不生效 | 宿主进程加载的是已启动的模块，需**重启 `dsh web`** |
| 离开 DevOps 面板再回来状态丢了 | 视图状态存于 `sessionStorage`；关闭标签页或换浏览器会话会清空，属预期 |
