# dsh-notes 设计文档

> 版本：0.4 · 状态：**已实现（M1 融合完成 + transcript 分级折叠，待重启 DSH 后验收）** · 关联原型：`prototype/index.html`
>
> 变更记录：
> 0.4.21 —— 待办详情卡片遮罩改为**毛玻璃**：`background` 置透明 + `backdrop-filter: blur(6px)`（含 `-webkit-` 前缀），不再用纯色遮罩。原型同步。
> 0.4.20 —— 待办详情卡片**只覆盖小计区域**：卡片模态层从竖栏根移入 `.np-section` 内部（`position: relative` 锚定），`inset: 0` 只盖住下半小计区，**不遮挡常驻会话**（上半会话卡片保持可见可交互）；卡片样式不变。原型同步。
> 0.4.19 —— 待办**详情按钮 + 弹出卡片**：每条待办行悬停出现「详情」按钮，点击弹出卡片（覆盖竖栏的模态层）显示并编辑**标题 + 描述**——新增 `TodoItem.detail` 字段（≤20000，`add`/`edit` 动作可携带，旧数据缺省视为空串，存储域 version 不变无需迁移）；卡片底部显示创建/更新时间与完成/置顶状态；保存走 `edit`（同时落 `detail`），取消/点遮罩/ESC 关闭；行内双击编辑（仅 text）不受影响，撤销删除恢复完整对象（含 detail）。
> 0.4.18 —— **常驻会话设置持久化 + cwd 固定临时目录**：状态文件 `~/.dsh/session-card.json` 持久化 `{sessionId, presetId, provider, model, effort}`——⚙ 选择的预设/模型/思考等级在清空会话、重启 DSH 后都会应用到新的常驻会话（`agents.create`/`agents.resume` 的 `agentOptions` 与预设挂载都用持久化值；持久化模型不可用时回退默认选择重试一次）；**移除 ⚙「工作目录（cwd）」设置与 `scard-select-cwd` 动作**，cwd 不再持久化，每次新会话恒用系统临时目录 `{tmpdir}/dsh-notes-resident`（空白旧会话若 header.cwd 不一致仍自动重建落到临时目录）。
> 0.4.17 —— 小计**默认落在当前工作区**：tab 初始值按工作区解析结果（有工作区 → 工作区 tab，无 → 全局）；`useEffect` 跟踪 `workspaceId` 变化——切换工作区后自动切到新工作区的小计（而非停留在全局），解析不到工作区（如切到 stray 会话）时回全局；挂载早期工作区解析从 undefined 变为有值也会自动落到工作区。原型默认 tab 同步改为工作区。
> 0.4.16 —— 卡片输出**瀑布流效果**：运行中轮询 800ms → 400ms（流式内容更连续）；流式输出尾部常显**闪烁光标**（不再只在纯文本降级时显示）；内容增长时若停留在底部则**自动跟随滚动**（用户上翻后不打断，发送后强制滚到底一次；与官方 ChatView 一致）；思考/工具阶段（尚无可见流式文本）显示官方 turnStatus 同款**流光「正在生成…」状态行**（品牌渐变 + background-clip 文字 + 1.8s shimmer）；新消息行轻微上浮淡入（0.18s，流式行 key 稳定不重复触发）；`prefers-reduced-motion` 下关闭动画。原型同步状态行演示。
> 0.4.15 —— **修复发送后误报「发送失败」**：`session.prompt` 的 wire 响应是 `{ok:true, value:{accepted:true}}`——`accepted` 在 `value` 内层，客户端旧判断读顶层 `result.accepted` 恒为 `undefined` → 每次发送成功也走失败分支显示「发送失败」，直到下一次轮询 `scard-chat-state` 成功才清掉（表现为「先显示发送失败、一会儿内容出现后消失」）。修复：改判 `result.ok === true && result.value?.accepted === true`。
> 0.4.14 —— 卡片模型输出支持 **Markdown 渲染**：复用官方 `dsh-client-ui-primitives` 的 `MarkdownText`（GFM + TeX 数学 + 安全链接 + 流式增量渲染，代码块带复制按钮）；加载失败降级纯文本。原型加精简 md 演示渲染器。
> 0.4.13 —— **修复回复内容重复显示**：同一输出被推了两次——流式块收尾（`block-end`/冲刷）先落一行，随后 `assistant/message` 最终事件又落一行。修复：按 `turn:step` 记录流式收尾行，`assistant/message` 落地时先移除同 step 的流式行再推最终行（与官方会话「partial 被最终消息替换」一致）；工具行改按 `callId` 去重（流式块与 `tool/call` 事件共用一行）。
> 0.4.12 —— **修复清空会话后旧内容回灌**：`ensureResident()` 单飞缓存未失效——清空后创建的新会话 B 不被轮询使用，`scard-chat-state` 仍解析到旧会话 A 的 transcript（UI 先清空、轮询又把旧消息灌回）。修复：`scard-clear` / `scard-select-cwd` 重建分支置 `residentPromise = null`，下次轮询重新读状态文件解析新会话。清空效果与归档一致（旧会话归档隐藏，卡片落到新空白会话）。
> 0.4.11 —— 分隔条改为**明显的分割细线**（全宽 1px `border-l2`，9px 热区本身即拖拽把手）；拖拽样式对齐 **DSH 原生**（无悬浮胶囊/底色/手柄，仅 `row-resize`/`col-resize` 指针变化；右缘宽度拖拽同改）。
> 0.4.10 —— **常驻会话工作目录可配置**：⚙ 弹窗新增「工作目录（cwd）」输入；未配置或路径无效（非绝对路径/不存在/非目录）→ 自动回退系统临时目录 `{tmpdir}/dsh-notes-resident`；cwd 在会话创建时写入 header（工具与 `{{cwd}}` 都读 header.cwd），空白会话立即重建生效、已开始会话在清空后生效；`scard-select-cwd` 动作 + 状态文件 `cwd` 字段。
> 0.4.9 —— **修复常驻会话提示词组装失败**：常驻会话无 cwd，而 deployment/preset persona 引用 `{{cwd}}` → 「prompt variable has no value」回合错误。修复：setup 时在 agent 作用域注册 `cwd` 变量兜底（`session.header.cwd` 缺省时回退 `sandboxPolicy.workspaceRoot`，遮蔽全局注册）。
> 0.4.8 —— 卡片**简化显示**：只渲染用户输入 / 模型输出 / 回合错误；上下文注入、思考、工具调用行由 Host 照常折叠但客户端不再渲染（随时可恢复）。
> 0.4.7 —— 回合错误可见化（官方 TurnErrorItem）：`turn/end` 携带 `reason.kind === 'error'` 时折叠为 **turn-error 行**（红点 + 「本轮运行失败」 + 错误信息 + 错误码），模型 429 等失败不再被吞掉。
> 0.4.6 —— 披露行/拖拽把手**对齐官方实现**：思考（ReasoningRow）、上下文注入（ContextInjectionRow+ContextBody）、工具调用（ToolRow+IN/OUT 卡）改为与 DSH 会话视图逐条对应的结构/样式/文案（DisclosureRow 骨架：16px 图标槽 + 悬停换箭头 + 24px 行高 + 14px/24px 排版；Think 首行/末行摘要 + 运行扫描动画；上下文代码块正文 max-height 141px；工具变体图标 + 状态点 + 摘要）；分隔条与右缘宽度条改官方 AppFrame handle 悬浮胶囊样式（button-floating-fill/hover）。Host 上下文行透传原始 `source`、工具行增 `callId`。
> 0.4.5 —— 分隔条**平时简洁、悬停/拖拽时强调**：静置为透明底 + 短浅手柄（低透明），hover/拖拽切换为底色条（bg-overlay + l2 边框）+ 品牌色长手柄。
> 0.4.4 —— 竖栏**宽度可调**（§10.1 候选落地）：右边缘水平拖拽（220–480px，默认 280，localStorage 持久化；折叠态不受影响）。
> 0.4.3 —— transcript 分级折叠（对齐 DSH 会话视图）：`user/message` 按 `source` 区分人类输入与**注入上下文**（工作区指令/目录/快照/通知/跨会话召回，按 dsh-client-runtime `contextProvenance` 规则投影标题与生产者）；`assistant/message` 的 reasoning 块与 `tool/call`+`tool/result` 成卡；客户端渲染为**可折叠披露行**（思考/上下文注入/工具调用），流式 partial 按块类型实时展开（提交 `7330770`，客户端版本标记 `data-notes-ver="7330770"`）。
> 0.4.2 —— 融合实现落地（src 双 half）：Host 增 scard-* 动作 + 常驻会话管理 + agent/request 模型覆盖 + transcript 折叠；Client 改全高双分区（上卡片/分隔条/下小计），顶栏之下定位（提交 `9ce1cfb`，客户端版本标记 `data-notes-ver="2bc8a83"`）。
> 0.4.1 —— 评审修正：竖栏为**「上边栏之下」的全高**（从 DSH 顶部栏下缘到页面底部，不覆盖上边栏）；上下两部分之间的**分隔条明显化**（整条底色 + 抓握手柄）。
> 0.4 —— **融合 dsh-session-card**：dock 改为**全高**，上半部分为**常驻会话卡片**、下半部分为小计（上下可拖拽调比例）；会话卡片 RPC 并入 `/api/dsh-notes` HTTP 通道；scard-1 动态插件源码不在本会话（inspect 为空），Host 侧按旧 dsh-session-card `design.md`/`research.md` 契约重新实现；常驻会话状态文件沿用 `~/.dsh/session-card.json`，已建会话无缝延续。
> 0.3 —— 作用域由「会话」改为「工作区」（评审确认）；新增撤销删除、置顶、拖拽排序（§2/§5/§6）。

