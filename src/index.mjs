// dsh-notes —— Node half（宿主侧）。
//
// 职责：
//   1. 打开持久化存储域 `notes`（backend json → ~/.dsh/storages/notes.json）：
//        global:     { todos: TodoItem[], memo: string }   —— 全局小记
//        table workspaces: <workspaceId> -> NoteScope      —— 工作区小记
//      schema 用鸭子类型透传实现（本包零运行时依赖，不 import zod；
//      数据全部由插件自身写入，透传即可；global 的 safeParse(null) 必须失败，
//      因为 null 是后端「从未写入」哨兵值，defineDomain 会据此校验）。
//   2. 经 ctx.webServer 挂 HTTP API（同 dsh-deepseek-quota 通道）：
//        GET  /api/dsh-notes?workspaceId=…   -> 小计状态快照
//        POST /api/dsh-notes                 -> { action, … }
//      小计动作：add / toggle / edit / delete / clear-done / set-memo
//               / pin（置顶）/ reorder（拖拽排序）/ undo-delete（撤销上次删除）
//      会话卡片动作（v0.4 融合 dsh-session-card）：scard-state / scard-chat-state
//               / scard-select-preset / scard-select-model / scard-clear
//   3. 会话卡片：管理插件专属「常驻会话」（未分组、无 cwd）——
//      - 状态文件 ~/.dsh/session-card.json（沿用旧 dsh-session-card 路径，
//        已建会话无缝复用；fs/sandboxPolicy 缺失时降级为仅内存运行）
//      - agent/request 全局瀑布监听（untagged，按会话 id 过滤）应用模型覆盖
//      - session/event 监听仅递增 revision（按会话 id 过滤，不缓存全文）
//      - chat-state 折叠 agent.session.events 为紧凑 transcript（叶字段 JSON）
//   4. 所有小计变更走插件内 promise 串行链（读-改-写），返回值只含标量拷贝。
//
// 隔离边界（v0.4）：小计内容对 agent 完全不可见（无模型工具、无 prompt 注入、
// 不写会话日志，仅 notes.json 域）；常驻会话是独立的聊天通道（用户主动使用），
// 其内容天然是会话内容，与 notes.json 互不相通。

export const name = 'dsh-notes'

export const inject = ['webServer']

const TODO_TEXT_MAX = 500
const MEMO_MAX = 20000
const ROUTE_PATH = '/api/dsh-notes'
const UNDO_CAP = 100
const TRANSCRIPT_LIMIT = 200

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
  tables: { workspaces: { valueSchema: passthroughSchema } },
}

