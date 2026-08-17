// dsh-notes —— 浏览器 half（官方 client bundle，__ModuleLoader__ 契约）。
//
// 职责：
//   1. shell.overlay 注册常驻条目（id: notes-dock）——「小计」竖栏（v0.4 融合）：
//      position:absolute（定位上下文 = overlay 层，层本身 inset:0 覆盖整个
//      AppFrame），left = AppFrame 网格第一列（侧栏列）实测宽度，
//      top = 中间栏会话头部（上边栏）下缘 —— 从自身 DOM 向上找到 grid 帧，
//      解析 gridTemplateColumns 首列 + 帧内 flex 列首子元素高度，
//      MutationObserver/ResizeObserver 跟随侧栏折叠/拖拽与会话头部高度变化。
//   2. 竖栏内容（自上而下）：
//      - 上半：常驻会话卡片 —— 消息列表/输入发送/停止/流式 partial（轮询
//        scard-chat-state 800ms/3s）、⚙ 设置弹窗（预设/模型/思考等级）、
//        清空会话（归档+新建）、↗ 在中间栏打开（sessions.open）；
//        发送/停止走 sessions.binding(id).session.prompt/cancel（wire RPC）。
//      - 分隔条：拖拽调整上下比例（25%–75%，双击复位 46%），localStorage 持久化。
//      - 下半：小计 —— 全局/本工作区 tab + 待办区（添加/勾选/双击编辑/删除/
//        清空/置顶/拖拽排序/撤销删除）+ 随记区（自由文本，防抖 600ms + 失焦保存）。
//   3. 小计数据经 fetch('/api/dsh-notes') 读写；当前工作区解析链：
//      当前会话 cwd（useSessions）→ 路径匹配工作区 → 兜底 recentWorkspaceId。
//   4. 样式只使用 --dsw-alias-* 语义令牌（原型 prototype/index.html 为基准）。

const React = require('react')
const { useState, useEffect, useLayoutEffect, useRef, useCallback } = React

const STYLE_TAG_ID = 'dsh-notes-dock-style'
const COLLAPSED_KEY = 'dsh-notes.collapsed'
const SPLIT_KEY = 'dsh-notes.split'
const SPLIT_DEFAULT = 46
const SPLIT_MIN = 25
const SPLIT_MAX = 75
const MEMO_DEBOUNCE_MS = 600
const UNDO_TTL_MS = 5000
const POLL_RUNNING_MS = 800
const POLL_IDLE_MS = 3000
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
const ICON_GRIP =
  '<svg viewBox="0 0 10 16" fill="currentColor"><circle cx="2.5" cy="2.5" r="1.4"/><circle cx="7.5" cy="2.5" r="1.4"/><circle cx="2.5" cy="8" r="1.4"/><circle cx="7.5" cy="8" r="1.4"/><circle cx="2.5" cy="13.5" r="1.4"/><circle cx="7.5" cy="13.5" r="1.4"/></svg>'
const ICON_OPEN =
  '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 2.5h5v5M9.5 2.5L2.5 9.5"/></svg>'
const ICON_GEAR =
  '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="1.8"/><path d="M6 1.2v1.6M6 9.2v1.6M1.2 6h1.6M9.2 6h1.6M2.7 2.7l1.1 1.1M8.2 8.2l1.1 1.1M2.7 9.3l1.1-1.1M8.2 3.8l1.1-1.1"/></svg>'

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
.dsh-notes-dock.collapsed {
  width: auto;
  height: auto;
  top: auto;
  bottom: 0;
  background: transparent;
  border-right: none;
}
.dsh-notes-dock.collapsed .dock-body { display: none; }
/* 复位规则用 :where() 保证零特异性，绝不覆盖任何组件类样式 */
:where(.dsh-notes-dock) button { font-family: inherit; font-size: inherit; border: none; background: none; color: inherit; cursor: pointer; }
:where(.dsh-notes-dock) input { font-family: inherit; font-size: inherit; color: inherit; }
:where(.dsh-notes-dock) textarea { font-family: inherit; font-size: inherit; color: inherit; }
:where(.dsh-notes-dock) select { font-family: inherit; font-size: inherit; color: inherit; }

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

