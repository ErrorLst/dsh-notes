window.__ModuleLoader__.load({
	id: "@dsh-external/dsh-notes",
	factory: (require) => {
		var module = { exports: {} };
		module.exports;
		//#region src/client/index.ts
		const React = require("react");
		const { useState, useEffect, useLayoutEffect, useRef, useCallback } = React;
		const STYLE_TAG_ID = "dsh-notes-dock-style";
		const WIN_KEY = "dsh-notes.window.v1";
		const WIN_DEFAULT_W = 320;
		const WIN_DEFAULT_H = 460;
		const WIN_MIN_W = 240;
		const WIN_MIN_H = 200;
		const WIN_MARGIN = 12;
		const NOTES_CACHE_KEY = "dsh-notes.cache.v1";
		function notesCacheRead(workspaceId) {
			try {
				const hit = JSON.parse(localStorage.getItem(NOTES_CACHE_KEY) || "{}")[workspaceId ?? "global"];
				return hit && hit.data && (hit.data.global || hit.data.workspace) ? hit.data : null;
			} catch {
				return null;
			}
		}
		function notesCacheWrite(workspaceId, data) {
			try {
				const j = JSON.parse(localStorage.getItem(NOTES_CACHE_KEY) || "{}");
				j[workspaceId ?? "global"] = {
					data,
					at: Date.now()
				};
				localStorage.setItem(NOTES_CACHE_KEY, JSON.stringify(j));
			} catch {}
		}
		function winDefaults() {
			const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
			const vh = typeof window !== "undefined" ? window.innerHeight : 800;
			const w = Math.min(WIN_DEFAULT_W, Math.max(WIN_MIN_W, vw - WIN_MARGIN * 2));
			const h = Math.min(WIN_DEFAULT_H, Math.max(WIN_MIN_H, vh - WIN_MARGIN * 2));
			return {
				x: Math.max(WIN_MARGIN, vw - w - 24),
				y: 76,
				w,
				h,
				collapsed: false
			};
		}
		function clampWin(win) {
			const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
			const vh = typeof window !== "undefined" ? window.innerHeight : 800;
			const w = Math.max(WIN_MIN_W, Math.min(win.w, vw - WIN_MARGIN * 2));
			const h = Math.max(WIN_MIN_H, Math.min(win.h, vh - WIN_MARGIN * 2));
			const x = Math.max(WIN_MARGIN, Math.min(win.x, vw - w - WIN_MARGIN));
			const y = Math.max(WIN_MARGIN, Math.min(win.y, vh - h - WIN_MARGIN));
			return {
				...win,
				x,
				y,
				w,
				h
			};
		}
		function winRead() {
			try {
				const raw = JSON.parse(localStorage.getItem(WIN_KEY) || "null");
				if (raw !== null && typeof raw === "object") {
					const base = winDefaults();
					const num = (value, fallback) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
					return clampWin({
						x: num(raw.x, base.x),
						y: num(raw.y, base.y),
						w: num(raw.w, base.w),
						h: num(raw.h, base.h),
						collapsed: raw.collapsed === true
					});
				}
			} catch {}
			return winDefaults();
		}
		function winWrite(win) {
			try {
				localStorage.setItem(WIN_KEY, JSON.stringify(win));
			} catch {}
		}
		const MEMO_DEBOUNCE_MS = 600;
		const UNDO_TTL_MS = 5e3;
		const ICON_CHECK = "<svg viewBox=\"0 0 12 12\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M2.5 6.5L5 9l4.5-6\"/></svg>";
		const ICON_TRASH = "<svg viewBox=\"0 0 14 14\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.3\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M2 4h10M5.5 4V2.8A.8.8 0 016.3 2h1.4a.8.8 0 01.8.8V4M3.5 4l.6 7a1 1 0 001 1h3.8a1 1 0 001-1l.6-7\"/><path d=\"M6 6.5v3M8 6.5v3\"/></svg>";
		const ICON_PIN = "<svg viewBox=\"0 0 14 14\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.4\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M8.6 1.4l4 4-1.4 1.4-1.2-.6-2.2 2.2.6 1.2-1.4 1.4-3-3L3.4 9l-.8-.8 2.6-2.6-1.2-.6 1.4-1.4 1.2.6 2.2-2.2-.6-1.2 1.4-1.4z\"/></svg>";
		const ICON_GRIP = "<svg viewBox=\"0 0 10 16\" fill=\"currentColor\"><circle cx=\"2.5\" cy=\"2.5\" r=\"1.4\"/><circle cx=\"7.5\" cy=\"2.5\" r=\"1.4\"/><circle cx=\"2.5\" cy=\"8\" r=\"1.4\"/><circle cx=\"7.5\" cy=\"8\" r=\"1.4\"/><circle cx=\"2.5\" cy=\"13.5\" r=\"1.4\"/><circle cx=\"7.5\" cy=\"13.5\" r=\"1.4\"/></svg>";
		const ICON_DETAIL = "<svg viewBox=\"0 0 14 14\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.3\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M2.5 1.8h9v10.4h-9z\"/><path d=\"M5 4.6h4M5 7h4M5 9.4h2.5\"/></svg>";
		const ICON_CHEVRON = "<svg viewBox=\"0 0 14 14\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M3.5 5.5L7 9l3.5-3.5\"/></svg>";
		const DOCK_CSS = `
.dsh-notes-dock {
  position: fixed;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--dsw-alias-bg-layer-1);
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 12px;
  overflow: hidden;
  box-shadow: var(--dsh-notes-shadow);
  z-index: 30;
  -webkit-app-region: no-drag;
  font-family: var(--dsw-font-family);
  /* 字体随会话设置（ui-theme.fontSize）：12px 基准 + 会话 delta，1:1 跟随。
     次要文字档 --dsh-notes-font-base-secondary：rc.1 起官方提供二级字号级联
     （--dsh-content-font-delta-secondary，低一档文本统一读它），竖栏内计数/
     tab/tip/状态等次要文字改挂此档；旧宿主无该令牌时回退主 delta，行为同 0.7.12。
     默认字号（14px）下二级 delta = 0，两档基准相同，视觉基线不变。 */
  --dsh-notes-font-base: calc(12px + var(--dsh-content-font-delta, 0px));
  --dsh-notes-font-base-secondary: calc(12px + var(--dsh-content-font-delta-secondary, var(--dsh-content-font-delta, 0px)));
  font-size: calc(var(--dsh-notes-font-base) * 1);
  color: var(--dsw-alias-label-primary);
  box-sizing: border-box;
  --dsh-notes-shadow: 0 8px 28px rgba(15, 17, 21, 0.14), 0 2px 8px rgba(15, 17, 21, 0.08);
}
body[data-ds-dark-theme] .dsh-notes-dock {
  --dsh-notes-shadow: 0 8px 28px rgba(0, 0, 0, 0.5), 0 2px 8px rgba(0, 0, 0, 0.3);
}
/* 拖拽移动中：禁止文本选择，避免跟手时选中标题文字 */
.dsh-notes-dock.dragging { user-select: none; }
.dsh-notes-dock.dragging .dock-header { cursor: grabbing; }
/* 复位规则用 :where() 保证零特异性，绝不覆盖任何组件类样式 */
:where(.dsh-notes-dock) button { font-family: inherit; font-size: inherit; border: none; background: none; color: inherit; cursor: pointer; }
:where(.dsh-notes-dock) input { font-family: inherit; font-size: inherit; color: inherit; }
:where(.dsh-notes-dock) textarea { font-family: inherit; font-size: inherit; color: inherit; }
:where(.dsh-notes-dock) select { font-family: inherit; font-size: inherit; color: inherit; }
/* 输入类元素关闭字体连字：代码字体（JetBrains Mono / Fira Code / Cascadia）
   会把 // 渲染成合并字形，看起来像「第一个 / 被透明」（//w 显示成 /w）。 */
:where(.dsh-notes-dock) input,
:where(.dsh-notes-dock) textarea {
  font-variant-ligatures: none;
  font-feature-settings: "liga" 0, "calt" 0, "dlig" 0;
}

.dock-body { display: flex; flex-direction: column; min-height: 0; flex: 1; }

/* ===== 浮动窗口外壳：标题栏（拖拽）/ 视图页签 / 内容 ===== */
.dock-header {
  display: flex; align-items: center; gap: 6px; flex: none;
  height: 38px;
  padding: 0 8px 0 12px;
  background: var(--dsw-alias-bg-layer-2);
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  cursor: grab;
  touch-action: none;
}
.dock-title {
  flex: none;
  font-size: calc(var(--dsh-notes-font-base) * 0.9583);
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--dsw-alias-label-secondary);
  user-select: none;
  -webkit-user-select: none;
}
.dock-scopes { display: flex; gap: 2px; align-items: center; margin-left: auto; min-width: 0; }
.dock-scope {
  padding: 2px 8px;
  border-radius: 999px;
  font-size: calc(var(--dsh-notes-font-base-secondary) * 0.9167);
  color: var(--dsw-alias-label-secondary);
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: background var(--ds-transition-duration-fast, 0.1s) var(--ds-ease-in-out, ease);
}
.dock-scope:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dock-scope.active { background: var(--dsw-alias-button-ghost-active-fill); color: var(--dsw-alias-label-primary); font-weight: 500; }
.dock-actions { display: flex; gap: 2px; flex: none; }
.dock-icon-btn {
  width: 22px; height: 22px;
  border-radius: 6px;
  color: var(--dsw-alias-label-tertiary);
  display: inline-flex; align-items: center; justify-content: center;
  transition: background var(--ds-transition-duration-fast, 0.1s) var(--ds-ease-in-out, ease);
}
.dock-icon-btn:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dock-icon-btn svg { width: 13px; height: 13px; }
.dock-icon-btn.expand svg { transform: rotate(180deg); }
/* 折叠态：只剩标题条（高度由内容撑开，宽度与位置保留） */
.dsh-notes-dock.collapsed .dock-header { border-bottom: none; }
.dock-badge {
  flex: none;
  margin-left: auto;
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-secondary);
  font-size: calc(var(--dsh-notes-font-base-secondary) * 0.875);
  white-space: nowrap;
}
.dock-badge.zero { opacity: 0.55; }

/* ===== 两个独立页签：待办 / 随记 ===== */
.dock-tabs {
  display: flex; gap: 4px; align-items: center; flex: none;
  padding: 6px 10px;
  background: var(--dsw-alias-bg-layer-1);
  border-bottom: 1px solid var(--dsw-alias-border-l1);
}
.dock-tab {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 4px 10px;
  border-radius: 7px;
  font-size: calc(var(--dsh-notes-font-base) * 0.9583);
  color: var(--dsw-alias-label-secondary);
  transition: background var(--ds-transition-duration-fast, 0.1s) var(--ds-ease-in-out, ease);
}
.dock-tab:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dock-tab.active { background: var(--dsw-alias-button-ghost-active-fill); color: var(--dsw-alias-label-primary); font-weight: 500; }
.dock-tab .n {
  padding: 0 6px;
  border-radius: 999px;
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-tertiary);
  font-size: calc(var(--dsh-notes-font-base-secondary) * 0.8333);
  line-height: 16px;
}
.dock-tab.active .n { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); }

.np-error {
  margin: 4px 12px 0;
  padding: 5px 10px;
  border-radius: 8px;
  background: var(--dsw-alias-interactive-bg-hover-danger);
  color: var(--dsw-alias-state-error-primary);
  font-size: calc(var(--dsh-notes-font-base-secondary) * 0.9583);
}

/* 页签面板：一次只挂载一个（待办 / 随记） */
.np-panel { flex: 1; min-height: 0; display: flex; flex-direction: column; position: relative; }
.np-sec-head { display: flex; align-items: baseline; gap: 8px; flex: none; padding: 8px 12px 4px; }
/* 头部行：单行不断行；计数可压缩（超窄省略号），标题/清空按钮恒定不压缩 */
.np-sec-head > * { white-space: nowrap; }
.np-sec-title { flex-shrink: 0; }
.np-clear { flex-shrink: 0; }
.np-sec-count { flex-shrink: 1; min-width: 40px; overflow: hidden; text-overflow: ellipsis; }
.np-sec-title { font-size: calc(var(--dsh-notes-font-base-secondary) * 0.875); font-weight: 600; letter-spacing: 0.04em; color: var(--dsw-alias-label-tertiary); }
.np-sec-count { font-size: calc(var(--dsh-notes-font-base-secondary) * 0.875); color: var(--dsw-alias-label-tertiary); }
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
.np-detail-field label { font-size: calc(var(--dsh-notes-font-base-secondary) * 0.9167); color: var(--dsw-alias-label-tertiary); }
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
  font-size: calc(var(--dsh-notes-font-base-secondary) * 0.875);
  color: var(--dsw-alias-label-tertiary);
}
.np-detail-status { font-size: calc(var(--dsh-notes-font-base-secondary) * 0.875); color: var(--dsw-alias-label-tertiary); }
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
.np-empty .sub { font-size: calc(var(--dsh-notes-font-base-secondary) * 0.875); color: var(--dsw-alias-label-tertiary); }

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
  font-size: calc(var(--dsh-notes-font-base-secondary) * 0.9583);
  color: var(--dsw-alias-label-secondary);
}
.np-undo button {
  margin-left: auto;
  font-size: calc(var(--dsh-notes-font-base-secondary) * 0.9583);
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
  font-size: calc(var(--dsh-notes-font-base-secondary) * 0.9167);
  line-height: 1.4;
  color: var(--dsw-alias-label-primary);
  white-space: nowrap;
  pointer-events: none;
}
.np-tip[hidden] { display: none; }

.np-memo-status { font-size: calc(var(--dsh-notes-font-base-secondary) * 0.875); color: var(--dsw-alias-label-tertiary); margin-left: auto; }
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


/* ===== 尺寸手柄：右缘 / 下缘 / 右下角（自由调整窗口大小） ===== */
.dock-resize-r, .dock-resize-b, .dock-resize-se { position: absolute; z-index: 6; touch-action: none; }
.dock-resize-r { top: 8px; right: 0; bottom: 14px; width: 5px; cursor: col-resize; }
.dock-resize-b { left: 8px; right: 14px; bottom: 0; height: 5px; cursor: row-resize; }
.dock-resize-se { right: 0; bottom: 0; width: 14px; height: 14px; cursor: nwse-resize; }
.dock-resize-r:hover, .dock-resize-b:hover { background: var(--dsw-alias-state-business-primary); opacity: .35; }
.dock-resize-se::after {
  content: ''; position: absolute; right: 3px; bottom: 3px; width: 7px; height: 7px;
  border-right: 2px solid var(--dsw-alias-label-tertiary);
  border-bottom: 2px solid var(--dsw-alias-label-tertiary);
  border-bottom-right-radius: 3px;
  opacity: 0.45;
  transition: opacity var(--ds-transition-duration-fast, 0.12s) var(--ds-ease-in-out, ease);
}
.dock-resize-se:hover::after, .dsh-notes-dock.dragging .dock-resize-se::after { opacity: 0.9; }


/* ===== 悬浮迷你滚动条（dock 内所有滚动区）：仅滚动/悬停时显示，非必要隐藏 =====
   随记 textarea 与详情卡片一并纳入：Windows 默认滚动条是 15~17px 的实心宽条，
   连轨道一起吃掉正文宽度；这里统一换成 6px 细轨道 + 内缩 1px 的 4px 圆头胶囊，
   与宿主 ui-tool 卡片内滚动区同一套做法（padding-box 裁切 + 透明边内缩），
   拇指不贴圆角边缘，也不会因 .scr-on 切换而变宽。
   scrollbar-gutter: stable 让这 6px 恒定预留：内容从「不溢出」变为「溢出」时
   正文不再横向重排（否则每跨过一次阈值都抖一下）。 */
.dsh-notes-dock :is(.np-list, .np-memo, .np-detail-body, .np-detail-textarea) {
  scrollbar-gutter: stable;
}
.dsh-notes-dock :is(.np-list, .np-memo, .np-detail-body, .np-detail-textarea)::-webkit-scrollbar {
  width: 6px;
  height: 6px;
  background: transparent;
}
/* 轨道与角落一律透明：细条只在拇指处显形，不画底 */
.dsh-notes-dock :is(.np-list, .np-memo, .np-detail-body, .np-detail-textarea)::-webkit-scrollbar-track {
  background: transparent;
  /* 拇指行程两端各留 3px，避开 8px 圆角——否则胶囊两端会被圆角切掉 */
  margin: 3px 0;
}
.dsh-notes-dock :is(.np-list, .np-memo, .np-detail-body, .np-detail-textarea)::-webkit-scrollbar-corner {
  background: transparent;
}
/* 拇指：1px 透明边 + padding-box 裁切 = 距轨道两侧各 1px 的 4px 圆头胶囊。
   只改 background-color（不用 background 简写，避免把裁切重置回 border-box
   导致显形瞬间变宽）。颜色走 ui-theme 的官方间接层 --dsh-scrollbar-thumb
   （高层级表面可自行 rebind 成 l2），旧 token 作 fallback。 */
.dsh-notes-dock :is(.np-list, .np-memo, .np-detail-body, .np-detail-textarea)::-webkit-scrollbar-thumb {
  background-color: transparent;
  border: 1px solid transparent;
  background-clip: padding-box;
  border-radius: 999px;
  transition: background-color 0.18s var(--ds-ease-in-out, ease);
}
.dsh-notes-dock :is(.np-list, .np-memo, .np-detail-body, .np-detail-textarea).scr-on::-webkit-scrollbar-thumb {
  background-color: var(--dsh-scrollbar-thumb, var(--dsw-alias-scrollbar-bg-l1));
}
.dsh-notes-dock :is(.np-list, .np-memo, .np-detail-body, .np-detail-textarea).scr-on::-webkit-scrollbar-thumb:hover {
  background-color: var(--dsh-scrollbar-thumb-hover, var(--dsw-alias-scrollbar-hover-l1));
}
`;
		function scopeOf(data, tab) {
			return tab === "global" ? data.global : data.workspace;
		}
		function mainSessionIdOf(state) {
			for (const id of state.ids) {
				const row = state.byId[id];
				if (row !== void 0 && (row.retainedBy?.mainView ?? 0) > 0) return id;
			}
			return state.current;
		}
		function NotesDock(props) {
			const useWorkspaces = props.useWorkspaces;
			const useSessions = props.useSessions;
			const currentSessionId = useSessions ? useSessions((state) => mainSessionIdOf(state)) : void 0;
			const currentCwd = useSessions ? useSessions((state) => {
				const id = mainSessionIdOf(state);
				return id !== void 0 ? state.byId[id]?.cwd : void 0;
			}) : void 0;
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
			const workspaceId = workspaceBySession ?? workspaceByCwd;
			const workspaceTitle = useWorkspaces ? useWorkspaces((state) => state.items.find((item) => item.workspaceId === workspaceId)?.title) : void 0;
			const rootRef = useRef(null);
			const dockRef = useRef(null);
			const inputRef = useRef(null);
			const [win, setWin] = useState(() => winRead());
			const winRef = useRef(win);
			winRef.current = win;
			const [moving, setMoving] = useState(false);
			const [view, setView] = useState("todo");
			const moveRef = useRef(null);
			const sizeRef = useRef(null);
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
			const lastTypedAtRef = useRef(0);
			const [memoStatus, setMemoStatus] = useState("");
			const memoTextRef = useRef("");
			const dirtyRef = useRef(false);
			const memoTimerRef = useRef(null);
			const dataForRef = useRef(null);
			const boundKeyRef = useRef(null);
			const boundDataRef = useRef(null);
			const memoTaRef = useRef(null);
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
				const onWindowResize = () => setWin((prev) => clampWin(prev));
				window.addEventListener("resize", onWindowResize);
				return () => window.removeEventListener("resize", onWindowResize);
			}, []);
			useEffect(() => {
				winWrite(win);
			}, [win]);
			function toggleCollapsed() {
				if (detailDraftRef.current !== null) closeDetail();
				setWin((prev) => ({
					...prev,
					collapsed: !prev.collapsed
				}));
			}
			function onHeaderPointerDown(event) {
				if (event.pointerType === "mouse" && event.button !== 0) return;
				const target = event.target;
				if (target instanceof Element && target.closest("button") !== null) return;
				event.preventDefault();
				hideTip();
				const current = winRef.current;
				moveRef.current = {
					dx: event.clientX - current.x,
					dy: event.clientY - current.y
				};
				setMoving(true);
				try {
					event.currentTarget.setPointerCapture(event.pointerId);
				} catch {}
			}
			function onHeaderPointerMove(event) {
				if (moveRef.current === null) return;
				const { dx, dy } = moveRef.current;
				setWin((prev) => clampWin({
					...prev,
					x: event.clientX - dx,
					y: event.clientY - dy
				}));
			}
			function onHeaderPointerUp(event) {
				if (moveRef.current === null) return;
				moveRef.current = null;
				setMoving(false);
				try {
					event.currentTarget.releasePointerCapture(event.pointerId);
				} catch {}
			}
			function onHeaderDoubleClick(event) {
				const target = event.target;
				if (target instanceof Element && target.closest("button") !== null) return;
				toggleCollapsed();
			}
			function onSizePointerDown(event) {
				if (event.pointerType === "mouse" && event.button !== 0) return;
				event.preventDefault();
				hideTip();
				const current = winRef.current;
				sizeRef.current = {
					axis: event.currentTarget.dataset.axis || "xy",
					x0: event.clientX,
					y0: event.clientY,
					w0: current.w,
					h0: current.h
				};
				try {
					event.currentTarget.setPointerCapture(event.pointerId);
				} catch {}
			}
			function onSizePointerMove(event) {
				const session = sizeRef.current;
				if (session === null) return;
				setWin((prev) => clampWin({
					...prev,
					w: session.axis.indexOf("x") >= 0 ? session.w0 + (event.clientX - session.x0) : prev.w,
					h: session.axis.indexOf("y") >= 0 ? session.h0 + (event.clientY - session.y0) : prev.h
				}));
			}
			function onSizePointerUp(event) {
				if (sizeRef.current === null) return;
				sizeRef.current = null;
				try {
					event.currentTarget.releasePointerCapture(event.pointerId);
				} catch {}
			}
			useEffect(() => {
				let alive = true;
				const cached = notesCacheRead(workspaceId);
				if (cached !== null && alive) {
					dataForRef.current = workspaceId ?? null;
					setData(cached);
					setError(null);
				}
				const load = () => {
					const query = workspaceId !== void 0 ? `?workspaceId=${encodeURIComponent(workspaceId)}` : "";
					fetch(`/api/dsh-notes${query}`, { cache: "no-store" }).then((response) => response.json()).then((result) => {
						if (!alive) return;
						if (result.ok === true) {
							const next = {
								global: result.global,
								workspace: result.workspace
							};
							dataForRef.current = workspaceId ?? null;
							setData(next);
							setError(null);
							notesCacheWrite(workspaceId, next);
						} else setError(result.error ?? "load-failed");
					}).catch(() => {
						if (alive) setError("network");
					});
				};
				load();
				let focusTimer = null;
				const onFocus = () => {
					if (focusTimer !== null) clearTimeout(focusTimer);
					focusTimer = setTimeout(load, 300);
				};
				window.addEventListener("focus", onFocus);
				return () => {
					alive = false;
					if (focusTimer !== null) clearTimeout(focusTimer);
					window.removeEventListener("focus", onFocus);
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
				lastTypedAtRef.current = Date.now();
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
				const scope = tab === "global" ? data.global : data.workspace;
				if (scope === null) return;
				if (Date.now() - lastTypedAtRef.current < 2e3) return;
				if (memoTaRef.current !== null && document.activeElement === memoTaRef.current) return;
				const keyChanged = boundKeyRef.current !== effectiveKey;
				if (boundDataRef.current === data) {
					if (keyChanged) {
						boundKeyRef.current = effectiveKey;
						boundDataRef.current = null;
						setMemoText("");
						memoTextRef.current = "";
						dirtyRef.current = false;
						setMemoStatus("");
					}
					return;
				}
				boundKeyRef.current = effectiveKey;
				boundDataRef.current = data;
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
				const SCROLLERS = ".np-list, .np-memo, .np-detail-body, .np-detail-textarea";
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
					for (const el of Array.from(root.querySelectorAll(SCROLLERS))) {
						if (el.dataset.scrHooked === "1") continue;
						el.dataset.scrHooked = "1";
						el.addEventListener("scroll", onScroll, { passive: true });
						el.addEventListener("mouseenter", onEnter);
						el.addEventListener("mouseleave", onLeave);
					}
				};
				attach();
				let observer = null;
				if (typeof MutationObserver !== "undefined") {
					observer = new MutationObserver(attach);
					observer.observe(root, {
						childList: true,
						subtree: true
					});
				}
				return () => {
					if (observer !== null) observer.disconnect();
					for (const el of Array.from(root.querySelectorAll(SCROLLERS))) {
						if (el.dataset.scrHooked !== "1") continue;
						el.dataset.scrHooked = "0";
						el.removeEventListener("scroll", onScroll);
						el.removeEventListener("mouseenter", onEnter);
						el.removeEventListener("mouseleave", onLeave);
					}
					for (const t of timers.values()) clearTimeout(t);
				};
			}, []);
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
			const winStyle = {
				left: `${win.x}px`,
				top: `${win.y}px`,
				width: `${win.w}px`,
				height: win.collapsed ? "auto" : `${win.h}px`
			};
			const scope = tab === "workspace" && data.workspace === null ? null : scopeOf(data, tab);
			const todos = scope === null ? [] : scope.todos;
			const doneCount = todos.filter((item) => item.done).length;
			const pendingCount = todos.length - doneCount;
			const displayTodos = [...todos.filter((item) => item.pinned), ...todos.filter((item) => !item.pinned)];
			const scopeTabs = [React.createElement("button", {
				key: "global",
				type: "button",
				className: "dock-scope" + (tab === "global" ? " active" : ""),
				onClick: () => {
					if (tab !== "global") {
						saveMemoNow();
						setTab("global");
					}
				}
			}, "全局")];
			if (workspaceId !== void 0) scopeTabs.push(React.createElement("button", {
				key: "workspace",
				type: "button",
				className: "dock-scope" + (tab === "workspace" ? " active" : ""),
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
				className: "dsh-notes-dock" + (win.collapsed ? " collapsed" : "") + (moving ? " dragging" : ""),
				"data-notes-ver": "8a1f00",
				ref: (node) => {
					rootRef.current = node;
					dockRef.current = node;
				},
				style: winStyle,
				onMouseOver: onTipOver,
				onMouseMove: onTipMove,
				onMouseOut: onTipOut,
				onPointerDown: onDockPointerDown
			}, React.createElement("div", {
				key: "header",
				className: "dock-header",
				onPointerDown: onHeaderPointerDown,
				onPointerMove: onHeaderPointerMove,
				onPointerUp: onHeaderPointerUp,
				onPointerCancel: onHeaderPointerUp,
				onDoubleClick: onHeaderDoubleClick
			}, React.createElement("span", {
				key: "title",
				className: "dock-title"
			}, "小计"), win.collapsed ? React.createElement("span", {
				key: "badge",
				className: "dock-badge" + (pendingCount === 0 ? " zero" : "")
			}, `待办 ${pendingCount}`) : React.createElement("span", {
				key: "scopes",
				className: "dock-scopes"
			}, ...scopeTabs), React.createElement("span", {
				key: "actions",
				className: "dock-actions"
			}, React.createElement("button", {
				type: "button",
				className: "dock-icon-btn" + (win.collapsed ? " expand" : ""),
				"data-tip": win.collapsed ? "展开小计" : "折叠小计",
				onClick: toggleCollapsed,
				dangerouslySetInnerHTML: { __html: ICON_CHEVRON }
			}))), win.collapsed ? null : React.createElement("div", {
				key: "tabs",
				className: "dock-tabs"
			}, React.createElement("button", {
				type: "button",
				className: "dock-tab" + (view === "todo" ? " active" : ""),
				onClick: () => {
					saveMemoNow();
					setView("todo");
				}
			}, "待办", React.createElement("span", { className: "n" }, String(pendingCount))), React.createElement("button", {
				type: "button",
				className: "dock-tab" + (view === "memo" ? " active" : ""),
				onClick: () => setView("memo")
			}, "随记")), win.collapsed ? null : React.createElement("div", {
				key: "body",
				className: "dock-body"
			}, error === null ? null : React.createElement("div", { className: "np-error" }, "存储不可用，请检查宿主 storage 域。"), view === "todo" ? React.createElement("div", {
				key: "todo",
				className: "np-panel"
			}, React.createElement("div", { className: "np-sec-head" }, React.createElement("span", { className: "np-sec-title" }, "待办"), React.createElement("span", { className: "np-sec-count" }, `共 ${todos.length} 项 · 未完成 ${pendingCount}`)), React.createElement("div", { className: "np-todo-card" }, React.createElement("div", { className: "np-input-row" }, React.createElement("input", {
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
			}, "撤销")))) : React.createElement("div", {
				key: "memo",
				className: "np-panel"
			}, React.createElement("div", { className: "np-sec-head" }, React.createElement("span", { className: "np-sec-title" }, "随记"), React.createElement("span", { className: "np-memo-status" }, memoStatus)), React.createElement("textarea", {
				className: "np-memo",
				ref: memoTaRef,
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
			})())))), win.collapsed ? null : React.createElement("div", {
				key: "resize-r",
				className: "dock-resize-r",
				"data-axis": "x",
				onPointerDown: onSizePointerDown,
				onPointerMove: onSizePointerMove,
				onPointerUp: onSizePointerUp,
				onPointerCancel: onSizePointerUp
			}), win.collapsed ? null : React.createElement("div", {
				key: "resize-b",
				className: "dock-resize-b",
				"data-axis": "y",
				onPointerDown: onSizePointerDown,
				onPointerMove: onSizePointerMove,
				onPointerUp: onSizePointerUp,
				onPointerCancel: onSizePointerUp
			}), win.collapsed ? null : React.createElement("div", {
				key: "resize-se",
				className: "dock-resize-se",
				"data-axis": "xy",
				onPointerDown: onSizePointerDown,
				onPointerMove: onSizePointerMove,
				onPointerUp: onSizePointerUp,
				onPointerCancel: onSizePointerUp
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