## 1. 概述

dsh-notes 在 DSH Web 界面中提供**侧栏与对话区之间的常驻竖栏**（无独立入口按钮、无弹窗）。v0.4 起竖栏**占据上边栏之下的整列高度**（从 DSH 顶部栏下缘到页面底部，**不覆盖上边栏**），自上而下分两个功能区：

1. **上半部分 —— 常驻会话卡片**（融合自 dsh-session-card）：卡片内直接对话的**插件专属常驻会话**（工作目录恒为系统临时目录，独立于任何用户工作区；预设/模型/思考等级 v0.4.18 起持久化），头部可设预设 / 模型 / 思考等级，支持清空会话（归档 + 新建）。
2. **下半部分 —— 小计**（原有功能）：**全局小记**（不分工作区）与**工作区小记**（以工作区隔离，跟随当前工作区）；每作用域含**待办区**（分点待办）与**随记区**（自由多行文本）。

两部分之间为**可拖拽分隔条**（调整上下比例，浏览器 localStorage 持久化）。整个竖栏仍可折叠成「📝 小记」胶囊按钮（折叠状态持久化）。

用户已确认的范围：

- 竖栏占据侧栏与对话区之间的**全高**（截图红色矩形区域）；
- **上半部分显示会话卡片**（卡片内可直接对话、可设预设/模型/思考等级、可清空），**下半部分显示小计**；
- 小计内容**不暴露给 agent**（隔离保证见 §2.1）；常驻会话是**独立的聊天通道**（其内容本身就是会话内容，见 §2.2）。

## 2. 功能清单

