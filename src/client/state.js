/**
 * 全局状态中枢：一个极简的可订阅 store，页面用 useSyncExternalStore 订阅。
 * 不引任何状态管理库。
 */
const { useSyncExternalStore, useMemo } = require('./h.js');

function createStore(initialState) {
  let state = initialState;
  const listeners = new Set();

  function getState() {
    return state;
  }

  function emit() {
    for (const fn of Array.from(listeners)) {
      try {
        fn();
      } catch (error) {
        // 单个订阅者出错不能影响其它订阅者
        console.error('[dsh-devops] store listener error', error);
      }
    }
  }

  /** 接受「新状态对象」或「(prev) => patch/新对象」；浅合并。 */
  function setState(patch) {
    const next = typeof patch === 'function' ? patch(state) : patch;
    if (!next) return state;
    let changed = false;
    for (const key of Object.keys(next)) {
      if (state[key] !== next[key]) {
        changed = true;
        break;
      }
    }
    if (!changed) return state;
    state = Object.assign({}, state, next);
    emit();
    return state;
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return { getState, setState, subscribe };
}

/** 订阅整个 store。 */
function useStore(store) {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}

/** 只订阅选中的切片；选择函数应返回稳定引用或原始值。 */
function useStoreSelect(store, selector) {
  const subscribe = store.subscribe;
  const getSnapshot = useMemo(() => () => selector(store.getState()), [store, selector]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

const KIND = {
  pipeline: 'pipelines',
  template: 'templates',
  server: 'servers',
  envset: 'envsets',
  snippet: 'snippets',
  run: 'runs',
  node: 'nodes',
  recent: 'recent',
};

/** 从列表数据里建立 id → 条目 的索引 Map。 */
function indexById(list) {
  const map = new Map();
  for (const item of list || []) {
    if (item && item.id) map.set(item.id, item);
  }
  return map;
}

/** 运行状态 → 语义色调。 */
function runTone(status) {
  if (status === 'success') return 'ok';
  if (status === 'failed') return 'error';
  if (status === 'running') return 'busy';
  if (status === 'canceled') return 'warn';
  return 'idle';
}

/** 步骤状态 → 语义色调。 */
function stepTone(status) {
  if (status === 'success') return 'ok';
  if (status === 'failed') return 'error';
  if (status === 'running') return 'busy';
  if (status === 'skipped') return 'idle';
  if (status === 'canceled') return 'warn';
  return 'idle';
}

const RUN_STATUS_TEXT = {
  queued: '排队中',
  running: '运行中',
  success: '成功',
  failed: '失败',
  canceled: '已取消',
};

const STEP_STATUS_TEXT = {
  pending: '等待',
  running: '运行中',
  success: '成功',
  failed: '失败',
  skipped: '已跳过',
  canceled: '已取消',
};

/** 契约 §2.5 的 phase 集合，顺序即阶段流转顺序。 */
const PHASES = ['queued', 'connecting', 'provisioning', 'transferring', 'running', 'draining', 'settled'];

const PHASE_TEXT = {
  queued: '排队',
  connecting: '建立连接',
  provisioning: '准备运行时',
  transferring: '传输文件',
  running: '执行中',
  draining: '收尾中',
  settled: '已结束',
};

exports.createStore = createStore;
exports.useStore = useStore;
exports.useStoreSelect = useStoreSelect;
exports.KIND = KIND;
exports.indexById = indexById;
exports.runTone = runTone;
exports.stepTone = stepTone;
exports.RUN_STATUS_TEXT = RUN_STATUS_TEXT;
exports.STEP_STATUS_TEXT = STEP_STATUS_TEXT;
exports.PHASES = PHASES;
exports.PHASE_TEXT = PHASE_TEXT;
