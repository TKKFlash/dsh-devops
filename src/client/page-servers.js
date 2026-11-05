/**
 * 服务器页：CRUD、测试连接、环境区块（探测结果 / 已装运行时 / 一键安装 / 延迟）。
 */
const { h, useState, useEffect, useMemo, clone, fmtAgo, fmtTime, pathPlaceholder } = require('./h.js');
const { Button, TextInput, Select, Switch, Card, Empty, Chip, Field, Modal, KV, Banner, StatusDot, Collapsible } = require('./ui.js');
const { api } = require('./api.js');

/**
 * 把 host-core 的 workdirSource 代码翻成人话。
 * 取值来自 src/store/domains.js 的 describeLocalWorkdir；未知代码原样显示，不吞掉信息。
 */
const WORKDIR_SOURCE_TEXT = {
  'session-directory': '当前会话的工作目录',
  'workingDirectory.defaultDirectory': 'DSH 默认工作目录',
  DSH_WORKSPACE: '环境变量 DSH_WORKSPACE',
  DSH_PROJECT_DIR: '环境变量 DSH_PROJECT_DIR',
  homedir: '用户主目录',
  'last-resort': '兜底的主目录',
  explicit: '显式指定',
};

function describeWorkdirSource(source) {
  if (!source) return '';
  if (WORKDIR_SOURCE_TEXT[source]) return WORKDIR_SOURCE_TEXT[source];
  // 工作区来源形如 workspace:my-project
  if (source.indexOf('workspace:') === 0) {
    const title = source.slice('workspace:'.length);
    return title && title !== 'unknown' ? '工作区「' + title + '」' : '最近使用的工作区';
  }
  return source;
}

/**
 * 工作目录字段的说明文案。
 *
 * 三种情形（未手动改过 / 已手动改过 / 没有来源字段）：
 *  - 没有 workdirSource（远端服务器、老数据）→ 不给提示，避免编造来源；
 *  - 本次编辑改过 workdir → 「已手动设置」；
 *  - 其余（确实由自动探测写入且未被改动）→ 点明「相对路径以它为基准」。
 */
function workdirHint(server, dirty) {
  const source = server.workdirSource;
  if (!source) return undefined;
  if (dirty) return '已手动设置：相对路径将以此目录为基准';
  return '自动探测自：' + describeWorkdirSource(source) + '（可修改）';
}

function blankServer() {
  return {
    id: 'server-' + Math.random().toString(36).slice(2, 7),
    name: '新服务器',
    kind: 'ssh',
    host: '',
    port: 22,
    user: '',
    auth: { type: 'key', keyRef: '', passwordRef: '', keyPath: '' },
    shell: '',
    workdir: '',
    tags: [],
    defaultEnv: [],
    customEnv: [],
    envSetRefs: [],
    probe: { at: 0, os: '', arch: '', shell: '', workdir: '', runtime: {}, managers: [], sudo: 'none', error: '' },
    runtimes: {},
    allowProvision: false,
    createdAt: 0,
    updatedAt: 0,
  };
}

/** 环境预览：合并后的环境变量（密钥显示为掩码）。 */
function EnvPreview(props) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    setError('');
    try {
      setData(await api.serverEnv(props.server.id));
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  return h(
    Collapsible,
    { title: '环境变量合并预览', defaultOpen: false },
    h('div', { style: { paddingTop: '6px' } },
      h(Button, { size: 'sm', icon: 'eye', label: '拉取预览', busy, onClick: load }),
      error ? h(Banner, { tone: 'error' }, error) : null,
      data
        ? h(
            'div',
            { className: 'dsh-devops-upload-preview', style: { marginTop: '6px' } },
            Object.keys(data.env || {}).sort().map((key) =>
              h('div', { key }, key + ' = ' + (data.masked && data.masked.includes(data.env[key]) ? '••••••' : data.env[key])),
            ),
            (data.report || []).length
              ? h('div', { style: { marginTop: '6px', color: 'var(--dsw-alias-label-caption)' } },
                  (data.report || []).map((r, i) => h('div', { key: i }, r.name + ' ← ' + r.source + (r.overridden ? '（被覆盖）' : ''))))
              : null,
          )
        : null,
    ),
  );
}