| 能力 | 说明 |
| --- | --- |
| 常驻竖栏（顶栏之下全高） | 固定于**左侧边栏与中间对话区之间**：宽 280、**从顶部栏下缘到页面底部**（`top: <顶栏高>; bottom: 0`，不覆盖 DSH 上边栏）、无独立入口按钮、无弹窗；无会话 hero 视图时仍显示（小计仅全局 tab） |
| 上下分区（明显分割） | **分隔条 = 明显的分割细线**（全宽 1px `border-l2`，9px 热区本身即拖拽把手）；拖拽样式 = **DSH 原生**（无特殊样式，仅 `row-resize` 指针变化）；调整比例（默认 上 ~46% / 下 ~54%，范围 25%–75%，双击复位），比例存 `localStorage['dsh-notes.split']` |
| 分区标题（风格统一） | 两个分区各有一个**同款标题行**（蓝点 + 标题 + 下缘分隔线，高 40）：上「常驻会话」（+ 会话 id 胶囊 + 操作按钮），下「小计」（+ 作用域 tab 行）——字体/间距/描边完全一致 |
| 折叠/展开 | 竖栏头部右侧「▾」按钮折叠；折叠后在同位置显示「📝 小记」胶囊按钮（点击展开）；折叠状态持久化；折叠/展开前先落盘随记 |
| 宽度可调（水平拖拽） | 竖栏**右边缘**拖拽调整宽度（默认 280px，范围 220–480px，`localStorage['dsh-notes.width']` 持久化；拖拽样式 = DSH 原生：不可见热区，仅 `col-resize` 指针变化）；折叠态胶囊不受影响 |
| 定位机制 | 与 v0.3 一致：`shell.overlay` 常驻条目 + `position: absolute` 浮层（定位上下文 = overlay 层，`inset: 0` 覆盖整个 AppFrame），不参与布局；`left` = AppFrame 网格第一列（侧栏列）实测宽度（向上找 grid 帧解析 `gridTemplateColumns`，MutationObserver 跟随折叠/拖拽）；`top: 0; bottom: 0`、`pointer-events: auto` |
| —— 会话卡片（上半） —— | |
| 常驻会话 | 插件专属会话：激活时 `agents.create`（`meta.cwd` 恒为系统临时目录 `{tmpdir}/dsh-notes-resident`，**每次新会话都在临时目录**）；状态文件 `~/.dsh/session-card.json`（沿用旧 dsh-session-card 路径）v0.4.18 起存 `{sessionId, presetId, provider, model, effort}`——预设/模型/思考等级持久化，清空或重启后的新会话沿用；进程重启后 `agents.resume` 恢复，空白会话 header.cwd 与临时目录不一致时自动重建 |
| 卡片内直接对话 | **简化显示（v0.4.8）**：只渲染用户输入气泡 / 模型输出气泡 / 回合错误行（官方 TurnErrorItem）；上下文注入、思考、工具调用行由 Host 照常折叠（§3.8-5 不变）但客户端不再显示，随时可恢复；**模型输出 Markdown 渲染（v0.4.14）**：官方 `MarkdownText`（GFM + TeX + 安全链接 + 流式）+ 输入发送 + 运行中可停止 |
| 内容读取 | Host 折叠 `agent.session.events` 为**分级 transcript**（user / assistant / context / reasoning / tool 行，见 §3.8-5），客户端轮询 `chat-state`（运行中 800ms / 空闲 3s；发送后立即轮询；`lastSeq` 未变且非运行中跳过重渲染） |
| 选择预设 | ⚙ 弹窗内 · `agentPresets` 名册；空白会话可切换（`presets.recompose` + `agent-preset/selected` 事件），已开始则锁定并提示 |
| 选择模型 / 思考等级 | ⚙ 弹窗内 · `llm` 模型目录（provider 分组）+ 当前模型 `reasoning.efforts`（含「默认」）；经 `agent/request` 全局瀑布监听（untagged、按会话 id 过滤）覆盖 provider/model/reasoningEffort |
| 清空会话 | 两段式确认；`workspaceRegistry.archiveSession` 归档 + 新建空白常驻会话（运行中拒绝）；客户端不自动导航 |
| —— 小计（下半，原有） —— | |
| Tab | 「全局」/「本工作区（工作区标题）」；无当前工作区（`recentWorkspaceId === undefined`）时隐藏工作区 tab；**默认落在当前工作区**（v0.4.17 起：首次加载有工作区即默认工作区 tab，切换工作区后自动回到新工作区的小计；无工作区时回全局），切换时各自独立读写 |
| 待办区 | 分区标题行（标题 + 「共 X 项 · 未完成 Y」+「清空已完成」）+ 添加输入行 + 分点列表：勾选/取消（显式传 done，幂等）、双击行内编辑（Enter 保存 / Esc 取消 / 失焦保存，空文本忽略）、**详情按钮（v0.4.19）**：悬停出现，点击弹出卡片编辑显示标题 + 描述（`detail` 字段，含创建/更新时间与完成/置顶状态）、删除（行悬停出现）、置顶（📌，置顶项恒在顶部）、拖拽排序（Pointer Events，拖到置顶区自动置顶）、撤销删除（5 秒内「撤销」条，恢复原位置） |
| 随记区 | 分区标题行（标题 + 保存状态）+ 多行 textarea：自由文本，防抖 600ms 自动保存 + 失焦立即保存；清空 = 文本置空 |
| 空/错状态 | 待办空列表提示；host 存储不可用时竖栏顶部错误条，UI 不崩溃 |
| 主题 | 全部使用 `--dsw-alias-*` 语义令牌，明暗由 `body[data-ds-dark-theme]` 自动适配（见 §7） |
| Agent 隔离 | 小计内容对 agent 完全不可见（见 §2.1）；常驻会话为独立聊天通道（见 §2.2） |

### 2.1 Agent 隔离（小计内容不可见保证，v0.4 更新）

小计是**用户私有**数据，agent（模型）在任何路径上都接触不到。**该保证只针对小计数据**；常驻会话是本插件新增的、用户主动使用的聊天功能，其内容本身就是会话内容（见 §2.2）：

1. **不注册模型工具**：不调用 `harness.defineTool` / `tools.register`，模型工具目录中不存在任何 notes 工具。
2. **不进提示词**：不注册 `systemPrompt` section / context / 变量，**小计内容永不进入任何模型上下文**（包括常驻会话的请求）。
3. **物理双通道**：小计数据只写入独立存储域文件 `~/.dsh/storages/notes.json`；常驻会话与普通会话一样写 `~/.dsh/sessions/<cwd>/<sessionId>/session.jsonl.zstd`（追加式 zstd JSONL）。**两条通道互不相交**：小计内容不会被折叠进常驻会话 transcript，常驻会话内容也不会写进 notes.json（详见 §3.6）。
4. **不注册 Remote 服务**：Host API 是普通 HTTP 路由（`webServer.register`，`/api/dsh-notes`），仅浏览器同源 `fetch` 调用；不经 typert gateway / api-remotes 暴露。
5. **键只是字符串**：工作区小计仅以 `workspaceId` 字符串为键；常驻会话仅以 sessionId 字符串为键，互不引用。
6. **无鉴权面**：HTTP API 无登录/密钥，仅依赖 DSH Web 本机绑定（默认 `127.0.0.1:3080`），部署层网络边界即访问边界。

### 2.2 常驻会话的性质（融合带来的新边界）

- 常驻会话是一个**真实的 DSH 会话**（工作目录恒为系统临时目录，v0.4.18 起不再可配置、不持久化；不绑定任何用户工作区），其消息、工具调用、模型请求与普通会话完全同路径——它是用户主动使用的聊天界面，**内容对 agent 可见是功能本身**（你在卡片里问的问题当然会进模型）。
- 常驻会话**读不到小计**：插件没有任何路径把小计内容注入常驻会话的请求（无 prompt 注入、无工具、无上下文拼接）；两套数据在存储与代码两个层面都隔离。
- 因此 v0.3 的「插件只依赖 webServer 与 storageDomain」变为：**小计功能**仍只依赖这两者；**会话卡片功能**额外依赖 `agents` / `agentPresets` / `llm` / `agentDefaultModel` / `workspaceRegistry` / `sessionTitle` / `sessionPersistence` / `sandboxPolicy` / `fs`（任一缺失 → 对应控件隐藏或降级，小计不受影响）。

