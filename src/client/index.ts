// dsh-notes —— 浏览器 half（官方 client bundle，__ModuleLoader__ 契约）。
//
// v0.5.0 起移除常驻会话卡片：本插件只保留「小计」（全局/本工作区 tab + 待办
// + 随记）。其余保留：
//   1. shell.overlay 注册常驻条目（id: notes-dock）——左边全高竖栏：
//      position:absolute，left/top 跟随侧栏列宽与会话头部下缘（测量 + 观察器）。
//   2. 视图绑定：轨迹/上下文等非对话视图下整条竖栏隐藏（tab 栏为权威信号，
//      三重触发：MutationObserver + tab 点击监听 + 1.5s 轮询重检）。
//   3. 窄窗口自动折叠（<1024px，与 DSH 侧栏同阈值）：折叠为底部小胶囊；
//      点击临时展开，回宽窗口恢复。无手动折叠、无持久化。
//   4. 右缘宽度拖拽（localStorage 持久化）。
//   5. 小计数据经 fetch('/api/dsh-notes') 读写；当前工作区解析链：
//      当前会话 cwd（useSessions）→ 路径匹配工作区 → 兜底 recentWorkspaceId。
//   6. 样式只使用 --dsw-alias-* 语义令牌。

const React = require('react')
const { useState, useEffect, useLayoutEffect, useRef, useCallback } = React

const STYLE_TAG_ID = 'dsh-notes-dock-style'
/* 自适应宽度（v0.5.2 起取消手动拖拽与宽度上限）：
   - 实际宽度 = 可用留白 - WIDTH_GAP（右侧与主会话区保持固定间距；无上限）
   - 最小宽度动态计算（头部行单行所需宽度），放不下才隐藏（迟滞防抖）
   - WIDTH_DEFAULT 仅用于 hero/空会话（无消息列可测）时的默认宽度 */
const WIDTH_DEFAULT = 280
const WIDTH_GAP = 16
const MEMO_DEBOUNCE_MS = 600
const UNDO_TTL_MS = 5000
const ICON_CHECK =
  '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 6.5L5 9l4.5-6"/></svg>'
const ICON_TRASH =
  '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4h10M5.5 4V2.8A.8.8 0 016.3 2h1.4a.8.8 0 01.8.8V4M3.5 4l.6 7a1 1 0 001 1h3.8a1 1 0 001-1l.6-7"/><path d="M6 6.5v3M8 6.5v3"/></svg>'
const ICON_PIN =
  '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M8.6 1.4l4 4-1.4 1.4-1.2-.6-2.2 2.2.6 1.2-1.4 1.4-3-3L3.4 9l-.8-.8 2.6-2.6-1.2-.6 1.4-1.4 1.2.6 2.2-2.2-.6-1.2 1.4-1.4z"/></svg>'
const ICON_GRIP =
  '<svg viewBox="0 0 10 16" fill="currentColor"><circle cx="2.5" cy="2.5" r="1.4"/><circle cx="7.5" cy="2.5" r="1.4"/><circle cx="2.5" cy="8" r="1.4"/><circle cx="7.5" cy="8" r="1.4"/><circle cx="2.5" cy="13.5" r="1.4"/><circle cx="7.5" cy="13.5" r="1.4"/></svg>'
const ICON_DETAIL =
  '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 1.8h9v10.4h-9z"/><path d="M5 4.6h4M5 7h4M5 9.4h2.5"/></svg>'

