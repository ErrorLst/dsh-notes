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
//   3. 会话卡片：管理插件专属「常驻会话」（未分组；cwd 恒为临时目录）——
//      - 状态文件 ~/.dsh/session-card.json（沿用旧 dsh-session-card 路径，
//        已建会话无缝复用；fs/sandboxPolicy 缺失时降级为仅内存运行）；
//        v0.4.18 起持久化 { sessionId, presetId, provider, model, effort }
//        （预设/模型/思考等级），不再持久化 cwd —— 每次新会话都在临时目录
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

import { tmpdir } from 'node:os'
import { join } from 'node:path'

const TODO_TEXT_MAX = 500
const DETAIL_MAX = 20000
const MEMO_MAX = 20000
const ROUTE_PATH = '/api/dsh-notes'
const UNDO_CAP = 100
const TRANSCRIPT_LIMIT = 200
const RESIDENT_TMP_SUBDIR = 'dsh-notes-resident'

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
      detail: typeof item.detail === 'string' ? item.detail : '',
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

  function pushTodo(todos, text, detail) {
    const trimmed = String(text).trim().slice(0, TODO_TEXT_MAX)
    if (trimmed === '') return todos
    const trimmedDetail = typeof detail === 'string' ? detail.slice(0, DETAIL_MAX) : ''
    const now = Date.now()
    const item = { id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`, text: trimmed, done: false, pinned: false, ...(trimmedDetail === '' ? {} : { detail: trimmedDetail }), createdAt: now, updatedAt: now }
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
        return mutate(scope, workspaceId, (current) => ({ ...current, todos: pushTodo(current.todos, body.text, typeof body.detail === 'string' ? body.detail : '') }))
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
        const hasDetail = typeof body.detail === 'string'
        const detail = hasDetail ? body.detail.slice(0, DETAIL_MAX) : undefined
        return mutate(scope, workspaceId, (current) => ({
          ...current,
          todos: current.todos.map((item) => {
            if (item.id !== body.id) return item
            const next = { ...item, text, updatedAt: Date.now() }
            if (hasDetail) {
              if (detail === '') delete next.detail
              else next.detail = detail
            }
            return next
          }),
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

  /* ---- 状态文件（沿用旧 dsh-session-card 路径，已建会话无缝复用） ----
   * fs.resolve(path) 是单路径 API（异步，返回 FsTarget；相对路径按 backend cwd
   * 解析），多段路径必须先 node:path.join，再 resolve 并 await 出 target。 */
  let stateFilePromise = null
  function resolveStateFile() {
    if (stateFilePromise !== null) return stateFilePromise
    const root = sandboxPolicy === undefined ? undefined : sandboxPolicy.workspaceRoot
    if (fs === undefined || typeof fs.resolve !== 'function' || typeof root !== 'string' || root === '') {
      stateFilePromise = Promise.resolve(null)
      return stateFilePromise
    }
    stateFilePromise = fs.resolve(join(root, '.dsh', 'session-card.json')).catch((error) => {
      ctx.logger.warn(`[dsh-notes] failed to resolve session-card state path: ${String(error)}`)
      return null
    })
    return stateFilePromise
  }

  async function readStateFile() {
    if (fs === undefined) return undefined
    const stateFile = await resolveStateFile()
    if (stateFile === null) return undefined
    try {
      const text = await fs.readText(stateFile)
      const parsed = JSON.parse(text)
      if (typeof parsed.sessionId !== 'string' || parsed.sessionId === '') return undefined
      return {
        sessionId: parsed.sessionId,
        presetId: typeof parsed.presetId === 'string' && parsed.presetId !== '' ? parsed.presetId : undefined,
        provider: typeof parsed.provider === 'string' && parsed.provider !== '' ? parsed.provider : undefined,
        model: typeof parsed.model === 'string' && parsed.model !== '' ? parsed.model : undefined,
        effort: typeof parsed.effort === 'string' && parsed.effort !== '' ? parsed.effort : undefined,
      }
    } catch {
      return undefined
    }
  }

  /** 持久化常驻会话设置（预设/模型/思考等级）；cwd 不持久化。 */
  async function writeStateFile(sessionId, settings) {
    if (fs === undefined) return
    const stateFile = await resolveStateFile()
    if (stateFile === null) return
    try {
      const record = { sessionId }
      if (settings?.presetId !== undefined) record.presetId = settings.presetId
      if (settings?.provider !== undefined) record.provider = settings.provider
      if (settings?.model !== undefined) record.model = settings.model
      if (settings?.effort !== undefined) record.effort = settings.effort
      await fs.writeText(stateFile, JSON.stringify(record))
    } catch (error) {
      ctx.logger.warn(`[dsh-notes] failed to write session-card state: ${String(error)}`)
    }
  }

  /* ---- 常驻会话工作目录：恒为系统临时目录下的 dsh-notes-resident（不可配置） ----
   * cwd 在会话创建时写入 header（工具与 {{cwd}} 提示词变量都读 header.cwd，
   * 无法事后修改）；每次新会话都在临时目录。 */
  const residentTempDir = (() => {
    try { return join(tmpdir(), RESIDENT_TMP_SUBDIR) } catch { return null }
  })()
  function residentCwd() {
    if (residentTempDir !== null) return residentTempDir
    try {
      if (sandboxPolicy !== undefined && sandboxPolicy.workspaceRoot !== undefined) return String(sandboxPolicy.workspaceRoot)
    } catch { /* ignore */ }
    return undefined
  }

  /* ---- 运行态 ---- */
  const overrides = new Map() // sessionId -> { provider, model, effort? }
  const revisions = new Map() // sessionId -> number（仅递增计数）
  const presetChains = new Map() // sessionId -> promise（预设切换串行化）
  let residentPromise = null // ensureResident 单飞
  /** 常驻会话持久化设置（读状态文件获得；scard-select-preset/model 更新并落盘） */
  let residentSettings = {}

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

  /** 常驻会话 setup：cwd 变量兜底 + 挂载预设（新建/恢复共用）。 */
  async function mountResidentSetup(agentCtx, presetId) {
    const cwd = residentCwd()
    if (cwd !== null && cwd !== undefined) {
      try {
        const systemPrompt = agentCtx.get('systemPrompt')
        if (systemPrompt !== undefined && typeof systemPrompt.variable === 'function') {
          systemPrompt.variable('cwd', (context) => {
            try {
              const headerCwd = context?.agent?.session?.header?.cwd
              if (typeof headerCwd === 'string' && headerCwd !== '') return headerCwd
            } catch { /* ignore */ }
            return cwd
          })
        }
      } catch (error) {
        ctx.logger.warn(`[dsh-notes] resident cwd variable failed: ${String(error)}`)
      }
    }
    try {
      await agentPresets.mount(agentCtx, presetId)
    } catch (error) {
      ctx.logger.warn(`[dsh-notes] resident preset mount failed: ${String(error)}`)
    }
  }

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

  /** 持久化设置折叠为 agentOptions（预设/模型/思考等级；无则 undefined）。 */
  function persistedSelection() {
    if (typeof residentSettings.provider === 'string' && residentSettings.provider !== ''
      && typeof residentSettings.model === 'string' && residentSettings.model !== '') {
      return {
        provider: residentSettings.provider,
        model: residentSettings.model,
        ...(residentSettings.effort === undefined ? {} : { reasoningEffort: residentSettings.effort }),
      }
    }
    return undefined
  }

  /** 冷恢复后把持久化模型/思考等级同步进 agent/request 覆盖层。
   * agentOptions 的 reasoningEffort 不会被 agent-loop 直接播种到请求，
   * 必须经全局瀑布监听显式应用（与 scard-select-model 同一路径）。 */
  function applyPersistedOverride(id) {
    const persisted = persistedSelection()
    if (persisted === undefined) return
    overrides.set(id, {
      provider: persisted.provider,
      model: persisted.model,
      ...(persisted.reasoningEffort === undefined ? {} : { effort: persisted.reasoningEffort }),
    })
  }

  async function createResident() {
    const sessionId = 'sesscard-' + Math.random().toString(36).slice(2, 10)
    const cwd = residentCwd()
    const selection = persistedSelection() ?? defaultSelection()
    const presetId = typeof residentSettings.presetId === 'string' && residentSettings.presetId !== '' ? residentSettings.presetId : undefined
    let handle
    let fallback = false
    try {
      handle = await agents.create({
        sessionId,
        ...(selection === undefined ? {} : { agentOptions: selection }),
        meta: { cwd }, // 恒为临时目录（工具与 {{cwd}} 都读 header.cwd）
        setup: async (agentCtx) => {
          await mountResidentSetup(agentCtx, presetId)
        },
      })
    } catch (error) {
      // 持久化的模型可能已不可用：回退默认选择重试一次
      fallback = true
      ctx.logger.warn(`[dsh-notes] resident create with persisted selection failed (${String(error?.message ?? error)}), retrying with default`)
      handle = await agents.create({
        sessionId,
        ...(defaultSelection() === undefined ? {} : { agentOptions: defaultSelection() }),
        meta: { cwd },
        setup: async (agentCtx) => {
          await mountResidentSetup(agentCtx, undefined)
        },
      })
    }
    if (!fallback) applyPersistedOverride(sessionId)
    const agent = handle.agent
    try {
      if (sessionTitle !== undefined) await sessionTitle.rename(agent.session, '常驻会话')
    } catch (error) {
      ctx.logger.warn(`[dsh-notes] rename resident failed: ${String(error)}`)
    }
    await writeStateFile(sessionId, residentSettings)
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
    if (existing !== undefined) {
      applyPersistedOverride(id)
      return existing
    }
    const selection = persistedSelection() ?? defaultSelection()
    let presetId = typeof residentSettings.presetId === 'string' && residentSettings.presetId !== '' ? residentSettings.presetId : undefined
    presetId ??= await foldedPresetFromPersistence(id)
    const handle = await agents.resume({
      resumeSessionId: id,
      ...(selection === undefined ? {} : { agentOptions: selection }),
      setup: async (agentCtx) => {
        await mountResidentSetup(agentCtx, presetId)
      },
    })
    applyPersistedOverride(id)
    return handle.agent
  }

  /** 单飞：确保常驻会话存在（创建或复用），返回 sessionId；失败返回 null。 */
  function ensureResident() {
    residentPromise ??= (async () => {
      const state = await readStateFile()
      residentSettings = {
        ...(state?.presetId === undefined ? {} : { presetId: state.presetId }),
        ...(state?.provider === undefined ? {} : { provider: state.provider }),
        ...(state?.model === undefined ? {} : { model: state.model }),
        ...(state?.effort === undefined ? {} : { effort: state.effort }),
      }
      let id = state?.sessionId
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
          const agent = await resumeAgent(id) // 冷会话立即恢复（卡片可能马上发送首条消息）
          // 会话 cwd 与当前策略（恒为临时目录）不一致且会话仍空白 → 重建
          const blank = agent !== undefined && !agent.session.events.some((ev) => ev.type === 'turn/start')
          if (blank && residentCwd() !== null && residentCwd() !== undefined && agent.session.header?.cwd !== residentCwd()) {
            try {
              if (workspaceRegistry !== undefined) await workspaceRegistry.archiveSession(id)
            } catch (error) {
              ctx.logger.warn(`[dsh-notes] archiveSession failed: ${String(error)}`)
            }
            overrides.delete(id)
            revisions.delete(id)
            id = await createResident()
          }
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

  /* ---- 消息来源投影（对齐 dsh-client-runtime contextProvenance，纯 JSON） ----
   * user/message 的 source 区分直接人类输入（{kind:'user'}）与注入上下文
   * （agent-instructions / plugin / skill-invocation / session-reference 等，
   * 可合并扩展）。上下文行的标题/生产者按 provenance 规则推导。 */
  const CONTEXT_FORM_LABELS = {
    instructions: '工作区指令',
    catalog: '目录',
    snapshot: '快照',
    notice: '通知',
    relay: '转达',
    recall: '跨会话召回',
  }

  function recordOf(source) {
    return source !== null && typeof source === 'object' ? source : null
  }

  function stringOf(value) {
    return typeof value === 'string' && value !== '' ? value : null
  }

  function collectStrings(record, key, subKey) {
    const list = Array.isArray(record[key]) ? record[key] : null
    if (list === null) return null
    const out = []
    for (const item of list) {
      if (item !== null && typeof item === 'object' && stringOf(item[subKey]) !== null) {
        out.push(item[subKey])
      } else if (subKey === undefined && stringOf(item) !== null) {
        out.push(item)
      }
    }
    return out.length > 0 ? out : null
  }

  function contextProvenanceOf(source) {
    const record = recordOf(source)
    const kind = record === null ? null : stringOf(record.kind)
    if (kind === null) return { role: 'inject', label: null }
    switch (kind) {
      case 'session-reference': {
        const labels = collectStrings(record, 'references', 'label')
        return { role: 'recall', label: labels !== null ? labels.join('、') : null }
      }
      case 'agent-instructions': {
        const paths = collectStrings(record, 'changes', 'path')
        return { role: 'inject', label: paths !== null ? paths.join('、') : null }
      }
      case 'plugin':
        return { role: 'inject', label: stringOf(record.plugin) ?? null }
      case 'skill-invocation':
        return { role: 'inject', label: stringOf(record.name) ?? null }
      default:
        return { role: 'inject', label: null }
    }
  }

  function contextFormOf(source) {
    const record = recordOf(source)
    const form = record === null ? null : stringOf(record.form)
    return form !== null && Object.prototype.hasOwnProperty.call(CONTEXT_FORM_LABELS, form) ? form : null
  }

  function resultTextOf(data) {
    // tool/result: message.content = [ToolResultBlock { type:'tool-result', toolCallId, content, isError }]
    const content = Array.isArray(data?.message?.content) ? data.message.content : null
    const block = content !== null && content.length > 0 ? content[0] : null
    if (block === null || block.type !== 'tool-result') return ''
    return textOfBlocks(block.content)
  }

  function flushPartials(partials, messages, onRow) {
    const done = []
    for (const p of partials.values()) {
      if (p.kind === 'text' && p.text !== '') onRow({ kind: 'assistant', id: p.id, text: p.text }, p.stepKey)
      else if (p.kind === 'reasoning' && p.text !== '') onRow({ kind: 'reasoning', id: p.id, text: p.text }, p.stepKey)
      else if (p.kind === 'tool-call' && (p.name !== '' || p.args !== '')) {
        onRow({ kind: 'tool', id: p.id, callId: p.callId ?? '', name: p.name, args: p.args, result: null, isError: false, done: false }, p.stepKey)
      }
      done.push(p.id)
    }
    partials.clear()
    return done
  }

  function foldTranscript(session) {
    const messages = []
    const toolById = new Map() // callId -> 行对象（流式块与 tool/call 事件共用，按 callId 去重）
    const partialRowsByStep = new Map() // stepKey -> Set<rowId>：流式收尾行；最终 assistant/message 落地时移除（同一输出只显示一次）
    const partials = new Map() // 流式块索引 -> { id, kind, text, name, args, callId, stepKey }

    const stepKeyOf = (data) => {
      const turn = data?.turn
      const step = data?.step
      return typeof turn === 'number' && typeof step === 'number' ? `${turn}:${step}` : null
    }

    const markPartialRow = (stepKey, rowId) => {
      if (stepKey === null) return
      let set = partialRowsByStep.get(stepKey)
      if (set === undefined) { set = new Set(); partialRowsByStep.set(stepKey, set) }
      set.add(rowId)
    }

    const removePartialRowsOf = (stepKey) => {
      const set = partialRowsByStep.get(stepKey)
      if (set === undefined || set.size === 0) return
      partialRowsByStep.delete(stepKey)
      for (let i = messages.length - 1; i >= 0; i--) {
        if (set.has(messages[i].id)) messages.splice(i, 1)
      }
    }

    const upsertToolRow = (callId, fields) => {
      if (typeof callId === 'string' && callId !== '') {
        const existing = toolById.get(callId)
        if (existing !== undefined && messages.includes(existing) && existing.kind === 'tool') {
          if (typeof fields.name === 'string' && fields.name !== '') existing.name = fields.name
          if (typeof fields.args === 'string' && fields.args !== '') existing.args = fields.args
          return existing
        }
        const row = { kind: 'tool', id: `t${callId}`, callId, name: fields.name ?? '', args: fields.args ?? '', result: null, isError: false, done: false }
        toolById.set(callId, row)
        messages.push(row)
        return row
      }
      const row = { kind: 'tool', id: fields.id ?? `tp${messages.length}`, name: fields.name ?? '', args: fields.args ?? '', result: null, isError: false, done: false }
      messages.push(row)
      return row
    }

    // 统一落行：工具行走 callId 去重；文本/思考行记录 stepKey 供最终消息替换
    const pushRow = (row, stepKey) => {
      if (row.kind === 'tool') {
        upsertToolRow(row.callId, { id: row.id, name: row.name, args: row.args })
        return
      }
      messages.push(row)
      markPartialRow(stepKey, row.id)
    }

    let running = false
    let lastSeq = 0
    for (const ev of session.events ?? []) {
      const seq = typeof ev.seq === 'number' ? ev.seq : 0
      if (seq > lastSeq) lastSeq = seq
      switch (ev.type) {
        case 'user/message': {
          const source = ev.data?.source
          const isHuman = recordOf(source) !== null && source.kind === 'user'
          if (isHuman) {
            const text = textOfBlocks(ev.data?.content)
            if (text !== '') messages.push({ kind: 'user', id: `u${seq}`, text })
          } else if (recordOf(source) !== null && source.kind !== 'tool') {
            // 注入上下文（工作区指令 / 技能目录 / 快照 / 通知 / 跨会话召回 …）
            const text = textOfBlocks(ev.data?.content)
            const provenance = contextProvenanceOf(source)
            const form = contextFormOf(source)
            const row = {
              kind: 'context',
              id: `c${seq}`,
              label: form !== null ? CONTEXT_FORM_LABELS[form] : (provenance.role === 'recall' ? '跨会话召回' : '上下文注入'),
              producer: provenance.label ?? '',
              text,
              source, // 原始 source（叶字段 JSON），客户端按官方表单化正文渲染
            }
            if (form === 'notice' && stringOf(source.summary) !== null) row.summary = source.summary
            messages.push(row)
          }
          // kind 'tool' 的 user/message（若有）跳过：tool/result 事件负责工具结果卡
          break
        }
        case 'assistant/message': {
          const content = Array.isArray(ev.data?.message?.content) ? ev.data.message.content : null
          if (content === null) break
          // 该 step 的流式收尾行已被最终消息取代：先移除再推最终行（避免同内容重复）
          removePartialRowsOf(stepKeyOf(ev.data))
          for (const block of content) {
            if (block === null || typeof block !== 'object') continue
            if (block.type === 'text' && typeof block.text === 'string' && block.text !== '') {
              messages.push({ kind: 'assistant', id: `a${seq}`, text: block.text })
            } else if (block.type === 'reasoning' && typeof block.text === 'string' && block.text !== '') {
              messages.push({ kind: 'reasoning', id: `r${seq}`, text: block.text })
            }
            // tool-call 块跳过：tool/call 事件单独成卡（与 DSH 会话视图一致，避免重复）
          }
          break
        }
        case 'assistant/chunk': {
          const chunk = ev.data?.chunk
          if (chunk === null || typeof chunk !== 'object') break
          if (chunk.type === 'block-start') {
            const kind = chunk.blockType === 'text' || chunk.blockType === 'reasoning' || chunk.blockType === 'tool-call'
              ? chunk.blockType
              : 'text'
            partials.set(chunk.index, { id: `p${seq}`, kind, text: '', name: '', args: '', callId: '', stepKey: stepKeyOf(ev.data) })
          } else if (chunk.type === 'text-delta') {
            let p = partials.get(chunk.index)
            if (p === undefined) { p = { id: `p${seq}`, kind: 'text', text: '', name: '', args: '', callId: '', stepKey: stepKeyOf(ev.data) }; partials.set(chunk.index, p) }
            if (p.kind === 'text') p.text += chunk.text ?? ''
          } else if (chunk.type === 'reasoning-delta') {
            let p = partials.get(chunk.index)
            if (p === undefined) { p = { id: `p${seq}`, kind: 'reasoning', text: '', name: '', args: '', callId: '', stepKey: stepKeyOf(ev.data) }; partials.set(chunk.index, p) }
            if (p.kind === 'reasoning') p.text += chunk.text ?? ''
          } else if (chunk.type === 'tool-call-delta') {
            let p = partials.get(chunk.index)
            if (p === undefined) { p = { id: `p${seq}`, kind: 'tool-call', text: '', name: '', args: '', callId: '', stepKey: stepKeyOf(ev.data) }; partials.set(chunk.index, p) }
            if (p.kind === 'tool-call') {
              if (chunk.id !== undefined && typeof chunk.id === 'string' && chunk.id !== '') p.callId = chunk.id
              if (chunk.name !== undefined && typeof chunk.name === 'string' && chunk.name !== '') p.name = chunk.name
              p.args += chunk.argumentsDelta ?? ''
            }
          } else if (chunk.type === 'block-end') {
            const p = partials.get(chunk.index)
            if (p !== undefined) {
              partials.delete(chunk.index)
              if (p.kind === 'text' && p.text !== '') pushRow({ kind: 'assistant', id: p.id, text: p.text }, p.stepKey)
              else if (p.kind === 'reasoning' && p.text !== '') pushRow({ kind: 'reasoning', id: p.id, text: p.text }, p.stepKey)
              else if (p.kind === 'tool-call' && (p.name !== '' || p.args !== '')) {
                pushRow({ kind: 'tool', id: p.id, callId: p.callId ?? '', name: p.name, args: p.args, result: null, isError: false, done: false }, p.stepKey)
              }
            }
          }
          break
        }
        case 'tool/call': {
          const callId = typeof ev.data?.callId === 'string' ? ev.data.callId : null
          if (callId === null || callId === '') break
          upsertToolRow(callId, {
            name: typeof ev.data.name === 'string' ? ev.data.name : '',
            args: typeof ev.data.arguments === 'string' ? ev.data.arguments : '',
          })
          break
        }
        case 'tool/result': {
          const data = ev.data ?? {}
          const block = Array.isArray(data.message?.content) && data.message.content.length > 0 ? data.message.content[0] : null
          const callId = block !== null && block.type === 'tool-result' && typeof block.toolCallId === 'string'
            ? block.toolCallId
            : (recordOf(data.message?.source) !== null && typeof data.message.source.callId === 'string' ? data.message.source.callId : null)
          const row = callId !== null ? toolById.get(callId) : undefined
          const resultText = resultTextOf(data)
          const isError = (block !== null && block.isError === true) || data.error !== undefined
          if (row !== undefined && messages.includes(row) && row.kind === 'tool') {
            row.result = resultText
            row.isError = isError
            row.done = true
          } else if (resultText !== '') {
            messages.push({ kind: 'tool', id: `tr${seq}`, name: '', args: '', result: resultText, isError, done: true })
          }
          break
        }
        case 'step/end':
        case 'turn/end': {
          if (ev.type === 'turn/end') {
            running = false
            // 终局失败：回合错误行（与官方 TurnErrorItem 一致；模型 429 等可见）
            const reason = recordOf(ev.data?.reason)
            if (reason !== null && reason.kind === 'error' && recordOf(reason.error) !== null) {
              const message = stringOf(reason.error.message)
              if (message !== null) {
                const code = stringOf(reason.error.code)
                messages.push({ kind: 'turn-error', id: `te${seq}`, text: message, ...(code === null ? {} : { code }) })
              }
            }
          }
          flushPartials(partials, messages, pushRow)
          break
        }
        case 'turn/start':
          running = true
          break
        default:
          break
      }
    }
    const trimmed = messages.slice(-TRANSCRIPT_LIMIT)
    // 仍打开的流式块（未 block-end / step-end / turn-end）作为实时行上报
    const livePartials = []
    for (const p of partials.values()) {
      if (p.kind === 'text' && p.text !== '') livePartials.push({ kind: 'assistant', id: p.id, text: p.text })
      else if (p.kind === 'reasoning' && p.text !== '') livePartials.push({ kind: 'reasoning', id: p.id, text: p.text })
      else if (p.kind === 'tool-call' && (p.name !== '' || p.args !== '')) {
        livePartials.push({ kind: 'tool', id: p.id, ...(p.callId === '' ? {} : { callId: p.callId }), name: p.name, args: p.args, result: null, isError: false, done: false })
      }
    }
    return {
      lastSeq,
      running,
      partials: livePartials,
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
      residentSettings.presetId = presetId
      await writeStateFile(id, residentSettings)
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
    residentSettings.provider = provider
    residentSettings.model = model
    if (effort === undefined) delete residentSettings.effort
    else residentSettings.effort = effort
    await writeStateFile(id, residentSettings)
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
    residentPromise = null // 关键：失效单飞缓存，下次 ensureResident() 重新读状态文件解析新会话
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
