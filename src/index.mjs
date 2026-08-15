// dsh-notes —— Node half（宿主侧）。
//
// 职责：
//   1. 打开持久化存储域 `notes`（backend json → ~/.dsh/storages/notes.json）：
//        global:  { todos: TodoItem[], memo: string }   —— 全局小记
//        table sessions: <sessionId> -> NoteScope        —— 会话小记
//      schema 用鸭子类型透传实现（本包零运行时依赖，不 import zod；
//      数据全部由插件自身写入，透传即可；global 的 safeParse(null) 必须失败，
//      因为 null 是后端「从未写入」哨兵值，defineDomain 会据此校验）。
//   2. 经 ctx.webServer 挂 HTTP API（同 dsh-deepseek-quota 通道）：
//        GET  /api/dsh-notes?sessionId=…   -> 状态快照
//        POST /api/dsh-notes               -> { action, scope, sessionId?, ... }
//      动作：add / toggle / edit / delete / clear-done / set-memo
//   3. 所有变更走插件内 promise 串行链（读-改-写），返回值只含标量拷贝。

export const name = 'dsh-notes'

export const inject = ['webServer']

const TODO_TEXT_MAX = 500
const MEMO_MAX = 20000
const ROUTE_PATH = '/api/dsh-notes'

const passthroughSchema = {
  parse(value) {
    if (value === null) throw new Error('null not allowed')
    return value
  },
  safeParse(value) {
    return value === null ? { success: false } : { success: true, data: value }
  },
}

const notesDomainSpec = {
  name: 'notes',
  version: 1,
  global: { schema: passthroughSchema, initial: { todos: [], memo: '' } },
  tables: { sessions: { valueSchema: passthroughSchema } },
}

function copyScope(scope) {
  return {
    todos: scope.todos.map((item) => ({
      id: item.id,
      text: item.text,
      done: item.done,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    })),
    memo: scope.memo,
  }
}

function emptyScope() {
  return { todos: [], memo: '' }
}

function openCount(todos) {
  let count = 0
  for (const item of todos) if (!item.done) count += 1
  return count
}

function snapshotOf(domain, sessionId) {
  const globalScope = domain.global.get()
  const table = domain.table('sessions')
  const sessionScope = sessionId !== null ? table.get(sessionId) : undefined
  return {
    global: copyScope(globalScope),
    session: sessionScope === undefined ? null : copyScope(sessionScope),
    counts: {
      globalOpen: openCount(globalScope.todos),
      sessionOpen: sessionScope === undefined ? 0 : openCount(sessionScope.todos),
    },
  }
}