## 3. 已核实的运行时事实（实现时不再猜测）

### 3.1 插槽（v0.3 已核实，v0.4 沿用）

| 插槽 | 类型/作用域 | 注册项 | owner props | standard props |
| --- | --- | --- | --- | --- |
| `shell.overlay` | list / root | `{id, order, label}` | 无 | `useSessions`、`useWorkspaces` |

- 竖栏是 `shell.overlay` 的一个**常驻条目**（id `notes-dock`，v0.4 起同时承载会话卡片，不再需要第二个 id；旧 `session-card` 条目由动态插件持有，融合后废弃）。
- overlay 层点击穿透（`.pI_x6G_overlayLayer`：`position:absolute; inset:0`，z-index 20），竖栏根元素需 `pointer-events: auto`。
- 定位：`position: absolute; top: <顶部栏高度>; bottom: 0; width: 280px（默认，220–480 可拖拽调整，见功能清单）`，定位上下文即 overlay 层；`left` 取自 AppFrame `grid-template-columns` 第一列（帧元素通过 `dockEl.parentElement…` 向上找 display:grid 节点），MutationObserver（`attributeFilter: ['style']`）+ `window.resize` 跟随侧栏折叠/拖拽。
- **顶部栏之下（v0.4.1）**：overlay 层 `inset: 0` 覆盖整个 AppFrame（含顶部栏区域），竖栏不能从 `top: 0` 开始；`top` 取**顶部栏下缘**——从 overlay 挂载容器向上定位 AppFrame 网格帧，测量其第一行（顶部栏）的高度（具体测量点在实现阶段按真实 DOM 结构核实，与 left 的 MutationObserver 同步机制共用）。原型以 `syncDockPos()` 模拟（测量 `#topbar.offsetHeight`）。
- 折叠态：仅渲染胶囊按钮（「📝 小记」+ 展开箭头），点击展开；折叠状态存 `localStorage['dsh-notes.collapsed']`。
- 注册范式：

```js
ctx.slots.inject('shell.overlay', () =>
  ctx.slots.register({ name: 'shell.overlay', id: 'notes-dock' }, NotesDock),
)
```

### 3.2 当前工作区与标题（v0.3 已核实，沿用）

`WorkspaceListState`（`dsh-client-runtime`）：
- `recentWorkspaceId: WorkspaceId | undefined`；
- `items: readonly WorkspaceView[]`，`WorkspaceView = { workspaceId, path, title, sessionIds, createdAt, updatedAt }`。

取值：
```ts
const workspaceId = useWorkspaces((s) => s.recentWorkspaceId)
const title       = useWorkspaces((s) => s.items.find((w) => w.workspaceId === workspaceId)?.title)
```

### 3.3 持久化（存储域，v0.3 已核实，沿用）

- Host 服务 `storageDomain`（`ctx.get('storageDomain')`）；JSON 后端根 `~/.dsh/storages`，域 `notes` 落盘 `~/.dsh/storages/notes.json`。
- 域/表名匹配 `/^[a-z][a-z0-9_]*$/`；表 `workspaces` 以 `workspaceId` 为键。
- zod 不可用 → schema 用鸭子类型透传（`parse` 对 null 抛错；`safeParse(null) → {success:false}`，null 是「从未写入」哨兵值）。
- 写入链路：浏览器 → POST → 插件内 promise 串行链 → 域写链（先落盘、后内存、再 `domain/changed`）→ `notes.json`；整文件原子替换（临时文件 + rename）；文件首次写入时创建。
- **常驻会话状态文件（新增）**：`{sandboxPolicy.workspaceRoot}/.dsh/session-card.json`，内容 `{"sessionId": "..."}`；实测本部署 workspaceRoot 解析为**用户主目录**，即 `~/.dsh/session-card.json`。**沿用旧 dsh-session-card 的同一路径**，融合后已有的常驻会话（scard-1 创建的）直接复用，对话历史保留。fs/sandboxPolicy 缺失时降级为仅内存运行（每次激活新建，console 注明）。

### 3.4 Host API 通道

- 独立插件（非动态 cordis 插件）的浏览器↔宿主通信使用 `webServer.register` 注册 HTTP 路由；路由注册须包在 `ctx.effect(...)` 中。
- v0.4 会话卡片不再使用动态插件的 `harness.handle` RPC，统一并入 `/api/dsh-notes` POST 动作（见 §6）。

### 3.5 主题令牌（v0.3 已核实，沿用 + 增补）

- alias 令牌定义于 `@deepseek-ai/dsh-client-ui-theme/lib/styles/design-platform.css`（`body` / `body[data-ds-dark-theme]` 两段），组件只消费 alias。
- 字体 `--dsw-font-family`；动效 `--ds-ease-in-out`、`--ds-transition-duration*`。
- v0.4 增补（会话卡片用）：`--dsw-alias-state-business-primary`（强调蓝：状态点、焦点边框、流式光标）、`--dsw-specific-bubble`（用户气泡）、`--dsw-alias-state-warn-primary`（确认提示）、`--dsw-alias-state-error-primary`（清空确认按钮）。本插件实际用到的 alias 令牌清单见 §7。

### 3.6 对话消息持久化（对照，v0.3 已核实）

| | 小计（本插件） | 常驻会话 / 普通对话（DSH 原生） |
| --- | --- | --- |
| 位置 | `~/.dsh/storages/notes.json` | `~/.dsh/sessions/<cwd 编码>/<sessionId>/session.jsonl.zstd` |
| 后端 | storage-domain（JSON 后端） | session-persistence-jsonl（追加式 JSONL，zstd） |
| 格式 | 人类可读 JSON（整文件快照） | 追加式 JSONL |
| 写入 | 原子整文件替换 + 域写链 | append-only 事件 |

- **小计侧**：不监听会话事件、不 append 会话日志、不产生任何 `SessionEvent`；agent 加载/恢复/搜索/导出只接触会话日志通道，结构上接触不到 notes 文件。
- **常驻会话侧**：它就是普通会话——日志、事件、agent 生命周期完全正常参与（否则卡片对话无法工作）。融合后插件**新增** `ctx.on('session/event', …)` 与 `ctx.on('agent/request', …)` 两个全局监听，但**只处理常驻会话 id**（`payload.agent.id === residentId`），且只做：递增 revision 计数（不缓存全文）、按 id 应用模型覆盖（其他会话直接放行）——不读取、不复制、不转发小计数据。