/* ===== 分区标题（会话卡片 / 小计 —— 同款样式） ===== */
.sc-head,
.np-head {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
  min-height: 40px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
}
.sc-head .dot,
.np-head .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--dsw-alias-state-business-primary); flex: none; }
.sc-head .t,
.np-head .t { font-size: 12.5px; font-weight: 600; line-height: 20px; white-space: nowrap; }
.sc-head .sid {
  font-size: 10.5px;
  line-height: 16px;
  color: var(--dsw-alias-label-tertiary);
  background: var(--dsw-alias-bg-layer-2);
  border-radius: 5px;
  padding: 0 6px;
  font-family: var(--ds-font-family-code, monospace);
  max-width: 96px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sc-head .spacer,
.np-head .spacer { flex: 1; }
.sc-btn {
  flex: none;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  color: var(--dsw-alias-label-tertiary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  transition: background var(--ds-transition-duration-fast, 0.1s) var(--ds-ease-in-out, ease), color var(--ds-transition-duration-fast, 0.1s) var(--ds-ease-in-out, ease);
}
.sc-btn:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.sc-btn svg { width: 13px; height: 13px; }

/* ===== 上半：常驻会话卡片 ===== */
.sc-section {
  position: relative;
  flex: 0 0 var(--sc-ratio, 46%);
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.sc-messages {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.sc-msg { max-width: 92%; white-space: pre-wrap; word-break: break-word; font-size: 12.5px; line-height: 1.55; }
.sc-msg.user {
  align-self: flex-end;
  background: var(--dsw-specific-bubble);
  color: var(--dsw-alias-label-primary);
  border-radius: 10px 10px 3px 10px;
  padding: 5px 10px;
}
.sc-msg.assistant { align-self: flex-start; }
.sc-msg.assistant .bubble {
  background: var(--dsw-alias-bg-layer-2);
  border-radius: 10px 10px 10px 3px;
  padding: 5px 10px;
}
.sc-msg.tool {
  align-self: center;
  font-size: 10.5px;
  line-height: 15px;
  color: var(--dsw-alias-label-tertiary);
  background: var(--dsw-alias-bg-layer-2);
  border-radius: 999px;
  padding: 1px 8px;
}
.sc-msg .cursor {
  display: inline-block;
  width: 5px;
  height: 12px;
  background: var(--dsw-alias-state-business-primary);
  vertical-align: -2px;
  animation: dsh-notes-blink 0.8s step-start infinite;
}
@keyframes dsh-notes-blink { 50% { opacity: 0; } }
.sc-empty { align-self: center; margin: auto; color: var(--dsw-alias-label-tertiary); font-size: 12px; }

.sc-input-row { display: flex; gap: 6px; flex: none; padding: 8px 10px; border-top: 1px solid var(--dsw-alias-border-l1); }
.sc-input {
  flex: 1;
  min-width: 0;
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  background: var(--dsw-specific-input-major);
  color: var(--dsw-alias-label-primary);
  font-size: 12.5px;
  outline: none;
  transition: border-color var(--ds-transition-duration-fast, 0.1s) var(--ds-ease-in-out, ease);
}
.sc-input:focus { border-color: var(--dsw-alias-state-business-primary); }
.sc-input::placeholder { color: var(--dsw-alias-label-caption); }
.sc-send {
  flex: none;
  height: 32px;
  padding: 0 12px;
  border-radius: 8px;
  background: var(--dsw-alias-button-primary-fill);
  color: var(--dsw-alias-label-primary-foreground);
  font-size: 12.5px;
  font-weight: 500;
  transition: opacity var(--ds-transition-duration-fast, 0.1s) var(--ds-ease-in-out, ease);
}
.sc-send:hover { opacity: 0.88; }
.sc-send.stop { background: var(--dsw-alias-button-ghost-active-fill); color: var(--dsw-alias-label-primary); }

.sc-foot {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
  min-height: 30px;
  padding: 0 10px 8px;
  flex-wrap: wrap;
}
.sc-clear {
  flex: none;
  height: 24px;
  padding: 0 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 7px;
  background: none;
  color: var(--dsw-alias-label-secondary);
  font-size: 11.5px;
  line-height: 16px;
  transition: background var(--ds-transition-duration-fast, 0.1s) var(--ds-ease-in-out, ease);
}
.sc-clear:hover { background: var(--dsw-alias-interactive-bg-hover); }
.sc-status { margin-left: auto; font-size: 11px; color: var(--dsw-alias-label-tertiary); }
.sc-confirm { display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--dsw-alias-state-warn-primary); }
.sc-confirm button {
  height: 24px;
  padding: 0 8px;
  border-radius: 7px;
  font-size: 11.5px;
}
.sc-confirm .yes { background: var(--dsw-alias-state-error-primary); color: var(--dsw-alias-label-primary-foreground); }
.sc-confirm .no { border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-button-elevated-fill); color: var(--dsw-alias-label-primary); }

.sc-popup {
  position: absolute;
  top: 38px;
  left: 8px;
  right: 8px;
  z-index: 30;
  background: var(--dsw-alias-bg-base);
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 10px;
  box-shadow: var(--dsh-notes-shadow);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.sc-popup-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
  min-height: 36px;
  padding: 6px 8px 6px 10px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
}
.sc-popup-head .t { flex: 1; font-size: 12.5px; font-weight: 500; line-height: 20px; }
.sc-popup-body { display: flex; flex-direction: column; gap: 8px; padding: 10px; }
.sc-field { display: flex; flex-direction: column; gap: 3px; }
.sc-field label { font-size: 11px; color: var(--dsw-alias-label-tertiary); }
.sc-field select {
  height: 30px;
  padding: 0 8px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 7px;
  background: var(--dsw-alias-button-elevated-fill);
  outline: none;
  font-size: 12.5px;
  color: var(--dsw-alias-label-primary);
}
.sc-field select:focus { border-color: var(--dsw-alias-state-business-primary); }
.sc-field select:disabled { opacity: 0.55; cursor: not-allowed; }
.sc-popup-hint { font-size: 10.5px; color: var(--dsw-alias-state-warn-primary); }
.sc-popup-foot { display: flex; justify-content: flex-end; flex: none; padding: 0 10px 10px; }
.sc-popup-foot button {
  height: 26px;
  padding: 0 12px;
  border: 0;
  border-radius: 7px;
  background: var(--dsw-alias-brand-primary);
  color: var(--dsw-alias-label-primary-foreground);
  font-size: 12.5px;
  font-weight: 500;
}
.sc-popup-foot button:hover { opacity: 0.9; }

.sc-error {
  margin: 0 10px;
  padding: 4px 8px;
  border-radius: 7px;
  background: var(--dsw-alias-interactive-bg-hover-danger);
  color: var(--dsw-alias-state-error-primary);
  font-size: 11px;
}

/* ===== 分隔条（明显分割标记：底色条 + 抓握手柄） ===== */
.dock-splitter {
  flex: none;
  height: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: row-resize;
  z-index: 5;
  touch-action: none;
  background: var(--dsw-alias-bg-overlay);
  border-top: 1px solid var(--dsw-alias-border-l2);
  border-bottom: 1px solid var(--dsw-alias-border-l2);
  transition: background var(--ds-transition-duration-fast, 0.1s) var(--ds-ease-in-out, ease);
}
.dock-splitter::before {
  content: '';
  width: 40px;
  height: 4px;
  border-radius: 2px;
  background: var(--dsw-alias-border-l3);
  transition: background var(--ds-transition-duration-fast, 0.1s) var(--ds-ease-in-out, ease), width var(--ds-transition-duration-fast, 0.1s) var(--ds-ease-in-out, ease);
}
.dock-splitter:hover,
.dsh-notes-dock.split-dragging .dock-splitter {
  background: var(--dsw-alias-interactive-bg-hover-accent);
}
.dock-splitter:hover::before,
.dsh-notes-dock.split-dragging .dock-splitter::before {
  background: var(--dsw-alias-state-business-primary);
  width: 56px;
}
.dsh-notes-dock.split-dragging { user-select: none; -webkit-user-select: none; cursor: row-resize; }

/* ===== 下半：小计 ===== */
.np-section { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.np-tabs { display: flex; gap: 2px; flex: none; padding: 6px 12px 0; }
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
.np-sec-head { display: flex; align-items: center; gap: 8px; flex: none; padding: 6px 12px 4px; }
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

.np-input-row { display: flex; gap: 6px; flex: none; padding: 0 12px 6px; }
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

.np-list { flex: 1; min-height: 0; overflow-y: auto; padding: 2px 8px 6px; }
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
  transition: background var(--ds-transition-duration-fast, 0.1s) var(--ds-ease-in-out, ease), box-shadow var(--ds-transition-duration-fast, 0.1s) var(--ds-ease-in-out, ease), opacity var(--ds-transition-duration-fast, 0.1s) var(--ds-ease-in-out, ease);
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
  user-select: text;
  -webkit-user-select: text;
}
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
.np-empty { padding: 18px 12px; text-align: center; font-size: 11.5px; color: var(--dsw-alias-label-tertiary); }

.np-undo {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
  margin: 0 12px 6px;
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
  transition: border-color var(--ds-transition-duration-fast, 0.1s) var(--ds-ease-in-out, ease);
}
.np-memo::placeholder { color: var(--dsw-alias-label-tertiary); }
.np-memo:focus { border-color: var(--dsw-alias-brand-primary); }
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
  const sessions = props.sessions
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
  const scInputRef = useRef(null)
  const [left, setLeft] = useState(260)
  const [top, setTop] = useState(0)
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(COLLAPSED_KEY) === '1' } catch { return false }
  })
  const [split, setSplit] = useState(() => {
    try {
      const value = Number(localStorage.getItem(SPLIT_KEY))
      if (Number.isFinite(value)) return Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, value))
    } catch { /* ignore */ }
    return SPLIT_DEFAULT
  })
  const [data, setData] = useState({ global: { todos: [], memo: '' }, workspace: null })
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('global')
  const [editing, setEditing] = useState(null) // { id, text }
  const [memoText, setMemoText] = useState('')
  const [memoStatus, setMemoStatus] = useState('')
  const [undoInfo, setUndoInfo] = useState(null) // { scope, count } | null
  const [dragId, setDragId] = useState(null)
  const [dropId, setDropId] = useState(null)
  const [card, setCard] = useState(null) // scard-state | null
  const [chat, setChat] = useState(null) // scard-chat-state | null
  const [cardError, setCardError] = useState(null)
  const [popupOpen, setPopupOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const editingRef = useRef(null)
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
  const chatRunningRef = useRef(false)
  const splitDragRef = useRef(null)

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
    const updateLeft = () => {
      const columns = getComputedStyle(frame).gridTemplateColumns.split(' ')
      const px = parseFloat(columns[0])
      if (Number.isFinite(px)) setLeft(px)
    }
    const updateTop = () => {
      const base = findScrollBody() ?? center?.firstElementChild ?? null
      if (base === null) return
      const frameRect = frame.getBoundingClientRect()
      const baseRect = base.getBoundingClientRect()
      setTop(Math.max(0, baseRect.top - frameRect.top))
    }
    updateLeft()
    updateTop()
    const onResize = () => { updateLeft(); updateTop() }
    const observer = new MutationObserver(onResize)
    observer.observe(frame, { attributes: true, attributeFilter: ['style'] })
    let ro = null
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(onResize)
      ro.observe(frame)
      if (center !== null) ro.observe(center)
      const scroll = findScrollBody()
      if (scroll !== null) ro.observe(scroll)
    }
    window.addEventListener('resize', onResize)
    return () => {
      observer.disconnect()
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

  /* =====================================================================
     会话卡片：scard RPC（经 /api/dsh-notes HTTP）
     ===================================================================== */
  function scardPost(action, extra) {
    return fetch('/api/dsh-notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(Object.assign({ action }, extra ?? {})),
    })
      .then((response) => response.json())
      .catch(() => ({ ok: false, error: 'network' }))
  }

  function scardErrorText(result) {
    const raw = result?.error?.message ?? result?.error
    if (raw === 'bad-args' || raw === 'unknown-action') return '宿主端未启用会话卡片功能，请重启 DSH 后刷新'
    return raw ?? '操作失败'
  }

  const refreshCard = useCallback(() => {
    return scardPost('scard-state').then((result) => {
      if (result.ok === true && result.scard) {
        setCard(result.scard)
        setCardError(null)
      } else if (result.error === 'scard-unavailable' || result.error === 'scard-failed') {
        setCardError('会话卡片暂不可用（宿主需重启 DSH 后生效）')
      } else {
        setCardError(scardErrorText(result))
      }
      return result
    })
  }, [])

  const fetchChat = useCallback(async () => {
    const result = await scardPost('scard-chat-state')
    if (result.ok === true && result.scard) {
      const next = result.scard
      chatRunningRef.current = next.running === true
      setCardError(null)
      setChat((prev) => {
        if (prev === null || next.cold === true) return next
        if (prev.lastSeq === next.lastSeq && !next.running) return prev
        return next
      })
    } else if (result.error === 'scard-unavailable' || result.error === 'scard-failed') {
      setCardError('会话卡片暂不可用（宿主需重启 DSH 后生效）')
    } else {
      setCardError(scardErrorText(result))
    }
    return result
  }, [])

  /* 轮询：展开时运行中 800ms / 空闲 3s */
  useEffect(() => {
    if (collapsed) return
    let alive = true
    let timer = null
    const schedule = (delay) => {
      timer = setTimeout(async () => {
        if (!alive) return
        await fetchChat()
        if (alive) schedule(chatRunningRef.current ? POLL_RUNNING_MS : POLL_IDLE_MS)
      }, delay)
    }
    schedule(0)
    return () => {
      alive = false
      if (timer !== null) clearTimeout(timer)
    }
  }, [collapsed, fetchChat])

  /* 展开/挂载时刷新卡片状态 */
  useEffect(() => {
    if (collapsed) return
    void refreshCard()
  }, [collapsed, refreshCard])

  async function sendMessage() {
    const input = scInputRef.current
    if (input === null || card === null) return
    const text = input.value.trim()
    if (text === '') return
    input.value = ''
    const binding = sessions !== undefined && sessions !== null ? sessions.binding(card.sessionId) : undefined
    if (binding === undefined || binding.session === undefined) {
      setCardError('会话暂不可用（未列出），正在重试…')
      setTimeout(() => void refreshCard(), 600)
      return
    }
    try {
      const result = await binding.session.prompt([{ type: 'text', text }], 'queue')
      if (result !== undefined && result.accepted !== true) {
        setCardError(result?.error?.message ?? '发送失败')
      } else {
        setCardError(null)
        void fetchChat()
      }
    } catch (error) {
      setCardError(String(error?.message ?? error))
    }
  }

  async function stopMessage() {
    if (card === null) return
    const binding = sessions !== undefined && sessions !== null ? sessions.binding(card.sessionId) : undefined
    try {
      if (binding !== undefined && binding.session !== undefined) await binding.session.cancel()
    } catch { /* ignore */ }
    void fetchChat()
  }

  function onSendClick() {
    if (chat !== null && chat.cold !== true && chat.running === true) void stopMessage()
    else void sendMessage()
  }

  function onScInputKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      onSendClick()
    }
  }

  function onPresetChange(event) {
    void scardPost('scard-select-preset', { presetId: event.target.value }).then((result) => {
      if (result.ok !== true) setCardError(result.error?.message ?? '预设切换失败')
      void refreshCard()
    })
  }

  function onModelChange(event) {
    const parts = event.target.value.split('/')
    const provider = parts[0]
    const model = parts[1]
    if (provider === undefined || model === undefined) return
    void scardPost('scard-select-model', { provider, model }).then((result) => {
      if (result.ok !== true) setCardError(result.error?.message ?? '模型切换失败')
      void refreshCard()
    })
  }

  function onEffortChange(event) {
    if (card === null || card.model === undefined) return
    const effort = event.target.value === '' ? undefined : event.target.value
    void scardPost('scard-select-model', { provider: card.model.provider, model: card.model.model, ...(effort === undefined ? {} : { effort }) }).then((result) => {
      if (result.ok !== true) setCardError(result.error?.message ?? '切换失败')
      void refreshCard()
    })
  }

  function confirmClear() {
    void scardPost('scard-clear').then((result) => {
      setConfirming(false)
      if (result.ok === true) {
        setChat(null)
        void refreshCard()
      } else {
        setCardError(result.error?.message ?? '清空失败')
      }
    })
  }

  function openInCenter() {
    if (card === null) return
    try {
      if (sessions !== undefined && sessions !== null && typeof sessions.open === 'function') sessions.open(card.sessionId)
    } catch { /* ignore */ }
  }

  /* ---------- 分隔条拖拽（调整上下比例） ---------- */
  function onSplitPointerDown(event) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    event.preventDefault()
    splitDragRef.current = event.pointerId
    if (dockRef.current !== null) dockRef.current.classList.add('split-dragging')
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* ignore */ }
  }
  function onSplitPointerMove(event) {
    if (splitDragRef.current === null) return
    const dock = dockRef.current
    if (dock === null) return
    const rect = dock.getBoundingClientRect()
    if (rect.height <= 0) return
    const pct = Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, ((event.clientY - rect.top) / rect.height) * 100))
    const rounded = Math.round(pct)
    setSplit(rounded)
    try { localStorage.setItem(SPLIT_KEY, String(rounded)) } catch { /* ignore */ }
  }
  function onSplitPointerUp() {
    splitDragRef.current = null
    if (dockRef.current !== null) dockRef.current.classList.remove('split-dragging')
  }
  function onSplitDoubleClick() {
    setSplit(SPLIT_DEFAULT)
    try { localStorage.setItem(SPLIT_KEY, String(SPLIT_DEFAULT)) } catch { /* ignore */ }
  }

  /* ---------- 渲染 ---------- */
  const dockStyle = { left: `${left}px`, top: `${top}px`, '--sc-ratio': `${split}%` }

  if (collapsed) {
    return React.createElement(
      'div',
      {
        className: 'dsh-notes-dock collapsed',
        'data-notes-ver': '24dd1f2',
        ref: rootRef,
        // 折叠态贴底：显式 top auto，覆盖测量出的顶部偏移
        style: { left: `${left}px`, top: 'auto' },
        onMouseOver: onTipOver,
        onMouseMove: onTipMove,
        onMouseOut: onTipOut,
      },
      React.createElement(
        'button',
        { className: 'dock-collapsed', type: 'button', 'data-tip': '展开小记', onClick: expand },
        React.createElement('span', null, '📝'),
        React.createElement('span', null, '小记'),
        React.createElement('span', { dangerouslySetInnerHTML: { __html: ICON_EXPAND } }),
      ),
      React.createElement('div', { className: 'np-tip', ref: tipRef, hidden: true }),
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

  /* ---- 会话卡片：消息列表 ---- */
  const chatRows = []
  if (chat === null || chat.cold === true) {
    chatRows.push(React.createElement('div', { key: 'empty', className: 'sc-empty' }, chat === null ? '常驻会话 · 直接在这里对话' : '常驻会话 · 发送首条消息以开始'))
  } else {
    for (const message of chat.messages) {
      if (message.role === 'user') {
        chatRows.push(React.createElement('div', { key: message.id, className: 'sc-msg user' }, message.text))
      } else if (message.role === 'assistant') {
        chatRows.push(
          React.createElement('div', { key: message.id, className: 'sc-msg assistant' },
            React.createElement('div', { className: 'bubble' }, message.text),
          ),
        )
      } else {
        chatRows.push(React.createElement('div', { key: message.id, className: 'sc-msg tool' }, message.text))
      }
    }
    if (chat.partial !== null && chat.partial !== '') {
      const last = chat.messages[chat.messages.length - 1]
      const duplicate = last !== undefined && last.role === 'assistant' && last.text === chat.partial
      if (!duplicate) {
        chatRows.push(
          React.createElement('div', { key: 'stream', className: 'sc-msg assistant' },
            React.createElement('div', { className: 'bubble' }, chat.partial, React.createElement('span', { className: 'cursor' })),
          ),
        )
      }
    }
  }

  /* ---- 会话卡片：⚙ 设置弹窗字段 ---- */
  const presetOptions = card === null || !Array.isArray(card.presets)
    ? []
    : card.presets.map((preset) =>
        React.createElement(
          'option',
          { key: preset.id, value: preset.id, disabled: preset.broken === true },
          preset.name ?? preset.id + (preset.isDefault === true ? '（默认）' : ''),
        ),
      )
  const modelGroups = card === null || !Array.isArray(card.catalog)
    ? []
    : card.catalog.map((provider) =>
        React.createElement(
          'optgroup',
          { key: provider.id, label: provider.name ?? provider.id },
          (provider.models ?? []).map((model) =>
            React.createElement(
              'option',
              { key: model.id, value: `${provider.id}/${model.id}` },
              model.name ?? model.id,
            ),
          ),
        ),
      )
  const currentModel = card !== null && card.model !== undefined ? card.model : undefined
  const currentModelInfo = (() => {
    if (currentModel === undefined || !Array.isArray(card.catalog)) return null
    for (const provider of card.catalog) {
      if (provider.id !== currentModel.provider) continue
      for (const model of provider.models ?? []) {
        if (model.id === currentModel.model) return model
      }
    }
    return null
  })()
  const efforts = currentModelInfo !== null && currentModelInfo.reasoning ? currentModelInfo.reasoning.efforts ?? [] : []
  const effortOptions = [
    React.createElement('option', { key: '', value: '' }, '默认'),
    ...efforts.map((entry) => React.createElement('option', { key: entry.id, value: entry.id }, entry.name)),
  ]

  /* ---- 待办列表 ---- */
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
            'data-id': item.id,
            className: rowClass,
            title: '双击编辑',
            onDoubleClick: () => startEdit(item),
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
            className: 'np-del',
            'data-tip': '删除',
            onClick: () => deleteTodo(item),
            dangerouslySetInnerHTML: { __html: ICON_TRASH },
          }),
        )
      })

  /* ---- 卡片状态行 ---- */
  const running = chat !== null && chat.cold !== true && chat.running === true
  const statusText = running
    ? '运行中…'
    : (card === null ? '加载中…' : (card.blank === true ? '空白 · 预设可切换' : '已开始 · 预设已锁定'))

  return React.createElement(
    'div',
    {
      className: 'dsh-notes-dock',
      'data-notes-ver': 'fusion-wip',
      ref: (node) => {
        rootRef.current = node
        dockRef.current = node
      },
      style: dockStyle,
      onMouseOver: onTipOver,
      onMouseMove: onTipMove,
      onMouseOut: onTipOut,
    },
    React.createElement(
      'div',
      { className: 'dock-body' },
      /* ===== 上半：常驻会话卡片 ===== */
      React.createElement(
        'section',
        { className: 'sc-section' },
        React.createElement(
          'div',
          { className: 'sc-head' },
          React.createElement('span', { className: 'dot' }),
          React.createElement('span', { className: 't' }, '常驻会话'),
          React.createElement('span', { className: 'sid' }, card !== null ? card.sessionId : '…'),
          React.createElement('span', { className: 'spacer' }),
          React.createElement('button', {
            type: 'button',
            className: 'sc-btn',
            'data-tip': '在中间栏打开',
            onClick: openInCenter,
            dangerouslySetInnerHTML: { __html: ICON_OPEN },
          }),
          React.createElement('button', {
            type: 'button',
            className: 'sc-btn',
            'data-tip': '设置（预设/模型/思考等级）',
            onClick: () => setPopupOpen((prev) => !prev),
            dangerouslySetInnerHTML: { __html: ICON_GEAR },
          }),
          React.createElement('button', {
            type: 'button',
            className: 'sc-btn',
            'data-tip': '折叠小记',
            onClick: collapse,
            dangerouslySetInnerHTML: { __html: ICON_COLLAPSE },
          }),
        ),
        React.createElement('div', { className: 'sc-messages' }, ...chatRows),
        cardError === null
          ? null
          : React.createElement('div', { className: 'sc-error' }, cardError),
        React.createElement(
          'div',
          { className: 'sc-input-row' },
          React.createElement('input', {
            ref: scInputRef,
            className: 'sc-input',
            placeholder: '给常驻会话发消息…',
            autoComplete: 'off',
            onKeyDown: onScInputKeyDown,
          }),
          React.createElement(
            'button',
            { type: 'button', className: 'sc-send' + (running ? ' stop' : ''), onClick: onSendClick },
            running ? '停止' : '发送',
          ),
        ),
        React.createElement(
          'div',
          { className: 'sc-foot' },
          React.createElement('button', { type: 'button', className: 'sc-clear', onClick: () => { if (!running) setConfirming(true) } }, '清空会话'),
          confirming
            ? React.createElement(
                'span',
                { className: 'sc-confirm' },
                '确认清空？',
                React.createElement('button', { type: 'button', className: 'yes', onClick: confirmClear }, '确认'),
                React.createElement('button', { type: 'button', className: 'no', onClick: () => setConfirming(false) }, '取消'),
              )
            : React.createElement('span', { className: 'sc-status' }, statusText),
        ),
        popupOpen
          ? React.createElement(
              'div',
              { className: 'sc-popup' },
              React.createElement(
                'div',
                { className: 'sc-popup-head' },
                React.createElement('span', { className: 't' }, '设置 · 常驻会话'),
                React.createElement('button', { type: 'button', className: 'sc-btn', 'data-tip': '关闭', onClick: () => setPopupOpen(false) }, '×'),
              ),
              React.createElement(
                'div',
                { className: 'sc-popup-body' },
                React.createElement(
                  'div',
                  { className: 'sc-field' },
                  React.createElement('label', null, '选择预设'),
                  React.createElement('select', {
                    value: card !== null ? (card.presetId ?? '') : '',
                    disabled: card === null || card.presetLocked === true,
                    onChange: onPresetChange,
                  }, ...presetOptions),
                  card !== null && card.presetLocked === true
                    ? React.createElement('span', { className: 'sc-popup-hint' }, '会话已开始，预设已锁定')
                    : null,
                ),
                React.createElement(
                  'div',
                  { className: 'sc-field' },
                  React.createElement('label', null, '选择模型'),
                  React.createElement('select', {
                    value: currentModel !== undefined ? `${currentModel.provider}/${currentModel.model}` : '',
                    onChange: onModelChange,
                  }, ...modelGroups),
                ),
                React.createElement(
                  'div',
                  { className: 'sc-field' },
                  React.createElement('label', null, '思考等级'),
                  React.createElement('select', {
                    value: currentModel !== undefined && currentModel.effort !== undefined ? currentModel.effort : '',
                    disabled: efforts.length === 0,
                    onChange: onEffortChange,
                  }, ...effortOptions),
                ),
              ),
              React.createElement(
                'div',
                { className: 'sc-popup-foot' },
                React.createElement('button', { type: 'button', onClick: () => setPopupOpen(false) }, '完成'),
              ),
            )
          : null,
      ),
      /* ===== 分隔条 ===== */
      React.createElement('div', {
        className: 'dock-splitter',
        'data-tip': '拖动调整上下比例（双击复位）',
        onPointerDown: onSplitPointerDown,
        onPointerMove: onSplitPointerMove,
        onPointerUp: onSplitPointerUp,
        onPointerCancel: onSplitPointerUp,
        onDoubleClick: onSplitDoubleClick,
      }),
      /* ===== 下半：小计 ===== */
      React.createElement(
        'section',
        { className: 'np-section' },
        React.createElement(
          'div',
          { className: 'np-head' },
          React.createElement('span', { className: 'dot' }),
          React.createElement('span', { className: 't' }, '小计'),
          React.createElement('span', { className: 'spacer' }),
        ),
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
            React.createElement(
              'button',
              { type: 'button', className: 'np-clear', 'data-tip': '清空已完成', disabled: doneCount === 0, onClick: clearDone },
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
      ),
    ),
    React.createElement('div', { className: 'np-tip', ref: tipRef, hidden: true }),
  )
}

export default {
  name: 'notes-client',
  inject: ['slots'],
  apply(ctx) {
    const sessions = ctx.get('sessions')
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
        React.createElement(NotesDock, Object.assign({}, props, { sessions })),
      ),
    )
  },
}