/**
 * 私钥文件选择（task-13）：文本输入 + 「浏览」按钮，复用既有 api.fsList。
 *
 * 为什么不用 fields.js 的 PathControl：
 *  - PathControl 是**节点字段**控件，需要 field 描述符、serverField/resolveServer、
 *    recent/remember 等一组 props；而这里是「服务器自身的认证配置」，不是节点字段，
 *    硬套要伪造一堆 props，反而更脆；
 *  - 本机私钥始终在**本机**（auth.keyPath 的语义就是宿主机路径），
 *    因此浏览目标固定为 'local'，不需要 serverField 解析；
 *  - 既有 .dsh-devops-dropdown 系列样式可直接复用，零新增 CSS。
 *
 * 浏览失败不影响手填：用户在任何情况下都能直接粘贴绝对路径。
 */
function KeyFileField(props) {
  const [open, setOpen] = useState(false);
  const [listing, setListing] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const value = props.value === undefined || props.value === null ? '' : String(props.value);
  // 本机私钥固定浏览本机；不要用被编辑服务器的 id（那可能是远端 SSH 机）
  const browseServer = 'local';

  async function browse(path) {
    setBusy(true);
    setError('');
    try {
      const result = await api.fsList(browseServer, path || value || '.');
      setListing(result);
      setOpen(true);
    } catch (err) {
      // 降级要可见：提示错误但仍让用户手填，不留死点击
      setError(err.message || String(err));
      setListing(null);
      setOpen(true);
    } finally {
      setBusy(false);
    }
  }

  function pick(path) {
    props.onChange(path);
    setOpen(false);
  }

  function joinPath(base, name) {
    if (!base || base === '.') return name;
    const sep = base.indexOf('\\') !== -1 && base.indexOf('/') === -1 ? '\\' : '/';
    return base.replace(/[\\/]+$/, '') + sep + name;
  }

  return h(Field, {
    label: '私钥文件路径（本机）',
    description: '留空则用下方凭据名。优先于凭据名；文件只支持本机路径',
  },
    h('div', null,
      h('div', { className: 'dsh-devops-field-row' },
        h('div', { style: { position: 'relative', flex: 1 } },
          h(TextInput, {
            value,
            placeholder: pathPlaceholder('file'),
            onChange: (v) => props.onChange(v),
          }),
          open
            ? h('div', { className: 'dsh-devops-dropdown' },
                h('div', { className: 'dsh-devops-dropdown-note' },
                  listing ? (listing.path || value || '.') : (error || '无法读取目录')),
                listing && listing.parent
                  ? h('div', { className: 'dsh-devops-dropdown-row', onClick: () => browse(listing.parent) }, '..')
                  : null,
                listing && listing.entries && listing.entries.length
                  ? listing.entries.map((entry) =>
                      h('div', {
                        key: entry.name,
                        className: 'dsh-devops-dropdown-row',
                        onClick: () => (entry.isDir ? browse(joinPath(listing.path, entry.name)) : pick(joinPath(listing.path, entry.name))),
                      }, entry.name))
                  : null,
                h('div', { className: 'dsh-devops-dropdown-note', style: { borderTop: '0.5px solid var(--dsw-alias-border-l2)' } },
                  '在本机中选择私钥文件'),
              )
            : null),
        h(Button, { size: 'sm', icon: 'box', label: '浏览', busy, onClick: () => browse(value) }),
        open ? h(Button, { size: 'sm', variant: 'ghost', label: '关闭', onClick: () => setOpen(false) }) : null,
      ),
      value ? h('div', { className: 'dsh-devops-hint', style: { marginTop: '4px' } },
        '私钥内容只会在连接时读取，不会写入服务器配置，也不会出现在日志或导出里。') : null,
    ));
}