### 3.7 会话卡片 Host 服务契约（融合自旧 dsh-session-card research.md §2，实现依据）

| 服务 | 方法（本次使用） | 用途 |
| --- | --- | --- |
| `agents` | `create({sessionId, agentOptions, meta, setup})` / `resume({resumeSessionId, agentOptions, setup})` / `get(id)` | 创建/恢复常驻会话 agent |
| `agentPresets` | `list()` / `mount(agentCtx, id?)` / `recompose(agentCtx, id)` / `composedPreset(agentCtx)` / `defaultId` | 名册 / 组合 / 换预设 / 当前预设 |
| `llm` | `listProviders()` / `listModels(provider)` / `resolveModelInfo(provider, model)` / `resolveCallConfig(config)` | 模型目录、efforts、选择校验 |
| `agentDefaultModel` | `currentSelection(): ModelSelection` / `saveSelection(next)` | 默认模型（播种 + 兜底） |
| `workspaceRegistry` | `archiveSession(sessionId)` | 清空会话的归档步 |
| `sessionTitle` | `rename(session, title)` | 钉住「常驻会话」标题 |
| `sessionPersistence` | `list()` | 状态文件 id 有效性核对 |
| `sandboxPolicy` | `workspaceRoot` | 状态文件根目录 |
| `fs` | `resolve(path)` / `readText` / `writeText` | 状态文件读写 |

关键类型：`ModelSelection = {provider, model, reasoningEffort?}`；`LlmResolvedModelInfo.reasoning = {efforts: [{id, name, description?}], defaultEffort?}`；`Agent = {id, options, session, inbox, status, ctx, cancel, whenIdle, …}`。

### 3.8 会话卡片关键机制（融合自旧 dsh-session-card research.md §3，实现依据）

1. **常驻会话创建/恢复**：`agents.create`（公开服务，走 agent 工厂完整路径：持久化 + setup + announce）；`meta: {cwd}` —— v0.4.18 起**恒为系统临时目录** `{tmpdir}/dsh-notes-resident`（不再可配置、不持久化，每次新会话都在临时目录；cwd 在创建时写入 header，工具与 `{{cwd}}` 提示词变量都读 header.cwd，无法事后修改）；冷会话（重启后）用 `agents.resume({resumeSessionId, agentOptions, setup})` 恢复，`setup` 内 `presets.mount(agentCtx, 预设 id)` + agent 作用域注册 `cwd` 变量兜底（遮蔽全局注册，防 persona `{{cwd}}` 组装失败）。**设置持久化（v0.4.18）**：状态文件存 `{presetId, provider, model, effort}`，创建/恢复的 `agentOptions` 与预设挂载均用持久化值（模型不可用时回退默认选择重试一次）。**侧栏分组不受 cwd 影响（已核实）**：侧栏工作区 = `workspaceRegistry` 记录，记录仅由一次性 bootstrap 或显式「添加工作区」/apiproxy 建会话创建；常驻会话走宿主侧 `agents.create`、从不 attach 任何记录 → 始终是 stray 会话，显示在「未分组」（有内容后；空白会话本就不显示），cwd 只作用于工具与提示词。
2. **预设切换**：空白检查 `!session.events.some(e => e.type === 'turn/start')`；`presets.recompose(agent.ctx, id)` + `session.append('agent-preset/selected', {agentPreset: id})`（log-only、无 turn 约束，可安全追加）；按 sessionId 串行化；失败类别 `agent-preset-not-found` / `agent-preset-invalid` / `agent-preset-locked`。
3. **模型覆盖**：**不用**「改日志头」（`request/header` 只能在 open turn 内追加，不变式否决）；用全局 untagged `agent/request` 瀑布监听器：
   ```js
   ctx.on('agent/request', async (payload, next) => {
     const resolved = await next()
     const override = overrides.get(payload.agent.id)
     if (override === undefined) return resolved
     const { reasoningEffort: _inherited, ...rest } = resolved
     return { ...rest, provider: override.provider, model: override.model,
              ...(override.effort === undefined ? {} : { reasoningEffort: override.effort }) }
   })
   ```
   - untagged 监听器全局收听所有 agent 作用域分发（`dsh-scope` scopeTarget：`tag === undefined → true`）；apiproxy 的模型选择监听器对常驻会话是**惰性安装**（首次 `session.models`/`session.selectModel` RPC）→ 本插件激活时注册的监听器在外层，返回值最终生效；其他会话按 id 放行，零影响。
   - 设置：`llm.resolveCallConfig({provider, model, …reasoningEffort})` 校验 → 写入 override map → 尽力 `agentDefaultModel.saveSelection`（失败仅 warn）。
4. **清空会话**：无内建清空 API → `workspaceRegistry.archiveSession(residentId)`（registry 全局归档，未分组会话适用）→ 新建常驻会话（§3.7 agents.create）→ 状态文件更新 → 删 override 旧条目。运行中拒绝。
5. **transcript 分级折叠（chat-state，v0.4.3）**：从 `agent.session.events` 折叠为行序列（只返回最近 200 行，叶字段 JSON）：
   - `user/message`：`data.source.kind === 'user'` → **user 行**（text 块拼接）；否则为**注入上下文 → context 行**（`label` = 表单中文名：instructions→工作区指令 / catalog→目录 / snapshot→快照 / notice→通知 / relay→转达 / recall→跨会话召回，未知 → 上下文注入；`producer` 按 dsh-client-runtime `contextProvenance` 规则投影：`agent-instructions` 取 `changes[].path`、`plugin` 取 `plugin`、`skill-invocation` 取 `name`、`session-reference` 取 `references[].label`；`form === 'notice'` 时附 `summary`；**v0.4.6 起透传原始 `source`**，客户端按官方 ContextBody 表单化渲染正文）；`kind === 'tool'` 跳过（由 tool/result 成卡）。
   - `assistant/message`：按 content 块拆分——`text` 块 → **assistant 行**，`reasoning` 块 → **reasoning 行**（思考），`tool-call` 块跳过（避免与 tool/call 事件重复成卡）。
   - `assistant/chunk`：按 `blockType`（text / reasoning / tool-call）分块累计流式 partial（`block-start` 开块、`text-delta` / `reasoning-delta` / `tool-call-delta` 累积、`block-end` 落行）；`step/end` / `turn/end` 冲刷未收尾块为行；仍在流中的块以 `partials[]` 上报（客户端自动展开 + 光标）。
   - `tool/call` + `tool/result`：按 `callId` 配对成 **tool 行**（`callId` + 名称 + 原始参数 JSON + 结果文本 + 错误标记；客户端按官方 ToolRow 渲染：变体图标/标题/摘要 + IN/OUT 卡）；result 缺失时保持「运行中」。
   - `running` = 最近 `turn/start` 无配对 `turn/end`；`lastSeq` = 最后事件 seq；**v0.4.7 起 `turn/end` 的 `reason.kind === 'error'` 折叠为 turn-error 行**（`text` = `reason.error.message`，`code` = `reason.error.code`）。监听 `session/event`（untagged）过滤 `session.id === residentId` 仅递增 revision。