const DOCK_CSS = `
.dsh-notes-dock {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 280px;
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
/* 尺寸自适：与对话滚动体发生实际重叠时隐藏；尺寸恢复后自动显示（非硬编码阈值）。
   用 visibility 而非 display:none——隐藏时空盒仍保留真实矩形，重叠测量不会因
   自身隐藏而变成 0 造成“隐藏→显示→隐藏”的闪烁反馈回路。 */
.dsh-notes-dock.covered-hidden { visibility: hidden; pointer-events: none; }
/* 非对话视图（如轨迹）激活时隐藏整条竖栏，避免遮挡页面内容 */
.dsh-notes-dock.view-hidden { display: none; }
/* 复位规则用 :where() 保证零特异性，绝不覆盖任何组件类样式 */
:where(.dsh-notes-dock) button { font-family: inherit; font-size: inherit; border: none; background: none; color: inherit; cursor: pointer; }
:where(.dsh-notes-dock) input { font-family: inherit; font-size: inherit; color: inherit; }
:where(.dsh-notes-dock) textarea { font-family: inherit; font-size: inherit; color: inherit; }
:where(.dsh-notes-dock) select { font-family: inherit; font-size: inherit; color: inherit; }

.dock-body { display: flex; flex-direction: column; min-height: 0; flex: 1; }

/* ===== 小计 ===== */
.np-section { flex: 1; min-height: 0; display: flex; flex-direction: column; position: relative; }
/* 顶部工作区标签：独立分割区（底色 + 分隔线强调） */
.np-tabs {
  display: flex; gap: 2px; align-items: center; flex: none;
  padding: 8px 12px;
  background: var(--dsw-alias-bg-layer-2);
  border-bottom: 1px solid var(--dsw-alias-border-l1);
}
.np-tab {
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 11.5px;
  color: var(--dsw-alias-label-secondary);
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: background var(--ds-transition-duration-fast, 0.1s) var(--ds-ease-in-out, ease);
}
.np-tab:hover { background: var(--dsw-alias-interactive-bg-hover); }
.np-tab.active { background: var(--dsw-alias-button-ghost-active-fill); color: var(--dsw-alias-label-primary); font-weight: 500; }

.np-error {
  margin: 4px 12px 0;
  padding: 5px 10px;
  border-radius: 8px;
  background: var(--dsw-alias-interactive-bg-hover-danger);
  color: var(--dsw-alias-state-error-primary);
  font-size: 11.5px;
}

.np-sec-todo {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1 1 55%;
}
.np-sec-head { display: flex; align-items: baseline; gap: 8px; flex: none; padding: 8px 12px 4px; }
/* 头部行：单行不断行；计数可压缩（超窄省略号），标题/清空按钮恒定不压缩 */
.np-sec-head > * { white-space: nowrap; }
.np-sec-title { flex-shrink: 0; }
.np-clear { flex-shrink: 0; }
.np-sec-count { flex-shrink: 1; min-width: 40px; overflow: hidden; text-overflow: ellipsis; }
.np-sec-title { font-size: 10.5px; font-weight: 600; letter-spacing: 0.04em; color: var(--dsw-alias-label-tertiary); }
.np-sec-count { font-size: 10.5px; color: var(--dsw-alias-label-tertiary); }
/* 待办内容卡片：与随记卡片同款（边框/圆角/间距），内部输入与列表无边框 */
.np-todo-card {
  flex: 1; min-height: 0; display: flex; flex-direction: column;
  margin: 0 12px 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  overflow: hidden;
  background: var(--dsw-alias-bg-layer-1);
}
.np-input-row { display: flex; gap: 6px; flex: none; padding: 8px; }
.np-input {
  flex: 1;
  min-width: 0;
  padding: 5px 10px;
  border-radius: 7px;
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
  border-radius: 7px;
  background: var(--dsw-alias-button-primary-fill);
  color: var(--dsw-alias-label-primary-foreground);
  font-size: 12px;
  font-weight: 500;
  transition: opacity var(--ds-transition-duration-fast, 0.1s) var(--ds-ease-in-out, ease);
}
.np-add:hover { opacity: 0.88; }

.np-list { flex: 1; min-height: 0; overflow-y: auto; padding: 0 8px 8px; }
.np-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border-radius: 8px;
  position: relative;
  user-select: none;
  -webkit-user-select: none;
  transition: background var(--ds-transition-duration-fast, 0.1s) var(--ds-ease-in-out, ease), transform var(--ds-transition-duration, 0.2s) var(--ds-ease-in-out, ease);
}
.np-item:hover { background: var(--dsw-alias-interactive-bg-hover); }
.np-item.dragging {
  opacity: 0.8;
  background: var(--dsw-alias-interactive-bg-hover-solid);
  box-shadow: var(--dsh-notes-shadow);
  z-index: 2;
}
.np-item.drop-target::after {
  content: '';
  position: absolute;
  left: 10px;
  right: 10px;
  top: -2px;
  height: 2px;
  border-radius: 1px;
  background: var(--dsw-alias-brand-primary);
  animation: dsh-notes-drop-pulse 0.4s ease-in-out infinite alternate;
}
@keyframes dsh-notes-drop-pulse {
  from { opacity: 0.35; transform: scaleX(0.55); }
  to { opacity: 1; transform: scaleX(1); }
}
.np-item.pinned .np-text::after { content: ' 📌'; font-size: 9px; }

.np-grip {
  flex: none;
  width: 16px;
  height: 22px;
  border-radius: 6px;
  color: var(--dsw-alias-label-tertiary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  opacity: 0.4;
  cursor: grab;
  touch-action: none;
  transition: opacity var(--ds-transition-duration-fast, 0.1s) var(--ds-ease-in-out, ease), background var(--ds-transition-duration-fast, 0.1s) var(--ds-ease-in-out, ease), color var(--ds-transition-duration-fast, 0.1s) var(--ds-ease-in-out, ease), transform var(--ds-transition-duration-fast, 0.1s) var(--ds-ease-in-out, ease);
}
.np-item:hover .np-grip { opacity: 1; }
.np-grip:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary); }
.np-grip:active { cursor: grabbing; transform: scale(0.85); }
.np-grip svg { width: 10px; height: 14px; pointer-events: none; -webkit-user-drag: none; }

.np-check {
  flex: none;
  width: 16px;
  height: 16px;
  border-radius: 5px;
  border: 1.5px solid var(--dsw-alias-label-tertiary);
  background: transparent;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background var(--ds-transition-duration-fast, 0.1s) var(--ds-ease-in-out, ease), border-color var(--ds-transition-duration-fast, 0.1s) var(--ds-ease-in-out, ease);
}
.np-check:hover { border-color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-interactive-bg-hover); }
.np-check svg { width: 10px; height: 10px; opacity: 0; }
.np-check.on { background: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); }
.np-check.on:hover { background: var(--dsw-alias-brand-primary); }
.np-check.on svg { opacity: 1; }
.np-text {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--dsw-alias-label-primary);
  word-break: break-all;
  cursor: default;
  padding: 1px 0;
}
.np-item.done .np-text { color: var(--dsw-alias-label-tertiary); text-decoration: line-through; }
.np-pin {
  flex: none;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  color: var(--dsw-alias-label-tertiary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  cursor: pointer;
  transition: opacity var(--ds-transition-duration-fast, 0.1s) var(--ds-ease-in-out, ease), background var(--ds-transition-duration-fast, 0.1s) var(--ds-ease-in-out, ease), color var(--ds-transition-duration-fast, 0.1s) var(--ds-ease-in-out, ease), transform var(--ds-transition-duration-fast, 0.1s) var(--ds-ease-in-out, ease);
}
.np-item:hover .np-pin { opacity: 1; }
.np-pin:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-brand-primary); transform: scale(1.15); }
.np-pin.on { color: var(--dsw-alias-brand-primary); }
.np-pin svg { width: 13px; height: 13px; }
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
.np-detail {
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
.np-item:hover .np-detail { opacity: 1; }
.np-detail:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-state-business-primary); }
.np-detail svg { width: 12px; height: 12px; }

/* 待办详情卡片（弹出编辑显示详细内容） */
.np-detail-overlay {
  position: absolute;
  inset: 0;
  z-index: 40;
  background: transparent; /* 毛玻璃：仅模糊背景，不遮纯色 */
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
}
.np-detail-card {
  width: 100%;
  max-height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--dsw-alias-bg-base);
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 10px;
  box-shadow: var(--dsh-notes-shadow);
  overflow: hidden;
}
.np-detail-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
  min-height: 36px;
  padding: 6px 8px 6px 10px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
}
.np-detail-head .t { flex: 1; font-size: 12.5px; font-weight: 500; line-height: 20px; }
.np-detail-close {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  color: var(--dsw-alias-label-tertiary);
  background: none;
  border: none;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
}
.np-detail-close:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.np-detail-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  overflow-y: auto;
  min-height: 0;
  overflow-anchor: none; /* 关闭滚动锚定：重渲染/内容变化不触发滚动位置漂移 */
}
.np-detail-field { display: flex; flex-direction: column; gap: 3px; }
.np-detail-field label { font-size: 11px; color: var(--dsw-alias-label-tertiary); }
.np-detail-title {
  height: 30px;
  padding: 0 8px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 7px;
  background: var(--dsw-specific-input-major);
  outline: none;
  font-size: 12.5px;
  color: var(--dsw-alias-label-primary);
  user-select: text;
  -webkit-user-select: text;
}
.np-detail-title:focus { border-color: var(--dsw-alias-state-business-primary); }
.np-detail-textarea {
  min-height: 110px;
  resize: vertical;
  overflow-anchor: none;
  padding: 6px 8px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 7px;
  background: var(--dsw-specific-input-major);
  outline: none;
  font-size: 12.5px;
  line-height: 1.55;
  color: var(--dsw-alias-label-primary);
  user-select: text;
  -webkit-user-select: text;
}
.np-detail-textarea:focus { border-color: var(--dsw-alias-state-business-primary); }
.np-detail-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  font-size: 10.5px;
  color: var(--dsw-alias-label-tertiary);
}
.np-detail-status { font-size: 10.5px; color: var(--dsw-alias-label-tertiary); }
/* 待办空态：图标 + 引导文案 */
.np-empty {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 8px; padding: 32px 16px; text-align: center;
  color: var(--dsw-alias-label-tertiary);
}
.np-empty-icon {
  width: 36px; height: 36px; border-radius: 50%;
  background: var(--dsw-alias-interactive-bg-hover);
  display: inline-flex; align-items: center; justify-content: center;
  color: var(--dsw-alias-label-tertiary);
}
.np-empty-icon svg { width: 15px; height: 15px; }
.np-empty p { margin: 0; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.np-empty .sub { font-size: 10.5px; color: var(--dsw-alias-label-tertiary); }

/* 列表滚动条（与 DSH 视觉一致） */
.np-list::-webkit-scrollbar { width: 8px; }
.np-list::-webkit-scrollbar-thumb { background: var(--dsw-alias-scrollbar-bg-l1); border-radius: 4px; }

.np-undo {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
  margin: 0 8px 8px;
  padding: 4px 10px;
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

.np-tip {
  position: absolute;
  z-index: 30;
  padding: 3px 8px;
  border-radius: 6px;
  background: var(--dsw-alias-bg-overlay);
  border: 1px solid var(--dsw-alias-border-l2);
  box-shadow: var(--dsh-notes-shadow);
  font-size: 11px;
  line-height: 1.4;
  color: var(--dsw-alias-label-primary);
  white-space: nowrap;
  pointer-events: none;
}
.np-tip[hidden] { display: none; }

.np-sec-memo {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1 1 45%;
  border-top: 1px solid var(--dsw-alias-border-l1);
}
.np-memo-status { font-size: 10.5px; color: var(--dsw-alias-label-tertiary); margin-left: auto; }
.np-memo {
  flex: 1;
  min-height: 56px;
  margin: 0 12px 8px;
  padding: 7px 10px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-specific-input-major);
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
  line-height: 1.5;
  resize: none;
  outline: none;
  /* 行尾空格正确断行：anywhere 允许在任何字符（含空格）处断行，
     解决"行尾输入空格越过行宽而不换行"的问题（break-word 不覆盖该场景） */
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: normal;
  transition: border-color var(--ds-transition-duration-fast, 0.1s) var(--ds-ease-in-out, ease);
}
.np-memo::placeholder { color: var(--dsw-alias-label-tertiary); }
.np-memo:focus { border-color: var(--dsw-alias-brand-primary); }

`

