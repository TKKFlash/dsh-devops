/**
 * 设置页：默认服务器、并发、日志保留、状态栏开关、卡住阈值等。
 * 对应契约 §2.4 settings 单例。
 */
const { h, useState, useEffect } = require('./h.js');
const { Button, TextInput, Select, Switch, Card, Field, Banner, KV } = require('./ui.js');
const { api } = require('./api.js');

function Settings(props) {
  const [settings, setSettings] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.getSettings()
      .then((value) => setSettings(value || {}))
      .catch((err) => setError(err.message || String(err)));
  }, []);

  if (error && !settings) return h(Banner, { tone: 'error' }, error);
  if (!settings) return h('div', { className: 'dsh-devops-empty' }, '加载设置中…');

  function patch(next) {
    setSettings(Object.assign({}, settings, next));
    setSaved(false);
  }

  async function save() {
    setBusy(true);
    setError('');
    try {
      await api.putSettings(settings);
      setSaved(true);
      props.toast.ok('设置已保存');
      props.onReload();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  function exportKind(kind) {
    const url = api.apiUrl('export', { kind });
    window.open(url.toString(), '_blank');
  }

  const servers = props.state.servers || [];

  return h(
    'div',
    { style: { maxWidth: '720px' } },
    h('h2', { className: 'dsh-devops-title', style: { marginBottom: '12px' } }, '设置'),

    error ? h(Banner, { tone: 'error' }, error) : null,
    saved ? h(Banner, { tone: 'ok' }, '已保存') : null,

    h(Card, { title: '执行' },
      h(Field, { label: '默认服务器', description: '新建流水线与节点未指定服务器时使用' },
        h(Select, {
          value: settings.defaultServer || 'local',
          options: servers.map((s) => ({ value: s.id, label: s.name + (s.kind === 'local' ? '（本机）' : '') })),
          onChange: (v) => patch({ defaultServer: v }),
        })),
      h(Field, { label: '默认 Shell' },
        h(Select, {
          value: settings.defaultShell || 'auto',
          options: ['auto', 'bash', 'sh', 'zsh', 'pwsh', 'powershell', 'cmd'],
          onChange: (v) => patch({ defaultShell: v }),
        })),
      h(Field, { label: '最大并发运行数', description: '同时进行的流水线数量' },
        h(TextInput, { type: 'number', min: 1, value: settings.maxConcurrentRuns || 2, onChange: (v) => patch({ maxConcurrentRuns: Number(v) }) })),
      h(Field, { label: '单运行最大并行步骤', description: '同一运行内允许并行执行的步骤上限' },
        h(TextInput, { type: 'number', min: 1, value: settings.maxParallelSteps || 4, onChange: (v) => patch({ maxParallelSteps: Number(v) }) })),
    ),

    h(Card, { title: '日志' },
      h(Field, { label: '日志内存环大小（字节）', description: '超出后前端读到的日志会标记 lossy' },
        h(TextInput, { type: 'number', value: settings.logRingBytes || 524288, onChange: (v) => patch({ logRingBytes: Number(v) }) })),
      h(Field, { label: '日志保留天数' },
        h(TextInput, { type: 'number', min: 1, value: settings.logRetentionDays || 30, onChange: (v) => patch({ logRetentionDays: Number(v) }) })),
    ),

    h(Card, { title: '界面与诊断' },
      h(Field, { label: '显示全局状态栏', description: '在界面右下角显示运行状态' },
        h(Switch, { value: settings.statusBar !== false, onChange: (v) => patch({ statusBar: v }) })),
      h(Field, { label: '卡住判定阈值（秒）', description: '步骤多久没有输出就提示「疑似卡住」' },
        h(TextInput, { type: 'number', min: 5, value: settings.stuckSilenceSec || 60, onChange: (v) => patch({ stuckSilenceSec: Number(v) }) })),
    ),

    h(Card, { title: '安全' },
      h(Field, { label: '允许自定义节点代码', description: '开启后才会加载 dataDir/nodes 下的 .mjs，执行任意代码' },
        h(Switch, { value: !!settings.allowCustomNodeCode, onChange: (v) => patch({ allowCustomNodeCode: v }) })),
      settings.allowCustomNodeCode ? h(Banner, { tone: 'warn' }, '自定义节点代码已启用：只注册你完全信任的实现。') : null,
    ),

    h(Card, { title: '导入导出' },
      h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } },
        h(Button, { size: 'sm', icon: 'download', label: '导出全部（bundle）', onClick: () => exportKind('bundle') }),
        h(Button, { size: 'sm', icon: 'download', label: '导出流水线', onClick: () => exportKind('pipeline') }),
        h(Button, { size: 'sm', icon: 'download', label: '导出模板', onClick: () => exportKind('template') }),
      ),
      h('div', { className: 'dsh-devops-hint', style: { marginTop: '6px' } }, '导出物中的密钥只保留引用名，不含明文。'),
    ),

    h('div', { style: { display: 'flex', gap: '8px', marginTop: '4px' } },
      h(Button, { label: '保存设置', variant: 'primary', busy, onClick: save }),
      h(Button, { label: '重新载入', onClick: () => { setSettings(null); setError(''); api.getSettings().then(setSettings).catch((e) => setError(e.message)); } }),
    ),

    h(Card, { title: '关于', className: 'dsh-devops-card' , style: { marginTop: '12px' } },
      h(KV, { entries: [['插件', 'dsh-devops'], ['接口契约', 'v1（docs/CONTRACT.md）'], ['前端形态', 'main(key) + sidebar.panellist(id) + shell.overlay']] }),
    ),
  );
}

exports.Settings = Settings;
