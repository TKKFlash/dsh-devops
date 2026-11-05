/**
 * SSE 客户端：契约 §3.11。
 *   event: run   data: {"run": <Run 摘要>}
 *   event: step  data: {"stepId":"compile","step": <Step>}
 *   event: log   data: {"stepId":"compile","seq":12,"ts":0,"stream":"stdout","text":"..."}
 *   event: gap   data: {"stepId":"compile","from":1,"to":9}
 *   event: ping  data: {}
 * id: 行写全局 seq，断线用 Last-Event-ID 续传。
 *
 * 注意：EventSource 无法自定义请求头，因此续传用查询参数 from 表达；
 * 后端同时支持 Last-Event-ID 头与 from 查询参数时两者等价。
 */
const { apiUrl } = require('./api.js');

function createRunStream(runId, handlers) {
  const onEvent = handlers.onEvent || function () {};
  const onStatus = handlers.onStatus || function () {};
  let source = null;
  let closed = false;
  let lastId = handlers.lastEventId || 0;
  let retryTimer = null;
  let attempt = 0;

  function open() {
    if (closed) return;
    const url = apiUrl('runs/' + encodeURIComponent(runId) + '/events', lastId ? { from: lastId } : null);
    onStatus('connecting');
    try {
      source = new EventSource(url.toString(), { withCredentials: true });
    } catch (error) {
      onStatus('error', error);
      scheduleReconnect();
      return;
    }

    source.onopen = () => {
      attempt = 0;
      onStatus('open');
    };

    source.onerror = () => {
      // 浏览器自身会重连；这里只在 readyState=CLOSED 时接管，避免双重重连。
      onStatus('error');
      if (source && source.readyState === 2) {
        try {
          source.close();
        } catch {
          /* ignore */
        }
        source = null;
        scheduleReconnect();
      }
    };

    const names = ['run', 'step', 'log', 'gap', 'ping'];
    for (const name of names) {
      source.addEventListener(name, (message) => {
        if (message.lastEventId) {
          const num = Number(message.lastEventId);
          if (isFinite(num) && num > lastId) lastId = num;
        }
        let data = null;
        if (message.data) {
          try {
            data = JSON.parse(message.data);
          } catch {
            return; // 半截帧直接丢弃，等重连补
          }
        }
        onEvent(name, data || {}, lastId);
      });
    }
  }

  function scheduleReconnect() {
    if (closed || retryTimer) return;
    attempt += 1;
    const delay = Math.min(15000, 800 * Math.pow(1.7, Math.min(attempt, 5)));
    retryTimer = setTimeout(() => {
      retryTimer = null;
      open();
    }, delay);
  }

  open();

  return {
    close() {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      if (source) {
        try {
          source.close();
        } catch {
          /* ignore */
        }
      }
      source = null;
      onStatus('closed');
    },
    get lastEventId() {
      return lastId;
    },
  };
}

exports.createRunStream = createRunStream;