export function apply(ctx, config = {}) {
  const webServer = ctx.webServer
  const storageDomain = ctx.get('storageDomain')
  if (storageDomain === undefined) {
    ctx.logger.error('[dsh-notes] storageDomain unavailable; notes API disabled')
    return
  }

  // 串行链：本插件所有变更依次执行，避免 global/记录读-改-写竞态
  let chain = Promise.resolve()
  function enqueue(job) {
    const result = chain.then(job)
    chain = result.then(() => {}, () => {})
    return result
  }

  const domainPromise = storageDomain.open(notesDomainSpec).catch((error) => {
    ctx.logger.error(`[dsh-notes] failed to open notes domain: ${String(error)}`)
    return null
  })

  ctx.effect(() => () => {
    void domainPromise.then((domain) => {
      if (domain !== null) return domain.close()
    })
  })

  async function requireDomain() {
    const domain = await domainPromise
    if (domain === null) throw new Error('storage-unavailable')
    return domain
  }

  /* ---------- 参数与动作 ---------- */

  function parseScope(body) {
    const scope = body.scope
    if (scope === 'global') return { scope, sessionId: null }
    if (scope === 'session') {
      const sessionId = typeof body.sessionId === 'string' && body.sessionId !== '' ? body.sessionId : null
      if (sessionId === null) return { error: 'bad-args' }
      return { scope, sessionId }
    }
    return { error: 'bad-args' }
  }

  function mutate(scope, sessionId, fn) {
    return enqueue(async () => {
      const domain = await requireDomain()
      if (scope === 'global') {
        const next = fn(copyScope(domain.global.get()))
        await domain.global.set(next)
        return snapshotOf(domain, sessionId)
      }
      const table = domain.table('sessions')
      const current = table.get(sessionId)
      const next = fn(current === undefined ? emptyScope() : copyScope(current))
      await table.put(sessionId, next)
      return snapshotOf(domain, sessionId)
    })
  }

  function pushTodo(todos, text) {
    const trimmed = String(text).trim().slice(0, TODO_TEXT_MAX)
    if (trimmed === '') return todos
    const now = Date.now()
    const item = { id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`, text: trimmed, done: false, createdAt: now, updatedAt: now }
    return [...todos, item]
  }

  function applyAction(action, body) {
    const parsed = parseScope(body)
    if (parsed.error !== undefined) return Promise.resolve({ error: parsed.error })
    const { scope, sessionId } = parsed

    switch (action) {
      case 'add': {
        if (typeof body.text !== 'string') return Promise.resolve({ error: 'bad-args' })
        return mutate(scope, sessionId, (current) => ({ ...current, todos: pushTodo(current.todos, body.text) }))
      }
      case 'toggle': {
        if (typeof body.id !== 'string' || typeof body.done !== 'boolean') return Promise.resolve({ error: 'bad-args' })
        return mutate(scope, sessionId, (current) => ({
          ...current,
          todos: current.todos.map((item) =>
            item.id === body.id ? { ...item, done: body.done, updatedAt: Date.now() } : item,
          ),
        }))
      }
      case 'edit': {
        if (typeof body.id !== 'string' || typeof body.text !== 'string') return Promise.resolve({ error: 'bad-args' })
        const text = body.text.trim().slice(0, TODO_TEXT_MAX)
        if (text === '') return Promise.resolve({ error: 'bad-args' })
        return mutate(scope, sessionId, (current) => ({
          ...current,
          todos: current.todos.map((item) => (item.id === body.id ? { ...item, text, updatedAt: Date.now() } : item)),
        }))
      }
      case 'delete': {
        if (typeof body.id !== 'string') return Promise.resolve({ error: 'bad-args' })
        return mutate(scope, sessionId, (current) => ({ ...current, todos: current.todos.filter((item) => item.id !== body.id) }))
      }
      case 'clear-done': {
        return mutate(scope, sessionId, (current) => ({ ...current, todos: current.todos.filter((item) => !item.done) }))
      }
      case 'set-memo': {
        if (typeof body.text !== 'string') return Promise.resolve({ error: 'bad-args' })
        return mutate(scope, sessionId, (current) => ({ ...current, memo: body.text.slice(0, MEMO_MAX) }))
      }
      default:
        return Promise.resolve({ error: 'bad-args' })
    }
  }

  /* ---------- HTTP ---------- */

  function sendJson(res, status, payload) {
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    })
    res.end(JSON.stringify(payload))
  }

  ctx.effect(
    () =>
      webServer.register({
        kind: 'exact',
        path: ROUTE_PATH,
        handler: async (req, res) => {
          if (req.method === 'GET' || req.method === 'HEAD') {
            const query = new URL(req.url ?? '/', 'http://local').searchParams
            const sessionId = query.get('sessionId')
            try {
              const domain = await requireDomain()
              sendJson(res, 200, { ok: true, ...snapshotOf(domain, sessionId !== null && sessionId !== '' ? sessionId : null) })
            } catch (error) {
              sendJson(res, 503, { ok: false, error: 'storage-unavailable' })
            }
            return
          }

          if (req.method !== 'POST') {
            sendJson(res, 405, { ok: false, error: 'METHOD' })
            return
          }

          let body
          try {
            body = await readJson(req)
          } catch {
            sendJson(res, 400, { ok: false, error: 'bad-json' })
            return
          }

          const action = typeof body.action === 'string' ? body.action : ''
          try {
            const result = await applyAction(action, body)
            if (result.error !== undefined) {
              sendJson(res, 400, { ok: false, error: result.error })
              return
            }
            sendJson(res, 200, { ok: true, state: result })
          } catch (error) {
            ctx.logger.warn(`[dsh-notes] action '${action}' failed: ${String(error)}`)
            sendJson(res, 503, { ok: false, error: 'storage-unavailable' })
          }
        },
      }),
    'dsh-notes: route',
  )
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 256 * 1024) {
        reject(new Error('payload too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}
