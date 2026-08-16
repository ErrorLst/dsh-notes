// dsh-notes —— 浏览器 half（官方 client bundle，__ModuleLoader__ 契约）。
//
// 职责：
//   1. shell.overlay 注册常驻条目（id: notes-dock）——「小记」竖栏：
//      position:absolute（定位上下文 = overlay 层，层本身 inset:0 覆盖整个
//      AppFrame），left = AppFrame 网格第一列（侧栏列）实测宽度；
//      从自身 DOM 向上找到 grid 帧元素，解析 gridTemplateColumns，
//      MutationObserver 跟随侧栏折叠/拖拽（不硬编码任何产品选择器）。
//   2. 竖栏内容：全局/本工作区 tab + 待办区（添加/勾选/双击编辑/删除/清空/
//      置顶/拖拽排序/撤销删除）+ 随记区（自由文本，防抖 600ms + 失焦自动保存）。
//   3. 数据经 fetch('/api/dsh-notes') 读写；当前工作区解析链：
//      当前会话 cwd（useSessions）→ 路径匹配工作区 → 兜底 recentWorkspaceId。
//   4. 样式只使用 --dsw-alias-* 语义令牌（原型 prototype/index.html 为基准）。

const React = require('react')
const { useState, useEffect, useRef, useCallback } = React

const STYLE_TAG_ID = 'dsh-notes-dock-style'
const COLLAPSED_KEY = 'dsh-notes.collapsed'
const MEMO_DEBOUNCE_MS = 600
const UNDO_TTL_MS = 5000
const ICON_CHECK =
  '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 6.5L5 9l4.5-6"/></svg>'
const ICON_TRASH =
  '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4h10M5.5 4V2.8A.8.8 0 016.3 2h1.4a.8.8 0 01.8.8V4M3.5 4l.6 7a1 1 0 001 1h3.8a1 1 0 001-1l.6-7"/><path d="M6 6.5v3M8 6.5v3"/></svg>'
const ICON_PIN =
  '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M8.6 1.4l4 4-1.4 1.4-1.2-.6-2.2 2.2.6 1.2-1.4 1.4-3-3L3.4 9l-.8-.8 2.6-2.6-1.2-.6 1.4-1.4 1.2.6 2.2-2.2-.6-1.2 1.4-1.4z"/></svg>'
const ICON_COLLAPSE =
  '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4.5L6 8.5l4-4"/></svg>'
const ICON_EXPAND =
  '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2 7.5L6 3.5l4 4"/></svg>'

