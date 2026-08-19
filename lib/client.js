window.__ModuleLoader__.load({
	id: "@dsh-external/dsh-notes",
	factory: (require) => {
		var module = { exports: {} };
		module.exports;
		let marked = require("marked");
		//#region src/client/index.ts
		const React = require("react");
		const { useState, useEffect, useLayoutEffect, useRef, useCallback } = React;
		let MarkdownText = null;
		try {
			const primitives = require("@deepseek-ai/dsh-client-ui-primitives");
			if (primitives !== null && typeof primitives === "object" && typeof primitives.MarkdownText === "function") MarkdownText = primitives.MarkdownText;
		} catch (error) {
			console.warn("[dsh-notes] 官方 MarkdownText 不可用，使用内置渲染器", error);
		}
		const MD_LABELS = {
			copyLabel: "复制",
			copiedLabel: "已复制"
		};
		let markedParse = null;
		try {
			if (typeof marked.marked === "function" && typeof marked.Renderer === "function") {
				const escapeHtml = (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
				markedParse = (text) => {
					const renderer = new marked.Renderer();
					renderer.html = function(token) {
						return escapeHtml((token && (token.raw ?? token.text)) ?? "");
					};
					renderer.link = function(token) {
						const href = token && token.href;
						const label = this.parser && typeof this.parser.parseInline === "function" ? this.parser.parseInline(token.tokens) : escapeHtml((token && (token.text ?? token.raw)) ?? "");
						if (typeof href === "string" && /^(https?:|mailto:)/i.test(href)) return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
						return escapeHtml((token && token.raw) ?? "");
					};
					renderer.image = function(token) {
						const href = token && token.href;
						if (typeof href === "string" && /^https?:/i.test(href)) return `<img src="${escapeHtml(href)}" alt="${escapeHtml((token && (token.text ?? "")) ?? "")}" />`;
						return escapeHtml((token && token.raw) ?? "");
					};
					return (0, marked.marked)(text, {
						gfm: true,
						breaks: true,
						renderer
					});
				};
			}
		} catch {}
		const STYLE_TAG_ID = "dsh-notes-dock-style";
		const COLLAPSED_KEY = "dsh-notes.collapsed";
		const SPLIT_KEY = "dsh-notes.split";
		const SPLIT_DEFAULT = 46;
		const SPLIT_MIN = 25;
		const SPLIT_MAX = 75;
		const WIDTH_KEY = "dsh-notes.width";
		const WIDTH_DEFAULT = 280;
		const WIDTH_MIN = 220;
		const WIDTH_MAX = 480;
		const MEMO_DEBOUNCE_MS = 600;
		const UNDO_TTL_MS = 5e3;
		const POLL_RUNNING_MS = 400;
		const POLL_IDLE_MS = 3e3;
		const ICON_CHECK = "<svg viewBox=\"0 0 12 12\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M2.5 6.5L5 9l4.5-6\"/></svg>";
		const ICON_TRASH = "<svg viewBox=\"0 0 14 14\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.3\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M2 4h10M5.5 4V2.8A.8.8 0 016.3 2h1.4a.8.8 0 01.8.8V4M3.5 4l.6 7a1 1 0 001 1h3.8a1 1 0 001-1l.6-7\"/><path d=\"M6 6.5v3M8 6.5v3\"/></svg>";
		const ICON_PIN = "<svg viewBox=\"0 0 14 14\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.4\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M8.6 1.4l4 4-1.4 1.4-1.2-.6-2.2 2.2.6 1.2-1.4 1.4-3-3L3.4 9l-.8-.8 2.6-2.6-1.2-.6 1.4-1.4 1.2.6 2.2-2.2-.6-1.2 1.4-1.4z\"/></svg>";
		const ICON_COLLAPSE = "<svg viewBox=\"0 0 12 12\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M2 4.5L6 8.5l4-4\"/></svg>";
		const ICON_EXPAND = "<svg viewBox=\"0 0 12 12\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M2 7.5L6 3.5l4 4\"/></svg>";
		const ICON_GRIP = "<svg viewBox=\"0 0 10 16\" fill=\"currentColor\"><circle cx=\"2.5\" cy=\"2.5\" r=\"1.4\"/><circle cx=\"7.5\" cy=\"2.5\" r=\"1.4\"/><circle cx=\"2.5\" cy=\"8\" r=\"1.4\"/><circle cx=\"7.5\" cy=\"8\" r=\"1.4\"/><circle cx=\"2.5\" cy=\"13.5\" r=\"1.4\"/><circle cx=\"7.5\" cy=\"13.5\" r=\"1.4\"/></svg>";
		const ICON_GEAR = "<svg viewBox=\"0 0 12 12\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"6\" cy=\"6\" r=\"1.8\"/><path d=\"M6 1.2v1.6M6 9.2v1.6M1.2 6h1.6M9.2 6h1.6M2.7 2.7l1.1 1.1M8.2 8.2l1.1 1.1M2.7 9.3l1.1-1.1M8.2 3.8l1.1-1.1\"/></svg>";
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
.sc-msg.assistant { align-self: flex-start; max-width: 96%; }
.sc-msg.assistant .bubble {
  background: var(--dsw-alias-bg-layer-2);
  border-radius: 10px 10px 10px 3px;
  padding: 5px 10px;
  white-space: normal; /* Markdown 渲染自行处理排版 */
  min-width: 0;
}
.sc-msg.assistant .bubble .sc-plain { white-space: pre-wrap; word-break: break-word; }

/* 内置 Markdown 渲染排版（官方 MarkdownText 不可用时的兜底） */
.dsh-notes-md {
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--dsw-alias-label-primary);
  overflow-wrap: anywhere;
}
.dsh-notes-md > :first-child { margin-top: 0; }
.dsh-notes-md > :last-child { margin-bottom: 0; }
.dsh-notes-md p { margin: 0 0 6px; }
.dsh-notes-md h1, .dsh-notes-md h2, .dsh-notes-md h3, .dsh-notes-md h4, .dsh-notes-md h5, .dsh-notes-md h6 {
  margin: 8px 0 4px;
  line-height: 1.35;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}
.dsh-notes-md h1 { font-size: 15px; }
.dsh-notes-md h2 { font-size: 14px; }
.dsh-notes-md h3 { font-size: 13px; }
.dsh-notes-md h4, .dsh-notes-md h5, .dsh-notes-md h6 { font-size: 12.5px; }
.dsh-notes-md ul, .dsh-notes-md ol { margin: 0 0 6px; padding-left: 18px; }
.dsh-notes-md li { margin: 1px 0; }
.dsh-notes-md code {
  font-family: var(--ds-font-family-code, monospace);
  font-size: 11px;
  background: var(--dsw-alias-bg-overlay);
  border-radius: 4px;
  padding: 1px 4px;
  color: var(--dsw-alias-label-secondary);
}
.dsh-notes-md pre {
  margin: 4px 0 8px;
  padding: 8px 10px;
  background: var(--dsw-alias-markdown-code-block, var(--dsw-alias-bg-overlay));
  border-radius: 8px;
  overflow-x: auto;
}
.dsh-notes-md pre code { background: none; padding: 0; font-size: 11px; line-height: 1.55; }
.dsh-notes-md blockquote {
  margin: 4px 0 8px;
  padding: 2px 0 2px 10px;
  border-left: 2px solid var(--dsw-alias-border-l2);
  color: var(--dsw-alias-label-secondary);
}
.dsh-notes-md a { color: var(--dsw-alias-state-business-primary); text-decoration: underline; text-underline-offset: 2px; }
.dsh-notes-md table { border-collapse: collapse; margin: 4px 0 8px; max-width: 100%; display: block; overflow-x: auto; }
.dsh-notes-md th, .dsh-notes-md td { border: 1px solid var(--dsw-alias-border-l2); padding: 3px 8px; font-size: 12px; }
.dsh-notes-md th { background: var(--dsw-alias-bg-layer-2); font-weight: 600; }
.dsh-notes-md hr { border: none; border-top: 1px solid var(--dsw-alias-border-l2); margin: 8px 0; }
.dsh-notes-md img { max-width: 100%; border-radius: 6px; }
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

/* 运行中状态行：官方 turnStatus 同款流光（品牌渐变 + background-clip 文字） */
.sc-streaming-status {
  align-self: flex-start;
  height: 26px;
  font-size: 13px;
  font-weight: 600;
  line-height: 26px;
  white-space: nowrap;
  background: linear-gradient(90deg,
    var(--dsw-alias-state-business-primary) 0%,
    var(--dsw-alias-state-business-primary) 40%,
    var(--dsw-alias-brand-primary) 50%,
    var(--dsw-alias-state-business-primary) 60%,
    var(--dsw-alias-state-business-primary) 100%);
  background-size: 250% 100%;
  background-position: 100% 0;
  color: transparent;
  -webkit-background-clip: text;
  background-clip: text;
  animation: dsh-notes-shimmer 1.8s linear infinite;
}
@keyframes dsh-notes-shimmer { to { background-position: 0 0; } }

/* 新消息进场（瀑布流）：轻微上浮淡入；流式行 key 稳定不重复触发 */
.sc-msg, .ds-turn-error { animation: dsh-notes-rise 0.18s ease-out; }
@keyframes dsh-notes-rise {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: none; }
}
@media (prefers-reduced-motion: reduce) {
  .sc-streaming-status { background-position: 0 0; background-size: 100% 100%; animation: none; }
  .sc-msg, .ds-turn-error { animation: none; }
}
.sc-empty { align-self: center; margin: auto; color: var(--dsw-alias-label-tertiary); font-size: 12px; }

/* 历史轮次折叠行（多轮对话时之前的轮次折叠，点击弹出记录卡片） */
.sc-history {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2);
  cursor: pointer;
  font-size: 11.5px;
  line-height: 1.4;
  min-width: 0;
  transition: background var(--ds-transition-duration-fast, 0.1s) var(--ds-ease-in-out, ease);
}
.sc-history:hover { background: var(--dsw-alias-interactive-bg-hover); }
.sc-history-label { flex: none; font-weight: 500; color: var(--dsw-alias-state-business-primary); }
.sc-history-preview {
  flex: 1;
  min-width: 0;
  color: var(--dsw-alias-label-secondary);
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow: hidden;
}
.sc-history-chev { flex: none; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 1; }

/* 历史轮次记录卡片（覆盖常驻会话区域，毛玻璃） */
.sc-history-overlay {
  position: absolute;
  inset: 0;
  z-index: 40;
  background: transparent;
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 10px;
}
.sc-history-card {
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
.sc-history-card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
  min-height: 36px;
  padding: 6px 8px 6px 10px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
}
.sc-history-card-head .t { flex: 1; font-size: 12.5px; font-weight: 500; line-height: 20px; }
.sc-history-card-head .x {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  border: none;
  background: none;
  color: var(--dsw-alias-label-tertiary);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
}
.sc-history-card-head .x:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.sc-history-card-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* ======================================================================
   折叠披露行 —— 官方同款实现（disclosure 骨架 + 思考行 + 上下文行 + 工具行）
   结构/样式逐条对应 dsh-client-ui-conversation 的 DisclosureRow /
   ReasoningRow / ContextInjectionRow / ContextBody 与 dsh-client-ui-tool
   的 ToolRow / StateDot（CSS module 转写，类名简化）
   ====================================================================== */
/* DisclosureRow 骨架 */
.ds-row { display: flex; flex-direction: column; width: 100%; min-width: 0; }
.ds-head {
  position: relative; overflow: hidden;
  display: flex; align-items: center;
  height: 24px; min-width: 0;
}
.ds-head[data-expandable] { cursor: pointer; }
.ds-leading {
  position: relative; flex: none; width: 16px; height: 16px;
  display: inline-flex; align-items: center; justify-content: center;
  margin-right: 6px; padding: 0; border: none; background: none;
  color: var(--dsw-alias-label-tertiary);
}
button.ds-leading { cursor: pointer; }
.ds-icon { display: inline-flex; opacity: 1; transition: opacity 0.1s ease; }
.ds-chev {
  position: absolute; top: 0; right: 0; bottom: 0; left: 0; margin: auto;
  opacity: 0; transition: opacity 0.1s ease;
  color: var(--dsw-alias-label-secondary);
}
.ds-head:hover .ds-icon { opacity: 0; }
.ds-head:hover .ds-chev { opacity: 1; }
.ds-title { flex: none; font-size: 14px; line-height: 24px; color: var(--dsw-alias-label-secondary); font-weight: 400; }
.ds-sep { background: var(--dsw-alias-label-caption); border-radius: 1px; flex: none; width: 2px; height: 2px; margin: 0 8px; }
.ds-summary { text-overflow: ellipsis; white-space: nowrap; min-width: 0; color: var(--dsw-alias-label-tertiary); flex: auto; font-size: 14px; line-height: 24px; overflow: hidden; }
.ds-summary[data-follow-end] { text-overflow: clip; }
.ds-source { min-width: 0; color: var(--dsw-alias-label-tertiary); text-overflow: ellipsis; white-space: nowrap; flex: none; font-size: 14px; line-height: 24px; overflow: hidden; }
.ds-suffix { white-space: nowrap; color: var(--dsw-alias-label-tertiary); flex: none; margin-left: 4px; font-size: 14px; line-height: 24px; }
.ds-vhidden { clip: rect(0 0 0 0); white-space: nowrap; width: 1px; height: 1px; position: absolute; overflow: hidden; }

/* 思考行（ReasoningRow：Think 图标 + 首行/末行摘要 + 运行扫描动画） */
.ds-reason { flex-direction: column; display: flex; }
.ds-reason .ds-head { position: relative; overflow: hidden; }
.ds-reason[data-state=running] .ds-head::after {
  content: '';
  inset-block: 0;
  background: linear-gradient(90deg, transparent 0%, color-mix(in srgb, var(--dsw-alias-bg-base) 60%, transparent) 55%, transparent 100%);
  pointer-events: none; width: 300px;
  animation: 2.6s ease-out infinite dsh-notes-reason-sweep;
  position: absolute; left: 0;
}
@keyframes dsh-notes-reason-sweep { 0% { left: -300px } 90%, to { left: 100% } }
.ds-thinkBody {
  color: var(--dsw-alias-label-tertiary); white-space: pre-wrap; word-break: break-word;
  padding: 4px 0 4px 22px; font-size: 14px; line-height: 24px;
}

/* 上下文行（ContextInjectionRow：标题 + 生产者/摘要 + 代码块正文） */
.ds-context { min-width: 0; }
.ds-context[data-open] { padding-bottom: 4px; }
.ds-context .ds-body {
  box-sizing: border-box; background: var(--dsw-alias-markdown-code-block);
  width: calc(100% - 22px); max-height: 141px; color: var(--dsw-alias-label-tertiary);
  font: 400 11px/16px var(--ds-font-family-code);
  border: none; border-radius: 8px; margin: 4px 0 0 22px; padding: 10px 16px 12px 12px; overflow: auto;
}
/* ContextBody（instructions / catalog / snapshot / relay / recall / opaque） */
.ds-cb-text { color: var(--dsw-alias-label-secondary); font: inherit; white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; }
.ds-cb-fields { border-top: 1px solid var(--dsw-alias-border-l1); flex-direction: column; gap: 2px; margin: 8px 0 0; padding-top: 8px; display: flex; }
.ds-cb-field { gap: 8px; min-width: 0; display: flex; }
.ds-cb-fieldKey { min-width: 96px; color: var(--dsw-alias-label-caption); flex: none; }
.ds-cb-fieldValue { min-width: 0; color: var(--dsw-alias-label-tertiary); overflow-wrap: anywhere; flex: auto; margin: 0; }
.ds-cb-files { flex-wrap: wrap; gap: 4px 12px; margin: 0 0 8px; padding: 0; list-style: none; display: flex; }
.ds-cb-file { align-items: baseline; gap: 6px; min-width: 0; display: flex; }
.ds-cb-filePath { color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
.ds-cb-fileAction { color: var(--dsw-alias-label-caption); }
.ds-cb-catalogNotice { color: var(--dsw-alias-label-caption); margin: 0 0 6px; }
.ds-cb-entries { flex-direction: column; gap: 4px; margin: 0; padding: 0; list-style: none; display: flex; }
.ds-cb-entry { gap: 8px; min-width: 0; display: flex; }
.ds-cb-entryName { color: var(--dsw-alias-label-secondary); flex: none; }
.ds-cb-entryDescription { min-width: 0; color: var(--dsw-alias-label-tertiary); text-overflow: ellipsis; white-space: nowrap; flex: auto; overflow: hidden; }
.ds-cb-sections { flex-direction: column; gap: 8px; margin: 0; display: flex; }
.ds-cb-section { flex-direction: column; gap: 2px; min-width: 0; display: flex; }
.ds-cb-sectionName { color: var(--dsw-alias-label-caption); }
.ds-cb-sectionText { color: var(--dsw-alias-label-secondary); white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; }
.ds-cb-relaySender { color: var(--dsw-alias-label-caption); overflow-wrap: anywhere; margin: 0 0 6px; }
.ds-cb-recalls { flex-direction: column; gap: 2px; margin: 0 0 8px; padding: 0; list-style: none; display: flex; }
.ds-cb-recall { gap: 8px; min-width: 0; display: flex; }
.ds-cb-recallLabel { color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
.ds-cb-recallCounts { color: var(--dsw-alias-label-caption); flex: none; }

/* 工具行（ToolRow：变体图标 + 标题/摘要 + IN/OUT 卡 + 运行扫描动画） */
.ds-tool { flex-direction: column; display: flex; }
.ds-tool .ds-head { position: relative; overflow: hidden; }
.ds-tool[data-state=running] .ds-head::after {
  content: '';
  inset-block: 0;
  background: linear-gradient(90deg, transparent 0%, color-mix(in srgb, var(--dsw-alias-bg-base) 60%, transparent) 55%, transparent 100%);
  pointer-events: none; width: 300px;
  animation: 2.6s ease-out infinite dsh-notes-tool-sweep;
  position: absolute; left: 0;
}
@keyframes dsh-notes-tool-sweep { 0% { left: -300px } 90%, to { left: 100% } }
.ds-errorSummary { color: var(--dsw-alias-state-error-primary); }
.ds-ioCard {
  border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-markdown-code-block);
  font: var(--dsw-font-markdown-code-block-small);
  border-radius: 12px; flex-direction: column; margin: 4px 0 4px 4px; display: flex;
}
.ds-ioSection { grid-template-columns: max-content 1fr; align-items: baseline; column-gap: 14px; max-height: 150px; padding: 12px 16px; display: grid; overflow-y: auto; }
.ds-ioLabel { color: var(--dsw-alias-label-caption); align-self: start; position: sticky; top: 0; }
.ds-ioDivider { background: var(--dsw-alias-border-l2); flex: none; height: 1px; }
.ds-ioText { white-space: pre-wrap; word-break: break-word; min-width: 0; color: var(--dsw-alias-label-secondary); }
.ds-ioText[data-error] { color: var(--dsw-alias-state-error-primary); }
.ds-bodyScroll { max-height: 260px; overflow-y: auto; }

/* StateDot（状态点：外圈光晕 + 内点；error 红 / warning 琥珀） */
.ds-dot { position: relative; display: inline-block; flex: none; width: 10px; height: 10px; }
.ds-dot::before { content: ''; position: absolute; top: 0; right: 0; bottom: 0; left: 0; border-radius: 50%; background: currentColor; opacity: 0.1; }
.ds-dot::after { content: ''; position: absolute; top: 20%; right: 20%; bottom: 20%; left: 20%; border-radius: 50%; background: currentColor; }
.ds-dot[data-state=error] { color: var(--dsw-alias-state-error-primary); }
.ds-dot[data-state=warning] { color: var(--dsw-alias-state-warn-primary); }

/* 回合错误行（官方 TurnErrorItem：红点 + 标题/信息 + 错误码） */
.ds-turn-error {
  grid-template-columns: 10px minmax(0, 1fr) auto;
  align-items: start;
  gap: 8px;
  padding: 2px 0;
  font-size: 13px;
  line-height: 20px;
  display: grid;
}
.ds-turn-error-dot { margin-top: 5px; }
.ds-turn-error-copy { overflow-wrap: anywhere; min-width: 0; }
.ds-turn-error-title { color: var(--dsw-alias-state-error-primary); margin-right: 6px; font-weight: 600; }
.ds-turn-error-message { color: var(--dsw-alias-label-secondary); }
.ds-turn-error-code { color: var(--dsw-alias-label-tertiary); font: var(--dsw-font-markdown-code-block-small); }

@media (prefers-reduced-motion: reduce) {
  .ds-reason[data-state=running] .ds-head::after,
  .ds-tool[data-state=running] .ds-head::after { animation: none; }
}

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
.sc-field input {
  height: 30px;
  padding: 0 8px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 7px;
  background: var(--dsw-alias-button-elevated-fill);
  outline: none;
  font-size: 12.5px;
  color: var(--dsw-alias-label-primary);
  font-family: var(--ds-font-family-code, monospace);
}
.sc-field input:focus { border-color: var(--dsw-alias-state-business-primary); }
.sc-field input::placeholder { color: var(--dsw-alias-label-caption); }
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

/* ===== 分隔条（明显的分割细线，本身即拖拽把手；拖拽样式 = DSH 原生：无特殊样式，仅指针变化） ===== */
.dock-splitter {
  flex: none;
  height: 9px;
  display: flex;
  align-items: center;
  cursor: row-resize;
  z-index: 5;
  touch-action: none;
}
.dock-splitter::before {
  content: '';
  width: 100%;
  height: 1px;
  background: var(--dsw-alias-border-l2);
}
.dsh-notes-dock.split-dragging { user-select: none; -webkit-user-select: none; cursor: row-resize; }

/* ===== 右缘宽度拖拽（DSH 原生样式：不可见热区，仅指针变化） ===== */
.dock-resizer {
  position: absolute;
  top: 0;
  bottom: 0;
  right: -4px;
  width: 8px;
  cursor: col-resize;
  touch-action: none;
  z-index: 6;
}
.dsh-notes-dock.resize-dragging { user-select: none; -webkit-user-select: none; cursor: col-resize; }
.dsh-notes-dock.collapsed .dock-resizer { display: none; }

/* ===== 下半：小计 ===== */
.np-section { flex: 1; min-height: 0; display: flex; flex-direction: column; position: relative; }
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
`;
		function scopeOf(data, tab) {
			return tab === "global" ? data.global : data.workspace;
		}
		function NotesDock(props) {
			const useWorkspaces = props.useWorkspaces;
			const useSessions = props.useSessions;
			const sessions = props.sessions;
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
			const scInputRef = useRef(null);
			const [left, setLeft] = useState(260);
			const [top, setTop] = useState(0);
			const [collapsed, setCollapsed] = useState(() => {
				try {
					return localStorage.getItem(COLLAPSED_KEY) === "1";
				} catch {
					return false;
				}
			});
			const [split, setSplit] = useState(() => {
				try {
					const value = Number(localStorage.getItem(SPLIT_KEY));
					if (Number.isFinite(value)) return Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, value));
				} catch {}
				return SPLIT_DEFAULT;
			});
			const [width, setWidth] = useState(() => {
				try {
					const value = Number(localStorage.getItem(WIDTH_KEY));
					if (Number.isFinite(value)) return Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, Math.round(value)));
				} catch {}
				return WIDTH_DEFAULT;
			});
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
			const [editing, setEditing] = useState(null);
			const [detailDraft, setDetailDraft] = useState(null);
			const [detailStatus, setDetailStatus] = useState("");
			const detailDraftRef = useRef(null);
			const detailDirtyRef = useRef(false);
			const detailTimerRef = useRef(null);
			const [historyCard, setHistoryCard] = useState(null);
			const [memoText, setMemoText] = useState("");
			const [memoStatus, setMemoStatus] = useState("");
			const [undoInfo, setUndoInfo] = useState(null);
			const [dragId, setDragId] = useState(null);
			const [dropId, setDropId] = useState(null);
			const [card, setCard] = useState(null);
			const [chat, setChat] = useState(null);
			const [cardError, setCardError] = useState(null);
			const [popupOpen, setPopupOpen] = useState(false);
			const [confirming, setConfirming] = useState(false);
			const editingRef = useRef(null);
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
			const chatRunningRef = useRef(false);
			const splitDragRef = useRef(null);
			const scMsgRef = useRef(null);
			const atBottomRef = useRef(true);
			const forceFollowRef = useRef(false);
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
				updateLeft();
				updateTop();
				let raf = 0;
				const scheduleUpdate = () => {
					if (raf !== 0) return;
					raf = requestAnimationFrame(() => {
						raf = 0;
						scrollEl = findScrollBody();
						updateLeft();
						updateTop();
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
						"data-phase"
					]
				});
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
			function collapse() {
				hideTip();
				saveMemoNow();
				setCollapsed(true);
				try {
					localStorage.setItem(COLLAPSED_KEY, "1");
				} catch {}
			}
			function expand() {
				hideTip();
				setCollapsed(false);
				try {
					localStorage.setItem(COLLAPSED_KEY, "0");
				} catch {}
				requestAnimationFrame(() => {
					inputRef.current?.focus();
				});
			}
			function onDockPointerDown() {
				hideTip();
			}
			useLayoutEffect(() => {
				hideTip();
			}, [collapsed]);
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
			function clearDone() {
				const scope = scopeOf(data, tab);
				const count = scope === null ? 0 : scope.todos.filter((item) => item.done).length;
				post({
					action: "clear-done",
					scope: tab,
					workspaceId: workspaceArg
				}).then((result) => {
					if (result.ok === true && count > 0) showUndo(tab, count);
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
			function startEdit(item) {
				editingRef.current = {
					id: item.id,
					text: item.text
				};
				setEditing({
					id: item.id,
					text: item.text
				});
			}
			function commitEdit() {
				const edit = editingRef.current;
				editingRef.current = null;
				setEditing(null);
				if (edit === null) return;
				const text = edit.text.trim();
				if (text === "") return;
				post({
					action: "edit",
					scope: tab,
					workspaceId: workspaceArg,
					id: edit.id,
					text
				});
			}
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
			function formatTime(ms) {
				if (typeof ms !== "number" || !Number.isFinite(ms)) return "—";
				const d = new Date(ms);
				const pad = (n) => String(n).padStart(2, "0");
				return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
			}
			function scardPost(action, extra) {
				return fetch("/api/dsh-notes", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(Object.assign({ action }, extra ?? {}))
				}).then((response) => response.json()).catch(() => ({
					ok: false,
					error: "network"
				}));
			}
			function scardErrorText(result) {
				const raw = result?.error?.message ?? result?.error;
				if (raw === "bad-args" || raw === "unknown-action") return "宿主端未启用会话卡片功能，请重启 DSH 后刷新";
				return raw ?? "操作失败";
			}
			const refreshCard = useCallback(() => {
				return scardPost("scard-state").then((result) => {
					if (result.ok === true && result.scard) {
						setCard(result.scard);
						setCardError(null);
					} else if (result.error === "scard-unavailable" || result.error === "scard-failed") setCardError("会话卡片暂不可用（宿主需重启 DSH 后生效）");
					else setCardError(scardErrorText(result));
					return result;
				});
			}, []);
			const fetchChat = useCallback(async () => {
				const result = await scardPost("scard-chat-state");
				if (result.ok === true && result.scard) {
					const next = result.scard;
					chatRunningRef.current = next.running === true;
					setCardError(null);
					setChat((prev) => {
						if (prev === null || next.cold === true) return next;
						if (prev.lastSeq === next.lastSeq && !next.running) return prev;
						return next;
					});
				} else if (result.error === "scard-unavailable" || result.error === "scard-failed") setCardError("会话卡片暂不可用（宿主需重启 DSH 后生效）");
				else setCardError(scardErrorText(result));
				return result;
			}, []);
			useEffect(() => {
				if (collapsed) return;
				let alive = true;
				let timer = null;
				const schedule = (delay) => {
					timer = setTimeout(async () => {
						if (!alive) return;
						await fetchChat();
						if (alive) schedule(chatRunningRef.current ? POLL_RUNNING_MS : POLL_IDLE_MS);
					}, delay);
				};
				schedule(0);
				return () => {
					alive = false;
					if (timer !== null) clearTimeout(timer);
				};
			}, [collapsed, fetchChat]);
			useLayoutEffect(() => {
				const el = scMsgRef.current;
				if (el === null) return;
				if (forceFollowRef.current || atBottomRef.current) {
					el.scrollTop = el.scrollHeight;
					atBottomRef.current = true;
				}
				forceFollowRef.current = false;
			}, [chat, collapsed]);
			function onScMsgScroll() {
				const el = scMsgRef.current;
				if (el === null) return;
				const floor = Math.max(0, el.scrollHeight - el.clientHeight);
				atBottomRef.current = floor - el.scrollTop <= 24;
			}
			useEffect(() => {
				if (collapsed) return;
				refreshCard();
			}, [collapsed, refreshCard]);
			async function sendMessage() {
				const input = scInputRef.current;
				if (input === null || card === null) return;
				const text = input.value.trim();
				if (text === "") return;
				input.value = "";
				forceFollowRef.current = true;
				const binding = sessions !== void 0 && sessions !== null ? sessions.binding(card.sessionId) : void 0;
				if (binding === void 0 || binding.session === void 0) {
					setCardError("会话暂不可用（未列出），正在重试…");
					setTimeout(() => void refreshCard(), 600);
					return;
				}
				try {
					const result = await binding.session.prompt([{
						type: "text",
						text
					}], "queue");
					if (result !== void 0 && (result.ok !== true || result.value?.accepted !== true)) setCardError(result?.error?.message ?? "发送失败");
					else {
						setCardError(null);
						fetchChat();
					}
				} catch (error) {
					setCardError(String(error?.message ?? error));
				}
			}
			async function stopMessage() {
				if (card === null) return;
				const binding = sessions !== void 0 && sessions !== null ? sessions.binding(card.sessionId) : void 0;
				try {
					if (binding !== void 0 && binding.session !== void 0) await binding.session.cancel();
				} catch {}
				fetchChat();
			}
			function onSendClick() {
				if (chat !== null && chat.cold !== true && chat.running === true) stopMessage();
				else sendMessage();
			}
			function onScInputKeyDown(event) {
				if (event.key === "Enter" && !event.shiftKey) {
					event.preventDefault();
					onSendClick();
				}
			}
			function onPresetChange(event) {
				scardPost("scard-select-preset", { presetId: event.target.value }).then((result) => {
					if (result.ok !== true) setCardError(result.error?.message ?? "预设切换失败");
					refreshCard();
				});
			}
			function onModelChange(event) {
				const parts = event.target.value.split("/");
				const provider = parts[0];
				const model = parts[1];
				if (provider === void 0 || model === void 0) return;
				scardPost("scard-select-model", {
					provider,
					model
				}).then((result) => {
					if (result.ok !== true) setCardError(result.error?.message ?? "模型切换失败");
					refreshCard();
				});
			}
			function onEffortChange(event) {
				if (card === null || card.model === void 0) return;
				const effort = event.target.value === "" ? void 0 : event.target.value;
				scardPost("scard-select-model", {
					provider: card.model.provider,
					model: card.model.model,
					...effort === void 0 ? {} : { effort }
				}).then((result) => {
					if (result.ok !== true) setCardError(result.error?.message ?? "切换失败");
					refreshCard();
				});
			}
			function confirmClear() {
				scardPost("scard-clear").then((result) => {
					setConfirming(false);
					if (result.ok === true) {
						setChat(null);
						refreshCard();
					} else setCardError(result.error?.message ?? "清空失败");
				});
			}
			function onSplitPointerDown(event) {
				if (event.pointerType === "mouse" && event.button !== 0) return;
				event.preventDefault();
				splitDragRef.current = event.pointerId;
				if (dockRef.current !== null) dockRef.current.classList.add("split-dragging");
				try {
					event.currentTarget.setPointerCapture(event.pointerId);
				} catch {}
			}
			function onSplitPointerMove(event) {
				if (splitDragRef.current === null) return;
				const dock = dockRef.current;
				if (dock === null) return;
				const rect = dock.getBoundingClientRect();
				if (rect.height <= 0) return;
				const pct = Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, (event.clientY - rect.top) / rect.height * 100));
				const rounded = Math.round(pct);
				setSplit(rounded);
				try {
					localStorage.setItem(SPLIT_KEY, String(rounded));
				} catch {}
			}
			function onSplitPointerUp() {
				splitDragRef.current = null;
				if (dockRef.current !== null) dockRef.current.classList.remove("split-dragging");
			}
			function onSplitDoubleClick() {
				setSplit(SPLIT_DEFAULT);
				try {
					localStorage.setItem(SPLIT_KEY, String(SPLIT_DEFAULT));
				} catch {}
			}
			const widthDragRef = useRef(null);
			function onWidthPointerDown(event) {
				if (event.pointerType === "mouse" && event.button !== 0) return;
				event.preventDefault();
				widthDragRef.current = event.pointerId;
				if (dockRef.current !== null) dockRef.current.classList.add("resize-dragging");
				try {
					event.currentTarget.setPointerCapture(event.pointerId);
				} catch {}
			}
			function onWidthPointerMove(event) {
				if (widthDragRef.current === null) return;
				const next = Math.round(Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, event.clientX - left)));
				setWidth(next);
				try {
					localStorage.setItem(WIDTH_KEY, String(next));
				} catch {}
			}
			function onWidthPointerUp() {
				widthDragRef.current = null;
				if (dockRef.current !== null) dockRef.current.classList.remove("resize-dragging");
			}
			const dockStyle = {
				left: `${left}px`,
				top: `${top}px`,
				width: `${width}px`,
				"--sc-ratio": `${split}%`
			};
			if (collapsed) return React.createElement("div", {
				className: "dsh-notes-dock collapsed",
				"data-notes-ver": "ce9291b",
				ref: rootRef,
				style: {
					left: `${left}px`,
					top: "auto"
				},
				onMouseOver: onTipOver,
				onMouseMove: onTipMove,
				onMouseOut: onTipOut,
				onPointerDown: onDockPointerDown
			}, React.createElement("button", {
				key: "pill",
				className: "dock-collapsed",
				type: "button",
				"data-tip": "展开小记",
				onClick: expand
			}, React.createElement("span", null, "📝"), React.createElement("span", null, "小记"), React.createElement("span", { dangerouslySetInnerHTML: { __html: ICON_EXPAND } })), React.createElement("div", {
				key: "tip",
				className: "np-tip",
				ref: tipRef,
				hidden: true
			}));
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
			function assistantContent(text, streaming) {
				if (MarkdownText !== null) return React.createElement(MarkdownText, {
					text,
					streaming: streaming === true,
					codeLabels: MD_LABELS
				});
				if (markedParse !== null) try {
					return React.createElement("div", {
						className: "dsh-notes-md",
						dangerouslySetInnerHTML: { __html: markedParse(text) }
					});
				} catch {}
				return React.createElement("span", { className: "sc-plain" }, text);
			}
			function rowElement(row, streaming) {
				const key = streaming === true ? `${row.id}-live` : row.id;
				if (row.kind === "turn-error") return React.createElement("div", {
					key,
					className: "ds-turn-error",
					role: "status"
				}, React.createElement("span", {
					className: "ds-dot ds-turn-error-dot",
					"data-state": "error"
				}), React.createElement("div", { className: "ds-turn-error-copy" }, React.createElement("span", { className: "ds-turn-error-title" }, "本轮运行失败"), React.createElement("span", { className: "ds-turn-error-message" }, row.text ?? "")), row.code !== void 0 && row.code !== "" ? React.createElement("code", { className: "ds-turn-error-code" }, row.code) : null);
				return null;
			}
			function rowElementOf(message, streaming) {
				if (message.kind === "user") return React.createElement("div", {
					key: message.id,
					className: "sc-msg user"
				}, message.text);
				if (message.kind === "assistant") return React.createElement("div", {
					key: message.id,
					className: "sc-msg assistant"
				}, React.createElement("div", { className: "bubble" }, assistantContent(message.text, streaming === true)));
				return rowElement(message, streaming);
			}
			const chatRows = [];
			if (chat === null || chat.cold === true) chatRows.push(React.createElement("div", {
				key: "empty",
				className: "sc-empty"
			}, chat === null ? "常驻会话 · 直接在这里对话" : "常驻会话 · 发送首条消息以开始"));
			else {
				const turns = [];
				let current = null;
				for (const message of chat.messages) if (message.kind === "user") {
					current = {
						id: message.id,
						userText: message.text,
						rows: [message]
					};
					turns.push(current);
				} else if (current !== null) current.rows.push(message);
				else {
					current = {
						id: "t0",
						userText: "",
						rows: [message]
					};
					turns.push(current);
				}
				if (turns.length <= 1) for (const message of chat.messages) chatRows.push(rowElementOf(message, false));
				else {
					for (let i = 0; i < turns.length - 1; i++) {
						const turn = turns[i];
						const preview = (turn.userText.split("\n")[0] ?? "").trim();
						const shown = preview.length > 18 ? preview.slice(0, 18) + "…" : preview;
						chatRows.push(React.createElement("div", {
							key: `h${turn.id}`,
							className: "sc-history",
							"data-tip": "查看该轮对话记录",
							onClick: () => setHistoryCard({
								label: `对话 ${i + 1} · ${shown}`,
								rows: turn.rows
							})
						}, React.createElement("span", { className: "sc-history-label" }, `对话 ${i + 1}`), React.createElement("span", { className: "sc-history-preview" }, shown === "" ? "（无标题）" : shown), React.createElement("span", { className: "sc-history-chev" }, "›")));
					}
					for (const message of turns[turns.length - 1].rows) chatRows.push(rowElementOf(message, false));
				}
				const streamingText = Array.isArray(chat.partials) ? chat.partials.some((p) => p.kind === "assistant" && p.text !== "") : false;
				if (Array.isArray(chat.partials)) for (const partial of chat.partials) if (partial.kind === "assistant") {
					const last = chat.messages[chat.messages.length - 1];
					if (!(last !== void 0 && last.kind === "assistant" && last.text === partial.text)) chatRows.push(React.createElement("div", {
						key: `${partial.id}-stream`,
						className: "sc-msg assistant"
					}, React.createElement("div", { className: "bubble" }, assistantContent(partial.text, true), React.createElement("span", { className: "cursor" }))));
				} else {
					const el = rowElement(partial, true);
					if (el !== null) chatRows.push(el);
				}
				if (chat.running === true && !streamingText) chatRows.push(React.createElement("div", {
					key: "streaming-status",
					className: "sc-streaming-status",
					role: "status"
				}, "正在生成…"));
			}
			const presetOptions = card === null || !Array.isArray(card.presets) ? [] : card.presets.map((preset) => React.createElement("option", {
				key: preset.id,
				value: preset.id,
				disabled: preset.broken === true
			}, preset.name ?? preset.id + (preset.isDefault === true ? "（默认）" : "")));
			const modelGroups = card === null || !Array.isArray(card.catalog) ? [] : card.catalog.map((provider) => React.createElement("optgroup", {
				key: provider.id,
				label: provider.name ?? provider.id
			}, (provider.models ?? []).map((model) => React.createElement("option", {
				key: model.id,
				value: `${provider.id}/${model.id}`
			}, model.name ?? model.id))));
			const currentModel = card !== null && card.model !== void 0 ? card.model : void 0;
			const currentModelInfo = (() => {
				if (currentModel === void 0 || !Array.isArray(card.catalog)) return null;
				for (const provider of card.catalog) {
					if (provider.id !== currentModel.provider) continue;
					for (const model of provider.models ?? []) if (model.id === currentModel.model) return model;
				}
				return null;
			})();
			const efforts = currentModelInfo !== null && currentModelInfo.reasoning ? currentModelInfo.reasoning.efforts ?? [] : [];
			const effortOptions = [React.createElement("option", {
				key: "",
				value: ""
			}, "默认"), ...efforts.map((entry) => React.createElement("option", {
				key: entry.id,
				value: entry.id
			}, entry.name))];
			const listItems = displayTodos.length === 0 ? [React.createElement("div", {
				key: "empty",
				className: "np-empty"
			}, "还没有待办")] : displayTodos.map((item) => {
				if (editing !== null && editing.id === item.id) return React.createElement("div", {
					key: item.id,
					className: "np-item"
				}, React.createElement("input", {
					className: "np-edit",
					autoFocus: true,
					defaultValue: editing.text,
					maxLength: 500,
					onChange: (event) => {
						editingRef.current = {
							id: item.id,
							text: event.target.value
						};
						setEditing({
							id: item.id,
							text: event.target.value
						});
					},
					onKeyDown: (event) => {
						if (event.key === "Enter") commitEdit();
						if (event.key === "Escape") {
							editingRef.current = null;
							setEditing(null);
						}
					},
					onBlur: commitEdit
				}));
				const rowClass = "np-item" + (item.done ? " done" : "") + (item.pinned ? " pinned" : "") + (dragId === item.id ? " dragging" : "") + (dropId === item.id ? " drop-target" : "");
				return React.createElement("div", {
					key: item.id,
					"data-id": item.id,
					className: rowClass,
					title: "双击编辑",
					onDoubleClick: () => startEdit(item)
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
			const running = chat !== null && chat.cold !== true && chat.running === true;
			const statusText = running ? "运行中…" : card === null ? "加载中…" : card.blank === true ? "空白 · 预设可切换" : "已开始 · 预设已锁定";
			return React.createElement("div", {
				className: "dsh-notes-dock",
				"data-notes-ver": "ce9291b",
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
			}, React.createElement("section", { className: "sc-section" }, React.createElement("div", { className: "sc-head" }, React.createElement("span", { className: "dot" }), React.createElement("span", { className: "t" }, "常驻会话"), React.createElement("span", { className: "sid" }, card !== null ? card.sessionId : "…"), React.createElement("span", { className: "spacer" }), React.createElement("button", {
				type: "button",
				className: "sc-btn",
				"data-tip": "设置（预设/模型/思考等级）",
				onClick: () => setPopupOpen((prev) => !prev),
				dangerouslySetInnerHTML: { __html: ICON_GEAR }
			}), React.createElement("button", {
				type: "button",
				className: "sc-btn",
				"data-tip": "折叠小记",
				onClick: collapse,
				dangerouslySetInnerHTML: { __html: ICON_COLLAPSE }
			})), React.createElement("div", {
				ref: scMsgRef,
				className: "sc-messages",
				onScroll: onScMsgScroll
			}, ...chatRows), cardError === null ? null : React.createElement("div", { className: "sc-error" }, cardError), React.createElement("div", { className: "sc-input-row" }, React.createElement("input", {
				ref: scInputRef,
				className: "sc-input",
				placeholder: "给常驻会话发消息…",
				autoComplete: "off",
				onKeyDown: onScInputKeyDown
			}), React.createElement("button", {
				type: "button",
				className: "sc-send" + (running ? " stop" : ""),
				onClick: onSendClick
			}, running ? "停止" : "发送")), React.createElement("div", { className: "sc-foot" }, React.createElement("button", {
				type: "button",
				className: "sc-clear",
				onClick: () => {
					if (!running) setConfirming(true);
				}
			}, "清空会话"), confirming ? React.createElement("span", { className: "sc-confirm" }, "确认清空？", React.createElement("button", {
				type: "button",
				className: "yes",
				onClick: confirmClear
			}, "确认"), React.createElement("button", {
				type: "button",
				className: "no",
				onClick: () => setConfirming(false)
			}, "取消")) : React.createElement("span", { className: "sc-status" }, statusText)), historyCard === null ? null : React.createElement("div", {
				className: "sc-history-overlay",
				onClick: (event) => {
					if (event.target === event.currentTarget) setHistoryCard(null);
				}
			}, React.createElement("div", { className: "sc-history-card" }, React.createElement("div", { className: "sc-history-card-head" }, React.createElement("span", { className: "t" }, historyCard.label), React.createElement("button", {
				type: "button",
				className: "x",
				"data-tip": "关闭",
				onClick: () => setHistoryCard(null)
			}, "×")), React.createElement("div", { className: "sc-history-card-body" }, ...historyCard.rows.map((message) => rowElementOf(message, false)).filter(Boolean)))), popupOpen ? React.createElement("div", { className: "sc-popup" }, React.createElement("div", { className: "sc-popup-head" }, React.createElement("span", { className: "t" }, "设置 · 常驻会话"), React.createElement("button", {
				type: "button",
				className: "sc-btn",
				"data-tip": "关闭",
				onClick: () => setPopupOpen(false)
			}, "×")), React.createElement("div", { className: "sc-popup-body" }, React.createElement("div", { className: "sc-field" }, React.createElement("label", null, "选择预设"), React.createElement("select", {
				value: card !== null ? card.presetId ?? "" : "",
				disabled: card === null || card.presetLocked === true,
				onChange: onPresetChange
			}, ...presetOptions), card !== null && card.presetLocked === true ? React.createElement("span", { className: "sc-popup-hint" }, "会话已开始，预设已锁定") : null), React.createElement("div", { className: "sc-field" }, React.createElement("label", null, "选择模型"), React.createElement("select", {
				value: currentModel !== void 0 ? `${currentModel.provider}/${currentModel.model}` : "",
				onChange: onModelChange
			}, ...modelGroups)), React.createElement("div", { className: "sc-field" }, React.createElement("label", null, "思考等级"), React.createElement("select", {
				value: currentModel !== void 0 && currentModel.effort !== void 0 ? currentModel.effort : "",
				disabled: efforts.length === 0,
				onChange: onEffortChange
			}, ...effortOptions))), React.createElement("div", { className: "sc-popup-foot" }, React.createElement("button", {
				type: "button",
				onClick: () => setPopupOpen(false)
			}, "完成"))) : null), React.createElement("div", {
				className: "dock-splitter",
				"data-tip": "拖动调整上下比例（双击复位）",
				onPointerDown: onSplitPointerDown,
				onPointerMove: onSplitPointerMove,
				onPointerUp: onSplitPointerUp,
				onPointerCancel: onSplitPointerUp,
				onDoubleClick: onSplitDoubleClick
			}), React.createElement("section", { className: "np-section" }, React.createElement("div", { className: "np-head" }, React.createElement("span", { className: "dot" }), React.createElement("span", { className: "t" }, "小计"), React.createElement("span", { className: "spacer" })), React.createElement("div", { className: "np-tabs" }, ...tabs), error === null ? null : React.createElement("div", { className: "np-error" }, "存储不可用，请检查宿主 storage 域。"), React.createElement("div", { className: "np-sec-todo" }, React.createElement("div", { className: "np-sec-head" }, React.createElement("span", { className: "np-sec-title" }, "待办"), React.createElement("span", { className: "np-sec-count" }, `共 ${todos.length} 项 · 未完成 ${todos.length - doneCount}`), React.createElement("button", {
				type: "button",
				className: "np-clear",
				"data-tip": "清空已完成",
				disabled: doneCount === 0,
				onClick: clearDone
			}, "清空已完成")), React.createElement("div", { className: "np-input-row" }, React.createElement("input", {
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
			}, "撤销"))), React.createElement("div", { className: "np-sec-memo" }, React.createElement("div", { className: "np-sec-head" }, React.createElement("span", { className: "np-sec-title" }, "随记"), React.createElement("span", { className: "np-memo-status" }, memoStatus)), React.createElement("textarea", {
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
			}, "×")), React.createElement("div", { className: "np-detail-body" }, React.createElement("div", { className: "np-detail-field" }, React.createElement("label", null, "标题"), React.createElement("input", {
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
				value: detailDraft.detail,
				onChange: onDetailTextarea,
				onKeyDown: (event) => {
					if (event.key === "Escape") closeDetail();
				}
			})), (() => {
				const scope = scopeOf(data, tab);
				const item = scope === null ? void 0 : scope.todos.find((it) => it.id === detailDraft.id);
				if (item === void 0) return null;
				return React.createElement("div", { className: "np-detail-meta" }, React.createElement("span", null, `创建 ${formatTime(item.createdAt)}`), React.createElement("span", null, `更新 ${formatTime(item.updatedAt)}`), React.createElement("span", null, item.done ? "已完成" : "未完成"), item.pinned ? React.createElement("span", null, "已置顶") : null);
			})()))))), React.createElement("div", {
				key: "resizer",
				className: "dock-resizer",
				"data-tip": "拖动调整竖栏宽度",
				onPointerDown: onWidthPointerDown,
				onPointerMove: onWidthPointerMove,
				onPointerUp: onWidthPointerUp,
				onPointerCancel: onWidthPointerUp
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
				const sessions = ctx.get("sessions");
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
				}, (props) => React.createElement(NotesDock, Object.assign({}, props, { sessions }))));
			}
		};
		return module.exports;
	}
});
