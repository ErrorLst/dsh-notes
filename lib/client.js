window.__ModuleLoader__.load({
	id: "@dsh-external/dsh-notes",
	factory: (require) => {
		var module = { exports: {} };
		module.exports;
		//#region src/client/index.ts
		const React = require("react");
		const { useState, useEffect, useLayoutEffect, useRef, useCallback } = React;
		const STYLE_TAG_ID = "dsh-notes-dock-style";
		const WIDTH_DEFAULT = 280;
		const WIDTH_GAP = 16;
		const WIDTH_DRAG_KEY = "dsh-notes.dockWidth";
		const WIDTH_DRAG_MIN = 200;
		const WIDTH_DRAG_MAX = 640;
		const MEMO_DEBOUNCE_MS = 600;
		const UNDO_TTL_MS = 5e3;
		const ICON_CHECK = "<svg viewBox=\"0 0 12 12\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M2.5 6.5L5 9l4.5-6\"/></svg>";
		const ICON_TRASH = "<svg viewBox=\"0 0 14 14\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.3\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M2 4h10M5.5 4V2.8A.8.8 0 016.3 2h1.4a.8.8 0 01.8.8V4M3.5 4l.6 7a1 1 0 001 1h3.8a1 1 0 001-1l.6-7\"/><path d=\"M6 6.5v3M8 6.5v3\"/></svg>";
		const ICON_PIN = "<svg viewBox=\"0 0 14 14\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.4\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M8.6 1.4l4 4-1.4 1.4-1.2-.6-2.2 2.2.6 1.2-1.4 1.4-3-3L3.4 9l-.8-.8 2.6-2.6-1.2-.6 1.4-1.4 1.2.6 2.2-2.2-.6-1.2 1.4-1.4z\"/></svg>";
		const ICON_GRIP = "<svg viewBox=\"0 0 10 16\" fill=\"currentColor\"><circle cx=\"2.5\" cy=\"2.5\" r=\"1.4\"/><circle cx=\"7.5\" cy=\"2.5\" r=\"1.4\"/><circle cx=\"2.5\" cy=\"8\" r=\"1.4\"/><circle cx=\"7.5\" cy=\"8\" r=\"1.4\"/><circle cx=\"2.5\" cy=\"13.5\" r=\"1.4\"/><circle cx=\"7.5\" cy=\"13.5\" r=\"1.4\"/></svg>";
		const ICON_DETAIL = "<svg viewBox=\"0 0 14 14\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.3\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M2.5 1.8h9v10.4h-9z\"/><path d=\"M5 4.6h4M5 7h4M5 9.4h2.5\"/></svg>";
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
  /* 字体随会话设置（ui-theme.fontSize）：12px 基准 + 会话 delta，1:1 跟随 */
  --dsh-notes-font-base: calc(12px + var(--dsh-content-font-delta, 0px));
  font-size: calc(var(--dsh-notes-font-base) * 1);
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
  font-size: calc(var(--dsh-notes-font-base) * 0.9583);
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
  font-size: calc(var(--dsh-notes-font-base) * 0.9583);
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
.np-sec-title { font-size: calc(var(--dsh-notes-font-base) * 0.875); font-weight: 600; letter-spacing: 0.04em; color: var(--dsw-alias-label-tertiary); }
.np-sec-count { font-size: calc(var(--dsh-notes-font-base) * 0.875); color: var(--dsw-alias-label-tertiary); }
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
  font-size: calc(var(--dsh-notes-font-base) * 1);
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
  font-size: calc(var(--dsh-notes-font-base) * 1);
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
.np-item.pinned .np-text::after { content: ' 📌'; font-size: calc(var(--dsh-notes-font-base) * 0.75); }

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
  font-size: calc(var(--dsh-notes-font-base) * 1);
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
.np-detail-head .t { flex: 1; font-size: calc(var(--dsh-notes-font-base) * 1.0417); font-weight: 500; line-height: 20px; }
.np-detail-close {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  color: var(--dsw-alias-label-tertiary);
  background: none;
  border: none;
  font-size: calc(var(--dsh-notes-font-base) * 1.1667);
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
.np-detail-field label { font-size: calc(var(--dsh-notes-font-base) * 0.9167); color: var(--dsw-alias-label-tertiary); }
.np-detail-title {
  height: 30px;
  padding: 0 8px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 7px;
  background: var(--dsw-specific-input-major);
  outline: none;
  font-size: calc(var(--dsh-notes-font-base) * 1.0417);
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
  font-size: calc(var(--dsh-notes-font-base) * 1.0417);
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
  font-size: calc(var(--dsh-notes-font-base) * 0.875);
  color: var(--dsw-alias-label-tertiary);
}
.np-detail-status { font-size: calc(var(--dsh-notes-font-base) * 0.875); color: var(--dsw-alias-label-tertiary); }
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
.np-empty p { margin: 0; font-size: calc(var(--dsh-notes-font-base) * 1); color: var(--dsw-alias-label-secondary); }
.np-empty .sub { font-size: calc(var(--dsh-notes-font-base) * 0.875); color: var(--dsw-alias-label-tertiary); }

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
  font-size: calc(var(--dsh-notes-font-base) * 0.9583);
  color: var(--dsw-alias-label-secondary);
}
.np-undo button {
  margin-left: auto;
  font-size: calc(var(--dsh-notes-font-base) * 0.9583);
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
  font-size: calc(var(--dsh-notes-font-base) * 0.9167);
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
.np-memo-status { font-size: calc(var(--dsh-notes-font-base) * 0.875); color: var(--dsw-alias-label-tertiary); margin-left: auto; }
.np-memo {
  flex: 1;
  min-height: 56px;
  margin: 0 12px 8px;
  padding: 7px 10px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-specific-input-major);
  color: var(--dsw-alias-label-primary);
  font-size: calc(var(--dsh-notes-font-base) * 1);
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


/* ===== 宽度拖拽手柄（右缘，竖直抓条） ===== */
.dock-resize {
  position: absolute; top: 0; bottom: 0; right: -8px; width: 8px;
  z-index: 20; cursor: col-resize; touch-action: none;
}
.dock-resize::after {
  content: ''; position: absolute; top: 0; bottom: 0; right: 0; width: 3px;
  border-radius: 2px; background: transparent;
  transition: background var(--ds-transition-duration-fast, 0.12s) var(--ds-ease-in-out, ease);
}
.dock-resize:hover::after, .dock-resize:active::after { background: var(--dsw-alias-state-business-primary); opacity: .8; }


/* ===== 悬浮迷你滚动条（dock 内所有滚动区）：仅滚动/悬停时显示，非必要隐藏 ===== */
.dsh-notes-dock .np-list::-webkit-scrollbar { width: 5px; }
.dsh-notes-dock .np-list::-webkit-scrollbar-thumb {
  background: transparent;
  border-radius: 999px;
  border: 1px solid transparent;
  background-clip: content-box;
  transition: background 0.18s var(--ds-ease-in-out, ease);
}
.dsh-notes-dock .np-list.scr-on::-webkit-scrollbar-thumb {
  background: var(--dsw-alias-scrollbar-bg-l1);
}
.dsh-notes-dock .np-list.scr-on::-webkit-scrollbar-thumb:hover {
  background: var(--dsw-alias-scrollbar-hover-l1);
}
`;
		function scopeOf(data, tab) {
			return tab === "global" ? data.global : data.workspace;
		}
		function NotesDock(props) {
			const useWorkspaces = props.useWorkspaces;
			const useSessions = props.useSessions;
			const currentSessionId = useSessions ? useSessions((state) => state.current) : void 0;
			const currentCwd = useSessions ? useSessions((state) => state.current !== void 0 ? state.byId[state.current]?.cwd : void 0) : void 0;
			const recentWorkspaceId = useWorkspaces ? useWorkspaces((state) => state.recentWorkspaceId) : void 0;
			const workspaceBySession = useWorkspaces ? useWorkspaces((state) => {
				if (currentSessionId === void 0) return void 0;
				const hit = state.items.find((item) => item.sessionIds.includes(currentSessionId));
				return hit !== void 0 ? hit.workspaceId : void 0;
			}) : void 0;
			const workspaceByCwd = useWorkspaces ? useWorkspaces((state) => {
				if (currentCwd === void 0) return void 0;
				const normalize = (p) => (p ?? "").toLowerCase().replace(/[\\/]+/g, "\\").replace(/\\+$/, "");
				const target = normalize(currentCwd);
				const hit = state.items.find((item) => normalize(item.path) === target);
				return hit !== void 0 ? hit.workspaceId : void 0;
			}) : void 0;
			const workspaceId = workspaceBySession ?? workspaceByCwd ?? recentWorkspaceId;
			const workspaceTitle = useWorkspaces ? useWorkspaces((state) => state.items.find((item) => item.workspaceId === workspaceId)?.title) : void 0;
			const rootRef = useRef(null);
			const dockRef = useRef(null);
			const inputRef = useRef(null);
			const [left, setLeft] = useState(260);
			const [top, setTop] = useState(0);
			const [viewIsChat, setViewIsChat] = useState(true);
			const [covered, setCovered] = useState(false);
			const [effWidth, setEffWidth] = useState(WIDTH_DEFAULT);
			const [dragWidth, setDragWidth] = useState(() => {
				try {
					const v = Number.parseInt(localStorage.getItem(WIDTH_DRAG_KEY) || "", 10);
					if (Number.isFinite(v)) return Math.max(WIDTH_DRAG_MIN, Math.min(WIDTH_DRAG_MAX, v));
				} catch {}
				return null;
			});
			const leftRef = useRef(260);
			leftRef.current = left;
			const effWidthRef = useRef(effWidth);
			const minWRef = useRef(0);
			effWidthRef.current = effWidth;
			const dragWidthRef = useRef(dragWidth);
			dragWidthRef.current = dragWidth;
			const dragActiveRef = useRef(false);
			const coveredRef = useRef(false);
			coveredRef.current = covered;
			const [data, setData] = useState({
				global: {
					todos: [],
					memo: ""
				},
				workspace: null
			});
			const [error, setError] = useState(null);
			const [tab, setTab] = useState(workspaceId !== void 0 ? "workspace" : "global");
			const lastWorkspaceRef = useRef(workspaceId);
			useEffect(() => {
				if (lastWorkspaceRef.current !== workspaceId) {
					lastWorkspaceRef.current = workspaceId;
					if (detailDraftRef.current !== null) closeDetail();
					setTab(workspaceId !== void 0 ? "workspace" : "global");
				}
			}, [workspaceId]);
			const [detailDraft, setDetailDraft] = useState(null);
			const [detailStatus, setDetailStatus] = useState("");
			const detailDraftRef = useRef(null);
			const detailDirtyRef = useRef(false);
			const detailTimerRef = useRef(null);
			const detailBodyRef = useRef(null);
			const detailTaRef = useRef(null);
			const detailScrollRef = useRef({
				body: 0,
				ta: 0
			});
			const lastDetailValueRef = useRef(null);
			const [memoText, setMemoText] = useState("");
			const [memoStatus, setMemoStatus] = useState("");
			const memoTextRef = useRef("");
			const dirtyRef = useRef(false);
			const memoTimerRef = useRef(null);
			const dataForRef = useRef(null);
			const boundKeyRef = useRef(null);
			const undoTimerRef = useRef(null);
			const tipRef = useRef(null);
			const dragIdRef = useRef(null);
			const dropIdRef = useRef(null);
			const dragStartRef = useRef(null);
			const flipFromRef = useRef(null);
			const [undoInfo, setUndoInfo] = useState(null);
			const [dragId, setDragId] = useState(null);
			const [dropId, setDropId] = useState(null);
			function tipElOf(target) {
				return target && target.closest ? target.closest("[data-tip]") : null;
			}
			function positionTip(el) {
				const tip = tipRef.current;
				if (tip === null) return;
				tip.textContent = el.dataset.tip || "";
				const rect = el.getBoundingClientRect();
				const dockRect = rootRef.current !== null ? rootRef.current.getBoundingClientRect() : null;
				if (dockRect === null) return;
				let x = rect.left - dockRect.left;
				let y = rect.bottom - dockRect.top + 6;
				const tw = tip.offsetWidth;
				const th = tip.offsetHeight;
				if (x + tw > dockRect.width - 4) x = Math.max(4, dockRect.width - tw - 4);
				if (y + th > dockRect.height - 4) y = rect.top - dockRect.top - th - 6;
				tip.style.left = `${x}px`;
				tip.style.top = `${y}px`;
				tip.hidden = false;
			}
			function hideTip() {
				if (tipRef.current !== null) tipRef.current.hidden = true;
			}
			function onTipOver(event) {
				const el = tipElOf(event.target);
				if (el !== null) positionTip(el);
				else hideTip();
			}
			function onTipMove(event) {
				const el = tipElOf(event.target);
				if (el !== null) positionTip(el);
			}
			function onTipOut(event) {
				if (tipElOf(event.relatedTarget) === null) hideTip();
			}
			useEffect(() => {
				const root = rootRef.current;
				if (root === null) return;
				let frame = null;
				let probe = root.parentElement;
				while (probe !== null && probe !== document.body) {
					const computed = getComputedStyle(probe);
					if (computed.display === "grid" && computed.gridTemplateColumns.split(" ").length >= 3) {
						frame = probe;
						break;
					}
					probe = probe.parentElement;
				}
				if (frame === null) return;
				const overlayEl = root.parentElement;
				let center = null;
				for (const child of frame.children) {
					if (child === overlayEl || child.nodeType !== 1) continue;
					const cs = getComputedStyle(child);
					if (cs.display === "flex" && cs.flexDirection === "column") {
						center = child;
						break;
					}
				}
				const findScrollBody = () => {
					if (center === null) return null;
					try {
						const hit = center.querySelector("[data-conversation-scroll]");
						if (hit !== null) return hit;
						const byClass = center.querySelector("[class*=\"scrollBody\"]");
						if (byClass !== null) return byClass;
					} catch {}
					return null;
				};
				let scrollEl = findScrollBody();
				const updateLeft = () => {
					const columns = getComputedStyle(frame).gridTemplateColumns.split(" ");
					const px = parseFloat(columns[0]);
					if (Number.isFinite(px)) setLeft(px);
				};
				const updateTop = () => {
					const base = scrollEl ?? center?.firstElementChild ?? null;
					if (base === null) return;
					const frameRect = frame.getBoundingClientRect();
					const baseRect = base.getBoundingClientRect();
					setTop(Math.max(0, baseRect.top - frameRect.top));
				};
				const updateCovered = () => {
					let scroll = null;
					try {
						scroll = center !== null ? center.querySelector("[data-conversation-scroll]") : null;
					} catch {}
					let next = false;
					let content = null;
					let minW = WIDTH_DEFAULT;
					const cardOpen = detailDraftRef.current !== null;
					if (scroll !== null) {
						const aLeft = frame.getBoundingClientRect().left + leftRef.current;
						try {
							const hit = center !== null ? center.querySelector("[data-chat-flow]") : null;
							content = hit !== null ? hit.getBoundingClientRect() : null;
						} catch {
							content = null;
						}
						if (content !== null) {
							const gap = content.left - aLeft;
							const fit = Math.max(0, gap - WIDTH_GAP);
							const el0 = rootRef.current;
							if (el0 !== null && !cardOpen) {
								const prevWidth = el0.style.width;
								try {
									el0.style.width = "max-content";
									let full = 0;
									let countFull = 0;
									const row = el0.querySelector(".np-sec-head");
									if (row !== null) {
										const prevRowW = row.style.width;
										row.style.width = "max-content";
										let w = 0;
										try {
											w = row.getBoundingClientRect().width;
										} catch {
											w = 0;
										}
										row.style.width = prevRowW;
										if (w > 0) {
											full = w;
											try {
												const c = row.querySelector(".np-sec-count");
												countFull = c !== null ? c.getBoundingClientRect().width : 0;
											} catch {
												countFull = 0;
											}
										}
									}
									const notesMin = full > 0 ? Math.max(120, full - countFull + 40 + 16) : 0;
									if (notesMin > 0) minWRef.current = notesMin;
								} catch {} finally {
									el0.style.width = prevWidth;
								}
							}
							if (minWRef.current > 0) minW = minWRef.current;
							const manual = dragWidthRef.current;
							if (manual !== null) {
								const target = Math.min(manual, fit);
								if (target < 120) next = true;
								else {
									if (!cardOpen) setEffWidth((prev) => Math.abs(prev - target) < 1 ? prev : target);
									next = false;
								}
							} else {
								const HYST = 24;
								if (coveredRef.current) if (fit >= minW + HYST) next = false;
								else next = true;
								else if (fit < minW) next = true;
								else {
									if (!cardOpen) setEffWidth((prev) => Math.abs(prev - fit) < 1 ? prev : fit);
									next = false;
								}
							}
						} else {
							if (!cardOpen) {
								const manual2 = dragWidthRef.current;
								const target = manual2 !== null ? manual2 : WIDTH_DEFAULT;
								setEffWidth((prev) => prev === target ? prev : target);
							}
							next = false;
						}
					}
					setCovered((prev) => prev === next ? prev : next);
				};
				const detectChatView = () => {
					if (center === null) return true;
					try {
						const tablist = center.querySelector("[role=\"tablist\"]");
						if (tablist !== null) {
							const tabs = tablist.querySelectorAll("[role=\"tab\"]");
							const active = tablist.querySelector("[role=\"tab\"][aria-selected=\"true\"]");
							if (active === null || tabs.length === 0) return true;
							return active === tabs[0];
						}
					} catch {
						return true;
					}
					return true;
				};
				updateLeft();
				updateTop();
				updateCovered();
				setViewIsChat(detectChatView());
				let raf = 0;
				const scheduleUpdate = () => {
					if (raf !== 0) return;
					raf = requestAnimationFrame(() => {
						raf = 0;
						scrollEl = findScrollBody();
						updateLeft();
						updateTop();
						updateCovered();
						setViewIsChat(detectChatView());
					});
				};
				const onResize = scheduleUpdate;
				const observer = new MutationObserver((mutations) => {
					let relevant = false;
					for (const mutation of mutations) {
						if (scrollEl !== null && (mutation.target === scrollEl || scrollEl.contains(mutation.target))) continue;
						relevant = true;
						break;
					}
					if (relevant) scheduleUpdate();
				});
				observer.observe(frame, {
					attributes: true,
					attributeFilter: ["style", "data-sidebar-collapsed"],
					childList: true
				});
				if (center !== null) observer.observe(center, {
					childList: true,
					subtree: true,
					attributes: true,
					attributeFilter: [
						"style",
						"class",
						"data-phase",
						"aria-selected"
					]
				});
				const onTabClick = (event) => {
					const target = event.target;
					if (target instanceof Element && target.closest("[role=\"tab\"]") !== null) scheduleUpdate();
				};
				document.addEventListener("click", onTabClick, true);
				const recheckTimer = setInterval(scheduleUpdate, 1500);
				let ro = null;
				if (typeof ResizeObserver !== "undefined") {
					ro = new ResizeObserver(onResize);
					ro.observe(frame);
					if (center !== null) ro.observe(center);
					if (scrollEl !== null) ro.observe(scrollEl);
				}
				window.addEventListener("resize", onResize);
				return () => {
					if (raf !== 0) cancelAnimationFrame(raf);
					observer.disconnect();
					document.removeEventListener("click", onTabClick, true);
					clearInterval(recheckTimer);
					if (ro !== null) ro.disconnect();
					window.removeEventListener("resize", onResize);
				};
			}, []);
			useEffect(() => {
				let alive = true;
				const load = () => {
					const query = workspaceId !== void 0 ? `?workspaceId=${encodeURIComponent(workspaceId)}` : "";
					fetch(`/api/dsh-notes${query}`, { cache: "no-store" }).then((response) => response.json()).then((result) => {
						if (!alive) return;
						if (result.ok === true) {
							dataForRef.current = workspaceId ?? null;
							setData({
								global: result.global,
								workspace: result.workspace
							});
							setError(null);
						} else setError(result.error ?? "load-failed");
					}).catch(() => {
						if (alive) setError("network");
					});
				};
				load();
				window.addEventListener("focus", load);
				return () => {
					alive = false;
					window.removeEventListener("focus", load);
				};
			}, [workspaceId]);
			const post = useCallback((body) => {
				return fetch("/api/dsh-notes", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(body)
				}).then((response) => response.json()).then((result) => {
					if (result.ok === true) {
						setData((prev) => ({
							global: result.state.global,
							workspace: result.state.workspace !== null ? result.state.workspace : prev.workspace
						}));
						setError(null);
					} else setError(result.error ?? "action-failed");
					return result;
				}).catch(() => {
					setError("network");
					return { ok: false };
				});
			}, []);
			const workspaceArg = tab === "workspace" ? workspaceId : void 0;
			function saveMemoNow() {
				if (!dirtyRef.current) return;
				dirtyRef.current = false;
				setMemoStatus("已保存");
				post({
					action: "set-memo",
					scope: tab,
					workspaceId: workspaceArg,
					text: memoTextRef.current
				});
			}
			function onMemoInput(event) {
				const value = event.target.value;
				setMemoText(value);
				memoTextRef.current = value;
				dirtyRef.current = true;
				setMemoStatus("保存中…");
				if (memoTimerRef.current !== null) clearTimeout(memoTimerRef.current);
				memoTimerRef.current = setTimeout(() => {
					memoTimerRef.current = null;
					saveMemoNow();
				}, MEMO_DEBOUNCE_MS);
			}
			function onMemoBlur() {
				if (memoTimerRef.current !== null) {
					clearTimeout(memoTimerRef.current);
					memoTimerRef.current = null;
				}
				saveMemoNow();
			}
			const scopeKey = tab === "global" ? "global" : `workspace:${workspaceId ?? ""}`;
			useEffect(() => {
				if (tab === "workspace" && (workspaceId === void 0 || dataForRef.current !== workspaceId)) return;
				const effectiveKey = tab === "global" ? "global" : `workspace:${dataForRef.current ?? ""}`;
				if (boundKeyRef.current === effectiveKey) return;
				const scope = tab === "global" ? data.global : data.workspace;
				if (scope === null) return;
				boundKeyRef.current = effectiveKey;
				setMemoText(scope.memo);
				memoTextRef.current = scope.memo;
				dirtyRef.current = false;
				setMemoStatus("");
			}, [scopeKey, data]);
			function showUndo(scope, count) {
				if (undoTimerRef.current !== null) clearTimeout(undoTimerRef.current);
				setUndoInfo({
					scope,
					count
				});
				undoTimerRef.current = setTimeout(() => {
					undoTimerRef.current = null;
					setUndoInfo(null);
				}, UNDO_TTL_MS);
			}
			function undoDelete() {
				if (undoInfo === null) return;
				const target = undoInfo.scope;
				if (undoTimerRef.current !== null) {
					clearTimeout(undoTimerRef.current);
					undoTimerRef.current = null;
				}
				setUndoInfo(null);
				post({
					action: "undo-delete",
					scope: target,
					workspaceId: target === "workspace" ? workspaceId : void 0
				}).then((result) => {
					if (result.ok !== true) setError(result.error ?? "no-undo");
				});
			}
			function onDockPointerDown() {
				hideTip();
			}
			useEffect(() => {
				const root = rootRef.current;
				if (root === null) return;
				const timers = /* @__PURE__ */ new Map();
				const onScroll = (event) => {
					const el = event.currentTarget;
					el.classList.add("scr-on");
					const prev = timers.get(el);
					if (prev !== void 0) clearTimeout(prev);
					timers.set(el, setTimeout(() => el.classList.remove("scr-on"), 1500));
				};
				const onEnter = (event) => {
					event.currentTarget.classList.add("scr-on");
				};
				const onLeave = (event) => {
					event.currentTarget.classList.remove("scr-on");
				};
				const attach = () => {
					for (const el of Array.from(root.querySelectorAll(".np-list"))) {
						if (el.dataset.scrHooked === "1") continue;
						el.dataset.scrHooked = "1";
						el.addEventListener("scroll", onScroll, { passive: true });
						el.addEventListener("mouseenter", onEnter);
						el.addEventListener("mouseleave", onLeave);
					}
				};
				attach();
				return () => {
					for (const el of Array.from(root.querySelectorAll(".np-list"))) {
						if (el.dataset.scrHooked !== "1") continue;
						el.dataset.scrHooked = "0";
						el.removeEventListener("scroll", onScroll);
						el.removeEventListener("mouseenter", onEnter);
						el.removeEventListener("mouseleave", onLeave);
					}
					for (const t of timers.values()) clearTimeout(t);
				};
			}, []);
			function gapToChat() {
				const root = rootRef.current;
				if (root === null) return null;
				let frame = null;
				let probe = root.parentElement;
				while (probe !== null && probe !== document.body) {
					const cs = getComputedStyle(probe);
					if (cs.display === "grid" && cs.gridTemplateColumns.split(" ").length >= 3) {
						frame = probe;
						break;
					}
					probe = probe.parentElement;
				}
				if (frame === null) return null;
				const overlayEl = root.parentElement;
				let center = null;
				for (const child of frame.children) {
					if (child === overlayEl || child.nodeType !== 1) continue;
					const cs = getComputedStyle(child);
					if (cs.display === "flex" && cs.flexDirection === "column") {
						center = child;
						break;
					}
				}
				if (center === null) return null;
				try {
					const hit = center.querySelector("[data-chat-flow]");
					if (hit === null) return null;
					const aLeft = frame.getBoundingClientRect().left + leftRef.current;
					const gap = hit.getBoundingClientRect().left - aLeft;
					return Math.max(0, gap - WIDTH_GAP);
				} catch {
					return null;
				}
			}
			function clampDragWidth(w) {
				return Math.max(WIDTH_DRAG_MIN, Math.min(WIDTH_DRAG_MAX, Math.round(w)));
			}
			function onResizeStart(event) {
				if (event.pointerType === "mouse" && event.button !== 0) return;
				event.preventDefault();
				dragActiveRef.current = true;
				hideTip();
				try {
					event.currentTarget.setPointerCapture(event.pointerId);
				} catch {}
			}
			function onResizeMove(event) {
				if (!dragActiveRef.current) return;
				const dock = rootRef.current;
				if (dock === null) return;
				const w = clampDragWidth(event.clientX - dock.getBoundingClientRect().left);
				setDragWidth(w);
				const fit = gapToChat();
				const target = fit === null ? w : Math.min(w, fit);
				if (target > 0) setEffWidth(target);
			}
			function onResizeEnd(event) {
				if (!dragActiveRef.current) return;
				dragActiveRef.current = false;
				const dock = rootRef.current;
				if (dock === null) return;
				const w = clampDragWidth(event.clientX - dock.getBoundingClientRect().left);
				setDragWidth(w);
				try {
					localStorage.setItem(WIDTH_DRAG_KEY, String(w));
				} catch {}
				try {
					window.dispatchEvent(new Event("resize"));
				} catch {}
			}
			function onResizeCancel() {
				dragActiveRef.current = false;
			}
			function addTodo() {
				const input = inputRef.current;
				if (input === null) return;
				const text = input.value.trim();
				if (text === "") return;
				input.value = "";
				post({
					action: "add",
					scope: tab,
					workspaceId: workspaceArg,
					text
				});
			}
			function toggleTodo(item) {
				post({
					action: "toggle",
					scope: tab,
					workspaceId: workspaceArg,
					id: item.id,
					done: !item.done
				});
			}
			function pinTodo(item) {
				post({
					action: "pin",
					scope: tab,
					workspaceId: workspaceArg,
					id: item.id,
					pinned: !item.pinned
				});
			}
			function deleteTodo(item) {
				post({
					action: "delete",
					scope: tab,
					workspaceId: workspaceArg,
					id: item.id
				}).then((result) => {
					if (result.ok === true) showUndo(tab, 1);
				});
			}
			function onGripPointerDown(event, id) {
				if (event.pointerType === "mouse" && event.button !== 0) return;
				event.preventDefault();
				dragIdRef.current = id;
				dropIdRef.current = null;
				dragStartRef.current = {
					x: event.clientX,
					y: event.clientY
				};
				setDragId(id);
				setDropId(null);
				try {
					event.currentTarget.setPointerCapture(event.pointerId);
				} catch {}
			}
			function onGripPointerMove(event) {
				if (dragIdRef.current === null) return;
				const hit = document.elementFromPoint(event.clientX, event.clientY);
				const row = hit && hit.closest ? hit.closest(".np-item") : null;
				const next = row && row.dataset ? row.dataset.id : null;
				if (next !== dropIdRef.current) {
					dropIdRef.current = next;
					setDropId(next);
				}
			}
			function onGripPointerUp(event) {
				const from = dragIdRef.current;
				const target = dropIdRef.current;
				dragIdRef.current = null;
				dropIdRef.current = null;
				setDragId(null);
				setDropId(null);
				const start = dragStartRef.current;
				dragStartRef.current = null;
				if (!(start !== null && Math.hypot(event.clientX - start.x, event.clientY - start.y) >= 4) || from === null || from === target) return;
				const rects = {};
				for (const row of document.querySelectorAll(".dsh-notes-dock .np-item")) {
					const r = row.getBoundingClientRect();
					if (row.dataset && row.dataset.id) rects[row.dataset.id] = {
						left: r.left,
						top: r.top
					};
				}
				flipFromRef.current = rects;
				const scope = scopeOf(data, tab);
				if (scope === null) return;
				const todos = scope.todos;
				const display = [...todos.filter((item) => item.pinned), ...todos.filter((item) => !item.pinned)];
				const fromIndex = display.findIndex((item) => item.id === from);
				if (fromIndex < 0) return;
				const next = [...display];
				const [movedItem] = next.splice(fromIndex, 1);
				const targetIndex = target === null ? next.length : next.findIndex((item) => item.id === target);
				next.splice(targetIndex < 0 ? next.length : targetIndex, 0, movedItem);
				const pinnedCount = todos.filter((item) => item.pinned).length;
				const shouldPin = next.indexOf(movedItem) < pinnedCount;
				const updates = [];
				if (movedItem.pinned !== shouldPin) updates.push(post({
					action: "pin",
					scope: tab,
					workspaceId: workspaceArg,
					id: movedItem.id,
					pinned: shouldPin
				}));
				updates.push(post({
					action: "reorder",
					scope: tab,
					workspaceId: workspaceArg,
					orderedIds: next.map((item) => item.id)
				}));
				Promise.all(updates);
			}
			function onGripPointerCancel() {
				dragIdRef.current = null;
				dropIdRef.current = null;
				dragStartRef.current = null;
				setDragId(null);
				setDropId(null);
			}
			useLayoutEffect(() => {
				const prev = flipFromRef.current;
				flipFromRef.current = null;
				if (prev === null || Object.keys(prev).length === 0) return;
				for (const row of document.querySelectorAll(".dsh-notes-dock .np-item")) {
					const id = row.dataset ? row.dataset.id : void 0;
					if (id === void 0) continue;
					const before = prev[id];
					if (before === void 0) continue;
					const r = row.getBoundingClientRect();
					const dx = before.left - r.left;
					const dy = before.top - r.top;
					if (dx === 0 && dy === 0) continue;
					row.style.transition = "none";
					row.style.transform = `translate(${dx}px, ${dy}px)`;
					row.getBoundingClientRect();
					row.style.transition = "";
					row.style.transform = "";
				}
			}, [data]);
			function openDetail(item) {
				flushDetailSave();
				const draft = {
					id: item.id,
					text: item.text,
					detail: item.detail ?? ""
				};
				detailDraftRef.current = draft;
				detailDirtyRef.current = false;
				setDetailStatus("");
				detailScrollRef.current = {
					body: 0,
					ta: 0
				};
				lastDetailValueRef.current = null;
				setDetailDraft(draft);
			}
			function flushDetailSave() {
				if (detailTimerRef.current !== null) {
					clearTimeout(detailTimerRef.current);
					detailTimerRef.current = null;
				}
				const draft = detailDraftRef.current;
				if (draft === null) return;
				if (!detailDirtyRef.current) return;
				detailDirtyRef.current = false;
				const text = draft.text.trim();
				if (text === "") {
					setDetailStatus("");
					return;
				}
				setDetailStatus("已保存");
				post({
					action: "edit",
					scope: tab,
					workspaceId: workspaceArg,
					id: draft.id,
					text,
					detail: draft.detail
				});
			}
			function scheduleDetailSave() {
				detailDirtyRef.current = true;
				setDetailStatus("保存中…");
				if (detailTimerRef.current !== null) clearTimeout(detailTimerRef.current);
				detailTimerRef.current = setTimeout(() => {
					detailTimerRef.current = null;
					flushDetailSave();
				}, MEMO_DEBOUNCE_MS);
			}
			function closeDetail() {
				flushDetailSave();
				detailDraftRef.current = null;
				setDetailStatus("");
				detailScrollRef.current = {
					body: 0,
					ta: 0
				};
				lastDetailValueRef.current = null;
				setDetailDraft(null);
			}
			function onDetailInput(event) {
				const draft = detailDraftRef.current;
				if (draft === null) return;
				draft.text = event.target.value;
				setDetailDraft({ ...draft });
				scheduleDetailSave();
			}
			function onDetailTextarea(event) {
				const draft = detailDraftRef.current;
				if (draft === null) return;
				draft.detail = event.target.value;
				setDetailDraft({ ...draft });
				scheduleDetailSave();
			}
			function onDetailBodyScroll(event) {
				detailScrollRef.current.body = event.currentTarget.scrollTop;
			}
			function onDetailTaScroll(event) {
				detailScrollRef.current.ta = event.currentTarget.scrollTop;
			}
			useLayoutEffect(() => {
				const draft = detailDraft;
				if (draft === null) return;
				const ta = detailTaRef.current;
				const body = detailBodyRef.current;
				if (lastDetailValueRef.current !== draft.detail) {
					lastDetailValueRef.current = draft.detail;
					if (ta !== null) detailScrollRef.current.ta = ta.scrollTop;
					if (body !== null) detailScrollRef.current.body = body.scrollTop;
					return;
				}
				if (ta !== null && ta.scrollTop !== detailScrollRef.current.ta) ta.scrollTop = detailScrollRef.current.ta;
				if (body !== null && body.scrollTop !== detailScrollRef.current.body) body.scrollTop = detailScrollRef.current.body;
			});
			function formatTime(ms) {
				if (typeof ms !== "number" || !Number.isFinite(ms)) return "—";
				const d = new Date(ms);
				const pad = (n) => String(n).padStart(2, "0");
				return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
			}
			const dockStyle = {
				left: `${left}px`,
				top: `${top}px`,
				width: `${effWidth}px`
			};
			const scope = tab === "workspace" && data.workspace === null ? null : scopeOf(data, tab);
			const todos = scope === null ? [] : scope.todos;
			const doneCount = todos.filter((item) => item.done).length;
			const displayTodos = [...todos.filter((item) => item.pinned), ...todos.filter((item) => !item.pinned)];
			const tabs = [React.createElement("button", {
				key: "global",
				type: "button",
				className: "np-tab" + (tab === "global" ? " active" : ""),
				onClick: () => {
					if (tab !== "global") {
						saveMemoNow();
						setTab("global");
					}
				}
			}, "全局")];
			if (workspaceId !== void 0) tabs.push(React.createElement("button", {
				key: "workspace",
				type: "button",
				className: "np-tab" + (tab === "workspace" ? " active" : ""),
				title: `本工作区：${workspaceTitle ?? ""}`,
				onClick: () => {
					if (tab !== "workspace") {
						saveMemoNow();
						setTab("workspace");
					}
				}
			}, workspaceTitle ?? "本工作区"));
			const listItems = displayTodos.length === 0 ? [React.createElement("div", {
				key: "empty",
				className: "np-empty"
			}, React.createElement("div", { className: "np-empty-icon" }, React.createElement("span", { dangerouslySetInnerHTML: { __html: ICON_CHECK } })), React.createElement("p", null, "还没有待办"), React.createElement("p", { className: "sub" }, "在上方输入内容，回车即可添加"))] : displayTodos.map((item) => {
				const rowClass = "np-item" + (item.done ? " done" : "") + (item.pinned ? " pinned" : "") + (dragId === item.id ? " dragging" : "") + (dropId === item.id ? " drop-target" : "");
				return React.createElement("div", {
					key: item.id,
					"data-id": item.id,
					className: rowClass,
					title: "双击打开详情",
					onDoubleClick: (event) => {
						if (typeof event.target.closest === "function" && event.target.closest("button")) return;
						openDetail(item);
					}
				}, React.createElement("button", {
					type: "button",
					className: "np-grip",
					"data-tip": "拖拽排序",
					onPointerDown: (event) => onGripPointerDown(event, item.id),
					onPointerMove: onGripPointerMove,
					onPointerUp: onGripPointerUp,
					onPointerCancel: onGripPointerCancel,
					dangerouslySetInnerHTML: { __html: ICON_GRIP }
				}), React.createElement("button", {
					type: "button",
					className: "np-check" + (item.done ? " on" : ""),
					"data-tip": item.done ? "标记未完成" : "标记完成",
					onClick: () => toggleTodo(item),
					dangerouslySetInnerHTML: { __html: ICON_CHECK }
				}), React.createElement("div", { className: "np-text" }, item.text), React.createElement("button", {
					type: "button",
					className: "np-pin" + (item.pinned ? " on" : ""),
					"data-tip": item.pinned ? "取消置顶" : "置顶",
					onClick: () => pinTodo(item),
					dangerouslySetInnerHTML: { __html: ICON_PIN }
				}), React.createElement("button", {
					type: "button",
					className: "np-detail",
					"data-tip": "详情",
					onClick: () => openDetail(item),
					dangerouslySetInnerHTML: { __html: ICON_DETAIL }
				}), React.createElement("button", {
					type: "button",
					className: "np-del",
					"data-tip": "删除",
					onClick: () => deleteTodo(item),
					dangerouslySetInnerHTML: { __html: ICON_TRASH }
				}));
			});
			return React.createElement("div", {
				className: "dsh-notes-dock" + (viewIsChat ? "" : " view-hidden") + (covered ? " covered-hidden" : ""),
				"data-notes-ver": "312d80",
				ref: (node) => {
					rootRef.current = node;
					dockRef.current = node;
				},
				style: dockStyle,
				onMouseOver: onTipOver,
				onMouseMove: onTipMove,
				onMouseOut: onTipOut,
				onPointerDown: onDockPointerDown
			}, React.createElement("div", {
				key: "body",
				className: "dock-body"
			}, React.createElement("section", {
				key: "notes-section",
				className: "np-section"
			}, React.createElement("div", { className: "np-tabs" }, ...tabs), error === null ? null : React.createElement("div", { className: "np-error" }, "存储不可用，请检查宿主 storage 域。"), React.createElement("div", { className: "np-sec-todo" }, React.createElement("div", { className: "np-sec-head" }, React.createElement("span", { className: "np-sec-title" }, "待办"), React.createElement("span", { className: "np-sec-count" }, `共 ${todos.length} 项 · 未完成 ${todos.length - doneCount}`)), React.createElement("div", { className: "np-todo-card" }, React.createElement("div", { className: "np-input-row" }, React.createElement("input", {
				ref: inputRef,
				className: "np-input",
				placeholder: "添加待办，回车确认…",
				maxLength: 500,
				onKeyDown: (event) => {
					if (event.key === "Enter") addTodo();
				}
			}), React.createElement("button", {
				type: "button",
				className: "np-add",
				onClick: addTodo
			}, "添加")), React.createElement("div", { className: "np-list" }, ...listItems), undoInfo === null ? null : React.createElement("div", { className: "np-undo" }, React.createElement("span", null, `已删除 ${undoInfo.count} 项`), React.createElement("button", {
				type: "button",
				onClick: undoDelete
			}, "撤销")))), React.createElement("div", { className: "np-sec-memo" }, React.createElement("div", { className: "np-sec-head" }, React.createElement("span", { className: "np-sec-title" }, "随记"), React.createElement("span", { className: "np-memo-status" }, memoStatus)), React.createElement("textarea", {
				className: "np-memo",
				placeholder: "随意记录点什么…（自动保存）",
				spellCheck: false,
				value: memoText,
				onChange: onMemoInput,
				onBlur: onMemoBlur
			})), detailDraft === null ? null : React.createElement("div", {
				className: "np-detail-overlay",
				onClick: (event) => {
					if (event.target === event.currentTarget) closeDetail();
				}
			}, React.createElement("div", { className: "np-detail-card" }, React.createElement("div", { className: "np-detail-head" }, React.createElement("span", { className: "t" }, "待办详情"), detailStatus === "" ? null : React.createElement("span", { className: "np-detail-status" }, detailStatus), React.createElement("button", {
				type: "button",
				className: "np-detail-close",
				"data-tip": "关闭",
				onClick: closeDetail
			}, "×")), React.createElement("div", {
				className: "np-detail-body",
				ref: detailBodyRef,
				onScroll: onDetailBodyScroll
			}, React.createElement("div", { className: "np-detail-field" }, React.createElement("label", null, "标题"), React.createElement("input", {
				className: "np-detail-title",
				maxLength: 500,
				value: detailDraft.text,
				autoFocus: true,
				onChange: onDetailInput,
				onKeyDown: (event) => {
					if (event.key === "Escape") closeDetail();
				}
			})), React.createElement("div", { className: "np-detail-field" }, React.createElement("label", null, "描述"), React.createElement("textarea", {
				className: "np-detail-textarea",
				placeholder: "描述 / 备注（可多行）…",
				maxLength: 2e4,
				spellCheck: false,
				ref: detailTaRef,
				value: detailDraft.detail,
				onChange: onDetailTextarea,
				onScroll: onDetailTaScroll,
				onKeyDown: (event) => {
					if (event.key === "Escape") closeDetail();
				}
			})), (() => {
				const scope = scopeOf(data, tab);
				const item = scope === null ? void 0 : scope.todos.find((it) => it.id === detailDraft.id);
				if (item === void 0) return null;
				return React.createElement("div", { className: "np-detail-meta" }, React.createElement("span", null, `创建 ${formatTime(item.createdAt)}`), React.createElement("span", null, `更新 ${formatTime(item.updatedAt)}`), React.createElement("span", null, item.done ? "已完成" : "未完成"), item.pinned ? React.createElement("span", null, "已置顶") : null);
			})()))))), React.createElement("div", {
				key: "resize",
				className: "dock-resize",
				"data-tip": "拖拽调整宽度",
				onPointerDown: onResizeStart,
				onPointerMove: onResizeMove,
				onPointerUp: onResizeEnd,
				onPointerCancel: onResizeCancel
			}), React.createElement("div", {
				key: "tip",
				className: "np-tip",
				ref: tipRef,
				hidden: true
			}));
		}
		//#endregion
		module.exports = {
			name: "notes-client",
			inject: ["slots"],
			apply(ctx) {
				ctx.effect(() => {
					if (typeof document === "undefined") return;
					if (document.getElementById(STYLE_TAG_ID) !== null) return;
					const tag = document.createElement("style");
					tag.id = STYLE_TAG_ID;
					tag.dataset.plugin = "@dsh-external/dsh-notes";
					tag.textContent = DOCK_CSS;
					document.head.appendChild(tag);
					return () => {
						tag.remove();
					};
				});
				ctx.slots.inject("shell.overlay", () => ctx.slots.register({
					name: "shell.overlay",
					id: "notes-dock"
				}, (props) => React.createElement(NotesDock, props)));
			}
		};
		return module.exports;
	}
});