const DOCK_CSS = `
.dsh-notes-dock {
  position: absolute;
  bottom: 0;
  width: 280px;
  height: min(62vh, 560px);
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--dsw-alias-bg-layer-1);
  border-right: 1px solid var(--dsw-alias-border-l1);
  z-index: 10;
  font-family: var(--dsw-font-family);
  font-size: 12px;
  color: var(--dsw-alias-label-primary);
  box-sizing: border-box;
  --dsh-notes-shadow: 0 8px 28px rgba(15, 17, 21, 0.14), 0 2px 8px rgba(15, 17, 21, 0.08);
}
body[data-ds-dark-theme] .dsh-notes-dock {
  --dsh-notes-shadow: 0 8px 28px rgba(0, 0, 0, 0.5), 0 2px 8px rgba(0, 0, 0, 0.3);
}
.dsh-notes-dock.collapsed {
  width: auto;
  height: auto;
  background: transparent;
  border-right: none;
}
.dsh-notes-dock.collapsed .dock-body { display: none; }
.dsh-notes-dock button { font-family: inherit; font-size: inherit; border: none; background: none; color: inherit; cursor: pointer; }
.dsh-notes-dock input { font-family: inherit; font-size: inherit; color: inherit; }
.dsh-notes-dock textarea { font-family: inherit; font-size: inherit; color: inherit; }

.dock-collapsed {
  display: none;
  align-items: center;
  gap: 6px;
  margin: 0 8px 8px;
  padding: 6px 12px;
  border-radius: 999px;
  background: var(--dsw-alias-bg-overlay);
  border: 1px solid var(--dsw-alias-border-l2);
  box-shadow: var(--dsh-notes-shadow);
  font-size: 11.5px;
  color: var(--dsw-alias-label-secondary);
  white-space: nowrap;
  transition: background var(--ds-transition-duration-fast, 0.1s) var(--ds-ease-in-out, ease);
}
.dsh-notes-dock.collapsed .dock-collapsed { display: flex; }
.dock-collapsed:hover { background: var(--dsw-alias-interactive-bg-hover-solid); color: var(--dsw-alias-label-primary); }
.dock-collapsed svg { width: 11px; height: 11px; }

.dock-body { display: flex; flex-direction: column; min-height: 0; flex: 1; }
.dock-head { display: flex; align-items: center; gap: 8px; padding: 12px 14px 8px; }
.dock-head .np-title { font-size: 12.5px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.dock-head .np-title .em { color: var(--dsw-alias-label-tertiary); font-weight: 400; margin-left: 4px; font-size: 10.5px; }
.dock-collapse {
  margin-left: auto;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  color: var(--dsw-alias-label-tertiary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background var(--ds-transition-duration-fast, 0.1s) var(--ds-ease-in-out, ease);
}
.dock-collapse:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dock-collapse svg { width: 12px; height: 12px; }

.np-tabs { display: flex; gap: 2px; padding: 0 12px 6px; }
.np-tab {
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 11.5px;
  color: var(--dsw-alias-label-secondary);
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: background var(--ds-transition-duration-fast, 0.1s) var(--ds-ease-in-out, ease);
}
.np-tab:hover { background: var(--dsw-alias-interactive-bg-hover); }
.np-tab.active { background: var(--dsw-alias-button-ghost-active-fill); color: var(--dsw-alias-label-primary); font-weight: 500; }

.np-error {
  margin: 0 12px 8px;
  padding: 6px 10px;
  border-radius: 8px;
  background: var(--dsw-alias-interactive-bg-hover-danger);
  color: var(--dsw-alias-state-error-primary);
  font-size: 11.5px;
}

.np-section { display: flex; flex-direction: column; min-height: 0; }
.np-sec-memo { flex: 1; border-top: 1px solid var(--dsw-alias-border-l1); }
.np-sec-head { display: flex; align-items: center; gap: 8px; padding: 8px 12px 6px; }
.np-sec-title { font-size: 10.5px; font-weight: 600; letter-spacing: 0.04em; color: var(--dsw-alias-label-tertiary); }
.np-sec-count { font-size: 10.5px; color: var(--dsw-alias-label-tertiary); }
.np-clear {
  margin-left: auto;
  font-size: 11px;
  color: var(--dsw-alias-label-secondary);
  padding: 2px 6px;
  border-radius: 6px;
  transition: background var(--ds-transition-duration-fast, 0.1s) var(--ds-ease-in-out, ease);
}
.np-clear:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover-danger); color: var(--dsw-alias-state-error-primary); }
.np-clear:disabled { opacity: 0.4; cursor: default; }

.np-input-row { display: flex; gap: 6px; padding: 0 12px 8px; }
.np-input {
  flex: 1;
  min-width: 0;
  padding: 5px 10px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-specific-input-major);
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
  outline: none;
  transition: border-color var(--ds-transition-duration-fast, 0.1s) var(--ds-ease-in-out, ease);
}
.np-input::placeholder { color: var(--dsw-alias-label-tertiary); }
.np-input:focus { border-color: var(--dsw-alias-brand-primary); }
.np-add {
  flex: none;
  padding: 5px 12px;
  border-radius: 8px;
  background: var(--dsw-alias-button-primary-fill);
  color: var(--dsw-alias-label-primary-foreground);
  font-size: 12px;
  font-weight: 500;
  transition: opacity var(--ds-transition-duration-fast, 0.1s) var(--ds-ease-in-out, ease);
}
.np-add:hover { opacity: 0.88; }

.np-list { max-height: 28vh; overflow-y: auto; padding: 2px 8px 6px; }
.np-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border-radius: 8px;
  transition: background var(--ds-transition-duration-fast, 0.1s) var(--ds-ease-in-out, ease);
}
.np-item:hover { background: var(--dsw-alias-interactive-bg-hover); }
.np-item.dragging { opacity: 0.45; }
.np-item.drop-target { box-shadow: inset 0 2px 0 var(--dsw-alias-brand-primary); }
.np-item.pinned .np-text::after { content: ' 📌'; font-size: 9px; }

.np-check {
  flex: none;
  width: 15px;
  height: 15px;
  border-radius: 5px;
  border: 1.5px solid var(--dsw-alias-border-l4);
  background: transparent;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background var(--ds-transition-duration-fast, 0.1s) var(--ds-ease-in-out, ease);
}
.np-check svg { width: 10px; height: 10px; opacity: 0; }
.np-check.on { background: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); }
.np-check.on svg { opacity: 1; }
.np-text {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--dsw-alias-label-primary);
  word-break: break-all;
  cursor: text;
  padding: 1px 0;
}
.np-item.done .np-text { color: var(--dsw-alias-label-tertiary); text-decoration: line-through; }
.np-edit {
  flex: 1;
  min-width: 0;
  padding: 1px 4px;
  border-radius: 6px;
  border: 1px solid var(--dsw-alias-brand-primary);
  background: var(--dsw-specific-input-major);
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
  outline: none;
}
.np-pin {
  flex: none;
  width: 20px;
  height: 20px;
  border-radius: 6px;
  color: var(--dsw-alias-label-tertiary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity var(--ds-transition-duration-fast, 0.1s) var(--ds-ease-in-out, ease), background var(--ds-transition-duration-fast, 0.1s) var(--ds-ease-in-out, ease), color var(--ds-transition-duration-fast, 0.1s) var(--ds-ease-in-out, ease);
}
.np-item:hover .np-pin, .np-pin.on { opacity: 1; }
.np-pin:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-brand-primary); }
.np-pin.on { color: var(--dsw-alias-brand-primary); }
.np-pin svg { width: 12px; height: 12px; }
.np-del {
  flex: none;
  width: 20px;
  height: 20px;
  border-radius: 6px;
  color: var(--dsw-alias-label-tertiary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity var(--ds-transition-duration-fast, 0.1s) var(--ds-ease-in-out, ease);
}
.np-item:hover .np-del { opacity: 1; }
.np-del:hover { background: var(--dsw-alias-interactive-bg-hover-danger); color: var(--dsw-alias-state-error-primary); }
.np-del svg { width: 12px; height: 12px; }
.np-empty { padding: 22px 12px; text-align: center; font-size: 11.5px; color: var(--dsw-alias-label-tertiary); }

.np-undo {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 12px 8px;
  padding: 5px 10px;
  border-radius: 8px;
  background: var(--dsw-alias-bg-overlay);
  border: 1px solid var(--dsw-alias-border-l2);
  box-shadow: var(--dsh-notes-shadow);
  font-size: 11.5px;
  color: var(--dsw-alias-label-secondary);
}
.np-undo button {
  margin-left: auto;
  font-size: 11.5px;
  font-weight: 500;
  color: var(--dsw-alias-brand-primary);
  padding: 2px 6px;
  border-radius: 6px;
  transition: background var(--ds-transition-duration-fast, 0.1s) var(--ds-ease-in-out, ease);
}
.np-undo button:hover { background: var(--dsw-alias-interactive-bg-hover); }

.np-memo {
  flex: 1;
  min-height: 88px;
  margin: 0 12px 10px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-specific-input-major);
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
  line-height: 1.5;
  resize: none;
  outline: none;
  transition: border-color var(--ds-transition-duration-fast, 0.1s) var(--ds-ease-in-out, ease);
}
.np-memo::placeholder { color: var(--dsw-alias-label-tertiary); }
.np-memo:focus { border-color: var(--dsw-alias-brand-primary); }
.np-memo-status { font-size: 10.5px; color: var(--dsw-alias-label-tertiary); margin-left: auto; }
`

