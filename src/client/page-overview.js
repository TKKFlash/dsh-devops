/**
 * 概览页：服务器状态卡、最近运行、失败率与平均耗时。
 */
const { h, useEffect, useMemo, useState, fmtAgo, fmtDuration, fmtTime, useTick } = require('./h.js');
const { Card, Chip, StatusDot, Button, Empty, KV, ProgressRing, AsyncBox } = require('./ui.js');
const { api } = require('./api.js');
const { runTone, RUN_STATUS_TEXT } = require('./state.js');

function Overview(props) {
  const state = props.state;
  const [now, setNow] = useState(Date.now());
  const [probeBusy, setProbeBusy] = useState('');
  useTick(true);

  const runs = state.runs || [];
  const servers = state.servers || [];
  const pipelines = state.pipelines || [];

  /** 最近 50 次运行的统计。 */
  const stats = useMemo(() => {
    const finished = runs.filter((r) => r.status === 'success' || r.status === 'failed');
    const failed = finished.filter((r) => r.status === 'failed').length;
    const durations = finished
      .filter((r) => r.startedAt && r.finishedAt)
      .map((r) => r.finishedAt - r.startedAt);
    const avg = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
    return {
      total: runs.length,
      failed,
      rate: finished.length ? Math.round((failed / finished.length) * 100) : 0,
      avg,
      active: runs.filter((r) => r.status === 'running' || r.status === 'queued').length,
    };
  }, [runs]);

  async function probe(server) {
    setProbeBusy(server.id);
    try {
      await api.testServer(server.id);
      props.toast && props.toast.ok('已探测 ' + server.name);
      props.onReload && props.onReload();
    } catch (error) {
      props.toast && props.toast.error('探测失败：' + (error.message || error));
    } finally {
      setProbeBusy('');
    }
  }

  const nowTs = Date.now();

  return h(
    'div',
    null,
    h(
      'div',
      { className: 'dsh-devops-grid', 'data-cols': '3', style: { marginBottom: '12px' } },
      h(Card, { title: '运行概览' },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: '14px' } },
          h(ProgressRing, {
            value: stats.total - stats.failed,
            total: stats.total || 1,
            tone: stats.rate > 30 ? 'error' : stats.rate > 0 ? 'busy' : 'ok',
          }),
          h(KV, {
            entries: [
              ['总运行', stats.total],
              ['活跃中', stats.active],
              ['失败率', stats.rate + '%'],
              ['平均耗时', stats.avg ? fmtDuration(stats.avg) : '—'],
            ],
          }),
        ),
      ),
      h(Card, { title: '流水线' },
        h(KV, {
          entries: [
            ['流水线数', pipelines.length],
            ['模板数', (state.templates || []).length],
            ['服务器数', servers.length],
            ['环境变量组', (state.envsets || []).length],
          ],
        }),
        h('div', { style: { marginTop: '8px' } },
          h(Button, { size: 'sm', icon: 'plus', label: '新建流水线', onClick: () => props.onNavigate('pipelines', { create: true }) })),
      ),
      h(Card, { title: '调度健康' },
        h(KV, {
          entries: [
            ['SSE 连接', state.sseStatus === 'open' ? '已连接' : state.sseStatus || '—'],
            ['卡住阈值', ((state.settings && state.settings.stuckSilenceSec) || 60) + 's'],
            ['并发上限', (state.settings && state.settings.maxConcurrentRuns) || 2],
            ['状态栏', state.settings && state.settings.statusBar === false ? '已关闭' : '开启'],
          ],
        }),
      ),
    ),

    h(Card, {
      title: '服务器状态',
      headExtra: h(Button, { size: 'sm', icon: 'refresh', label: '刷新', onClick: props.onReload }),
    },
      servers.length === 0
        ? h(Empty, { text: '还没有服务器，先去「服务器」页添加' })
        : h(
            'div',
            { className: 'dsh-devops-grid', 'data-cols': '2' },
            servers.map((server) => {
              const probeInfo = server.probe || {};
              const online = !!probeInfo.at && !probeInfo.error;
              return h(
                'div',
                { key: server.id, className: 'dsh-devops-card', style: { marginBottom: 0 } },
                h(
                  'div',
                  { className: 'dsh-devops-card-head' },
                  h(StatusDot, { tone: probeInfo.error ? 'error' : online ? 'ok' : 'idle', title: probeInfo.error || (online ? '在线' : '未探测') }),
                  h('span', { className: 'dsh-devops-card-title' }, server.name),
                  h(Chip, null, server.kind === 'local' ? '本机' : 'SSH'),
                  h('div', { className: 'dsh-devops-spacer' }),
                  h(Button, { size: 'sm', icon: 'refresh', label: '测试连接', busy: probeBusy === server.id, onClick: () => probe(server) }),
                ),
                h(KV, {
                  entries: [
                    ['地址', server.kind === 'local' ? '本机' : (server.host || '') + ':' + (server.port || 22)],
                    ['系统', probeInfo.os || '未探测'],
                    ['架构', probeInfo.arch || '—'],
                    ['工作目录', server.workdir || probeInfo.workdir || '—'],
                    ['已装运行时', Object.keys(server.runtimes || {}).join('、') || '—'],
                    ['最后探测', probeInfo.at ? fmtAgo(probeInfo.at, nowTs) : '从未'],
                  ],
                }),
                probeInfo.error ? h('div', { className: 'dsh-devops-field-error', style: { marginTop: '6px' } }, probeInfo.error) : null,
              );
            }),
          ),
    ),

    h(Card, {
      title: '最近运行',
      headExtra: h(Button, { size: 'sm', icon: 'history', label: '查看全部', onClick: () => props.onNavigate('runs') }),
    },
      runs.length === 0
        ? h(Empty, { text: '还没有运行记录' })
        : h(
            'table',
            { className: 'dsh-devops-table' },
            h('thead', null,
              h('tr', null,
                h('th', null, '运行'),
                h('th', null, '流水线'),
                h('th', null, '状态'),
                h('th', null, '耗时'),
                h('th', null, '开始时间'),
                h('th', null, ''),
              )),
            h('tbody', null,
              runs.slice(0, 8).map((run) =>
                h('tr', { key: run.id },
                  h('td', { className: 'dsh-devops-monospace' }, run.id),
                  h('td', null, run.pipelineName || run.pipelineId),
                  h('td', null, h(Chip, { tone: runTone(run.status), dot: true }, RUN_STATUS_TEXT[run.status] || run.status)),
                  h('td', null, run.finishedAt && run.startedAt ? fmtDuration(run.finishedAt - run.startedAt) : run.startedAt ? '进行中' : '—'),
                  h('td', null, fmtAgo(run.startedAt, nowTs)),
                  h('td', null, h(Button, { size: 'sm', variant: 'ghost', label: '详情', onClick: () => props.onOpenRun(run.id) })),
                ),
              )),
          ),
    ),
  );
}

exports.Overview = Overview;