6. **卡片内发送/停止（客户端）**：`ctx.sessions.binding(residentId)`（纯解析，任何已列出会话惰性创建 scope+binding，无需先在中间栏打开）；`binding.session.prompt([{type:'text', text}], 'queue')` / `cancel()`（wire RPC，冷会话 host 侧自动恢复 agent，与 composer 同路径）；失败返回 `RpcResult`，消息不乐观上屏、行内展示 `error.message`。非当前会话无实时事件流（窗口只在会话成为「当前」时打开）→ 内容一律走轮询，不用 subscribe。
7. **`sessions.binding(id)` 返回 undefined（会话尚未列入列表）**：短暂重试（列表拉取后即解析）；仍失败显示「会话不可用」。

## 4. 架构

```
┌─ 浏览器（client bundle, lib/client.js）─────────────────────────────┐
│  shell.overlay ── 常驻竖栏（侧栏与对话区之间，宽 280，全高）          │
│    ├ 上：会话卡片（常驻会话）                                         │
│    │   消息列表/输入发送/停止/流式 · ⚙ 预设/模型/思考等级 · 清空确认   │
│    │   │  sessions.binding(id).session.prompt/cancel（wire）          │
│    │   │  fetch('/api/dsh-notes') 轮询 scard-chat-state（800ms/3s）   │
│    ├ 分隔条（拖拽调比例，localStorage 持久化）                        │
│    └ 下：小计（全局/工作区 tab · 待办 · 随记）                        │
│        │  useWorkspaces（当前工作区 id + 标题）                       │
│        │  fetch('/api/dsh-notes')（读/写，JSON）                      │
└────────┼────────────────────────────────────────────────────────────┘
         ▼
┌─ Node（host half, lib/index.mjs）───────────────────────────────────┐
│  webServer.register('/api/dsh-notes')                               │
│     ├ notes：串行链 + storageDomain.open('notes', v1) ← JSON 后端    │
│     │        └── ~/.dsh/storages/notes.json                         │
│     └ scard：常驻会话管理（agents/agentPresets/llm/…，缺失降级）      │
│          ├ 状态文件 ~/.dsh/session-card.json（复用旧 scard 会话）     │
│          ├ ctx.on('agent/request') 模型覆盖（按会话 id 过滤）         │
│          └ ctx.on('session/event') 仅递增 revision（按 id 过滤）      │
└─────────────────────────────────────────────────────────────────────┘
```

- 小计单一事实来源：Host 域内存态（写链保证落盘先于内存变更）；浏览器每次变更后直接用返回的快照渲染。
- 常驻会话单一事实来源：DSH 会话日志（原生通道）；卡片只读折叠后的紧凑 transcript。
- 多窗口同步：小计 mutation 返回全量快照 + window focus 重拉；卡片轮询天然多窗口一致；第一版无实时推送。
- **三条持久化通道的边界**：小计 → `storages/notes.json`；常驻会话 → `sessions/…/session.jsonl.zstd`；UI 偏好（折叠/比例）→ localStorage。互不相交。

## 5. 数据模型

### 5.1 小计（v0.3 数据模型不变）

每个作用域（全局 / 每个工作区）是一个独立 NoteScope：

```ts
interface TodoItem {
  id: string        // `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  text: string      // 标题（≤500）
  done: boolean
  pinned: boolean
  detail: string    // 描述/备注（v0.4.19 新增，≤20000；缺省 ''）
  createdAt: number // epoch ms
  updatedAt: number
}