function scopeOf(data, tab) {
  return tab === 'global' ? data.global : data.workspace
}

function openCount(todos) {
  let n = 0
  for (const item of todos) if (!item.done) n += 1
  return n
}

function NotesDock(props) {
  const useWorkspaces = props.useWorkspaces
  const useSessions = props.useSessions
  // 当前工作区解析链（按可靠性排序）：
  //   1) 当前会话 id ∈ workspace.sessionIds（权威归属）
  //   2) 会话 cwd → 归一化路径匹配 workspace.path
  //   3) recentWorkspaceId 兜底
  const currentSessionId = useSessions ? useSessions((state) => state.current) : undefined
  const currentCwd = useSessions ? useSessions((state) => (state.current !== undefined ? state.byId[state.current]?.cwd : undefined)) : undefined
  const recentWorkspaceId = useWorkspaces ? useWorkspaces((state) => state.recentWorkspaceId) : undefined
  const workspaceBySession = useWorkspaces ? useWorkspaces((state) => {
    if (currentSessionId === undefined) return undefined
    const hit = state.items.find((item) => item.sessionIds.includes(currentSessionId))
    return hit !== undefined ? hit.workspaceId : undefined
  }) : undefined
  const workspaceByCwd = useWorkspaces ? useWorkspaces((state) => {
    if (currentCwd === undefined) return undefined
    const normalize = (p) => (p ?? '').toLowerCase().replace(/[\\/]+/g, '\\').replace(/\\+$/, '')
    const target = normalize(currentCwd)
    const hit = state.items.find((item) => normalize(item.path) === target)
    return hit !== undefined ? hit.workspaceId : undefined
  }) : undefined
  const workspaceId = workspaceBySession ?? workspaceByCwd ?? recentWorkspaceId
  const workspaceTitle = useWorkspaces ? useWorkspaces((state) =>
    state.items.find((item) => item.workspaceId === workspaceId)?.title,
  ) : undefined

  const rootRef = useRef(null)
  const inputRef = useRef(null)
  const [left, setLeft] = useState(260)
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(COLLAPSED_KEY) === '1' } catch { return false }
  })
  const [data, setData] = useState({ global: { todos: [], memo: '' }, workspace: null })
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('global')
  const [editing, setEditing] = useState(null) // { id, text }
  const [memoText, setMemoText] = useState('')
  const [memoStatus, setMemoStatus] = useState('')
  const [undoInfo, setUndoInfo] = useState(null) // { scope, count } ｜ null
  const [dragId, setDragId] = useState(null)
  const [dropId, setDropId] = useState(null)
  const editingRef = useRef(null)
  const memoTextRef = useRef('')
  const dirtyRef = useRef(false)
  const memoTimerRef = useRef(null)
  const dataForRef = useRef(null) // 当前 data 所属的工作区 id（null = 无工作区）
  const boundKeyRef = useRef(null) // 已绑定 textarea 的作用域键
  const undoTimerRef = useRef(null)

  /* ---------- 竖栏 left 跟随 AppFrame 网格第一列（侧栏列） ---------- */
  useEffect(() => {
    const root = rootRef.current
    if (root === null) return
    let frame = null
    let probe = root.parentElement
    while (probe !== null && probe !== document.body) {
      const computed = getComputedStyle(probe)
      if (computed.display === 'grid' && computed.gridTemplateColumns.split(' ').length >= 3) {
        frame = probe
        break
      }
      probe = probe.parentElement
    }
    if (frame === null) return
    const update = () => {
      const columns = getComputedStyle(frame).gridTemplateColumns.split(' ')
      const px = parseFloat(columns[0])
      if (Number.isFinite(px)) setLeft(px)
    }
    update()
    const observer = new MutationObserver(update)
    observer.observe(frame, { attributes: true, attributeFilter: ['style'] })
    window.addEventListener('resize', update)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [])

  /* ---------- 数据加载（挂载 / 工作区切换 / 窗口聚焦） ---------- */
  useEffect(() => {
    let alive = true
    const load = () => {
      const query = workspaceId !== undefined ? `?workspaceId=${encodeURIComponent(workspaceId)}` : ''
      fetch(`/api/dsh-notes${query}`, { cache: 'no-store' })
        .then((response) => response.json())
        .then((result) => {
          if (!alive) return
          if (result.ok === true) {
            dataForRef.current = workspaceId ?? null
            setData({ global: result.global, workspace: result.workspace })
            setError(null)
          } else {
            setError(result.error ?? 'load-failed')
          }
        })
        .catch(() => {
          if (alive) setError('network')
        })
    }
    load()
    window.addEventListener('focus', load)
    return () => {
      alive = false
      window.removeEventListener('focus', load)
    }
  }, [workspaceId])

  const post = useCallback((body) => {
    return fetch('/api/dsh-notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then((response) => response.json())
      .then((result) => {
        if (result.ok === true) {
          setData({ global: result.state.global, workspace: result.state.workspace })
          setError(null)
        } else {
          setError(result.error ?? 'action-failed')
        }
        return result
      })
      .catch(() => {
        setError('network')
        return { ok: false }
      })
  }, [])

  const workspaceArg = tab === 'workspace' ? workspaceId : undefined

  /* ---------- 随记：防抖保存 ---------- */
  function saveMemoNow() {
    if (!dirtyRef.current) return
    dirtyRef.current = false
    setMemoStatus('已保存')
    void post({ action: 'set-memo', scope: tab, workspaceId: workspaceArg, text: memoTextRef.current })
  }

  function onMemoInput(event) {
    const value = event.target.value
    setMemoText(value)
    memoTextRef.current = value
    dirtyRef.current = true
    setMemoStatus('保存中…')
    if (memoTimerRef.current !== null) clearTimeout(memoTimerRef.current)
    memoTimerRef.current = setTimeout(() => {
      memoTimerRef.current = null
      saveMemoNow()
    }, MEMO_DEBOUNCE_MS)
  }

  function onMemoBlur() {
    if (memoTimerRef.current !== null) { clearTimeout(memoTimerRef.current); memoTimerRef.current = null }
    saveMemoNow()
  }

  /* ---------- 作用域切换时同步 textarea（只绑定一次，不打断输入） ---------- */
  const scopeKey = tab === 'global' ? 'global' : `workspace:${workspaceId ?? ''}`
  useEffect(() => {
    if (tab === 'workspace' && (workspaceId === undefined || dataForRef.current !== workspaceId)) return // 等待当前工作区数据到达
    const effectiveKey = tab === 'global' ? 'global' : `workspace:${dataForRef.current ?? ''}`
    if (boundKeyRef.current === effectiveKey) return
    const scope = tab === 'global' ? data.global : data.workspace
    if (scope === null) return // 工作区记录尚不存在
    boundKeyRef.current = effectiveKey
    setMemoText(scope.memo)
    memoTextRef.current = scope.memo
    dirtyRef.current = false
    setMemoStatus('')
  }, [scopeKey, data]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- 撤销（删除/清空后 5s 内可恢复） ---------- */
  function showUndo(scope, count) {
    if (undoTimerRef.current !== null) clearTimeout(undoTimerRef.current)
    setUndoInfo({ scope, count })
    undoTimerRef.current = setTimeout(() => {
      undoTimerRef.current = null
      setUndoInfo(null)
    }, UNDO_TTL_MS)
  }

  function undoDelete() {
    if (undoInfo === null) return
    const target = undoInfo.scope
    if (undoTimerRef.current !== null) { clearTimeout(undoTimerRef.current); undoTimerRef.current = null }
    setUndoInfo(null)
    void post({ action: 'undo-delete', scope: target, workspaceId: target === 'workspace' ? workspaceId : undefined })
      .then((result) => {
        if (result.ok !== true) setError(result.error ?? 'no-undo')
      })
  }

  /* ---------- 折叠 ---------- */
  function collapse() {
    saveMemoNow()
    setCollapsed(true)
    try { localStorage.setItem(COLLAPSED_KEY, '1') } catch { /* ignore */ }
  }
  function expand() {
    setCollapsed(false)
    try { localStorage.setItem(COLLAPSED_KEY, '0') } catch { /* ignore */ }
    requestAnimationFrame(() => { inputRef.current?.focus() })
  }

  /* ---------- 待办动作 ---------- */
  function addTodo() {
    const input = inputRef.current
    if (input === null) return
    const text = input.value.trim()
    if (text === '') return
    input.value = ''
    void post({ action: 'add', scope: tab, workspaceId: workspaceArg, text })
  }

  function toggleTodo(item) {
    void post({ action: 'toggle', scope: tab, workspaceId: workspaceArg, id: item.id, done: !item.done })
  }

  function pinTodo(item) {
    void post({ action: 'pin', scope: tab, workspaceId: workspaceArg, id: item.id, pinned: !item.pinned })
  }

  function deleteTodo(item) {
    void post({ action: 'delete', scope: tab, workspaceId: workspaceArg, id: item.id }).then((result) => {
      if (result.ok === true) showUndo(tab, 1)
    })
  }

  function clearDone() {
    const scope = scopeOf(data, tab)
    const count = scope === null ? 0 : scope.todos.filter((item) => item.done).length
    void post({ action: 'clear-done', scope: tab, workspaceId: workspaceArg }).then((result) => {
      if (result.ok === true && count > 0) showUndo(tab, count)
    })
  }

  /* ---------- 拖拽排序 ---------- */
  function onDragStart(event, id) {
    setDragId(id)
    try { event.dataTransfer.effectAllowed = 'move' } catch { /* ignore */ }
  }
  function onDragOver(event, id) {
    if (dragId === null || dragId === id) return
    event.preventDefault()
    setDropId(id)
  }
  function onDrop(event, targetId) {
    event.preventDefault()
    const from = dragId
    setDragId(null)
    setDropId(null)
    if (from === null || from === targetId) return
    const scope = scopeOf(data, tab)
    if (scope === null) return
    const todos = scope.todos
    const display = [...todos.filter((item) => item.pinned), ...todos.filter((item) => !item.pinned)]
    const fromIndex = display.findIndex((item) => item.id === from)
    if (fromIndex < 0) return
    const next = [...display]
    const [moved] = next.splice(fromIndex, 1)
    const targetIndex = targetId === null ? next.length : next.findIndex((item) => item.id === targetId)
    next.splice(targetIndex < 0 ? next.length : targetIndex, 0, moved)

    const pinnedCount = todos.filter((item) => item.pinned).length
    const movedIndex = next.indexOf(moved)
    const shouldPin = movedIndex < pinnedCount
    const updates = []
    if (moved.pinned !== shouldPin) updates.push(post({ action: 'pin', scope: tab, workspaceId: workspaceArg, id: moved.id, pinned: shouldPin }))
    updates.push(post({ action: 'reorder', scope: tab, workspaceId: workspaceArg, orderedIds: next.map((item) => item.id) }))
    void Promise.all(updates)
  }

  /* ---------- 行内编辑 ---------- */
  function startEdit(item) {
    editingRef.current = { id: item.id, text: item.text }
    setEditing({ id: item.id, text: item.text })
  }
  function commitEdit() {
    const edit = editingRef.current
    editingRef.current = null
    setEditing(null)
    if (edit === null) return
    const text = edit.text.trim()
    if (text === '') return
    void post({ action: 'edit', scope: tab, workspaceId: workspaceArg, id: edit.id, text })
  }

  /* ---------- 渲染 ---------- */
  if (collapsed) {
    return React.createElement(
      'div',
      { className: 'dsh-notes-dock collapsed', ref: rootRef, style: { left: `${left}px` } },
      React.createElement(
        'button',
        { className: 'dock-collapsed', type: 'button', title: '展开小记', onClick: expand },
        React.createElement('span', null, '📝'),
        React.createElement('span', null, '小记'),
        React.createElement('span', { dangerouslySetInnerHTML: { __html: ICON_EXPAND } }),
      ),
    )
  }

  const scope = tab === 'workspace' && data.workspace === null ? null : scopeOf(data, tab)
  const todos = scope === null ? [] : scope.todos
  const doneCount = todos.filter((item) => item.done).length
  const displayTodos = [...todos.filter((item) => item.pinned), ...todos.filter((item) => !item.pinned)]

  const tabs = [
    React.createElement(
      'button',
      {
        key: 'global',
        type: 'button',
        className: 'np-tab' + (tab === 'global' ? ' active' : ''),
        onClick: () => { if (tab !== 'global') { saveMemoNow(); setTab('global') } },
      },
      '全局',
    ),
  ]
  if (workspaceId !== undefined) {
    tabs.push(
      React.createElement(
        'button',
        {
          key: 'workspace',
          type: 'button',
          className: 'np-tab' + (tab === 'workspace' ? ' active' : ''),
          title: `本工作区：${workspaceTitle ?? ''}`,
          onClick: () => { if (tab !== 'workspace') { saveMemoNow(); setTab('workspace') } },
        },
        workspaceTitle ?? '本工作区',
      ),
    )
  }

  const listItems = displayTodos.length === 0
    ? [React.createElement('div', { key: 'empty', className: 'np-empty' }, '还没有待办')]
    : displayTodos.map((item) => {
        if (editing !== null && editing.id === item.id) {
          return React.createElement(
            'div',
            { key: item.id, className: 'np-item' },
            React.createElement('input', {
              className: 'np-edit',
              autoFocus: true,
              defaultValue: editing.text,
              maxLength: 500,
              onChange: (event) => {
                editingRef.current = { id: item.id, text: event.target.value }
                setEditing({ id: item.id, text: event.target.value })
              },
              onKeyDown: (event) => {
                if (event.key === 'Enter') commitEdit()
                if (event.key === 'Escape') { editingRef.current = null; setEditing(null) }
              },
              onBlur: commitEdit,
            }),
          )
        }
        const rowClass = 'np-item'
          + (item.done ? ' done' : '')
          + (item.pinned ? ' pinned' : '')
          + (dragId === item.id ? ' dragging' : '')
          + (dropId === item.id ? ' drop-target' : '')
        return React.createElement(
          'div',
          {
            key: item.id,
            className: rowClass,
            draggable: true,
            title: '拖拽排序，双击编辑',
            onDragStart: (event) => onDragStart(event, item.id),
            onDragOver: (event) => onDragOver(event, item.id),
            onDrop: (event) => onDrop(event, item.id),
            onDragEnd: () => { setDragId(null); setDropId(null) },
            onDoubleClick: () => startEdit(item),
          },
          React.createElement('button', {
            type: 'button',
            className: 'np-check' + (item.done ? ' on' : ''),
            title: item.done ? '标记未完成' : '标记完成',
            onClick: () => toggleTodo(item),
            dangerouslySetInnerHTML: { __html: ICON_CHECK },
          }),
          React.createElement('div', { className: 'np-text' }, item.text),
          React.createElement('button', {
            type: 'button',
            className: 'np-pin' + (item.pinned ? ' on' : ''),
            title: item.pinned ? '取消置顶' : '置顶',
            onClick: () => pinTodo(item),
            dangerouslySetInnerHTML: { __html: ICON_PIN },
          }),
          React.createElement('button', {
            type: 'button',
            className: 'np-del',
            title: '删除',
            onClick: () => deleteTodo(item),
            dangerouslySetInnerHTML: { __html: ICON_TRASH },
          }),
        )
      })

  return React.createElement(
    'div',
    { className: 'dsh-notes-dock', ref: rootRef, style: { left: `${left}px` } },
    React.createElement(
      'div',
      { className: 'dock-body' },
      React.createElement(
        'div',
        { className: 'dock-head' },
        React.createElement(
          'span',
          { className: 'np-title' },
          '小记',
          React.createElement('span', { className: 'em' }, tab === 'global' ? '全局' : '本工作区'),
        ),
        React.createElement('button', {
          type: 'button',
          className: 'dock-collapse',
          title: '折叠小记',
          onClick: collapse,
          dangerouslySetInnerHTML: { __html: ICON_COLLAPSE },
        }),
      ),
      React.createElement('div', { className: 'np-tabs' }, ...tabs),
      error === null
        ? null
        : React.createElement('div', { className: 'np-error' }, '存储不可用，请检查宿主 storage 域。'),
      React.createElement(
        'div',
        { className: 'np-section np-sec-todo' },
        React.createElement(
          'div',
          { className: 'np-sec-head' },
          React.createElement('span', { className: 'np-sec-title' }, '待办'),
          React.createElement(
            'span',
            { className: 'np-sec-count' },
            `共 ${todos.length} 项 · 未完成 ${todos.length - doneCount}`,
          ),
          React.createElement(
            'button',
            { type: 'button', className: 'np-clear', disabled: doneCount === 0, onClick: clearDone },
            '清空已完成',
          ),
        ),
        React.createElement(
          'div',
          { className: 'np-input-row' },
          React.createElement('input', {
            ref: inputRef,
            className: 'np-input',
            placeholder: '添加待办，回车确认…',
            maxLength: 500,
            onKeyDown: (event) => { if (event.key === 'Enter') addTodo() },
          }),
          React.createElement('button', { type: 'button', className: 'np-add', onClick: addTodo }, '添加'),
        ),
        React.createElement('div', { className: 'np-list' }, ...listItems),
        undoInfo === null
          ? null
          : React.createElement(
              'div',
              { className: 'np-undo' },
              React.createElement('span', null, `已删除 ${undoInfo.count} 项`),
              React.createElement('button', { type: 'button', onClick: undoDelete }, '撤销'),
            ),
      ),
      React.createElement(
        'div',
        { className: 'np-section np-sec-memo' },
        React.createElement(
          'div',
          { className: 'np-sec-head' },
          React.createElement('span', { className: 'np-sec-title' }, '随记'),
          React.createElement('span', { className: 'np-memo-status' }, memoStatus),
        ),
        React.createElement('textarea', {
          className: 'np-memo',
          placeholder: '随意记录点什么…（自动保存）',
          spellCheck: false,
          value: memoText,
          onChange: onMemoInput,
          onBlur: onMemoBlur,
        }),
      ),
    ),
  )
}

export default {
  name: 'notes-client',
  inject: ['slots'],
  apply(ctx) {
    ctx.effect(() => {
      if (typeof document === 'undefined') return
      if (document.getElementById(STYLE_TAG_ID) !== null) return
      const tag = document.createElement('style')
      tag.id = STYLE_TAG_ID
      tag.dataset.plugin = '@dsh-external/dsh-notes'
      tag.textContent = DOCK_CSS
      document.head.appendChild(tag)
      return () => { tag.remove() }
    })
    ctx.slots.inject('shell.overlay', () =>
      ctx.slots.register({ name: 'shell.overlay', id: 'notes-dock' }, NotesDock),
    )
  },
}