function copyScope(scope) {
  return {
    todos: scope.todos.map((item) => ({
      id: item.id,
      text: item.text,
      done: item.done,
      pinned: item.pinned === true,
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

function snapshotOf(domain, workspaceId) {
  const globalScope = domain.global.get()
  const table = domain.table('workspaces')
  const workspaceScope = workspaceId !== null ? table.get(workspaceId) : undefined
  return {
    global: copyScope(globalScope),
    workspace: workspaceScope === undefined ? null : copyScope(workspaceScope),
    counts: {
      globalOpen: openCount(globalScope.todos),
      workspaceOpen: workspaceScope === undefined ? 0 : openCount(workspaceScope.todos),
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

  // 串行链：本插件所有小计变更依次执行，避免 global/记录读-改-写竞态
  let chain = Promise.resolve()
  function enqueue(job) {
    const result = chain.then(job)
    chain = result.then(() => {}, () => {})
    return result
  }

  // 撤销记录：scopeKey -> { removed: TodoItem[], indices: number[] }（内存态，
  // 仅覆盖本次进程；任何同作用域其他变更会使旧撤销失效）
  const undoMap = new Map()
  function undoKeyOf(scope, workspaceId) {
    return scope === 'global' ? 'global' : `workspace:${workspaceId}`
  }
  function recordUndo(key, removed) {
    undoMap.delete(key) // 重置 LRU 位置
    undoMap.set(key, removed)
    while (undoMap.size > UNDO_CAP) {
      const oldest = undoMap.keys().next().value
      undoMap.delete(oldest)
    }
  }
  function clearUndo(key) {
    undoMap.delete(key)
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
    if (scope === 'global') return { scope, workspaceId: null }
    if (scope === 'workspace') {
      const workspaceId = typeof body.workspaceId === 'string' && body.workspaceId !== '' ? body.workspaceId : null
      if (workspaceId === null) return { error: 'bad-args' }
      return { scope, workspaceId }
    }
    return { error: 'bad-args' }
  }

  function mutate(scope, workspaceId, fn) {
    return enqueue(async () => {
      const domain = await requireDomain()
      if (scope === 'global') {
        const next = fn(copyScope(domain.global.get()))
        await domain.global.set(next)
        return snapshotOf(domain, workspaceId)
      }
      const table = domain.table('workspaces')
      const current = table.get(workspaceId)
      const next = fn(current === undefined ? emptyScope() : copyScope(current))
      await table.put(workspaceId, next)
      return snapshotOf(domain, workspaceId)
    })
  }

  function pushTodo(todos, text) {
    const trimmed = String(text).trim().slice(0, TODO_TEXT_MAX)
    if (trimmed === '') return todos
    const now = Date.now()
    const item = { id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`, text: trimmed, done: false, pinned: false, createdAt: now, updatedAt: now }
    return [...todos, item]
  }

  function applyAction(action, body) {
    const parsed = parseScope(body)
    if (parsed.error !== undefined) return Promise.resolve({ error: parsed.error })
    const { scope, workspaceId } = parsed
    const undoKey = undoKeyOf(scope, workspaceId)

    switch (action) {
      case 'add': {
        if (typeof body.text !== 'string') return Promise.resolve({ error: 'bad-args' })
        clearUndo(undoKey)
        return mutate(scope, workspaceId, (current) => ({ ...current, todos: pushTodo(current.todos, body.text) }))
      }
      case 'toggle': {
        if (typeof body.id !== 'string' || typeof body.done !== 'boolean') return Promise.resolve({ error: 'bad-args' })
        clearUndo(undoKey)
        return mutate(scope, workspaceId, (current) => ({
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
        clearUndo(undoKey)
        return mutate(scope, workspaceId, (current) => ({
          ...current,
          todos: current.todos.map((item) => (item.id === body.id ? { ...item, text, updatedAt: Date.now() } : item)),
        }))
      }
      case 'delete': {
        if (typeof body.id !== 'string') return Promise.resolve({ error: 'bad-args' })
        return mutate(scope, workspaceId, (current) => {
          const removed = []
          const indices = []
          const todos = current.todos.filter((item, index) => {
            if (item.id === body.id) {
              removed.push(item)
              indices.push(index)
              return false
            }
            return true
          })
          if (removed.length > 0) recordUndo(undoKey, { removed, indices })
          return { ...current, todos }
        })
      }
      case 'clear-done': {
        return mutate(scope, workspaceId, (current) => {
          const removed = []
          const indices = []
          const todos = current.todos.filter((item, index) => {
            if (item.done) {
              removed.push(item)
              indices.push(index)
              return false
            }
            return true
          })
          if (removed.length > 0) recordUndo(undoKey, { removed, indices })
          return { ...current, todos }
        })
      }
      case 'pin': {
        if (typeof body.id !== 'string' || typeof body.pinned !== 'boolean') return Promise.resolve({ error: 'bad-args' })
        clearUndo(undoKey)
        return mutate(scope, workspaceId, (current) => {
          let found = false
          const todos = current.todos.map((item) => {
            if (item.id !== body.id) return item
            found = true
            return { ...item, pinned: body.pinned, updatedAt: Date.now() }
          })
          if (!found) return current
          // 置顶 = 移到数组头部（显示时置顶组在前，稳定排序保持组内顺序）
          const item = todos.find((it) => it.id === body.id)
          return {
            ...current,
            todos: body.pinned ? [item, ...todos.filter((it) => it.id !== body.id)] : todos,
          }
        })
      }
      case 'reorder': {
        if (!Array.isArray(body.orderedIds) || body.orderedIds.some((id) => typeof id !== 'string')) {
          return Promise.resolve({ error: 'bad-args' })
        }
        clearUndo(undoKey)
        return mutate(scope, workspaceId, (current) => {
          const byId = new Map(current.todos.map((item) => [item.id, item]))
          const ordered = []
          for (const id of body.orderedIds) {
            const item = byId.get(id)
            if (item !== undefined) {
              ordered.push(item)
              byId.delete(id)
            }
          }
          for (const item of byId.values()) ordered.push(item) // 未列出的兜底追加
          return { ...current, todos: ordered }
        })
      }
      case 'set-memo': {
        if (typeof body.text !== 'string') return Promise.resolve({ error: 'bad-args' })
        clearUndo(undoKey)
        return mutate(scope, workspaceId, (current) => ({ ...current, memo: body.text.slice(0, MEMO_MAX) }))
      }
      case 'undo-delete': {
        const record = undoMap.get(undoKey)
        if (record === undefined) return Promise.resolve({ error: 'no-undo' })
        undoMap.delete(undoKey)
        return mutate(scope, workspaceId, (current) => {
          const todos = [...current.todos]
          for (let i = 0; i < record.removed.length; i += 1) {
            const at = Math.min(record.indices[i], todos.length)
            todos.splice(at, 0, record.removed[i])
          }
          return { ...current, todos }
        })
      }
      default:
        return Promise.resolve({ error: 'bad-args' })
    }
  }

  /* =====================================================================
     会话卡片（融合自旧 dsh-session-card，契约见 docs/design.md §3.7-3.8）
     ===================================================================== */

  const scard = setupScard(ctx)

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
            const workspaceId = query.get('workspaceId')
            try {
              const domain = await requireDomain()
              sendJson(res, 200, { ok: true, ...snapshotOf(domain, workspaceId !== null && workspaceId !== '' ? workspaceId : null) })
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

          // 会话卡片动作（v0.4）
          if (action.startsWith('scard-')) {
            if (!scard.enabled) {
              sendJson(res, 503, { ok: false, error: 'scard-unavailable' })
              return
            }
            try {
              const result = await scard.handle(action, body)
              if (result.ok === true) {
                sendJson(res, 200, result)
                return
              }
              sendJson(res, result.error === 'scard-unavailable' ? 503 : 400, result)
            } catch (error) {
              ctx.logger.warn(`[dsh-notes] scard '${action}' failed: ${String(error)}`)
              sendJson(res, 503, { ok: false, error: 'scard-failed' })
            }
            return
          }

          try {
            const result = await applyAction(action, body)
            if (result.error !== undefined) {
              sendJson(res, result.error === 'no-undo' ? 404 : 400, { ok: false, error: result.error })
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

/* =====================================================================
   会话卡片管理（独立函数，避免 apply 过长）
   ===================================================================== */

function setupScard(ctx) {
  const agents = ctx.get('agents')
  const agentPresets = ctx.get('agentPresets')
  const llm = ctx.get('llm')
  const agentDefaultModel = ctx.get('agentDefaultModel')
  const workspaceRegistry = ctx.get('workspaceRegistry')
  const sessionTitle = ctx.get('sessionTitle')
  const sessionPersistence = ctx.get('sessionPersistence')
  const sandboxPolicy = ctx.get('sandboxPolicy')
  const fs = ctx.get('fs')

  if (agents === undefined || agentPresets === undefined || llm === undefined) {
    ctx.logger.warn('[dsh-notes] scard disabled: agents/agentPresets/llm unavailable')
    return { enabled: false, handle: () => ({ ok: false, error: 'scard-unavailable' }) }
  }

  /* ---- 状态文件（沿用旧 dsh-session-card 路径，已建会话无缝复用） ---- */
  let stateFile = null
  try {
    if (fs !== undefined && sandboxPolicy !== undefined && typeof fs.resolve === 'function') {
      stateFile = fs.resolve(sandboxPolicy.workspaceRoot, '.dsh', 'session-card.json')
    }
  } catch {
    stateFile = null
  }

  async function readStateFile() {
    if (stateFile === null || fs === undefined) return undefined
    try {
      const text = await fs.readText(stateFile)
      const parsed = JSON.parse(text)
      return typeof parsed.sessionId === 'string' && parsed.sessionId !== '' ? parsed.sessionId : undefined
    } catch {
      return undefined
    }
  }

  async function writeStateFile(sessionId) {
    if (stateFile === null || fs === undefined) return
    try {
      await fs.writeText(stateFile, JSON.stringify({ sessionId }))
    } catch (error) {
      ctx.logger.warn(`[dsh-notes] failed to write session-card state: ${String(error)}`)
    }
  }

  /* ---- 运行态 ---- */
  const overrides = new Map() // sessionId -> { provider, model, effort? }
  const revisions = new Map() // sessionId -> number（仅递增计数）
  const presetChains = new Map() // sessionId -> promise（预设切换串行化）
  let residentPromise = null // ensureResident 单飞

  /* ---- 全局监听（untagged：所有 agent 作用域分发都可收听，按 id 过滤） ---- */
  ctx.on('agent/request', async (payload, next) => {
    const resolved = await next()
    const id = payload?.agent?.id
    if (id === undefined) return resolved
    const override = overrides.get(id)
    if (override === undefined) return resolved
    const { reasoningEffort: _inherited, ...rest } = resolved
    return {
      ...rest,
      provider: override.provider,
      model: override.model,
      ...(override.effort === undefined ? {} : { reasoningEffort: override.effort }),
    }
  })

  ctx.on('session/event', (session, event) => {
    const id = session?.id
    if (id === undefined || id !== residentIdRef.current) return
    revisions.set(id, (revisions.get(id) ?? 0) + 1)
  })

  ctx.on('agent/disposed', (subject) => {
    const id = subject?.id ?? subject?.agent?.id
    if (id !== undefined) overrides.delete(id)
  })

  // residentId 的 ref 视图（供无闭包同步问题的监听器读取）
  const residentIdRef = { current: null }

  /* ---- 常驻会话生命周期 ---- */
  function defaultSelection() {
    try {
      const selection = agentDefaultModel?.currentSelection?.()
      if (selection && typeof selection.provider === 'string' && typeof selection.model === 'string') {
        return { provider: selection.provider, model: selection.model }
      }
    } catch { /* ignore */ }
    return undefined
  }

  async function createResident() {
    const sessionId = 'sesscard-' + Math.random().toString(36).slice(2, 10)
    const selection = defaultSelection()
    const handle = await agents.create({
      sessionId,
      ...(selection === undefined ? {} : { agentOptions: selection }),
      meta: { cwd: undefined }, // 无 cwd → 未分组，无关任何工作区
      setup: async (agentCtx) => {
        try {
          await agentPresets.mount(agentCtx, undefined) // 默认预设
        } catch (error) {
          ctx.logger.warn(`[dsh-notes] resident preset mount failed: ${String(error)}`)
        }
      },
    })
    const agent = handle.agent
    try {
      if (sessionTitle !== undefined) await sessionTitle.rename(agent.session, '常驻会话')
    } catch (error) {
      ctx.logger.warn(`[dsh-notes] rename resident failed: ${String(error)}`)
    }
    await writeStateFile(sessionId)
    return sessionId
  }

  /** 从持久化记录折叠预设 id（冷会话恢复时 setup 用；失败返回 undefined = 挂默认）。 */
  async function foldedPresetFromPersistence(id) {
    if (sessionPersistence === undefined || typeof sessionPersistence.inspect !== 'function') return undefined
    try {
      const record = await sessionPersistence.inspect(id)
      const source = record?.session ?? record
      const events = Array.isArray(source?.events) ? source.events : []
      for (let i = events.length - 1; i >= 0; i--) {
        const ev = events[i]
        if (ev?.type === 'agent-preset/selected' && typeof ev.data?.agentPreset === 'string') return ev.data.agentPreset
      }
      const header = source?.requestHeader ?? source?.header
      if (header && typeof header.agentPreset === 'string') return header.agentPreset
    } catch { /* ignore */ }
    return undefined
  }

  async function resumeAgent(id) {
    const existing = agents.get(id)
    if (existing !== undefined) return existing
    const selection = defaultSelection()
    const presetId = await foldedPresetFromPersistence(id)
    const handle = await agents.resume({
      resumeSessionId: id,
      ...(selection === undefined ? {} : { agentOptions: selection }),
      setup: async (agentCtx) => {
        try {
          await agentPresets.mount(agentCtx, presetId ?? undefined)
        } catch (error) {
          ctx.logger.warn(`[dsh-notes] resident resume preset mount failed: ${String(error)}`)
        }
      },
    })
    return handle.agent
  }

  /** 单飞：确保常驻会话存在（创建或复用），返回 sessionId；失败返回 null。 */
  function ensureResident() {
    residentPromise ??= (async () => {
      let id = await readStateFile()
      if (id !== undefined && sessionPersistence !== undefined) {
        try {
          const rows = await sessionPersistence.list()
          const known = Array.isArray(rows) && rows.some((row) => (row?.id ?? row?.sessionId) === id)
          if (!known) id = undefined
        } catch {
          id = undefined // 无法核对 → 保守新建
        }
      }
      if (id === undefined) {
        id = await createResident()
      } else {
        try {
          await resumeAgent(id) // 冷会话立即恢复（卡片可能马上发送首条消息）
        } catch (error) {
          ctx.logger.warn(`[dsh-notes] resident resume failed: ${String(error)}`)
        }
      }
      residentIdRef.current = id
      return id
    })().catch((error) => {
      residentPromise = null
      ctx.logger.warn(`[dsh-notes] scard ensure failed: ${String(error)}`)
      return null
    })
    return residentPromise
  }

  /* ---- 查询辅助 ---- */
  function foldedPresetOf(session) {
    try {
      const header = typeof session.requestHeader === 'function' ? session.requestHeader() : undefined
      if (header && typeof header.agentPreset === 'string') return header.agentPreset
    } catch { /* ignore */ }
    const events = session.events ?? []
    for (let i = events.length - 1; i >= 0; i--) {
      const ev = events[i]
      if (ev.type === 'agent-preset/selected' && ev.data && typeof ev.data.agentPreset === 'string') return ev.data.agentPreset
    }
    return undefined
  }

  function isRunning(session) {
    let running = false
    for (const ev of session.events ?? []) {
      if (ev.type === 'turn/start') running = true
      else if (ev.type === 'turn/end') running = false
    }
    return running
  }

  function textOfBlocks(content) {
    if (!Array.isArray(content)) return ''
    let out = ''
    for (const block of content) {
      if (block && block.type === 'text' && typeof block.text === 'string') out += block.text
    }
    return out
  }

  function foldTranscript(session) {
    const messages = []
    let partial = null
    let running = false
    let lastSeq = 0
    for (const ev of session.events ?? []) {
      const seq = typeof ev.seq === 'number' ? ev.seq : 0
      if (seq > lastSeq) lastSeq = seq
      switch (ev.type) {
        case 'user/message': {
          const text = textOfBlocks(ev.data?.content)
          if (text !== '') messages.push({ id: `u${seq}`, role: 'user', text })
          break
        }
        case 'assistant/message': {
          const text = textOfBlocks(ev.data?.message?.content)
          if (text !== '') messages.push({ id: `a${seq}`, role: 'assistant', text })
          break
        }
        case 'assistant/chunk': {
          const chunk = ev.data?.chunk
          if (!chunk) break
          if (chunk.type === 'block-start' && chunk.blockType === 'text') partial = { id: `p${seq}`, text: '' }
          else if (chunk.type === 'text-delta' && partial !== null) partial.text += chunk.text ?? ''
          else if (chunk.type === 'block-end' && partial !== null) {
            if (partial.text !== '') messages.push({ id: partial.id, role: 'assistant', text: partial.text })
            partial = null
          }
          break
        }
        case 'step/start': {
          if (partial === null) partial = { id: `p${seq}`, text: '' }
          break
        }
        case 'step/end': {
          if (partial !== null) {
            if (partial.text !== '') messages.push({ id: partial.id, role: 'assistant', text: partial.text })
            partial = null
          }
          break
        }
        case 'turn/start':
          running = true
          break
        case 'turn/end':
          running = false
          break
        default:
          break
      }
    }
    if (partial !== null && partial.text !== '') messages.push({ id: partial.id, role: 'assistant', text: partial.text })
    const trimmed = messages.slice(-TRANSCRIPT_LIMIT)
    return {
      lastSeq,
      running,
      partial: partial !== null ? partial.text : null,
      messages: trimmed,
    }
  }

  function currentModelOf(id, agent) {
    const override = overrides.get(id)
    if (override !== undefined) {
      return { provider: override.provider, model: override.model, ...(override.effort === undefined ? {} : { effort: override.effort }) }
    }
    try {
      const header = typeof agent.session.requestHeader === 'function' ? agent.session.requestHeader() : undefined
      const config = header?.config
      if (config && typeof config.provider === 'string' && typeof config.model === 'string') {
        return {
          provider: config.provider,
          model: config.model,
          ...(config.reasoningEffort === undefined ? {} : { effort: config.reasoningEffort }),
        }
      }
    } catch { /* ignore */ }
    const selection = defaultSelection()
    if (selection !== undefined) {
      let effort
      try {
        effort = agentDefaultModel?.currentSelection?.()?.reasoningEffort
      } catch { /* ignore */ }
      return {
        provider: selection.provider,
        model: selection.model,
        ...(effort === undefined ? {} : { effort }),
      }
    }
    return undefined
  }

  async function buildCatalog() {
    try {
      const providers = await llm.listProviders()
      const out = []
      for (const provider of providers) {
        const providerId = typeof provider === 'string' ? provider : provider.id
        const providerName = typeof provider === 'string' ? provider : provider.name ?? provider.id
        const models = await llm.listModels(providerId)
        const entries = []
        for (const model of models) {
          const modelId = typeof model === 'string' ? model : model.id
          const modelName = typeof model === 'string' ? model : model.name ?? model.id
          let reasoning
          try {
            const info = await llm.resolveModelInfo(providerId, modelId)
            if (info?.reasoning) {
              reasoning = {
                efforts: (info.reasoning.efforts ?? []).map((entry) => ({ id: entry.id, name: entry.name })),
                ...(info.reasoning.defaultEffort === undefined ? {} : { defaultEffort: info.reasoning.defaultEffort }),
              }
            }
          } catch { /* 单模型失败不阻塞目录 */ }
          entries.push({ id: modelId, name: modelName, ...(reasoning === undefined ? {} : { reasoning }) })
        }
        out.push({ id: providerId, name: providerName, models: entries })
      }
      return out
    } catch (error) {
      ctx.logger.warn(`[dsh-notes] model catalog failed: ${String(error)}`)
      return []
    }
  }

  async function roster() {
    try {
      const rows = await agentPresets.list()
      return rows.map((row) => ({
        id: row.id,
        ...(row.name === undefined ? {} : { name: row.name }),
        trust: row.trust,
        isDefault: row.isDefault === true,
        ...(row.broken === true ? { broken: true } : {}),
      }))
    } catch (error) {
      ctx.logger.warn(`[dsh-notes] preset roster failed: ${String(error)}`)
      return []
    }
  }

  /* ---- 动作处理 ---- */
  async function scardState() {
    const id = await ensureResident()
    if (id === null) return { ok: false, error: 'scard-unavailable' }
    let agent
    try {
      agent = agents.get(id) ?? (await resumeAgent(id))
    } catch (error) {
      return { ok: false, error: { code: 'resume-failed', message: String(error?.message ?? error) } }
    }
    const session = agent.session
    const blank = !session.events.some((ev) => ev.type === 'turn/start')
    let presetId
    try {
      presetId = agentPresets.composedPreset(agent.ctx)?.id
    } catch { /* ignore */ }
    presetId ??= foldedPresetOf(session)
    const [catalog, presets] = await Promise.all([buildCatalog(), roster()])
    return {
      ok: true,
      scard: {
        sessionId: id,
        title: '常驻会话',
        blank,
        running: isRunning(session),
        presetId,
        presetLocked: !blank,
        presets,
        model: currentModelOf(id, agent),
        catalog,
      },
    }
  }

  async function scardChatState() {
    const id = await ensureResident()
    if (id === null) return { ok: false, error: 'scard-unavailable' }
    const agent = agents.get(id)
    if (agent === undefined) return { ok: true, scard: { cold: true } }
    return { ok: true, scard: { sessionId: id, ...foldTranscript(agent.session) } }
  }

  async function scardSelectPreset(body) {
    const id = await ensureResident()
    if (id === null) return { ok: false, error: 'scard-unavailable' }
    const presetId = typeof body.presetId === 'string' ? body.presetId : ''
    if (presetId === '') return { ok: false, error: { code: 'bad-args', message: 'presetId required' } }
    let agent
    try {
      agent = agents.get(id) ?? (await resumeAgent(id))
    } catch (error) {
      return { ok: false, error: { code: 'resume-failed', message: String(error?.message ?? error) } }
    }
    const session = agent.session
    if (session.events.some((ev) => ev.type === 'turn/start')) {
      return { ok: false, error: { code: 'locked', message: '会话已开始，预设已锁定' } }
    }
    const prev = presetChains.get(id) ?? Promise.resolve()
    const run = prev.then(async () => {
      try {
        await agentPresets.recompose(agent.ctx, presetId)
      } catch (error) {
        const name = error?.name ?? ''
        if (name === 'UnknownPresetError') return { ok: false, error: { code: 'unknown', message: '预设不存在' } }
        if (name === 'PresetMountError') return { ok: false, error: { code: 'invalid', message: String(error?.message ?? error) } }
        return { ok: false, error: { code: 'not-attached', message: String(error?.message ?? error) } }
      }
      try {
        await session.append('agent-preset/selected', { agentPreset: presetId })
      } catch (error) {
        ctx.logger.warn(`[dsh-notes] append agent-preset/selected failed: ${String(error)}`)
      }
      return { ok: true, presetId }
    })
    presetChains.set(id, run.then(() => {}, () => {}))
    return run
  }

  async function scardSelectModel(body) {
    const id = await ensureResident()
    if (id === null) return { ok: false, error: 'scard-unavailable' }
    const provider = typeof body.provider === 'string' ? body.provider : ''
    const model = typeof body.model === 'string' ? body.model : ''
    if (provider === '' || model === '') return { ok: false, error: { code: 'bad-args', message: 'provider/model required' } }
    const effort = body.effort === undefined || body.effort === null || body.effort === '' ? undefined : body.effort
    try {
      await llm.resolveCallConfig({ provider, model, ...(effort === undefined ? {} : { reasoningEffort: effort }) })
    } catch (error) {
      return { ok: false, error: { code: 'model-unavailable', message: String(error?.message ?? error) } }
    }
    overrides.set(id, { provider, model, ...(effort === undefined ? {} : { effort }) })
    if (agentDefaultModel !== undefined && typeof agentDefaultModel.saveSelection === 'function') {
      try {
        await agentDefaultModel.saveSelection({ provider, model, ...(effort === undefined ? {} : { reasoningEffort: effort }) })
      } catch (error) {
        ctx.logger.warn(`[dsh-notes] saveSelection failed: ${String(error)}`)
      }
    }
    return { ok: true, selected: { provider, model, ...(effort === undefined ? {} : { effort }) } }
  }

  async function scardClear() {
    const id = await ensureResident()
    if (id === null) return { ok: false, error: 'scard-unavailable' }
    const agent = agents.get(id)
    if (agent !== undefined && agent.status === 'running') {
      return { ok: false, error: { code: 'running', message: '会话运行中，不能清空' } }
    }
    try {
      if (workspaceRegistry !== undefined) await workspaceRegistry.archiveSession(id)
    } catch (error) {
      ctx.logger.warn(`[dsh-notes] archiveSession failed: ${String(error)}`)
    }
    overrides.delete(id)
    revisions.delete(id)
    const newId = await createResident()
    residentIdRef.current = newId
    return { ok: true, sessionId: newId }
  }

  return {
    enabled: true,
    handle(action, body) {
      switch (action) {
        case 'scard-state':
          return scardState()
        case 'scard-chat-state':
          return scardChatState()
        case 'scard-select-preset':
          return scardSelectPreset(body)
        case 'scard-select-model':
          return scardSelectModel(body)
        case 'scard-clear':
          return scardClear()
        default:
          return Promise.resolve({ ok: false, error: { code: 'unknown-action', message: action } })
      }
    },
  }
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