interface NoteScope {
  todos: TodoItem[] // 待办区（数组顺序 = 用户排序）
  memo: string      // 随记区（空串 = 无内容）
}
```

存储域 `notes`，version `1`（**不变，无需迁移**；`detail` 字段随对象透传，旧数据缺省视为 `''`）：

```
DomainSpec {
  name: 'notes',
  version: 1,
  global: { schema: passthroughSchema, initial: { todos: [], memo: '' } },
  tables: { workspaces: { valueSchema: passthroughSchema } },  // key = workspaceId
}
```

变更语义（与 v0.3 一致）：添加 `text.trim()` 为空忽略、追加尾部（`add` 可带 `detail`）；编辑空文本忽略（`edit` 可带 `detail`，缺省保持原描述不变）；勾选显式传 done（幂等）；置顶移到数组头部；`reorder {orderedIds}` 整体重排（未列出兜底追加）；清空已完成仅移除 done；`undo-delete` 恢复最近一次删除/清空到原位置（Host 内存 Map，上限 100 LRU，同作用域其他变更使其失效）；`set-memo` 整体替换。

### 5.2 常驻会话（新增）

- 会话 id：`sesscard-<8位随机>`，落盘 `~/.dsh/session-card.json`（`{"sessionId": "..."}`）；重启复用，被删则新建。
- 覆盖状态：Host 内存 `Map<sessionId, {provider, model, effort?}>`（apply 闭包，随运行销毁）。
- undo/覆盖状态均为内存态，进程重启自然失效（会话本体与历史由 DSH 原生持久化负责）。

## 6. Host API 契约

基址 `/api/dsh-notes`（`cache-control: no-store`，UTF-8 JSON）。

`GET /api/dsh-notes?workspaceId=<id>` —— 小计状态快照（v0.3 不变）：

```json
{ "ok": true, "global": { "todos": [...], "memo": "" }, "workspace": { "todos": [...], "memo": "" } | null, "counts": { "globalOpen": 2, "workspaceOpen": 1 } }
```

`POST /api/dsh-notes` —— 动作，body `{action, ...}`：

**小计动作（v0.3 不变）**：

| action | 附加字段 | 行为 |
| --- | --- | --- |
| `add` | `scope`, `workspaceId?`, `text` | 添加待办（空文本忽略） |
| `toggle` | `scope`, `workspaceId?`, `id`, `done: boolean` | 勾选/取消（幂等） |
| `edit` | `scope`, `workspaceId?`, `id`, `text` | 行内编辑（空文本忽略） |
| `delete` | `scope`, `workspaceId?`, `id` | 删除待办（记入撤销记录） |
| `clear-done` | `scope`, `workspaceId?` | 移除全部已完成待办（记入撤销记录） |
| `pin` | `scope`, `workspaceId?`, `id`, `pinned: boolean` | 置顶/取消置顶 |
| `reorder` | `scope`, `workspaceId?`, `orderedIds: string[]` | 拖拽排序 |
| `undo-delete` | `scope`, `workspaceId?` | 撤销上次删除/清空（无记录 404 `no-undo`） |
| `set-memo` | `scope`, `workspaceId?`, `text` | 整体替换随记（空串 = 清空） |

**会话卡片动作（v0.4 新增，替代旧 scard-1 的 harness RPC）**：

| action | 附加字段 | 返回 |
| --- | --- | --- |
| `scard-state` | — | `{scard: {sessionId, title, blank, running, presetId, presetLocked, presets: [{id, name?, trust, isDefault, broken?}], model: {provider, model, effort?}, catalog: [{id, name, models: [{id, name, reasoning: {efforts: [{id, name}], defaultEffort?}?}]}]}}` |
| `scard-select-preset` | `presetId` | `{presetId}` 或 `{error: {code, message}}`（locked / unknown / invalid / not-attached）；成功后持久化到状态文件 `presetId` |
| `scard-select-model` | `provider`, `model`, `effort?` | `{selected: {provider, model, effort?}}` 或 `{error}`；成功后持久化 `provider/model/effort` 到状态文件 |
| `scard-clear` | — | `{sessionId}` 或 `{error}`（running）；新建会话沿用持久化的预设/模型/思考等级，cwd 恒为临时目录 |
| `scard-chat-state` | — | `{scard: {sessionId, lastSeq, running, partials: [{kind: 'assistant'\|'reasoning'\|'tool', …}], messages: [{kind: 'user'\|'assistant'\|'context'\|'reasoning'\|'tool', …}]}}` 或 `{scard: {cold: true}}`（行字段见 §3.8-5；context 行含 `source`，tool 行含 `callId`） |

- 小计动作错误：`scope: 'global'` 时 `workspaceId` 必须缺省；`scope: 'workspace'` 时 `workspaceId` 必填；否则 `bad-args`。成功返回 `{ok: true, state: <快照>}`；存储域不可用 `{ok: false, error: 'storage-unavailable'}`；`undo-delete` 无记录 404。
- 卡片动作错误：返回 `{ok: false, error: {code, message}}`（HTTP 400）或 `{ok: false, error: 'scard-unavailable'}`（必要服务缺失）；`scard-chat-state` 轮询失败时客户端保留旧内容、下次重试。
- 响应只含标量拷贝（TodoItem / 折叠消息行），绝不外泄域内部 live 对象。

## 7. 主题适配规范

**总原则：组件样式只允许引用 `--dsw-alias-*` 语义令牌，禁止硬编码色值。** 明暗切换由宿主主题机制完成（`body[data-ds-dark-theme]`）。

| 用途 | 令牌 |
| --- | --- |
| 竖栏背景/描边 | `--dsw-alias-bg-layer-1` / `--dsw-alias-border-l1`（右缘分隔线；无阴影、无圆角，与列布局融合） |
| 分隔条 | `--dsw-alias-border-l1`（默认）；hover 时 `--dsw-alias-state-business-primary` |
| 文本 | `--dsw-alias-label-primary`（正文）、`--dsw-alias-label-secondary`（次要）、`--dsw-alias-label-tertiary`（时间/禁用/提示/分区标题）、`--dsw-alias-label-caption`（占位符） |
| 品牌/强调 | `--dsw-alias-brand-primary`（勾选填充、按钮主填充、发送按钮）、`--dsw-alias-label-primary-foreground`（按钮前景）、`--dsw-alias-state-business-primary`（会话状态点、焦点边框、流式光标、tab 指示） |
| 交互 | `--dsw-alias-interactive-bg-hover`（行悬停）、`--dsw-alias-interactive-bg-hover-danger`（删除悬停）、`--dsw-alias-button-ghost-active-fill`（tab 激活） |
| 输入框 | `--dsw-specific-input-major` |
| 气泡 | `--dsw-specific-bubble`（用户气泡）、`--dsw-alias-bg-layer-2`（助手气泡） |
| 状态 | `--dsw-alias-state-error-primary`（存储不可用 / 清空确认）、`--dsw-alias-state-warn-primary`（确认提示文案） |
| 字体/动效 | `--dsw-font-family`、`--ds-ease-in-out`、`--ds-transition-duration-fast` |

**样式基准**：组件样式的唯一事实来源是 `src/client/index.ts` 的 `DOCK_CSS`；`prototype/index.html` 仅作交互形态参考（原型为评审对象，先行确认布局/交互，再落到代码）。

## 8. 目录结构与构建

```
dsh-notes/
├── src/index.mjs          # Host half（webServer 路由 + 存储域 + 会话卡片管理）
├── src/client/index.ts    # 浏览器 half（ModuleLoader 工厂，禁止 JSX/import）
├── prototype/index.html   # HTML 原型（评审对象，样式基准）
├── docs/design.md         # 本文档
├── docs/research.md       # API 调研记录（融合自旧 dsh-session-card research.md）
├── cordis.patch.yml       # 组合补丁：insert { id: dsh-notes, name: @dsh-external/dsh-notes }
├── tsdown.config.ts       # 双 half 构建（Node esm + client cjs 包装）
└── package.json           # dsh.bundle.patch + dsh.client{inject, platform} 元数据
```

构建：`pnpm build` → `lib/index.mjs` + `lib/client.js`。

安装/热更（v0.3 不变）：`dsh plugin --profile web add .`；客户端 `pnpm build` 后刷新浏览器即生效，Host half 改动需重启 DSH。

## 9. 里程碑与验收

| 里程碑 | 内容 | 验收 | 状态 |
| --- | --- | --- | --- |
| M0 原型（v0.3） | 小计竖栏原型 | 已完成 | ✅ |
| M0 融合原型（v0.4） | `prototype/index.html`：顶栏之下全高 dock + 上会话卡片（对话/流式/⚙/清空）+ 明显分隔条（底色+手柄，可拖拽）+ 下小计 + 折叠 | 明暗切换、宽/窄侧栏、顶栏之下全高（不覆盖上边栏）、两分区标题同款样式、上下比例可拖（双击复位）、卡片完整交互、小计完整交互、localStorage 模拟持久化 | ✅ 完成 |
| M1 实现（v0.3） | 小计 src 双 half | 构建通过、安装成功 | ✅ |
| M1 融合实现（v0.4.2） | 会话卡片 Host（scard-* 动作 + 常驻会话 + 模型覆盖 + transcript 折叠）与 Client（上半卡片 UI）并入 src；旧 scard-1 动态插件退役 | 构建通过；服务端 bundle 已确认包含新代码（2bc8a83）；`scard-state` 触发常驻会话创建/复用（复用 `~/.dsh/session-card.json` 中已有 id）；**Host half 需重启 DSH 生效** | ⏳ 待重启验证 |
| M2 功能验收（v0.3） | 小计功能 | 对照 §2 清单逐项 | ⏳ 待重启 DSH 后验收 |
| M3 持久化验收 | 刷新/重启后数据仍在 | `notes.json` 结构符合 §5.1；`session-card.json` 会话复用 | ⏳ |
| M4 主题验收 | 明暗双主题所有状态 | 与原型一致，无硬编码色值残留 | ⏳ |
| M5 隔离验收 | 小计对 agent 不可见 | 工具目录无 notes 工具；会话日志/提示词中无小计内容；常驻会话与 notes.json 互不相通 | ⏳ |
| M6 融合验收 | 卡片对话/流式/停止、预设/模型/思考等级真实生效、清空归档、重启复用、stop/update 副作用清理 | 对照 §2 会话卡片清单逐项 | ⏳ |

## 10. 已知限制与风险

- 动态重启恢复：dsh-notes 是安装型插件，宿主重启后由组合自动恢复；小计数据在 `notes.json`、常驻会话由 `session-card.json` + DSH 原生持久化共同恢复。
- **顶栏之下全高遮挡（v0.4 新取舍）**：竖栏从顶部栏下缘覆盖对话列左缘至底部；对话内容居中（max-width 860）时通常落在留白区，窄窗口下可能盖住对话区左侧内容 —— 用户明确要求顶栏之下全高；**不覆盖 DSH 上边栏**（顶部栏始终可见、可交互）；折叠后遮挡归零。
- **常驻会话在侧边栏可见**：以「未分组」条目出现在侧边栏（与「卡片独立于工作区」不冲突）。
- **常驻会话的模型所有权**：卡片对常驻会话的模型选择拥有最终决定权（注册更早、瀑布在外层）；composer 里再改会被卡片覆盖；其余会话不受影响。
- **scard-1 动态插件退役**：融合实现上线（DSH 重启）后，若旧动态插件仍在运行会出现双卡片；融合版交付时旧插件随进程重启自然消失，无需手动清理（若用户希望立即移除可在重启前手动 stop）。
- 多窗口实时同步：第一版为「mutation 快照 + focus 重拉」+ 卡片轮询。
- 侧栏折叠/拖拽：竖栏 `left` 跟随 AppFrame 网格第一列（MutationObserver）。
- 会话删除/归档：对应小计记录保留（无害遗留，后续版本可加）。
- 存储文件损坏：域 open 抛错 → API 返回 `storage-unavailable` → UI 错误条，不影响宿主其他功能。
- zod 透传 schema 不做内容校验：数据全部由插件自身写入，风险可控。

### 10.1 后续候选功能（v0.3 评审结论 + v0.4 增补）

> v0.3 已采纳并实现：撤销删除、置顶与拖拽排序；作用域调整为工作区。v0.4 采纳：融合常驻会话卡片（上/下分区）；v0.4.4 采纳：竖栏宽度可调。
> 以下候选未纳入本迭代，将来需要时按此列表评估。

| 候选 | 痛点 | 实现路径（基于已核实能力） |
| --- | --- | --- |
| 跨工作区搜索/「全部」视图 | 工作区小记只跟随当前工作区 | Host 增 `GET /api/dsh-notes/search?q=` 遍历 `table.entries()` |
| 无效工作区清理 | 工作区删除后记录残留 | 对比 `workspaceRegistry.list()`（只读）清理 |
| 消息一键存入小记 | 聊天内容需手动复制粘贴 | `conversation.chat.assistant-actions` 加按钮，聊天→小记方向 |
| 导出/备份 | 唯一副本是 notes.json | 竖栏导出 JSON/Markdown 下载 |
| Host API 冒烟测试 | M2/M3 人工验收 | node --test 起临时端口打 API |
| 多窗口实时同步 | 秒级延迟 | SSE 推送 `domain/changed` |
| 卡片高度独立折叠 | 全高竖栏占用过多 | 会话卡片区单独折叠成一行 |
| 会话卡片常驻会话位置可配置 | 固定「未分组」 | ❌ 已核实不可行：侧栏分组 = 工作区记录归属，常驻会话不 attach 任何记录 → 恒为 stray/未分组；cwd 曾作为折中（v0.4.10）但 v0.4.18 已移除——工作目录恒为临时目录 |

**明确不做**：模型侧工具/小计可见性（违反核心要求）；提醒/通知；随记 Markdown 渲染；多用户/云同步。

## 11. 参考

- `dsh-deepseek-quota`（`.dsh-plugins/` 与 profile 内副本）：webServer 路由 + slots 注册范式。
- `dsh-message-feedback`（profile node_modules）：storageDomain 打开/关闭范式。
- `@deepseek-ai/dsh-client-ui-theme/lib/styles/design-platform.css`：主题令牌唯一事实来源。
- `@deepseek-ai/dsh-client-runtime`：`SessionListState` / `useSessions` / `useWorkspaces` / `sessions.binding` 契约。
- `dsh-navbar`（`.dsh-plugins/`）：TS 双 half 构建（tsdown）与项目结构范式。
- **旧 dsh-session-card 项目**（`.dsh-plugins/dsh-session-card/`）：`docs/design.md`（功能规格）与 `docs/research.md`（API 调研，已并入本仓库 `docs/research.md`）——v0.4 会话卡片的实现依据；其源码（动态插件 scard-1）不在本会话，按契约重新实现。
