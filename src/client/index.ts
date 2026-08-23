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
//        scard-chat-state 400ms/3s（运行中 400ms，瀑布流跟随滚动））、⚙ 设置弹窗（预设/模型/思考等级）、
//        清空会话（归档+新建）；
//        发送/停止走 sessions.binding(id).session.prompt/cancel（wire RPC）。
//      - 分隔条：拖拽调整上下比例（25%–75%，双击复位 46%），localStorage 持久化。
//      - 下半：小计 —— 全局/本工作区 tab + 待办区（添加/勾选/双击打开详情/删除/
//        清空/置顶/拖拽排序/撤销删除）+ 随记区（自由文本，防抖 600ms + 失焦保存）。
//   3. 小计数据经 fetch('/api/dsh-notes') 读写；当前工作区解析链：
//      当前会话 cwd（useSessions）→ 路径匹配工作区 → 兜底 recentWorkspaceId。
//   4. 样式只使用 --dsw-alias-* 语义令牌（原型 prototype/index.html 为基准）。

const React = require('react')
const { useState, useEffect, useLayoutEffect, useRef, useCallback } = React

/* 内置 GFM 渲染器（marked 裸导入 → tsdown 内联进 client bundle；原始 HTML 转义为
 * 字面文本，链接/图片仅允许 http(s)/mailto） */
import { marked as markedParseFn, Renderer as MarkedRenderer } from 'marked'

/* 官方 Markdown 渲染（dsh-client-ui-primitives：GFM + TeX 数学 + 安全链接 +
 * 流式渲染；解析失败时降级到内置 marked 渲染器；再失败为纯文本） */
let MarkdownText = null
try {
  const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
  if (primitives !== null && typeof primitives === 'object' && typeof primitives.MarkdownText === 'function') {
    MarkdownText = primitives.MarkdownText
  }
} catch (error) {
  console.warn('[dsh-notes] 官方 MarkdownText 不可用，使用内置渲染器', error)
}
const MD_LABELS = { copyLabel: '复制', copiedLabel: '已复制' }

/* 内置 GFM 渲染器（marked，随 bundle 内联；原始 HTML 转义为字面文本，
 * 链接/图片仅允许 http(s)/mailto；marked v18 renderer 收 token 对象） */
