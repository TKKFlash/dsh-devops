/**
 * dsh-devops · SSE 推送（契约 §3.11）
 *
 * 帧格式：
 *   id: <全局 seq>
 *   event: run|step|log|gap|ping
 *   data: <JSON>
 *
 * 能力：
 *   * Last-Event-ID 续传：客户端重连时带上最后一次收到的 id，服务端从内存环
 *     里补发其后的帧；环里已经没有的区间补一条 gap 事件，明确告知"这段丢了"。
 *   * 每 15s 一条 ping 保活（可配置）。
 *   * 每个订阅者独立状态，任何一个写失败只摘掉它自己，不影响其它订阅者。
 *
 * 这里不 import 任何东西，也不碰业务：engine 的 onEvent 把事件喂给 publish。
 */

/** 把一条事件序列化成 SSE 帧。导出以便单测直接断言帧格式。 */
export function formatFrame({ seq, type, data }) {
  const lines = []
  if (Number.isSafeInteger(seq)) lines.push(`id: ${seq}`)
  lines.push(`event: ${type}`)
  lines.push(`data: ${JSON.stringify(data ?? {})}`)
  return `${lines.join('\n')}\n\n`
}

/**
 * 从 Last-Event-ID 头或查询参数里取续传起点；取不到返回 0。
 * 头优先（浏览器 EventSource 自动带）；query 兜底支持两种写法：
 *   `?lastEventId=9`（语义直白）与 `?from=9`（与 /logs?from= 一致，便于手工调试）。
 */
export function readLastEventId(req, query) {
  const header = req?.headers?.['last-event-id'] ?? req?.headers?.['Last-Event-ID']
  let raw
  if (header !== undefined && header !== null && String(header).trim() !== '') {
    raw = header
  } else if (query?.get) {
    raw = query.get('lastEventId') ?? query.get('from')
  }
  const value = Number(String(raw ?? '').trim())
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.trunc(value)
}

/**
 * 创建 SSE 集线器。
 * @param {{log?:object, pingMs?:number, ringSize?:number}} [options]
 */
export function createSseHub({ log, pingMs = 15000, ringSize = 500 } = {}) {
  /** @type {Set<{runId:string,res:object,closed:boolean,lastId:number,stepId:string}>} */
  const clients = new Set()
  /** 每个 run 一个内存环：断线重连能补齐最近的帧。 */
  const rings = new Map()
  let seq = 0
  let timer = null

  const warn = (message) => {
    if (log && typeof log.warn === 'function') log.warn(message)
  }

  function remember(runId, record) {
    if (!runId) return
    let ring = rings.get(runId)
    if (!ring) {
      ring = []
      rings.set(runId, ring)
    }
    ring.push(record)
    if (ring.length > ringSize) ring.splice(0, ring.length - ringSize)
  }

  function writeFrame(client, record) {
    if (client.closed) return
    try {
      client.res.write(formatFrame(record))
      client.lastId = record.seq
      if (record.data && typeof record.data === 'object' && typeof record.data.stepId === 'string') {
        client.stepId = record.data.stepId
      }
    } catch (error) {
      client.closed = true
      clients.delete(client)
      warn(`dsh-devops: SSE 订阅者写入失败，已摘除订阅：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * 广播一条事件。runId 从 event.runId / event.run.id / event.step 归属推断。
   * @param {{type?:string, runId?:string, run?:object, stepId?:string}} event
   */
  function publish(event) {
    if (!event || typeof event !== 'object') return
    const type = typeof event.type === 'string' && event.type ? event.type : 'log'
    if (type === 'ping' || type === 'gap') return // 保留类型，业务侧不可伪造
    const runId = String(event.runId || event.run?.id || '')
    seq += 1
    const record = { seq, type, data: event }
    remember(runId, record)
    for (const client of clients) {
      if (runId && client.runId && client.runId !== runId) continue
      writeFrame(client, record)
    }
  }

  /** 补发断线期间遗漏的事件；环里已被挤掉的区间用 gap 事件说明。 */
  function replay(client, runId, lastId) {
    if (!lastId) return
    const ring = (runId && rings.get(runId)) || []
    const held = ring.filter((record) => record.seq > lastId)
    if (held.length === 0) return
    const oldest = held[0].seq
    if (oldest > lastId + 1) {
      // 中间这段在环里已经不存在了：如实告知，不留"静默跳号"。
      client.res.write(
        formatFrame({
          type: 'gap',
          data: {
            stepId: client.stepId || '',
            from: lastId + 1,
            to: oldest - 1,
          },
        }),
      )
    }
    for (const record of held) writeFrame(client, record)
  }

  function ensureTimer() {
    if (timer || pingMs <= 0) return
    timer = setInterval(() => {
      if (clients.size === 0) return
      const frame = formatFrame({ type: 'ping', data: {} })
      for (const client of [...clients]) {
        if (client.closed) continue
        try {
          client.res.write(frame)
        } catch {
          client.closed = true
          clients.delete(client)
        }
      }
    }, pingMs)
    // 保活定时器不该拖住进程退出
    timer.unref?.()
  }

  /**
   * 接一个订阅者：写响应头、按需续传，然后保持连接。
   * 调用后必须由调用方保证不再向该 res 写其它内容。
   *
   * @param {object} req
   * @param {object} res
   * @param {string} runId 订阅的运行（空串表示订阅全部）
   * @param {{lastId?:number, initial?:object[]}} [options]
   *   lastId：续传起点（来自 Last-Event-ID）；
   *   initial：只发给**这个新订阅者**的初始帧（如当前 run 快照）。
   *     为什么不走 publish：publish 会广播给所有订阅者，新客户端连进来
   *     不该导致老客户端重复收到一遍快照。initial 帧不占用全局 seq。
   */
  function subscribe(req, res, runId, { lastId = 0, initial = [] } = {}) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    // 断线后客户端默认 3s 重连
    res.write('retry: 3000\n\n')
    const client = { runId: String(runId || ''), res, closed: false, lastId: 0, stepId: '' }
    clients.add(client)
    ensureTimer()
    // 续传先于注册：先补历史再收新帧，避免中间缝隙
    try {
      replay(client, client.runId, lastId)
    } catch (error) {
      warn(`dsh-devops: SSE 补发失败：${error instanceof Error ? error.message : String(error)}`)
    }
    // 只发给本订阅者的初始帧（无 seq，不参与续传）
    for (const record of Array.isArray(initial) ? initial : []) {
      if (client.closed) break
      try {
        client.res.write(formatFrame(record))
      } catch {
        client.closed = true
        clients.delete(client)
        break
      }
    }
    const cleanup = () => {
      client.closed = true
      clients.delete(client)
    }
    res.on?.('close', cleanup)
    res.on?.('error', cleanup)
    req.on?.('close', cleanup)
    return client
  }

  /** 摘掉全部订阅者并停掉保活定时器（热重载/插件卸载时调用）。 */
  function closeAll() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
    for (const client of [...clients]) {
      client.closed = true
      try {
        client.res.end()
      } catch {
        /* 连接可能已经断了 */
      }
    }
    clients.clear()
  }

  return {
    publish,
    subscribe,
    closeAll,
    /** 诊断用：订阅者数量。 */
    get size() {
      return clients.size
    },
    /** 诊断/测试用：当前全局 seq。 */
    get seq() {
      return seq
    },
  }
}