/** 服务器编辑弹层。 */
function ServerModal(props) {
  const [server, setServer] = useState(() => (props.server ? clone(props.server) : blankServer()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // 是否在本次编辑里手动改过工作目录：用于区分「自动探测值」与「用户自己的值」
  const [workdirDirty, setWorkdirDirty] = useState(false);
  const isLocal = server.kind === 'local';
  const isNew = !props.server;

  function patch(next) {
    setServer(Object.assign({}, server, next));
  }

  async function save() {
    setBusy(true);
    setError('');
    try {
      if (isNew) await api.createServer(server);
      else await api.updateServer(server.id, server);
      props.toast.ok('已保存');
      props.onClose();
      props.onSaved();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  return h(
    Modal,
    {
      title: isNew ? '新建服务器' : '编辑服务器：' + (props.server.name || props.server.id),
      onClose: props.onClose,
      footer: [
        h(Button, { key: 'c', label: '取消', onClick: props.onClose }),
        h(Button, { key: 's', label: '保存', variant: 'primary', busy, onClick: save }),
      ],
    },
    error ? h(Banner, { tone: 'error' }, error) : null,
    h(Field, { label: '名称', required: true }, h(TextInput, { value: server.name, onChange: (v) => patch({ name: v }) })),
    h(Field, { label: '标识 id', required: true, description: '本地服务器 id 固定为 local，不可改 kind' },
      h(TextInput, { value: server.id, disabled: server.id === 'local', onChange: (v) => patch({ id: v }) })),
    h(Field, { label: '类型' },
      h(Select, {
        value: server.kind,
        disabled: server.id === 'local',
        options: [{ value: 'local', label: '本机' }, { value: 'ssh', label: 'SSH' }],
        onChange: (v) => patch({ kind: v }),
      })),
    !isLocal
      ? h(
          'div',
          null,
          h(
            'div',
            { className: 'dsh-devops-field-row' },
            h(Field, { label: '主机', required: true }, h(TextInput, { value: server.host || '', placeholder: '10.0.0.5 或 host.example.com', onChange: (v) => patch({ host: v }) })),
            h(Field, { label: '端口' }, h(TextInput, { type: 'number', value: server.port || 22, onChange: (v) => patch({ port: Number(v) }) })),
          ),
          h(Field, { label: '用户名' }, h(TextInput, { value: server.user || '', onChange: (v) => patch({ user: v }) })),
          h(Field, { label: '认证方式' },
            h(Select, {
              value: (server.auth && server.auth.type) || 'key',
              options: [{ value: 'key', label: '私钥' }, { value: 'password', label: '密码' }],
              onChange: (v) => patch({ auth: Object.assign({}, server.auth, { type: v }) }),
            })),
          (server.auth && server.auth.type) === 'password'
            ? h(Field, { label: '密码凭据名', description: '来自 ctx.credentials，不写明文' },
                h(TextInput, { value: (server.auth && server.auth.passwordRef) || '', onChange: (v) => patch({ auth: Object.assign({}, server.auth, { passwordRef: v }) }) }))
            : h('div', null,
                h(KeyFileField, {
                  server,
                  value: (server.auth && server.auth.keyPath) || '',
                  onChange: (v) => patch({ auth: Object.assign({}, server.auth, { keyPath: v }) }),
                }),
                h(Field, { label: '私钥凭据名', description: '来自 ctx.credentials，不写明文；上方填了文件时以文件优先' },
                  h(TextInput, { value: (server.auth && server.auth.keyRef) || '', onChange: (v) => patch({ auth: Object.assign({}, server.auth, { keyRef: v }) }) }))),
        )
      : null,
    h(Field, {
      label: '工作目录',
      description: workdirHint(server, workdirDirty),
    }, h(TextInput, {
      value: server.workdir || '',
      // 占位示例按平台给：Windows 上 C:\... 才有参考价值
      placeholder: pathPlaceholder('dir'),
      onChange: (v) => {
        setWorkdirDirty(true);
        patch({ workdir: v });
      },
    })),
    h(Field, { label: 'Shell', description: '留空表示自动探测' }, h(TextInput, { value: server.shell || '', placeholder: 'auto', onChange: (v) => patch({ shell: v }) })),
    h(Field, { label: '标签' },
      h(TextInput, { value: (server.tags || []).join(', '), onChange: (v) => patch({ tags: v.split(',').map((s) => s.trim()).filter(Boolean) }) })),
    h(
      'div',
      { className: 'dsh-devops-field-row' },
      h(Field, { label: '允许在该机安装环境' }, h(Switch, { value: !!server.allowProvision, onChange: (v) => patch({ allowProvision: v }) })),
    ),
    h('div', { className: 'dsh-devops-hint' }, '密钥值只从凭据服务或本机私钥文件读取，日志与导出均不会出现明文。'),
  );
}

/** 运行时区块：已装运行时 + 一键安装。 */
function RuntimeSection(props) {
  const server = props.server;
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const runtimes = server.runtimes || {};

  async function install(spec) {
    setBusy(spec);
    setNote('');
    try {
      const result = await api.provisionServer(server.id, spec);
      if (result && result.ok === false) {
        setNote('未能自动提供：' + (result.error || '') + (result.suggestion ? '；建议：' + result.suggestion : ''));
      } else {
        setNote('已就绪：' + JSON.stringify((result && result.resolved) || {}));
      }
      props.onReload();
    } catch (error) {
      setNote(error.message || String(error));
    } finally {
      setBusy('');
    }
  }

  const candidates = ['python:3.11', 'python:3.12', 'node:20', 'node:22'];
  return h(
    Collapsible,
    { title: '运行时与环境', defaultOpen: true },
    h('div', { style: { paddingTop: '6px' } },
      Object.keys(runtimes).length
        ? h(KV, { entries: Object.keys(runtimes).map((key) => [key, (runtimes[key] && runtimes[key].path) || '已解析']) })
        : h('div', { className: 'dsh-devops-hint' }, '还没有解析过运行时'),
      h(
        'div',
        { style: { display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '6px' } },
        candidates.map((spec) =>
          h(Button, { key: spec, size: 'sm', icon: 'download', label: spec, busy: busy === spec, onClick: () => install(spec) }),
        ),
      ),
      h('div', { className: 'dsh-devops-hint', style: { marginTop: '4px' } },
        server.allowProvision ? '该服务器允许自动安装（策略：uv/pyenv/发行版包 → nvm/fnm/mise）' : '该服务器未允许自动安装，缺失时只会给出建议'),
      note ? h('div', { className: 'dsh-devops-field-error', style: { marginTop: '4px' } }, note) : null,
    ),
  );
}

function Servers(props) {
  const servers = props.state.servers || [];
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [detailId, setDetailId] = useState(props.initialServerId || '');

  useEffect(() => {
    props.onReload();
  }, []);

  async function probe(server) {
    setBusyId(server.id);
    try {
      const t0 = Date.now();
      const result = await api.testServer(server.id);
      const ms = Date.now() - t0;
      if (result && result.error) props.toast.error('探测失败：' + result.error);
      else props.toast.ok('连接正常（' + ms + 'ms）');
      await props.onReload();
    } catch (error) {
      props.toast.error('探测失败：' + (error.message || error));
    } finally {
      setBusyId('');
    }
  }

  async function remove(server) {
    if (!confirm('确定删除服务器「' + (server.name || server.id) + '」？')) return;
    try {
      await api.deleteServer(server.id);
      props.toast.ok('已删除');
      await props.onReload();
    } catch (error) {
      props.toast.error(error.message || String(error));
    }
  }

  return h(
    'div',
    null,
    h(
      'div',
      { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' } },
      h('h2', { className: 'dsh-devops-title' }, '服务器'),
      h('div', { className: 'dsh-devops-spacer' }),
      h(Button, { size: 'sm', icon: 'plus', label: '添加服务器', variant: 'primary', onClick: () => setCreating(true) }),
    ),
    servers.length === 0
      ? h(Empty, { text: '还没有服务器' })
      : h(
          'div',
          { className: 'dsh-devops-grid', 'data-cols': '2' },
          servers.map((server) => {
            const probeInfo = server.probe || {};
            const online = !!probeInfo.at && !probeInfo.error;
            const open = detailId === server.id;
            return h(Card, {
              key: server.id,
              headExtra: h(
                'span',
                { style: { display: 'flex', gap: '4px' } },
                h(Button, { size: 'sm', icon: 'refresh', label: '测试连接', busy: busyId === server.id, onClick: () => probe(server) }),
                h(Button, { size: 'sm', label: '编辑', onClick: () => setEditing(server) }),
                server.id !== 'local' ? h(Button, { size: 'sm', variant: 'danger', icon: 'trash', onClick: () => remove(server) }) : null,
              ),
            },
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' } },
                h(StatusDot, { tone: probeInfo.error ? 'error' : online ? 'ok' : 'idle', title: probeInfo.error || (online ? '在线' : '未探测') }),
                h('span', { style: { fontWeight: 500 } }, server.name),
                h(Chip, null, server.kind === 'local' ? '本机' : 'SSH'),
                probeInfo.sudo && probeInfo.sudo !== 'none' ? h(Chip, null, 'sudo:' + probeInfo.sudo) : null,
                server.allowProvision ? h(Chip, { tone: 'warn' }, '可安装') : null,
              ),
              h(KV, {
                entries: [
                  ['id', h('span', { className: 'dsh-devops-monospace' }, server.id)],
                  ['地址', server.kind === 'local' ? '本机' : (server.host || '—') + ':' + (server.port || 22)],
                  ['用户', server.user || '—'],
                  ['系统', probeInfo.os || '未探测'],
                  ['运行时', Object.keys(server.runtimes || {}).length ? Object.keys(server.runtimes).join('、') : '—'],
                  ['管理器', (probeInfo.managers || []).join('、') || '—'],
                  ['最后探测', probeInfo.at ? fmtAgo(probeInfo.at) : '从未'],
                ],
              }),
              probeInfo.error ? h(Banner, { tone: 'error' }, probeInfo.error) : null,
              h('div', { style: { marginTop: '8px' } },
                h(Button, { size: 'sm', variant: 'ghost', label: open ? '收起详情' : '展开环境区块', onClick: () => setDetailId(open ? '' : server.id) })),
              open
                ? h('div', { style: { marginTop: '8px' } },
                    h(EnvPreview, { server }),
                    h(RuntimeSection, { server, onReload: props.onReload }),
                    probeInfo.runtime && Object.keys(probeInfo.runtime).length
                      ? h(Collapsible, { title: '探测到的运行时明细', defaultOpen: false },
                          h('div', { className: 'dsh-devops-upload-preview', style: { marginTop: '6px' } },
                            Object.keys(probeInfo.runtime).map((k) => h('div', { key: k }, k + ' → ' + probeInfo.runtime[k]))))
                      : null,
                    probeInfo.at ? h('div', { className: 'dsh-devops-hint', style: { marginTop: '6px' } }, '最后探测：' + fmtTime(probeInfo.at)) : null,
                  )
                : null,
            );
          }),
        ),
    creating ? h(ServerModal, { toast: props.toast, onClose: () => setCreating(false), onSaved: props.onReload }) : null,
    editing ? h(ServerModal, { server: editing, toast: props.toast, onClose: () => setEditing(null), onSaved: props.onReload }) : null,
  );
}

exports.Servers = Servers;
exports.blankServer = blankServer;
// 导出以下三项供测试直接验证（不影响界面行为）
exports.ServerModal = ServerModal;
// 导出私钥文件字段控件，供测试直接验证（不影响界面行为）
exports.KeyFileField = KeyFileField;
exports.workdirHint = workdirHint;
exports.describeWorkdirSource = describeWorkdirSource;