let markedParse = null
try {
  if (typeof markedParseFn === 'function' && typeof MarkedRenderer === 'function') {
    const escapeHtml = (value) => String(value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    markedParse = (text) => {
      const renderer = new MarkedRenderer()
      renderer.html = function (token) {
        return escapeHtml((token && (token.raw ?? token.text)) ?? '')
      }
      renderer.link = function (token) {
        const href = token && token.href
        const label = this.parser && typeof this.parser.parseInline === 'function'
          ? this.parser.parseInline(token.tokens)
          : escapeHtml((token && (token.text ?? token.raw)) ?? '')
        if (typeof href === 'string' && /^(https?:|mailto:)/i.test(href)) {
          return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`
        }
        return escapeHtml((token && token.raw) ?? '')
      }
      renderer.image = function (token) {
        const href = token && token.href
        if (typeof href === 'string' && /^https?:/i.test(href)) {
          return `<img src="${escapeHtml(href)}" alt="${escapeHtml((token && (token.text ?? '')) ?? '')}" />`
        }
        return escapeHtml((token && token.raw) ?? '')
      }
      return markedParseFn(text, { gfm: true, breaks: true, renderer })
    }
  }
} catch { /* 无内置渲染 */ }

const STYLE_TAG_ID = 'dsh-notes-dock-style'
const SPLIT_KEY = 'dsh-notes.split'
const SPLIT_DEFAULT = 46
const SPLIT_MIN = 25
const SPLIT_MAX = 75
const WIDTH_KEY = 'dsh-notes.width'
const WIDTH_DEFAULT = 280
const WIDTH_MIN = 220
const WIDTH_MAX = 480
const MEMO_DEBOUNCE_MS = 600
const UNDO_TTL_MS = 5000
const POLL_RUNNING_MS = 400
const POLL_IDLE_MS = 3000
const ICON_CHECK =
  '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 6.5L5 9l4.5-6"/></svg>'
const ICON_TRASH =
  '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4h10M5.5 4V2.8A.8.8 0 016.3 2h1.4a.8.8 0 01.8.8V4M3.5 4l.6 7a1 1 0 001 1h3.8a1 1 0 001-1l.6-7"/><path d="M6 6.5v3M8 6.5v3"/></svg>'
const ICON_PIN =
  '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M8.6 1.4l4 4-1.4 1.4-1.2-.6-2.2 2.2.6 1.2-1.4 1.4-3-3L3.4 9l-.8-.8 2.6-2.6-1.2-.6 1.4-1.4 1.2.6 2.2-2.2-.6-1.2 1.4-1.4z"/></svg>'
const ICON_GRIP =
  '<svg viewBox="0 0 10 16" fill="currentColor"><circle cx="2.5" cy="2.5" r="1.4"/><circle cx="7.5" cy="2.5" r="1.4"/><circle cx="2.5" cy="8" r="1.4"/><circle cx="7.5" cy="8" r="1.4"/><circle cx="2.5" cy="13.5" r="1.4"/><circle cx="7.5" cy="13.5" r="1.4"/></svg>'
const ICON_GEAR =
  '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="1.8"/><path d="M6 1.2v1.6M6 9.2v1.6M1.2 6h1.6M9.2 6h1.6M2.7 2.7l1.1 1.1M8.2 8.2l1.1 1.1M2.7 9.3l1.1-1.1M8.2 3.8l1.1-1.1"/></svg>'
const ICON_DETAIL =
  '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 1.8h9v10.4h-9z"/><path d="M5 4.6h4M5 7h4M5 9.4h2.5"/></svg>'

/* ---- 官方图标（dsh-client-ui-primitives 原版 SVG） ---- */
const ICON_THINK =
  '<svg viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7.06431 5.93342C7.68763 5.93342 8.19307 6.43904 8.19322 7.06233C8.19322 7.68573 7.68772 8.19123 7.06431 8.19123C6.44099 8.19113 5.9354 7.68567 5.9354 7.06233C5.93555 6.43911 6.44108 5.93353 7.06431 5.93342Z" fill="currentColor"/><path fill-rule="evenodd" clip-rule="evenodd" d="M8.6815 0.963693C10.1169 0.447019 11.6266 0.374829 12.5633 1.31135C13.5 2.24805 13.4277 3.75776 12.911 5.19319C12.7126 5.74431 12.4386 6.31796 12.0965 6.89729C12.4969 7.54638 12.8141 8.19018 13.036 8.80647C13.5527 10.2419 13.6251 11.7516 12.6883 12.6883C11.7516 13.625 10.242 13.5527 8.8065 13.036C8.19022 12.8141 7.54641 12.4969 6.89732 12.0965C6.31797 12.4386 5.74435 12.7125 5.19322 12.911C3.75777 13.4276 2.2481 13.5 1.31138 12.5633C0.374859 11.6266 0.447049 10.1168 0.963724 8.68147C1.17185 8.10338 1.46321 7.50063 1.82896 6.8924C1.52182 6.35711 1.27235 5.82825 1.08872 5.31819C0.572068 3.88278 0.499714 2.37306 1.43638 1.43635C2.37308 0.499655 3.8828 0.572044 5.31822 1.08869C5.82828 1.27232 6.35715 1.5218 6.89243 1.82893C7.50066 1.46318 8.10341 1.17181 8.6815 0.963693ZM11.3573 8.01154C10.9083 8.62253 10.3901 9.22873 9.80943 9.8094C9.22877 10.3901 8.62255 10.9083 8.01158 11.3572C8.4257 11.5841 8.8287 11.7688 9.21275 11.9071C10.5456 12.3868 11.4246 12.2547 11.8397 11.8397C12.2548 11.4246 12.3869 10.5456 11.9071 9.21272C11.7688 8.82866 11.5841 8.42568 11.3573 8.01154ZM2.56529 8.02912C2.37344 8.39322 2.21495 8.74796 2.09263 9.08772C1.61291 10.4204 1.74512 11.2995 2.16001 11.7147C2.57505 12.1297 3.45415 12.2618 4.78697 11.7821C5.11057 11.6656 5.44786 11.5164 5.7938 11.3367C5.249 10.9223 4.70922 10.4533 4.19029 9.9344C3.57578 9.31987 3.03169 8.67633 2.56529 8.02912ZM6.90708 3.2469C6.24065 3.70479 5.5646 4.26321 4.91392 4.91389C4.26325 5.56456 3.70482 6.24063 3.24693 6.90705C3.72674 7.63325 4.32777 8.37459 5.03892 9.08576C5.64943 9.69627 6.28183 10.2265 6.90806 10.6678C7.59368 10.2025 8.2908 9.63076 8.96079 8.96076C9.6308 8.29075 10.2025 7.59366 10.6678 6.90803C10.2265 6.2818 9.69631 5.6494 9.08579 5.03889C8.37462 4.32773 7.63328 3.72672 6.90708 3.2469ZM11.7147 2.15998C11.2996 1.74509 10.4204 1.61288 9.08775 2.0926C8.74835 2.21479 8.39382 2.37271 8.03013 2.56428C8.67728 3.03065 9.31995 3.5758 9.93443 4.19026C10.4534 4.7092 10.9223 5.24896 11.3368 5.79377C11.5164 5.44785 11.6656 5.11052 11.7821 4.78694C12.2618 3.45416 12.1297 2.57502 11.7147 2.15998ZM4.91197 2.2176C3.57922 1.73788 2.70004 1.86995 2.28501 2.28498C1.87001 2.70003 1.73791 3.5792 2.21763 4.91194C2.31709 5.18822 2.44112 5.47427 2.58677 5.7674C3.01931 5.1887 3.51474 4.6158 4.06529 4.06526C4.61584 3.5147 5.18872 3.01928 5.76743 2.58674C5.47431 2.4411 5.18824 2.31706 4.91197 2.2176Z" fill="currentColor"/></svg>'
const ICON_CHEVRON_DOWN =
  '<svg viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.12709 8.46904 7.25977 8.3623C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z" fill="currentColor"/></svg>'
const ICON_BROWSE =
  '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M11.2426 4.80473V6.10551H4.75819V4.80473H11.2426Z" fill="currentColor"/><path d="M9.40858 7.84478V9.14557H4.75819V7.84478H9.40858Z" fill="currentColor"/><path d="M9.23438 0.546389C10.1941 0.546389 10.9683 0.544914 11.5859 0.611819C12.2161 0.680096 12.7634 0.825745 13.2393 1.17139C13.5172 1.3733 13.7619 1.61812 13.9639 1.896C14.3096 2.37183 14.4551 2.91922 14.5234 3.54932C14.5903 4.16686 14.5889 4.94133 14.5889 5.90088V10.0981C14.5889 11.0576 14.5903 11.8321 14.5234 12.4497C14.4552 13.0798 14.3094 13.6272 13.9639 14.103C13.7619 14.381 13.5172 14.6257 13.2393 14.8276C12.7633 15.1734 12.2163 15.3189 11.5859 15.3872C10.9683 15.4541 10.1942 15.4536 9.23438 15.4536H6.76563C5.80591 15.4536 5.03168 15.4541 4.41407 15.3872C3.78385 15.3189 3.23665 15.1734 2.76074 14.8276C2.48291 14.6257 2.23802 14.3809 2.03614 14.103C1.69066 13.6272 1.54483 13.0798 1.47657 12.4497C1.40973 11.8321 1.41114 11.0576 1.41114 10.0981V5.90088C1.41113 4.94132 1.40966 4.16686 1.47657 3.54932C1.54488 2.91921 1.69042 2.37184 2.03614 1.896C2.2381 1.61807 2.4828 1.37333 2.76074 1.17139C3.23665 0.825682 3.78386 0.680109 4.41407 0.611819C5.03168 0.544905 5.80591 0.546389 6.76563 0.546389H9.23438ZM6.76563 1.896C5.77586 1.896 5.0876 1.89738 4.55957 1.95459C4.0443 2.01043 3.76214 2.11349 3.55469 2.26416C3.39135 2.38284 3.24761 2.52662 3.12891 2.68994C2.97821 2.89736 2.8752 3.17967 2.81934 3.69483C2.76214 4.22279 2.76075 4.91131 2.76074 5.90088V10.0981C2.76074 11.0876 2.76221 11.7762 2.81934 12.3042C2.87516 12.8194 2.97829 13.1026 3.12891 13.3101C3.24754 13.4733 3.39147 13.6172 3.55469 13.7358C3.76213 13.8865 4.04438 13.9896 4.55957 14.0454C5.0876 14.1026 5.77586 14.103 6.76563 14.103H9.23438C10.2242 14.103 10.9124 14.1026 11.4404 14.0454C11.9556 13.9896 12.2379 13.8865 12.4453 13.7358C12.6086 13.6172 12.7525 13.4733 12.8711 13.3101C13.0217 13.1026 13.1248 12.8195 13.1807 12.3042C13.2378 11.7762 13.2393 11.0876 13.2393 10.0981V5.90088C13.2393 4.91131 13.2379 4.22279 13.1807 3.69483C13.1248 3.17969 13.0218 2.89736 12.8711 2.68994C12.7524 2.52667 12.6086 2.38281 12.4453 2.26416C12.2379 2.11355 11.9556 2.01041 11.4404 1.95459C10.9124 1.8974 10.2241 1.896 9.23438 1.896H6.76563Z" fill="currentColor"/></svg>'
const ICON_SEARCH =
  '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M11.894845 6.647401C11.894845 3.725463 9.534486 1.356779 6.623219 1.35657C3.711786 1.35657 1.351635 3.725338 1.351635 6.647401C1.351843 9.569296 3.711911 11.938273 6.623219 11.938273C9.534361 11.938064 11.894637 9.569171 11.894845 6.647401ZM13.245462 6.647401C13.245254 10.317935 10.280401 13.293613 6.623219 13.293821C2.965871 13.293821 0.000204 10.31806 0 6.647401C0 2.976574 2.965746 0 6.623219 0C10.280526 0.000205 13.245462 2.9767 13.245462 6.647401Z" fill="currentColor"/><path d="M16.000417 15.041079L15.044449 16.000433L11.530434 12.473588L12.486298 11.514234L16.000417 15.041079Z" fill="currentColor"/></svg>'
const ICON_API =
  '<svg viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"><path transform="translate(0.6689 1.073)" d="M11.4818 5.57813C11.4818 4.45301 11.4807 3.66237 11.4075 3.05908C11.3359 2.46953 11.2024 2.13852 10.9939 1.89441C10.9247 1.81341 10.8493 1.73801 10.7683 1.66882C10.5242 1.46033 10.1932 1.32686 9.60364 1.25525C9.00034 1.18198 8.20974 1.18091 7.0846 1.18091L5.57813 1.18091C4.45301 1.18091 3.66238 1.18198 3.05908 1.25525C2.46953 1.32686 2.13852 1.46033 1.89441 1.66882C1.81341 1.73801 1.73801 1.81341 1.66882 1.89441C1.46033 2.13852 1.32686 2.46953 1.25525 3.05908C1.18198 3.66238 1.18091 4.45301 1.18091 5.57813L1.18091 6.2771C1.18091 7.40218 1.18197 8.19288 1.25525 8.79614C1.32687 9.38553 1.46036 9.71674 1.66882 9.96082C1.73797 10.0417 1.81347 10.1173 1.89441 10.1864C2.13851 10.3948 2.46965 10.5275 3.05908 10.5991C3.66238 10.6724 4.45298 10.6735 5.57813 10.6735L7.0846 10.6735C8.20977 10.6735 9.00033 10.6724 9.60364 10.5991C10.1931 10.5275 10.5242 10.3948 10.7683 10.1864C10.8493 10.1173 10.9247 10.0417 10.9939 9.96082C11.2024 9.71674 11.3358 9.38553 11.4075 8.79614C11.4808 8.19288 11.4818 7.40218 11.4818 6.2771L11.4818 5.57813ZM12.6627 6.2771C12.6627 7.37222 12.6637 8.247 12.5798 8.93799C12.4942 9.64284 12.3133 10.2359 11.8928 10.7282C11.7834 10.8562 11.6637 10.9751 11.5356 11.0845C11.0434 11.5049 10.4511 11.6867 9.74634 11.7723C9.05525 11.8563 8.17999 11.8552 7.0846 11.8552L5.57813 11.8552C4.48273 11.8552 3.60747 11.8563 2.91638 11.7723C2.21157 11.6867 1.61933 11.5049 1.12708 11.0845C0.99901 10.9751 0.879281 10.8562 0.769898 10.7282C0.349454 10.2359 0.168506 9.64284 0.0828864 8.93799C-0.00101964 8.247 4.88512e-07 7.37222 6.47206e-07 6.2771L6.47206e-07 5.57813C6.47206e-07 4.48273 -0.00106163 3.60747 0.0828864 2.91638C0.168502 2.21168 0.349594 1.61928 0.769898 1.12708C0.879302 0.998981 0.998981 0.879302 1.12708 0.769898C1.61928 0.349594 2.21168 0.168502 2.91638 0.0828864C3.60747 -0.00106163 4.48273 6.47206e-07 5.57813 6.47206e-07L7.0846 6.47206e-07C8.17999 6.47206e-07 9.05525 -0.00106163 9.74634 0.0828864C10.451 0.168505 11.0434 0.349587 11.5356 0.769899C11.9559 1.26199 12.137 1.85516 12.2226 2.56002C12.3065 3.25094 12.3055 4.12565 12.3055 5.22068L12.3055 6.2771C12.3055 7.37222 12.3065 8.247 12.2226 8.93799C12.137 9.64284 11.9559 10.2359 11.5356 10.7282C11.4262 10.8562 11.3065 10.9751 11.1784 11.0845C10.6862 11.5049 10.0939 11.6867 9.38916 11.7723C8.69807 11.8563 7.82281 11.8552 6.72742 11.8552L5.22095 11.8552C4.12555 11.8552 3.25029 11.8563 2.5592 11.7723C1.85439 11.6867 1.26215 11.5049 0.769898 11.0845C0.641825 10.9751 0.5221 10.8562 0.412717 10.7282C-0.00772767 10.2359 -0.188676 9.64284 -0.274295 8.93799C-0.358201 8.247 -0.357139 7.37222 -0.357139 6.2771L-0.357139 5.57813C-0.357139 4.48273 -0.358201 3.60747 -0.274295 2.91638C-0.188679 2.21168 -0.00758756 1.61928 0.412717 1.12708C0.52212 0.998981 0.641799 0.879302 0.769898 0.769898C1.2621 0.349594 1.8545 0.168502 2.5592 0.0828864C3.25029 -0.00106163 4.12555 6.47206e-07 5.22095 6.47206e-07L6.72742 6.47206e-07C7.82281 6.47206e-07 8.69807 -0.00106163 9.38916 0.0828864C10.0939 0.168505 10.4863 0.349587 10.9786 0.769899Z" fill="currentColor"/></svg>'
const ICON_EDIT =
  '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M9.94076 1.34942C10.7047 0.90231 11.6503 0.902415 12.4143 1.34942C12.7061 1.52015 12.9688 1.79118 13.3104 2.13284C13.6521 2.47448 13.9231 2.73721 14.0939 3.02894C14.5408 3.79294 14.5409 4.73856 14.0939 5.50251C13.9231 5.79415 13.652 6.05704 13.3104 6.39861L6.65932 13.0497C6.28068 13.4284 6.00695 13.7108 5.66543 13.9097C5.32391 14.1085 4.94315 14.2074 4.42705 14.3498L3.24394 14.6761C2.77527 14.8054 2.34538 14.9262 2.00131 14.9684C1.65196 15.0112 1.17964 15.0013 0.810764 14.6325C0.441921 14.2637 0.432107 13.7913 0.47486 13.442C0.517035 13.0979 0.6379 12.668 0.767181 12.1993L1.09352 11.0162C1.23588 10.5001 1.33481 10.1193 1.5336 9.77784C1.7325 9.43632 2.0149 9.1626 2.39355 8.78395L9.04466 2.13284C9.38625 1.79126 9.64911 1.52016 9.94076 1.34942ZM15.5427 14.8398H7.55223L8.96707 13.425H15.5427V14.8398ZM3.39382 9.78422C2.965 10.213 2.84244 10.3436 2.75709 10.49C2.67183 10.6366 2.61862 10.8079 2.45733 11.3925L2.13099 12.5756C2.00183 13.0439 1.92194 13.3419 1.88863 13.5536C2.10041 13.5204 2.39872 13.4416 2.86764 13.3123L4.05075 12.9859C4.63544 12.8246 4.80669 12.7715 4.95323 12.6862C5.09968 12.6008 5.23022 12.4783 5.65905 12.0494L10.721 6.98644L8.45577 4.72121L3.39382 9.78422ZM11.7 2.57079C11.3774 2.38198 10.9777 2.38198 10.6551 2.57079C10.5602 2.62647 10.4487 2.72931 10.0449 3.13311L9.45604 3.72094L11.7213 5.98617L12.3102 5.39833C12.7139 4.99457 12.8168 4.88307 12.8725 4.78818C13.0613 4.46561 13.0612 4.06585 12.8725 3.74326C12.8169 3.64827 12.7146 3.53752 12.3102 3.13311C11.9057 2.72863 11.795 2.6264 11.7 2.57079Z" fill="currentColor"/></svg>'
const ICON_CODE =
  '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M12.3368 1.53569L11.931 4.43172H14.8086V5.79673H11.7404L11.1962 9.67859H14.2839V11.0436H11.0056L10.4994 14.6529L9.14873 14.4643L9.62731 11.0436H5.75876L5.25252 14.6529L3.90186 14.4643L4.38043 11.0436H1.69141V9.67859H4.57104L5.11417 5.79673H2.21609V4.43172H5.30581L5.73724 1.34713L7.08995 1.53569L6.68414 4.43172H10.5527L10.9841 1.34713L12.3368 1.53569ZM5.94937 9.67859H9.81791L10.361 5.79673H6.49353L5.94937 9.67859Z" fill="currentColor"/></svg>'
const ICON_SPARKLE =
  '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6.1 3.1Q6.6 7.8 11.3 8.3Q6.6 8.8 6.1 13.5Q5.6 8.8 0.9 8.3Q5.6 7.8 6.1 3.1Z" fill="currentColor"/><path d="M11.9 1Q12.2 3.7 14.9 4Q12.2 4.3 11.9 7Q11.6 4.3 8.9 4Q11.6 3.7 11.9 1Z" fill="currentColor"/><path d="M12.5 9.4Q12.7 11.4 14.7 11.6Q12.7 11.8 12.5 13.8Q12.3 11.8 10.3 11.6Q12.3 11.4 12.5 9.4Z" fill="currentColor"/></svg>'

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
/* 非对话视图（如轨迹）激活时隐藏整条竖栏，避免遮挡页面内容 */
.dsh-notes-dock.view-hidden { display: none; }
/* 复位规则用 :where() 保证零特异性，绝不覆盖任何组件类样式 */
:where(.dsh-notes-dock) button { font-family: inherit; font-size: inherit; border: none; background: none; color: inherit; cursor: pointer; }
:where(.dsh-notes-dock) input { font-family: inherit; font-size: inherit; color: inherit; }
:where(.dsh-notes-dock) textarea { font-family: inherit; font-size: inherit; color: inherit; }
:where(.dsh-notes-dock) select { font-family: inherit; font-size: inherit; color: inherit; }

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
`

function scopeOf(data, tab) {
  return tab === 'global' ? data.global : data.workspace
}

function openCount(todos) {
  let n = 0
  for (const item of todos) if (!item.done) n += 1
  return n
}

/* ======================================================================
   披露行组件 —— 官方同款（DisclosureRow / ReasoningRow / ContextInjectionRow /
   ToolRow 的 React 转写，结构逐条对应 dsh-client-ui-conversation 源码）
   ====================================================================== */

/* DisclosureRow：头部（图标 + 悬停换箭头 + 标题 + 折叠摘要）+ 展开正文 */
function ScDisclosure({ open, onToggle, icon, leading, title, collapsedContent, keepContent, className, children }) {
  const expandable = onToggle !== undefined
  const rowExpands = expandable
  const toggleFromKeyboard = (event) => {
    if (!rowExpands || (event.key !== 'Enter' && event.key !== ' ')) return
    event.preventDefault()
    onToggle()
  }
  const leadingEl = open
    ? React.createElement('span', { className: 'ds-leading' },
        React.createElement('span', { className: 'ds-chev', dangerouslySetInnerHTML: { __html: ICON_CHEVRON_DOWN } }),
      )
    : (leading !== undefined
        ? leading
        : React.createElement('span', { className: 'ds-leading' },
            React.createElement('span', { className: 'ds-icon', dangerouslySetInnerHTML: { __html: icon } }),
            React.createElement('span', { className: 'ds-chev', dangerouslySetInnerHTML: { __html: ICON_CHEVRON_DOWN } }),
          ))
  return React.createElement(
    'div',
    { className: 'ds-row' + (className === undefined ? '' : ' ' + className), 'data-open': open || undefined },
    React.createElement(
      'div',
      {
        className: 'ds-head',
        'data-disclosure-row': true,
        'data-expandable': rowExpands || undefined,
        role: rowExpands ? 'button' : undefined,
        tabIndex: rowExpands ? 0 : undefined,
        'aria-expanded': rowExpands ? open : undefined,
        onClick: rowExpands ? onToggle : undefined,
        onKeyDown: rowExpands ? toggleFromKeyboard : undefined,
      },
      leadingEl,
      React.createElement('span', { className: 'ds-title' }, title),
      (keepContent === true || !open) && collapsedContent,
    ),
    open ? children : null,
  )
}

/* 思考行（ReasoningRow）：Think 图标 + 首行/末行摘要 + 运行扫描动画 */
function firstLineOf(text) {
  const newline = text.indexOf('\n')
  return newline === -1 ? text : text.slice(0, newline)
}
function latestLineOf(text) {
  const visible = text.trimEnd()
  const newline = visible.lastIndexOf('\n')
  return newline === -1 ? visible : visible.slice(newline + 1)
}
function ScReasoning({ row, streaming }) {
  const [expanded, setExpanded] = useState(false)
  const summaryRef = useRef(null)
  const text = row.text ?? ''
  const summary = streaming === true ? latestLineOf(text) : firstLineOf(text)
  useLayoutEffect(() => {
    const element = summaryRef.current
    if (element === null) return
    element.scrollLeft = streaming === true ? element.scrollWidth - element.clientWidth : 0
  }, [streaming, summary])
  const open = streaming === true || expanded
  return React.createElement(
    'div',
    { className: 'ds-row ds-reason', 'data-variant': 'think', 'data-state': streaming === true ? 'running' : 'ok' },
    streaming === true ? React.createElement('span', { className: 'ds-vhidden' }, '运行中') : null,
    React.createElement(ScDisclosure, {
      open,
      onToggle: () => setExpanded((value) => !value),
      icon: ICON_THINK,
      title: 'Think',
      collapsedContent: React.createElement(React.Fragment, null,
        React.createElement('span', { className: 'ds-sep', 'aria-hidden': true }),
        React.createElement('span', {
          ref: summaryRef,
          className: 'ds-summary',
          'data-follow-end': streaming === true || undefined,
        }, summary),
      ),
      children: React.createElement('div', { className: 'ds-thinkBody' }, text),
    }),
  )
}

/* 上下文行（ContextInjectionRow）：标题 + 生产者/摘要 + 表单化代码块正文 */
function asRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : null
}
function boundedText(text) {
  return text.length > 20000 ? text.slice(0, 20000) + '…' : text
}
function instructionChanges(source) {
  const record = asRecord(source)
  const list = record === null ? undefined : record.changes
  if (!Array.isArray(list)) return null
  const changes = []
  const seen = new Set()
  for (const entry of list) {
    const change = asRecord(entry)
    if (change === null) return null
    const path = change.path
    if (typeof path !== 'string' || path === '') return null
    const action = change.action
    if (action !== 'set' && action !== 'replace' && action !== 'remove') return null
    if (seen.has(path)) continue
    seen.add(path)
    changes.push({ action, path, ...(typeof change.digest === 'string' ? { digest: change.digest } : {}) })
  }
  return changes.length === 0 ? null : changes
}
function instructionActionLabel(action, baseline) {
  if (action === 'remove') return '已移除'
  if (baseline === true) return '已载入'
  return action === 'set' ? '已新增' : '已更新'
}
function catalogEntriesOf(source) {
  const record = asRecord(source)
  const list = record === null ? undefined : record.entries
  if (!Array.isArray(list)) return null
  const entries = []
  for (const item of list) {
    const entry = asRecord(item)
    if (entry === null) return null
    const name = entry.name
    const description = entry.description
    if (typeof name !== 'string' || name === '' || typeof description !== 'string') return null
    entries.push({ name, description })
  }
  return entries
}
function snapshotSectionsOf(source) {
  const record = asRecord(source)
  const list = record === null ? undefined : record.sections
  if (!Array.isArray(list)) return null
  const sections = []
  for (const item of list) {
    const section = asRecord(item)
    if (section === null) return null
    const name = section.name
    const text = section.text
    if (typeof name !== 'string' || name === '' || typeof text !== 'string') return null
    sections.push({ name, text })
  }
  return sections.length === 0 ? null : sections
}
function relaySenderOf(source) {
  const sender = asRecord(source) === null ? undefined : source.senderSessionId
  return typeof sender === 'string' && sender !== '' ? sender : null
}
function recalledSessionsOf(source) {
  const record = asRecord(source)
  const list = record === null ? undefined : record.references
  if (!Array.isArray(list)) return null
  const sessions = []
  for (const item of list) {
    const reference = asRecord(item)
    if (reference === null) return null
    const label = reference.label
    const retained = reference.retainedMessages
    const omitted = reference.omittedMessages
    const truncated = reference.truncated
    if (typeof label !== 'string' || label === '' || typeof retained !== 'number' || typeof omitted !== 'number' || typeof truncated !== 'boolean') return null
    sessions.push({ label, retained, omitted, truncated })
  }
  return sessions.length === 0 ? null : sessions
}
function contextBodyEl(row) {
  const source = row.source
  const text = row.text ?? ''
  const form = asRecord(source) === null ? null : (typeof source.form === 'string' ? source.form : null)
  const modelText = React.createElement('pre', { className: 'ds-cb-text', 'data-context-text': true }, boundedText(text))
  const sourceFields = () => {
    const record = asRecord(source)
    if (record === null) return null
    const keys = Object.keys(record).filter((key) => !['form', 'summary'].includes(key))
    if (keys.length === 0) return null
    return React.createElement('div', { className: 'ds-cb-fields' },
      keys.map((key) =>
        React.createElement('div', { key: key, className: 'ds-cb-field' },
          React.createElement('span', { className: 'ds-cb-fieldKey' }, key),
          React.createElement('span', { className: 'ds-cb-fieldValue' }, JSON.stringify(record[key])),
        ),
      ),
    )
  }
  switch (form) {
    case 'instructions': {
      const changes = instructionChanges(source)
      if (changes === null) return React.createElement(React.Fragment, null, modelText, sourceFields())
      const baseline = asRecord(source) !== null && source.baseline === true
      return React.createElement(React.Fragment, null,
        React.createElement('ul', { className: 'ds-cb-files', 'data-context-files': true },
          changes.map((change) =>
            React.createElement('li', { key: change.path, className: 'ds-cb-file', title: change.digest },
              React.createElement('span', { className: 'ds-cb-filePath' }, change.path),
              React.createElement('span', { className: 'ds-cb-fileAction' }, instructionActionLabel(change.action, baseline)),
            ),
          ),
        ),
        modelText,
      )
    }
    case 'catalog': {
      const entries = catalogEntriesOf(source)
      if (entries === null) return React.createElement(React.Fragment, null, modelText, sourceFields())
      const update = asRecord(source) !== null && source.update === true
      const shown = entries.slice(0, 200)
      return React.createElement(React.Fragment, null,
        update === true ? React.createElement('p', { className: 'ds-cb-catalogNotice', 'data-context-catalog-update': true }, '替换目录') : null,
        React.createElement('ul', { className: 'ds-cb-entries', 'data-context-entries': true },
          shown.map((entry, index) =>
            React.createElement('li', { key: index, className: 'ds-cb-entry' },
              React.createElement('code', { className: 'ds-cb-entryName' }, entry.name),
              React.createElement('span', { className: 'ds-cb-entryDescription' }, entry.description),
            ),
          ),
        ),
        shown.length < entries.length
          ? React.createElement('p', { className: 'ds-cb-catalogNotice', 'data-context-entries-truncated': true }, `…还有 ${entries.length - shown.length} 条`)
          : null,
      )
    }
    case 'snapshot': {
      const sections = snapshotSectionsOf(source)
      if (sections === null) return React.createElement(React.Fragment, null, modelText, sourceFields())
      return React.createElement(React.Fragment, null,
        React.createElement('p', { className: 'ds-cb-catalogNotice', 'data-context-snapshot-supersedes': true }, '取代先前的快照'),
        React.createElement('dl', { className: 'ds-cb-sections', 'data-context-sections': true },
          sections.map((section, index) =>
            React.createElement('div', { key: index, className: 'ds-cb-section' },
              React.createElement('dt', { className: 'ds-cb-sectionName' }, section.name),
              React.createElement('dd', { className: 'ds-cb-sectionText' }, boundedText(section.text)),
            ),
          ),
        ),
      )
    }
    case 'notice':
      return modelText
    case 'relay': {
      const sender = relaySenderOf(source)
      if (sender === null) return React.createElement(React.Fragment, null, modelText, sourceFields())
      return React.createElement(React.Fragment, null,
        React.createElement('p', { className: 'ds-cb-relaySender', 'data-context-relay-sender': true }, `来自会话 ${sender}`),
        modelText,
      )
    }
    case 'recall': {
      const sessions = recalledSessionsOf(source)
      if (sessions === null) return React.createElement(React.Fragment, null, modelText, sourceFields())
      return React.createElement(React.Fragment, null,
        React.createElement('ul', { className: 'ds-cb-recalls', 'data-context-recalls': true },
          sessions.map((session, index) =>
            React.createElement('li', { key: index, className: 'ds-cb-recall' },
              React.createElement('span', { className: 'ds-cb-recallLabel' }, session.label),
              React.createElement('span', { className: 'ds-cb-recallCounts' }, `保留 ${session.retained} 条 · 省略 ${session.omitted} 条`),
              session.truncated === true ? React.createElement('span', { className: 'ds-cb-recallCounts' }, '已截断') : null,
            ),
          ),
        ),
        modelText,
      )
    }
    default:
      return React.createElement(React.Fragment, null, modelText, sourceFields())
  }
}
function ScContext({ row }) {
  const [expanded, setExpanded] = useState(false)
  return React.createElement(
    'div',
    { className: 'ds-row ds-context', 'data-open': expanded || undefined },
    React.createElement(ScDisclosure, {
      open: expanded,
      onToggle: () => setExpanded((value) => !value),
      icon: ICON_BROWSE,
      title: row.label ?? '上下文注入',
      keepContent: true,
      collapsedContent: row.producer !== '' || row.summary !== undefined
        ? React.createElement(React.Fragment, null,
            row.producer !== ''
              ? React.createElement(React.Fragment, null,
                  React.createElement('span', { className: 'ds-sep', 'aria-hidden': true }),
                  React.createElement('span', { className: 'ds-source', 'data-context-source': true }, row.producer),
                )
              : null,
            row.summary !== undefined && row.summary !== ''
              ? React.createElement(React.Fragment, null,
                  React.createElement('span', { className: 'ds-sep', 'aria-hidden': true }),
                  React.createElement('span', { className: 'ds-summary', 'data-context-summary': true }, row.summary),
                )
              : null,
          )
        : null,
      children: React.createElement('div', {
        className: 'ds-body',
        'data-context-injection-body': true,
        'data-context-form': formOf(row.source) ?? undefined,
      }, contextBodyEl(row)),
    }),
  )
}
function formOf(source) {
  const record = asRecord(source)
  const form = record === null ? null : (typeof record.form === 'string' ? record.form : null)
  return form !== null && ['instructions', 'catalog', 'snapshot', 'notice', 'relay', 'recall'].includes(form) ? form : null
}

/* 工具行（ToolRow）：变体图标 + 标题/摘要 + IN/OUT 卡 + 状态点 */
const TOOL_TITLES = {
  cordis_package_inspect: 'Inspect',
  cordis_runtime_inspect: 'Inspect',
  cordis_run: 'Run Cordis Plugin',
  cordis_stop: 'Stop Cordis Plugin',
  cordis_undefine: 'Remove Cordis Plugin',
  pwsh: 'Pwsh',
}
const TOOL_VARIANTS = {
  bash: 'bash', pwsh: 'bash', read: 'read', web_fetch: 'read', web_search: 'search', grep: 'search', glob: 'search',
  write: 'write', edit: 'edit', run_code: 'code',
  cordis_package_inspect: 'read', cordis_runtime_inspect: 'read', cordis_run: 'others', cordis_stop: 'others', cordis_undefine: 'others',
}
const VARIANT_TITLES = { search: 'Search', read: 'Read', bash: 'Bash', write: 'Write', edit: 'Edit', code: 'Code', others: 'Tool call' }
const VARIANT_ICONS = { search: ICON_SEARCH, read: ICON_BROWSE, bash: ICON_API, write: ICON_EDIT, edit: ICON_EDIT, code: ICON_CODE, others: ICON_SPARKLE }
const SUMMARY_KEYS = {
  bash: ['description', 'command'],
  read: ['path', 'file_path', 'url'],
  search: ['query', 'pattern', 'url'],
  write: ['path', 'file_path'],
  edit: ['path', 'file_path'],
  code: ['description'],
  others: [],
}
function parseArgs(raw) {
  try { return JSON.parse(raw) } catch { return undefined }
}
function pickString(args, keys) {
  for (const key of keys) {
    const value = args[key]
    if (typeof value === 'string' && value !== '') return value
  }
  return undefined
}
function deriveSummary(variant, argsRaw) {
  const parsed = parseArgs(argsRaw)
  if (typeof parsed !== 'object' || parsed === null) return firstLineOf(argsRaw)
  const picked = pickString(parsed, SUMMARY_KEYS[variant] ?? [])
  if (picked !== undefined) return firstLineOf(picked)
  for (const value of Object.values(parsed)) {
    if (typeof value === 'string' && value !== '') return firstLineOf(value)
  }
  return firstLineOf(argsRaw)
}
function deriveBody(variant, argsRaw) {
  if (argsRaw === '') return null
  const parsed = parseArgs(argsRaw)
  if (parsed === undefined) return argsRaw
  if (variant === 'code' && typeof parsed === 'object' && parsed !== null) {
    const code = parsed.code
    if (typeof code === 'string' && code !== '') return code
  }
  return JSON.stringify(parsed, null, 2)
}
function toolRowModel(row) {
  const name = row.name ?? ''
  const variant = TOOL_VARIANTS[name] ?? 'others'
  const argsRaw = row.args ?? ''
  const state = row.done === true ? (row.isError === true ? 'error' : 'ok') : 'running'
  const base = argsRaw === '' ? (row.callId ?? row.id) : deriveSummary(variant, argsRaw)
  const toolTitle = TOOL_TITLES[name]
  const summary = variant === 'others' && name !== '' && toolTitle === undefined ? `${name} · ${base}` : base
  const output = row.done === true ? (row.result ?? '') : null
  const errorSummary = state === 'error' && output !== null && output !== '' ? firstLineOf(output) : null
  return {
    variant,
    title: toolTitle ?? VARIANT_TITLES[variant],
    summary,
    output,
    errorSummary,
    state,
    body: deriveBody(variant, argsRaw),
  }
}
function ScTool({ row, streaming }) {
  const [expanded, setExpanded] = useState(false)
  const model = toolRowModel(row)
  const open = (streaming === true || expanded) && (model.body !== null || model.output !== null)
  const statusText = model.state === 'running' ? '运行中' : model.state === 'error' ? '失败' : model.state === 'stopped' ? '已停止' : null
  const summaryText = model.errorSummary !== null ? model.errorSummary : model.summary
  const stateDot = model.state === 'error' || model.state === 'stopped'
    ? React.createElement('span', { className: 'ds-icon' },
        React.createElement('span', { className: 'ds-dot', 'data-state': model.state === 'error' ? 'error' : 'warning' }),
      )
    : undefined
  const leading = stateDot !== undefined
    ? React.createElement('span', { className: 'ds-leading' },
        stateDot,
        React.createElement('span', { className: 'ds-chev', dangerouslySetInnerHTML: { __html: ICON_CHEVRON_DOWN } }),
      )
    : undefined
  return React.createElement(
    'div',
    { className: 'ds-row ds-tool', 'data-variant': model.variant, 'data-tool': row.name ?? '', 'data-state': model.state },
    statusText !== null ? React.createElement('span', { className: 'ds-vhidden' }, statusText) : null,
    React.createElement(ScDisclosure, {
      open,
      onToggle: () => setExpanded((value) => !value),
      icon: VARIANT_ICONS[model.variant],
      leading,
      title: model.title,
      keepContent: true,
      collapsedContent: summaryText !== ''
        ? React.createElement(React.Fragment, null,
            React.createElement('span', { className: 'ds-sep', 'aria-hidden': true }),
            React.createElement('span', { className: 'ds-summary' + (model.errorSummary !== null ? ' ds-errorSummary' : '') }, summaryText),
          )
        : null,
      children: React.createElement('div', { className: 'ds-bodyWrap' },
        model.body !== null || model.output !== null
          ? React.createElement('div', { className: 'ds-ioCard' },
              model.body !== null
                ? React.createElement('div', { className: 'ds-ioSection' },
                    React.createElement('span', { className: 'ds-ioLabel' }, 'IN'),
                    React.createElement('span', { className: 'ds-ioText' }, model.body),
                  )
                : null,
              model.body !== null && model.output !== null
                ? React.createElement('span', { className: 'ds-ioDivider', 'aria-hidden': true })
                : null,
              model.output !== null
                ? React.createElement('div', { className: 'ds-ioSection' },
                    React.createElement('span', { className: 'ds-ioLabel' }, 'OUT'),
                    React.createElement('span', { className: 'ds-ioText', 'data-error': model.state === 'error' || undefined }, model.output),
                  )
                : null,
            )
          : null,
      ),
    }),
  )
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
  // 当前会话视图是否为「对话」（false 时隐藏整条竖栏，见定位 effect 的 detectChatView）
  const [viewIsChat, setViewIsChat] = useState(true)
  const [split, setSplit] = useState(() => {
    try {
      const value = Number(localStorage.getItem(SPLIT_KEY))
      if (Number.isFinite(value)) return Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, value))
    } catch { /* ignore */ }
    return SPLIT_DEFAULT
  })
  const [width, setWidth] = useState(() => {
    try {
      const value = Number(localStorage.getItem(WIDTH_KEY))
      if (Number.isFinite(value)) return Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, Math.round(value)))
    } catch { /* ignore */ }
    return WIDTH_DEFAULT
  })
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
  const [historyCard, setHistoryCard] = useState(null) // { label, rows } | null（历史轮次记录卡片）
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
  const scMsgRef = useRef(null) // 消息列表滚动容器（瀑布流跟随）
  const atBottomRef = useRef(true) // 用户是否停留在底部（跟随滚动依据）
  const forceFollowRef = useRef(false) // 发送后强制滚到底一次

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
    setViewIsChat(detectChatView())
    let raf = 0
    const scheduleUpdate = () => {
      if (raf !== 0) return
      raf = requestAnimationFrame(() => {
        raf = 0
        scrollEl = findScrollBody()
        updateLeft()
        updateTop()
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
      // 这些变化不产生 childList 时也必须能触发 top 重测。
      observer.observe(center, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'data-phase', 'aria-selected'] })
    }
    // 兜底 1：tab 点击必然触发（捕获阶段监听，与 React 渲染无关）；
    // 点击事件先于视图重渲染到达，rAF 中重检时 DOM 已切换完成。
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

  /* ---------- 折叠（v0.4.28 起移除：竖栏在对话页始终展开显示） ---------- */
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

  /* ---------- 待办详情卡片（双击行 / 悬停「详情」按钮弹出；标题与描述均在此编辑，
     自动保存：防抖 600ms + 关闭时落盘；行内标题编辑 v0.4.27 起移除） ---------- */
  function openDetail(item) {
    flushDetailSave()
    const draft = { id: item.id, text: item.text, detail: item.detail ?? '' }
    detailDraftRef.current = draft
    detailDirtyRef.current = false
    setDetailStatus('')
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

  function formatTime(ms) {
    if (typeof ms !== 'number' || !Number.isFinite(ms)) return '—'
    const d = new Date(ms)
    const pad = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
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

  /* 轮询：运行中 400ms（瀑布流） / 空闲 3s；非对话视图隐藏时不轮询 */
  useEffect(() => {
    if (!viewIsChat) return
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
  }, [viewIsChat, fetchChat])

  /* 瀑布流跟随：内容增长时若停留在底部则自动滚到底（与官方 ChatView 一致）；
     发送后强制跟随一次；展开时若本就在底部也滚到底。 */
  useLayoutEffect(() => {
    const el = scMsgRef.current
    if (el === null) return
    if (forceFollowRef.current || atBottomRef.current) {
      el.scrollTop = el.scrollHeight
      atBottomRef.current = true
    }
    forceFollowRef.current = false
  }, [chat])

  function onScMsgScroll() {
    const el = scMsgRef.current
    if (el === null) return
    const floor = Math.max(0, el.scrollHeight - el.clientHeight)
    atBottomRef.current = floor - el.scrollTop <= 24
  }

  /* 挂载时刷新卡片状态 */
  useEffect(() => {
    void refreshCard()
  }, [refreshCard])

  async function sendMessage() {
    const input = scInputRef.current
    if (input === null || card === null) return
    const text = input.value.trim()
    if (text === '') return
    input.value = ''
    forceFollowRef.current = true // 发送后滚到底，等待瀑布流落下
    const binding = sessions !== undefined && sessions !== null ? sessions.binding(card.sessionId) : undefined
    if (binding === undefined || binding.session === undefined) {
      setCardError('会话暂不可用（未列出），正在重试…')
      setTimeout(() => void refreshCard(), 600)
      return
    }
    try {
      const result = await binding.session.prompt([{ type: 'text', text }], 'queue')
      if (result !== undefined && (result.ok !== true || result.value?.accepted !== true)) {
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

  /* ---------- 右边缘水平拖拽（调整竖栏宽度） ---------- */
  const widthDragRef = useRef(null)
  function onWidthPointerDown(event) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    event.preventDefault()
    widthDragRef.current = event.pointerId
    if (dockRef.current !== null) dockRef.current.classList.add('resize-dragging')
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* ignore */ }
  }
  function onWidthPointerMove(event) {
    if (widthDragRef.current === null) return
    const next = Math.round(Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, event.clientX - left)))
    setWidth(next)
    try { localStorage.setItem(WIDTH_KEY, String(next)) } catch { /* ignore */ }
  }
  function onWidthPointerUp() {
    widthDragRef.current = null
    if (dockRef.current !== null) dockRef.current.classList.remove('resize-dragging')
  }

  /* ---------- 渲染 ---------- */
  const dockStyle = { left: `${left}px`, top: `${top}px`, width: `${width}px`, '--sc-ratio': `${split}%` }

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

  /* ---- 会话卡片：消息列表（简化显示：只渲染用户输入 / 模型输出 / 回合错误；
       上下文注入、思考、工具调用行由 Host 折叠但不再显示，随时可恢复） ---- */

  /* 模型输出内容：官方 MarkdownText → 内置 marked → 纯文本 */
  function assistantContent(text, streaming) {
    if (MarkdownText !== null) {
      return React.createElement(MarkdownText, { text, streaming: streaming === true, codeLabels: MD_LABELS })
    }
    if (markedParse !== null) {
      try {
        return React.createElement('div', { className: 'dsh-notes-md', dangerouslySetInnerHTML: { __html: markedParse(text) } })
      } catch { /* fall through */ }
    }
    return React.createElement('span', { className: 'sc-plain' }, text)
  }

  function rowElement(row, streaming) {
    const key = streaming === true ? `${row.id}-live` : row.id
    if (row.kind === 'turn-error') {
      return React.createElement(
        'div',
        { key, className: 'ds-turn-error', role: 'status' },
        React.createElement('span', { className: 'ds-dot ds-turn-error-dot', 'data-state': 'error' }),
        React.createElement('div', { className: 'ds-turn-error-copy' },
          React.createElement('span', { className: 'ds-turn-error-title' }, '本轮运行失败'),
          React.createElement('span', { className: 'ds-turn-error-message' }, row.text ?? ''),
        ),
        row.code !== undefined && row.code !== ''
          ? React.createElement('code', { className: 'ds-turn-error-code' }, row.code)
          : null,
      )
    }
    return null
  }
  /* 消息行统一渲染（主列表与历史记录卡片共用） */
  function rowElementOf(message, streaming) {
    if (message.kind === 'user') {
      return React.createElement('div', { key: message.id, className: 'sc-msg user' }, message.text)
    }
    if (message.kind === 'assistant') {
      return React.createElement('div', { key: message.id, className: 'sc-msg assistant' },
        React.createElement('div', { className: 'bubble' }, assistantContent(message.text, streaming === true)),
      )
    }
    return rowElement(message, streaming)
  }
  const chatRows = []
  if (chat === null || chat.cold === true) {
    chatRows.push(React.createElement('div', { key: 'empty', className: 'sc-empty' }, chat === null ? '常驻会话 · 直接在这里对话' : '常驻会话 · 发送首条消息以开始'))
  } else {
    /* 按用户消息分轮：每轮 = 一条用户输入 + 后续模型输出/回合错误；
       只有一轮时正常平铺，多轮时之前的轮次折叠成摘要行（点击弹出记录卡片） */
    const turns = []
    let current = null
    for (const message of chat.messages) {
      if (message.kind === 'user') {
        current = { id: message.id, userText: message.text, rows: [message] }
        turns.push(current)
      } else if (current !== null) {
        current.rows.push(message)
      } else {
        current = { id: 't0', userText: '', rows: [message] }
        turns.push(current)
      }
    }
    if (turns.length <= 1) {
      for (const message of chat.messages) chatRows.push(rowElementOf(message, false))
    } else {
      for (let i = 0; i < turns.length - 1; i++) {
        const turn = turns[i]
        const preview = (turn.userText.split('\n')[0] ?? '').trim()
        const shown = preview.length > 18 ? preview.slice(0, 18) + '…' : preview
        chatRows.push(
          React.createElement('div', {
            key: `h${turn.id}`,
            className: 'sc-history',
            'data-tip': '查看该轮对话记录',
            onClick: () => setHistoryCard({ label: `对话 ${i + 1} · ${shown}`, rows: turn.rows }),
          },
            React.createElement('span', { className: 'sc-history-label' }, `对话 ${i + 1}`),
            React.createElement('span', { className: 'sc-history-preview' }, shown === '' ? '（无标题）' : shown),
            React.createElement('span', { className: 'sc-history-chev' }, '›'),
          ),
        )
      }
      for (const message of turns[turns.length - 1].rows) chatRows.push(rowElementOf(message, false))
    }
    const streamingText = Array.isArray(chat.partials)
      ? chat.partials.some((p) => p.kind === 'assistant' && p.text !== '')
      : false
    if (Array.isArray(chat.partials)) {
      for (const partial of chat.partials) {
        if (partial.kind === 'assistant') {
          const last = chat.messages[chat.messages.length - 1]
          const duplicate = last !== undefined && last.kind === 'assistant' && last.text === partial.text
          if (!duplicate) {
            chatRows.push(
              React.createElement('div', { key: `${partial.id}-stream`, className: 'sc-msg assistant' },
                React.createElement('div', { className: 'bubble' },
                  assistantContent(partial.text, true),
                  React.createElement('span', { className: 'cursor' }),
                ),
              ),
            )
          }
        } else {
          const el = rowElement(partial, true)
          if (el !== null) chatRows.push(el)
        }
      }
    }
    /* 运行中且尚无可见流式文本（思考/工具阶段）：官方同款流光「正在生成…」状态行 */
    if (chat.running === true && !streamingText) {
      chatRows.push(React.createElement('div', { key: 'streaming-status', className: 'sc-streaming-status', role: 'status' }, '正在生成…'))
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

  /* ---- 卡片状态行 ---- */
  const running = chat !== null && chat.cold !== true && chat.running === true
  const statusText = running
    ? '运行中…'
    : (card === null ? '加载中…' : (card.blank === true ? '空白 · 预设可切换' : '已开始 · 预设已锁定'))

  return React.createElement(
    'div',
    {
      className: 'dsh-notes-dock' + (viewIsChat ? '' : ' view-hidden'),
      'data-notes-ver': '04c8f3',
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
            'data-tip': '设置（预设/模型/思考等级）',
            onClick: () => setPopupOpen((prev) => !prev),
            dangerouslySetInnerHTML: { __html: ICON_GEAR },
          }),
        ),
        React.createElement('div', { ref: scMsgRef, className: 'sc-messages', onScroll: onScMsgScroll }, ...chatRows),
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
        /* 历史轮次记录卡片：只覆盖常驻会话区域 */
        historyCard === null
          ? null
          : React.createElement(
              'div',
              {
                className: 'sc-history-overlay',
                onClick: (event) => { if (event.target === event.currentTarget) setHistoryCard(null) },
              },
              React.createElement(
                'div',
                { className: 'sc-history-card' },
                React.createElement(
                  'div',
                  { className: 'sc-history-card-head' },
                  React.createElement('span', { className: 't' }, historyCard.label),
                  React.createElement('button', { type: 'button', className: 'x', 'data-tip': '关闭', onClick: () => setHistoryCard(null) }, '×'),
                ),
                React.createElement(
                  'div',
                  { className: 'sc-history-card-body' },
                  ...historyCard.rows.map((message) => rowElementOf(message, false)).filter(Boolean),
                ),
              ),
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
        /* 待办详情卡片：只覆盖小计区域，不遮挡常驻会话 */
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
                  { className: 'np-detail-body' },
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
                      value: detailDraft.detail,
                      onChange: onDetailTextarea,
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
    React.createElement('div', {
      key: 'resizer',
      className: 'dock-resizer',
      'data-tip': '拖动调整竖栏宽度',
      onPointerDown: onWidthPointerDown,
      onPointerMove: onWidthPointerMove,
      onPointerUp: onWidthPointerUp,
      onPointerCancel: onWidthPointerUp,
    }),
    React.createElement('div', { key: 'tip', className: 'np-tip', ref: tipRef, hidden: true }),
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