function scopeOf(data, tab) {
  return tab === 'global' ? data.global : data.workspace
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
  const dockRef = useRef(null)
  const inputRef = useRef(null)
  const [left, setLeft] = useState(260)
  const [top, setTop] = useState(0)
  // 当前会话视图是否为「对话」（false 时隐藏整条竖栏，见定位 effect 的 detectChatView）
  const [viewIsChat, setViewIsChat] = useState(true)
  // 尺寸自适（非硬编码阈值）：竖栏宽度自动收缩以适配消息列左侧可用留白；
  // 收缩至最小宽度仍放不下时才隐藏。covered = 隐藏；effWidth = 实际渲染宽度。
  const [covered, setCovered] = useState(false)
  const [effWidth, setEffWidth] = useState(WIDTH_DEFAULT)
  // 供挂载 effect 闭包内测量读取（防陈旧值）；渲染时同步
  const leftRef = useRef(260)
  leftRef.current = left
  const effWidthRef = useRef(effWidth)
  effWidthRef.current = effWidth
  const coveredRef = useRef(false)
  coveredRef.current = covered
  const [data, setData] = useState({ global: { todos: [], memo: '' }, workspace: null })
  const [error, setError] = useState(null)
  // 小计默认落在当前工作区（而非全局）；无工作区时仅全局可用
  const [tab, setTab] = useState(workspaceId !== undefined ? 'workspace' : 'global')
  const lastWorkspaceRef = useRef(workspaceId)
  useEffect(() => {
    if (lastWorkspaceRef.current !== workspaceId) {
      lastWorkspaceRef.current = workspaceId
      if (detailDraftRef.current !== null) closeDetail() // 作用域变了，详情卡片落盘并关闭
      setTab(workspaceId !== undefined ? 'workspace' : 'global')
    }
  }, [workspaceId])
  const [detailDraft, setDetailDraft] = useState(null) // { id, text, detail } | null（待办详情卡片草稿）
  const [detailStatus, setDetailStatus] = useState('')
  const detailDraftRef = useRef(null)
  const detailDirtyRef = useRef(false)
  const detailTimerRef = useRef(null)
  const detailBodyRef = useRef(null)
  const detailTaRef = useRef(null)
  const detailScrollRef = useRef({ body: 0, ta: 0 })
  const lastDetailValueRef = useRef(null)
  const [memoText, setMemoText] = useState('')
  const [memoStatus, setMemoStatus] = useState('')
  const memoTextRef = useRef('')
  const dirtyRef = useRef(false)
  const memoTimerRef = useRef(null)
  const dataForRef = useRef(null)
  const boundKeyRef = useRef(null)
  const undoTimerRef = useRef(null)
  const tipRef = useRef(null)
  const dragIdRef = useRef(null)
  const dropIdRef = useRef(null)
  const dragStartRef = useRef(null)
  const flipFromRef = useRef(null)
  const [undoInfo, setUndoInfo] = useState(null) // { scope, count } | null
  const [dragId, setDragId] = useState(null)
  const [dropId, setDropId] = useState(null)

  /* ---------- 自定义悬浮提示 ---------- */
  function tipElOf(target) {
    return target && target.closest ? target.closest('[data-tip]') : null
  }
  function positionTip(el) {
    const tip = tipRef.current
    if (tip === null) return
    tip.textContent = el.dataset.tip || ''
    const rect = el.getBoundingClientRect()
    const dockRect = rootRef.current !== null ? rootRef.current.getBoundingClientRect() : null
    if (dockRect === null) return
    let x = rect.left - dockRect.left
    let y = rect.bottom - dockRect.top + 6
    const tw = tip.offsetWidth
    const th = tip.offsetHeight
    if (x + tw > dockRect.width - 4) x = Math.max(4, dockRect.width - tw - 4)
    if (y + th > dockRect.height - 4) y = rect.top - dockRect.top - th - 6
    tip.style.left = `${x}px`
    tip.style.top = `${y}px`
    tip.hidden = false
  }
  function hideTip() {
    if (tipRef.current !== null) tipRef.current.hidden = true
  }
  function onTipOver(event) {
    const el = tipElOf(event.target)
    if (el !== null) positionTip(el)
    else hideTip()
  }
  function onTipMove(event) {
    const el = tipElOf(event.target)
    if (el !== null) positionTip(el)
  }
  function onTipOut(event) {
    if (tipElOf(event.relatedTarget) === null) hideTip()
  }

  /* ---------- 竖栏定位：left 跟随侧栏列宽，top 跟随对话滚动体（全高基准） ----------
     全高 = .wSkVaW_scrollBody（对话滚动体，data-conversation-scroll）顶部到页面底部：
     不覆盖上边栏（会话头部），也不侵入对话区自身的滚动体区域之外。 */
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
    const overlayEl = root.parentElement
    // 中间栏 = frame 直接子元素中唯一的 flex 列（排除 overlay 层与两侧 block 列）
    let center = null
    for (const child of frame.children) {
      if (child === overlayEl || child.nodeType !== 1) continue
      const cs = getComputedStyle(child)
      if (cs.display === 'flex' && cs.flexDirection === 'column') {
        center = child
        break
      }
    }
    const findScrollBody = () => {
      if (center === null) return null
      try {
        // 稳定属性优先（CSS module hash 类名可能随版本变化）
        const hit = center.querySelector('[data-conversation-scroll]')
        if (hit !== null) return hit
        const byClass = center.querySelector('[class*="scrollBody"]')
        if (byClass !== null) return byClass
      } catch { /* ignore */ }
      return null
    }
    let scrollEl = findScrollBody()
    const updateLeft = () => {
      const columns = getComputedStyle(frame).gridTemplateColumns.split(' ')
      const px = parseFloat(columns[0])
      if (Number.isFinite(px)) setLeft(px)
    }
    const updateTop = () => {
      const base = scrollEl ?? center?.firstElementChild ?? null
      if (base === null) return
      const frameRect = frame.getBoundingClientRect()
      const baseRect = base.getBoundingClientRect()
      setTop(Math.max(0, baseRect.top - frameRect.top))
    }
    // 尺寸自适（非硬编码阈值）：竖栏「应占矩形」与对话滚动体矩形的水平重叠 > 16px
    // 即视为遮挡 → 隐藏；重叠消失（尺寸恢复/拖动后）自动显示。无滚动体（hero/无会话）不隐藏。
    // 关键：用已知几何（left/width 状态 + 帧左偏移）而非自身 getBoundingClientRect——
    // 隐藏态下自身矩形全 0，会与 visibility 双保险形成“隐藏→显示”反馈回路导致闪烁。
    const updateCovered = () => {
      let scroll = null
      try {
        scroll = center !== null ? center.querySelector('[data-conversation-scroll]') : null
      } catch { /* ignore */ }
      let next = false
      let content = null
      let minW = WIDTH_DEFAULT
      if (scroll !== null) {
        const frameLeft = frame.getBoundingClientRect().left
        const aLeft = frameLeft + leftRef.current
        // 消息列左缘（官方稳定锚点 [data-chat-flow] 第一项）；无消息（hero/空会话）
        // 视为无内容可遮挡，不隐藏。gap = 消息列左缘 - 竖栏左缘 = 可用留白。
        try {
          const hit = center !== null ? center.querySelector('[data-chat-flow]') : null
          content = hit !== null ? hit.getBoundingClientRect() : null
        } catch { content = null }
        if (content !== null) {
          const gap = content.left - aLeft
          const fit = Math.max(0, gap - WIDTH_GAP)
          // 最小宽度动态、确定性测量：把竖栏临时设为 max-content，读头部行全宽
          // （计数按完整文本），再减去计数全宽、置换为计数下限 40px + 内边距 16px。
          // 结果 = 标题+按钮+计数下限，不随当前渲染宽度自引用；超窄时计数
          // 显示省略号（CSS），行文不折行。
          const el0 = rootRef.current
          if (el0 !== null) {
            const prevWidth = el0.style.width
            try {
              el0.style.width = 'max-content'
              const rows = el0.querySelectorAll('.np-sec-head')
              let full = 0
              let countFull = 0
              for (const row of rows) {
                // 关键：行自身也设 max-content —— flex 列子元素默认被父级拉伸，
                // 长待办会把竖栏 max-content 撑宽并连带拉伸行矩形，导致测量
                // 拿到竖栏整体宽度（minW 爆炸 → 整栏被隐藏）。
                const prevRowW = row.style.width
                row.style.width = 'max-content'
                let w = 0
                try { w = row.getBoundingClientRect().width } catch { w = 0 }
                row.style.width = prevRowW
                if (w > full) {
                  full = w
                  try {
                    const c = row.querySelector('.np-sec-count')
                    countFull = c !== null ? c.getBoundingClientRect().width : 0
                  } catch { countFull = 0 }
                }
              }
              if (full > 0) minW = Math.max(120, full - countFull + 40 + 16)
            } catch { /* 测量失败回退默认 */ } finally {
              el0.style.width = prevWidth
            }
          }
          // 迟滞带（HYST=24）：显示→隐藏 需 fit < minW；隐藏→显示 需 fit ≥ minW+HYST。
          const HYST = 24
          if (coveredRef.current) {
            if (fit >= minW + HYST) next = false
            else next = true
          } else {
            if (fit < minW) {
              next = true
            } else {
              setEffWidth((prev) => (Math.abs(prev - fit) < 1 ? prev : fit))
              next = false
            }
          }
        } else {
          // 无消息节点：显示（hero/空会话），宽度按偏好
          setEffWidth((prev) => (prev === WIDTH_DEFAULT ? prev : WIDTH_DEFAULT))
          next = false
        }
      }
      setCovered((prev) => (prev === next ? prev : next))
    }
    // 当前视图是否为「对话」：竖栏只在对话视图显示，切换轨迹等其他视图时隐藏，
    // 避免遮挡页面内容。判定链（对话 tab 恒为 conversation.view 首个条目 order 0）：
    //   1) tab 栏（role=tablist）存在时：激活 tab 必须是第一个 tab（对话），
    //      否则为轨迹/上下文等非对话视图 —— tab 栏是当前视图的权威信号
    //   2) 无 tab 栏（hero/无会话/仅对话视图）→ 视为对话页
    const detectChatView = () => {
      if (center === null) return true
      try {
        const tablist = center.querySelector('[role="tablist"]')
        if (tablist !== null) {
          const tabs = tablist.querySelectorAll('[role="tab"]')
          const active = tablist.querySelector('[role="tab"][aria-selected="true"]')
          if (active === null || tabs.length === 0) return true
          return active === tabs[0]
        }
      } catch { return true }
      return true
    }
    updateLeft()
    updateTop()
    updateCovered()
    setViewIsChat(detectChatView())
    let raf = 0
    const scheduleUpdate = () => {
      if (raf !== 0) return
      raf = requestAnimationFrame(() => {
        raf = 0
        scrollEl = findScrollBody()
        updateLeft()
        updateTop()
        updateCovered()
        setViewIsChat(detectChatView())
      })
    }
    const onResize = scheduleUpdate
    // 除 frame 自身 style 变化（侧栏折叠/拖拽）外，还要监听中间栏 DOM 增删与会话头部显隐：
    // 首次启动没有会话时头部隐藏（wSkVaW_headerHidden / data-phase=hero），打开会话后
    // 头部插入内容/切换 data-phase，scrollBody 的 top 才会下移；若只监听 style 属性，
    // top 不会重新测量，导致竖栏遮住上方状态栏。
    const observer = new MutationObserver((mutations) => {
      // 会话内消息流式渲染会不断增删 scroll body 内部的子节点；这些变化不影响
      // 竖栏 top/left，应忽略，避免每次流式块都触发重排和 setState。
      let relevant = false
      for (const mutation of mutations) {
        if (scrollEl !== null && (mutation.target === scrollEl || scrollEl.contains(mutation.target))) continue
        relevant = true
        break
      }
      if (relevant) scheduleUpdate()
    })
    observer.observe(frame, { attributes: true, attributeFilter: ['style', 'data-sidebar-collapsed'], childList: true })
    if (center !== null) {
      // class/data-phase 用于会话头部显隐（wSkVaW_headerHidden / root data-phase），
      // tab 切换（aria-selected）必须触发视图重检。
      observer.observe(center, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'data-phase', 'aria-selected'] })
    }
    // 兜底 1：tab 点击必然触发（捕获阶段监听，与 React 渲染无关）
    const onTabClick = (event) => {
      const target = event.target
      if (target instanceof Element && target.closest('[role="tab"]') !== null) scheduleUpdate()
    }
    document.addEventListener('click', onTabClick, true)
    // 兜底 2：低频轮询重检（1.5s 一次，任何事件机制失效时仍收敛）
    const recheckTimer = setInterval(scheduleUpdate, 1500)
    let ro = null
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(onResize)
      ro.observe(frame)
      if (center !== null) ro.observe(center)
      if (scrollEl !== null) ro.observe(scrollEl)
    }
    window.addEventListener('resize', onResize)
    return () => {
      if (raf !== 0) cancelAnimationFrame(raf)
      observer.disconnect()
      document.removeEventListener('click', onTabClick, true)
      clearInterval(recheckTimer)
      if (ro !== null) ro.disconnect()
      window.removeEventListener('resize', onResize)
    }
  }, [])

  /* ---------- 小计数据加载（挂载 / 工作区切换 / 窗口聚焦） ---------- */
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
          setData((prev) => ({
            global: result.state.global,
            // 宿主端对「全局」动作返回的快照中 workspace 恒为 null（未查询工作区表）；
            // 直接覆盖会把已加载的工作区数据显示成空（误以为被删）。保留本地值。
            workspace: result.state.workspace !== null ? result.state.workspace : prev.workspace,
          }))
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

  /* ---------- 作用域切换时同步 textarea ---------- */
  const scopeKey = tab === 'global' ? 'global' : `workspace:${workspaceId ?? ''}`
  useEffect(() => {
    if (tab === 'workspace' && (workspaceId === undefined || dataForRef.current !== workspaceId)) return
    const effectiveKey = tab === 'global' ? 'global' : `workspace:${dataForRef.current ?? ''}`
    if (boundKeyRef.current === effectiveKey) return
    const scope = tab === 'global' ? data.global : data.workspace
    if (scope === null) return
    boundKeyRef.current = effectiveKey
    setMemoText(scope.memo)
    memoTextRef.current = scope.memo
    dirtyRef.current = false
    setMemoStatus('')
  }, [scopeKey, data]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- 撤销 ---------- */
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

  function onDockPointerDown() {
    hideTip()
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

  /* ---------- 拖拽排序（Pointer Events 手动拖拽） ---------- */
  function onGripPointerDown(event, id) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    event.preventDefault()
    dragIdRef.current = id
    dropIdRef.current = null
    dragStartRef.current = { x: event.clientX, y: event.clientY }
    setDragId(id)
    setDropId(null)
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* ignore */ }
  }
  function onGripPointerMove(event) {
    if (dragIdRef.current === null) return
    const hit = document.elementFromPoint(event.clientX, event.clientY)
    const row = hit && hit.closest ? hit.closest('.np-item') : null
    const next = row && row.dataset ? row.dataset.id : null
    if (next !== dropIdRef.current) {
      dropIdRef.current = next
      setDropId(next)
    }
  }
  function onGripPointerUp(event) {
    const from = dragIdRef.current
    const target = dropIdRef.current
    dragIdRef.current = null
    dropIdRef.current = null
    setDragId(null)
    setDropId(null)
    const start = dragStartRef.current
    dragStartRef.current = null
    const moved = start !== null && Math.hypot(event.clientX - start.x, event.clientY - start.y) >= 4
    if (!moved || from === null || from === target) return
    const rects = {}
    for (const row of document.querySelectorAll('.dsh-notes-dock .np-item')) {
      const r = row.getBoundingClientRect()
      if (row.dataset && row.dataset.id) rects[row.dataset.id] = { left: r.left, top: r.top }
    }
    flipFromRef.current = rects
    const scope = scopeOf(data, tab)
    if (scope === null) return
    const todos = scope.todos
    const display = [...todos.filter((item) => item.pinned), ...todos.filter((item) => !item.pinned)]
    const fromIndex = display.findIndex((item) => item.id === from)
    if (fromIndex < 0) return
    const next = [...display]
    const [movedItem] = next.splice(fromIndex, 1)
    const targetIndex = target === null ? next.length : next.findIndex((item) => item.id === target)
    next.splice(targetIndex < 0 ? next.length : targetIndex, 0, movedItem)

    const pinnedCount = todos.filter((item) => item.pinned).length
    const movedIndex = next.indexOf(movedItem)
    const shouldPin = movedIndex < pinnedCount
    const updates = []
    if (movedItem.pinned !== shouldPin) updates.push(post({ action: 'pin', scope: tab, workspaceId: workspaceArg, id: movedItem.id, pinned: shouldPin }))
    updates.push(post({ action: 'reorder', scope: tab, workspaceId: workspaceArg, orderedIds: next.map((item) => item.id) }))
    void Promise.all(updates)
  }
  function onGripPointerCancel() {
    dragIdRef.current = null
    dropIdRef.current = null
    dragStartRef.current = null
    setDragId(null)
    setDropId(null)
  }

  /* ---------- FLIP 归位动画 ---------- */
  useLayoutEffect(() => {
    const prev = flipFromRef.current
    flipFromRef.current = null
    if (prev === null || Object.keys(prev).length === 0) return
    for (const row of document.querySelectorAll('.dsh-notes-dock .np-item')) {
      const id = row.dataset ? row.dataset.id : undefined
      if (id === undefined) continue
      const before = prev[id]
      if (before === undefined) continue
      const r = row.getBoundingClientRect()
      const dx = before.left - r.left
      const dy = before.top - r.top
      if (dx === 0 && dy === 0) continue
      row.style.transition = 'none'
      row.style.transform = `translate(${dx}px, ${dy}px)`
      void row.getBoundingClientRect()
      row.style.transition = ''
      row.style.transform = ''
    }
  }, [data])

  /* ---------- 待办详情卡片（双击行 / 悬停「详情」按钮弹出；标题与描述均在此编辑，
     自动保存：防抖 600ms + 关闭时落盘；行内标题编辑 v0.4.27 起移除） ---------- */
  function openDetail(item) {
    flushDetailSave()
    const draft = { id: item.id, text: item.text, detail: item.detail ?? '' }
    detailDraftRef.current = draft
    detailDirtyRef.current = false
    setDetailStatus('')
    detailScrollRef.current = { body: 0, ta: 0 }
    lastDetailValueRef.current = null
    setDetailDraft(draft)
  }
  function flushDetailSave() {
    if (detailTimerRef.current !== null) { clearTimeout(detailTimerRef.current); detailTimerRef.current = null }
    const draft = detailDraftRef.current
    if (draft === null) return
    if (!detailDirtyRef.current) return
    detailDirtyRef.current = false
    const text = draft.text.trim()
    if (text === '') { setDetailStatus(''); return } // 空标题不保存
    setDetailStatus('已保存')
    void post({ action: 'edit', scope: tab, workspaceId: workspaceArg, id: draft.id, text, detail: draft.detail })
  }
  function scheduleDetailSave() {
    detailDirtyRef.current = true
    setDetailStatus('保存中…')
    if (detailTimerRef.current !== null) clearTimeout(detailTimerRef.current)
    detailTimerRef.current = setTimeout(() => {
      detailTimerRef.current = null
      flushDetailSave()
    }, MEMO_DEBOUNCE_MS)
  }
  function closeDetail() {
    flushDetailSave()
    detailDraftRef.current = null
    setDetailStatus('')
    detailScrollRef.current = { body: 0, ta: 0 }
    lastDetailValueRef.current = null
    setDetailDraft(null)
  }
  function onDetailInput(event) {
    const draft = detailDraftRef.current
    if (draft === null) return
    draft.text = event.target.value
    setDetailDraft({ ...draft })
    scheduleDetailSave()
  }
  function onDetailTextarea(event) {
    const draft = detailDraftRef.current
    if (draft === null) return
    draft.detail = event.target.value
    setDetailDraft({ ...draft })
    scheduleDetailSave()
  }

  /* ---------- 详情卡片滚动位置保持 ----------
     卡片外的任何重渲染（自动保存回包、window focus 重新拉取、外壳状态更新等）都可能让
     Chromium 重置 / 漂移描述的滚动位置（回滚一段或直接回顶）；这里在每次提交后把
     用户最新的 scrollTop 恢复回去。仅在描述文本真的变化（打字，光标跟随）时不干预。 */
  function onDetailBodyScroll(event) {
    detailScrollRef.current.body = event.currentTarget.scrollTop
  }
  function onDetailTaScroll(event) {
    detailScrollRef.current.ta = event.currentTarget.scrollTop
  }
  useLayoutEffect(() => {
    const draft = detailDraft
    if (draft === null) return
    const ta = detailTaRef.current
    const body = detailBodyRef.current
    if (lastDetailValueRef.current !== draft.detail) {
      // 描述文本变化（正在输入）：浏览器按光标定位，只重新采集基线，不恢复
      lastDetailValueRef.current = draft.detail
      if (ta !== null) detailScrollRef.current.ta = ta.scrollTop
      if (body !== null) detailScrollRef.current.body = body.scrollTop
      return
    }
    if (ta !== null && ta.scrollTop !== detailScrollRef.current.ta) ta.scrollTop = detailScrollRef.current.ta
    if (body !== null && body.scrollTop !== detailScrollRef.current.body) body.scrollTop = detailScrollRef.current.body
  })

  function formatTime(ms) {
    if (typeof ms !== 'number' || !Number.isFinite(ms)) return '—'
    const d = new Date(ms)
    const pad = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

  /* ---------- 渲染 ---------- */
  const dockStyle = { left: `${left}px`, top: `${top}px`, width: `${effWidth}px` }

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

  /* ---- 待办列表 ---- */
  const listItems = displayTodos.length === 0
    ? [React.createElement('div', { key: 'empty', className: 'np-empty' },
        React.createElement('div', { className: 'np-empty-icon' },
          React.createElement('span', { dangerouslySetInnerHTML: { __html: ICON_CHECK } }),
        ),
        React.createElement('p', null, '还没有待办'),
        React.createElement('p', { className: 'sub' }, '在上方输入内容，回车即可添加'),
      )]
    : displayTodos.map((item) => {
        const rowClass = 'np-item'
          + (item.done ? ' done' : '')
          + (item.pinned ? ' pinned' : '')
          + (dragId === item.id ? ' dragging' : '')
          + (dropId === item.id ? ' drop-target' : '')
        return React.createElement(
          'div',
          {
            key: item.id,
            'data-id': item.id,
            className: rowClass,
            title: '双击打开详情',
            onDoubleClick: (event) => {
              // 行内按钮上的双击交给按钮自身处理（勾选/置顶/详情/删除/拖拽），不弹详情卡
              if (typeof event.target.closest === 'function' && event.target.closest('button')) return
              openDetail(item)
            },
          },
          React.createElement('button', {
            type: 'button',
            className: 'np-grip',
            'data-tip': '拖拽排序',
            onPointerDown: (event) => onGripPointerDown(event, item.id),
            onPointerMove: onGripPointerMove,
            onPointerUp: onGripPointerUp,
            onPointerCancel: onGripPointerCancel,
            dangerouslySetInnerHTML: { __html: ICON_GRIP },
          }),
          React.createElement('button', {
            type: 'button',
            className: 'np-check' + (item.done ? ' on' : ''),
            'data-tip': item.done ? '标记未完成' : '标记完成',
            onClick: () => toggleTodo(item),
            dangerouslySetInnerHTML: { __html: ICON_CHECK },
          }),
          React.createElement('div', { className: 'np-text' }, item.text),
          React.createElement('button', {
            type: 'button',
            className: 'np-pin' + (item.pinned ? ' on' : ''),
            'data-tip': item.pinned ? '取消置顶' : '置顶',
            onClick: () => pinTodo(item),
            dangerouslySetInnerHTML: { __html: ICON_PIN },
          }),
          React.createElement('button', {
            type: 'button',
            className: 'np-detail',
            'data-tip': '详情',
            onClick: () => openDetail(item),
            dangerouslySetInnerHTML: { __html: ICON_DETAIL },
          }),
          React.createElement('button', {
            type: 'button',
            className: 'np-del',
            'data-tip': '删除',
            onClick: () => deleteTodo(item),
            dangerouslySetInnerHTML: { __html: ICON_TRASH },
          }),
        )
      })

  return React.createElement(
    'div',
    {
      className: 'dsh-notes-dock' + (viewIsChat ? '' : ' view-hidden') + (covered ? ' covered-hidden' : ''),
      'data-notes-ver': '9efe09',
      ref: (node) => {
        rootRef.current = node
        dockRef.current = node
      },
      style: dockStyle,
      onMouseOver: onTipOver,
      onMouseMove: onTipMove,
      onMouseOut: onTipOut,
      onPointerDown: onDockPointerDown,
    },
    React.createElement(
      'div',
      { key: 'body', className: 'dock-body' },
      /* ===== 小计（v0.5.0 移除常驻会话卡片，竖栏整块为小计） ===== */
      React.createElement(
        'section',
        { className: 'np-section' },
        React.createElement('div', { className: 'np-tabs' }, ...tabs),
        error === null
          ? null
          : React.createElement('div', { className: 'np-error' }, '存储不可用，请检查宿主 storage 域。'),
        React.createElement(
          'div',
          { className: 'np-sec-todo' },
          React.createElement(
            'div',
            { className: 'np-sec-head' },
            React.createElement('span', { className: 'np-sec-title' }, '待办'),
            React.createElement(
              'span',
              { className: 'np-sec-count' },
              `共 ${todos.length} 项 · 未完成 ${todos.length - doneCount}`,
            ),
          ),
          React.createElement(
            'div',
            { className: 'np-todo-card' },
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
        ),
        React.createElement(
          'div',
          { className: 'np-sec-memo' },
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
        /* 待办详情卡片：只覆盖小计区域 */
        detailDraft === null
          ? null
          : React.createElement(
              'div',
              {
                className: 'np-detail-overlay',
                onClick: (event) => { if (event.target === event.currentTarget) closeDetail() },
              },
              React.createElement(
                'div',
                { className: 'np-detail-card' },
                React.createElement(
                  'div',
                  { className: 'np-detail-head' },
                  React.createElement('span', { className: 't' }, '待办详情'),
                  detailStatus === ''
                    ? null
                    : React.createElement('span', { className: 'np-detail-status' }, detailStatus),
                  React.createElement('button', { type: 'button', className: 'np-detail-close', 'data-tip': '关闭', onClick: closeDetail }, '×'),
                ),
                React.createElement(
                  'div',
                  { className: 'np-detail-body', ref: detailBodyRef, onScroll: onDetailBodyScroll },
                  React.createElement(
                    'div',
                    { className: 'np-detail-field' },
                    React.createElement('label', null, '标题'),
                    React.createElement('input', {
                      className: 'np-detail-title',
                      maxLength: 500,
                      value: detailDraft.text,
                      autoFocus: true,
                      onChange: onDetailInput,
                      onKeyDown: (event) => { if (event.key === 'Escape') closeDetail() },
                    }),
                  ),
                  React.createElement(
                    'div',
                    { className: 'np-detail-field' },
                    React.createElement('label', null, '描述'),
                    React.createElement('textarea', {
                      className: 'np-detail-textarea',
                      placeholder: '描述 / 备注（可多行）…',
                      maxLength: 20000,
                      spellCheck: false,
                      ref: detailTaRef,
                      value: detailDraft.detail,
                      onChange: onDetailTextarea,
                      onScroll: onDetailTaScroll,
                      onKeyDown: (event) => { if (event.key === 'Escape') closeDetail() },
                    }),
                  ),
                  (() => {
                    const scope = scopeOf(data, tab)
                    const item = scope === null ? undefined : scope.todos.find((it) => it.id === detailDraft.id)
                    if (item === undefined) return null
                    return React.createElement(
                      'div',
                      { className: 'np-detail-meta' },
                      React.createElement('span', null, `创建 ${formatTime(item.createdAt)}`),
                      React.createElement('span', null, `更新 ${formatTime(item.updatedAt)}`),
                      React.createElement('span', null, item.done ? '已完成' : '未完成'),
                      item.pinned ? React.createElement('span', null, '已置顶') : null,
                    )
                  })(),
                ),
              ),
            ),
      ),
    ),
    React.createElement('div', { key: 'tip', className: 'np-tip', ref: tipRef, hidden: true }),
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
      ctx.slots.register({ name: 'shell.overlay', id: 'notes-dock' }, (props) =>
        React.createElement(NotesDock, props),
      ),
    )
  },
}
