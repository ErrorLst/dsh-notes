# dsh-notes API 调研记录（会话卡片部分，融合自旧 dsh-session-card）


> [DSH 版本标注 2026-09，DSH 0.1.2-alpha.1] 本文档写于 DSH 0.1.1-rc.2 时期：文中引用的 @deepseek-ai/dsh-client-runtime 已更名 @deepseek-ai/dsh-client-store（useSessions/useWorkspaces/useProjection 等客户端座席仍在，由新包及 ui-session/ui-chat 提供）；@deepseek-ai/dsh-host-apiproxy 已删除，拆分为 @deepseek-ai/dsh-api-session-controller、dsh-api-settings-controller、dsh-api-workspace-controller，客户端不再使用 connection.api。本文仅作历史设计参照，实现契约请以当前 DSH 源码为准。

> 版本：0.3（原 dsh-session-card）· 状态：**已并入 dsh-notes（v0.4 融合）** · 关联设计：`design.md`
>
> 本文记录会话卡片实现所需的全部 API 契约与机制验证结论，均来自对当前 DSH 安装（`C:\Users\zhoujin\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\*`）的源码与运行时 Inspect 查询核实。实现前如 DSH 版本变化，请复核本文引用的签名。

## 1. 挂载点调研（Client）

### 1.1 为什么是 `shell.overlay`

- 完整槽位树（`Slots.listSubTree`）中，`sidebar` 整列被 shell 的 `SidebarRoot` 占用：顶部品牌行 + "新会话" 按钮是 shell 自有 chrome，**没有任何"侧边栏顶部加法槽位"**；`sidebar.workspaces` 是 single 槽（整个浏览区，replaceRisk: shadows-shipped-ui），`sidebar.footer.action` 在底部。
- `shell.overlay`：list 槽、`replaceRisk: none`、additive——"the additive seat for a frame-wide surface of your own: a fresh `id` is added beside the shipped entries"。现占用者：`notes-dock`（dsh-notes）、`dsh-livefeed.panel`（dsh-livefeed）——**本插件的既定惯例挂载点**。
- 语义："The layer itself is click-through — entries opt back into pointer events" → 卡片需 `pointer-events: auto`。
- 标准 props：`useSessions` / `useWorkspaces`（SnapshotSelectorHook）——本卡片不依赖（独立于工作区），保留为备用。

### 1.2 客户端能力（Client Builtin）

`ctx`（受限 Cordis Context）、`React`（无 JSX，必须 `React.createElement`）、`host`（`host.call(method, args)` 自有 RPC）、`styles`（`styles.insert(css)`）、`console`。**没有 api 客户端** → 所有业务必须走 Host half。

### 1.3 中间栏左上角锚定（评审修正：卡片不在侧边栏内）

- **布局事实**（`dsh-client-ui-layout/lib/client.js`）：`shell.overlay` 层渲染在网格框架内部——235 行 `renderSlot("shell.overlay", {})` 是 `.frame`（CSS grid）的子项；层样式 `position: absolute; inset: 0` 覆盖整个框架（56 行 CSS `.pI_x6G_overlayLayer`），`pointer-events: none`、子项 opt-in；
- **列宽实时可读**：frame 的 inline style 是 `gridTemplateColumns: "<sidebar>px minmax(0, 1fr) <details>px"`（221 行），每次渲染重写；侧边栏轨道 = 默认 280、拖拽夹 264–420（287 行 `clampWidth`）、折叠导轨 56（35 行 `sidebar === 0 ? 56`）、窄视口自动折叠（190–195 行）；
- **稳定标记**：层 `data-shell-overlay: true`（236 行）、frame `data-sidebar-collapsed`（222 行）——均为语义属性而非哈希 class；
- **`ctx.layout` 不可用**：仅暴露 `toggleSidebar / openDetails / closeDetails`（服务目录核实），无宽度 getter、无订阅、无事件；
- **结论**：卡片 `position: absolute; top: 12px; left: <首列宽 + 12px>`；实现时读取挂载容器（`[data-shell-overlay]`）的父级 frame 的 computed `gridTemplateColumns` 首列，MutationObserver 监听 frame 的 `style` / `data-sidebar-collapsed` 属性变化 + window resize 重读；测量失败回退 280px。折叠成导轨（56px）时卡片自动左移贴住中间栏。
- **实测补充（2026-08）**：`sandboxPolicy.workspaceRoot` 在本部署解析为**用户主目录**（`C:\Users\zhoujin`），因此状态文件实际落在 `~/.dsh/session-card.json`（`{workspaceRoot}/.dsh/session-card.json` 首写路径成功）；未分组常驻会话日志落在 `~/.dsh/sessions/_no-cwd/<sessionId>/`（`session.jsonl.zstd`）。

### 1.4 客户端会话面与事件流（卡片内对话的关键事实）

- **`ctx.sessions.binding(id)`**（客户端服务）：`SessionBinding = {sessionId, session: SessionFace, ctx: AgentContext}`。`SessionFace = ISession & ObservableSnapshot<ConversationSnapshot>`（`dsh-client-runtime/lib/types/client/contract/session.d.ts` 96 行）——行为动词 `prompt(content, mode)` / `cancel()` / `rename()` / `loadOlder()` / `command()` + 可订阅的会话快照。
- **binding 惰性创建**：`dsh-client-runtime/lib/client.js` `resolve(id)`（9194–9214）——"Lazily mint the scope + binding for an eligible session. Eligibility and prune share one predicate: listed on the host or selected through a retained subagent address."；`binding(id)`（9146–9148）为纯解析。→ 常驻会话只要出现在 `session.list` 即可 `binding()`，**无需先在中间栏打开**。
- **窗口只在"当前会话"时打开**：`followCurrent()`（9173–9187）——"Staging IS the open signal — the window opens ⟺ the session is on stage"；`ConversationSnapshot.openState`（`sessions/conversation.d.ts` 297 行）`'cold' | 'loading' | 'open' | 'error'`。非当前会话的 binding 快照保持 cold、**无实时事件流**（连接层订阅随窗口建立；`session/subscribed` 帧只在窗口打开时拉基线）。
- **结论**：
  - 发送/停止：直接用 `binding.session.prompt([{type:'text',text}], 'queue')` / `cancel()`——`session.prompt` 是 wire RPC（`dsh-host-apiproxy/lib/types/api/sessions.d.ts` 365 行），host 侧经 `agentFor`→`ensureSession` 对冷会话自动创建/恢复 agent，与 composer 完全同路径；
  - 内容渲染：**不用** `binding.session.subscribe`（非当前会话无流），改用 **Host 折叠 `agent.session.events` + 客户端轮询自有 RPC `chat-state`**（运行中 800ms / 空闲 3s；发送后立即轮询）。
- `ConversationSnapshot` 关键字段（`sessions/conversation.d.ts` 367–417）：`nodes`（最终节点）、`partial`（流式 partial）、`running`、`queue`、`composerPhase`、`blank`、`openState`、`promptError`——若未来常驻会话恰好是当前会话，可切到快照直读，但**不依赖**。

## 2. Host 服务契约速查

| 服务 | 方法（本次使用） | 用途 |
| --- | --- | --- |
| `agents` | `create({sessionId, agentOptions, meta, setup})` / `resume({resumeSessionId, agentOptions, setup})` / `get(id)` | 创建/恢复常驻会话 agent；`create` 走注册的 agent 工厂完整路径（会话持久化 + setup + announce） |
| `agentPresets` | `list()` / `mount(agentCtx, id?)` / `recompose(agentCtx, id)` / `composedPreset(agentCtx)` / `defaultId` | 名册 / 组合 / 换预设 / 当前预设 |
| `llm` | `listProviders()` / `listModels(provider)` / `resolveModelInfo(provider, model)` / `resolveCallConfig(config)` | 模型目录、efforts、选择校验 |
| `agentDefaultModel` | `currentSelection(): ModelSelection` / `saveSelection(next)` | 默认模型（播种 + 兜底） |
| `workspaceRegistry` | `archiveSession(sessionId)` | 清空会话的归档步 |
| `sessionTitle` | `rename(session, title)` | 钉住"常驻会话"标题 |
| `sessionPersistence` | `list()` | 状态文件 id 有效性核对 |
| `sandboxPolicy` | `workspaceRoot` | 状态文件根目录 |
| `fs` | `resolve(path)` / `readText` / `writeText` | 状态文件读写 |

关键类型：`ModelSelection = {provider, model, reasoningEffort?}`；`LlmResolvedModelInfo.reasoning = {efforts: [{id, name, description?}], defaultEffort?}`；`Agent` = `{id, options, session, inbox, status, ctx, cancel, whenIdle, runMaintenance, send, followup, steer, inject}`（`agent.ctx` 是 agent 作用域 Cordis Context，可 `ctx.on` 注册监听）。

## 3. 关键机制验证

### 3.1 预设切换（镜像 apiproxy `agentPreset.select`）

源码：`dsh-host-apiproxy/lib/index.js` 3323–3367。要点：

- 空白检查：`sessionBlank(session) = !session.events.some(e => e.type === "turn/start")`（1238–1247；turn 之外的事件——命令、plan、标题、goal——不算"已开始"）；
- 换预设：`presets.recompose(agent.ctx, agentPreset)`，随后 `agent.session.append("agent-preset/selected", { agentPreset: preset.id })`；
- 按 sessionId 串行化（`presetSwitches` Map）；
- 失败类别：`agent-preset-not-found`（UnknownPresetError）、`agent-preset-invalid`（PresetMountError）、`agent-preset-locked`（非空白）。
- `agent-preset/selected` 事件类型由 dsh-agent-presets 注册（`dsh-agent-presets/lib/types/types.d.ts`），log-only；会话不变式对其无 turn 约束（`dsh-session/lib/types/invariant.js` 112 行 default 分支：插件自有事件不受约束）。

### 3.2 模型选择：为什么不用"改日志头"，而用 `agent/request` 覆盖

- apiproxy 的 `session.selectModel`（`dsh-host-apiproxy/lib/index.js` 2674–2719）：`llm.resolveCallConfig` 校验 → 写入**模块私有 WeakMap `selections`** 的 picked 层（`selectionFor`，1750–1773）→ 尽力 `saveDefaultModelSelection`。picked 层无法从插件外部写入。
- "改日志头"方案（追加 `request/header` 事件让 selectionFor 读日志层）**被会话不变式否决**：`dsh-session/lib/types/invariant.js` 111–117——`request/header` 只能在 **open turn 内**追加，插件在 turn 外追加会触发 invariant 失败。
- **结论方案**：全局 untagged `agent/request` 瀑布监听器。机制依据：
  - `dsh-scope/lib/index.js` `scopeTarget`（316–338）：`tag === undefined → true`——**untagged 监听器全局收听所有 agent 作用域分发**；
  - `agent/request` 事件（`dsh-agent/lib/types/runtime-types.d.ts` 254–259）：waterfall，payload 含 `agent`（fused dispatcher 注入，`dsh-agent/lib/types/dispatch.d.ts`），listener 签名 `(payload, next) => Promise<LlmCallConfig>`；
  - apiproxy 的模型选择监听器（`installModelSelection`，`dsh-agent/lib/types/model-selection.js` 17–52）对常驻会话是**惰性安装**（首次 `session.models` / `session.selectModel` RPC）→ 晚于本插件激活时注册的监听器；
  - Cordis waterfall：**先注册者在外层，其返回值最终生效**（外层 `await next()` 后做最终变换）→ 本插件监听器对常驻会话拥有最终决定权；对其他会话按 `payload.agent.id` 过滤放行。
- 覆盖语义与 `installModelSelection` 一致：剥离继承 effort，应用 `{provider, model, reasoningEffort?}`；effort 缺省即恢复该模型的 provider/default 行为。

### 3.3 模型目录（镜像 apiproxy `buildModelCatalog`）

源码：`dsh-host-apiproxy/lib/index.js` 1068–1112：`llm.listProviders()` → `llm.listModels(provider.id)` → 每模型 `llm.resolveModelInfo` 取 `reasoning.efforts`。全部为公开服务方法，可直接复刻。

### 3.4 清空会话：无内建 API

- 会话域 RPC（`dsh-host-apiproxy/lib/types/api/sessions.d.ts`）无 clear/reset；`session/event` 追加式日志无截断；
- 客户端服务也无清空（`workspaces.archiveSession` 只是归档隐藏）；
- 结论：**归档 + 新建空白常驻会话**（等价"清空"）。`workspaceRegistry.archiveSession` 是 registry 全局归档，未分组会话同样适用（`dsh-client-runtime/.../workspaces/service.d.ts` 145 行注释：registry-global set）。

### 3.5 常驻会话创建（镜像 apiproxy `session.create`）

源码：`dsh-host-apiproxy/lib/index.js` 2131–2190（`ensureSession`）与 1812–1826（`composeAgent`）、1708–1714（`agentOptions()` = `defaultModelSelection()` 的 provider/model）：

- `agents.create` 是公开服务（`dsh-agent/lib/index.js` 543–548），委托注册的 agent 工厂（`agentLoop.createAgent`）完成会话创建 + 持久化 + setup + announce（`register`/`announce` 语义见 580–585、660–669）；
- 无 cwd（`meta: {cwd: undefined}`）→ 未分组会话（`SessionHeader.cwd` 可选，`dsh-session/lib/types/types.d.ts` 51 行）；
- `agents.resume` 用于冷会话（进程重启后）恢复：工厂从持久化加载，`setup` 由调用方提供（确保预设组合正确）。

### 3.6 会话不变式对插件追加事件的约束（汇总）

| 事件 | 约束 |
| --- | --- |
| `request/header` / `request/context` / `todo/write` | 必须在 open turn 内追加（`dsh-session/lib/types/invariant.js` 111–117）→ 本插件**不追加** |
| `agent-preset/selected`（dsh-agent-presets 扩展） | 无 turn 约束，可安全追加（镜像 apiproxy） |

### 3.7 transcript 折叠（`chat-state` 的实现依据）

- 源：`agent.session.events`（`Session.events` 全量；`dsh-session/lib/types/index.d.ts` 公开）。折叠规则：
  - `user/message` → `{role:'user', text}`（`content` 中 text 块拼接；`UserMessage` 形状见 `dsh-llm/lib/types/message.d.ts` 131 行）；
  - `assistant/message` → `{role:'assistant', text}`（跳过 tool-call 块；`assistant/chunk` 的 block-start/text-delta/block-end 用于累计当前 open step 的 partial）；
  - `running`：最近 `turn/start` 无配对 `turn/end`；
  - 返回最近 N 条 + partial + running + lastSeq，全部叶字段。
- 监听：`ctx.on('session/event', (session, event) => ...)`——apiproxy 自身即以 untagged 方式全局收听（`dsh-host-apiproxy/lib/index.js` 1892 行），本插件同法过滤 `session.id === residentId` 仅递增 revision。
- 流式 partial 的折叠需追踪 open step：`step/start`（打开）→ `assistant/chunk`（累计）→ `step/end` 或新 `turn/start`（关闭）；`turn/end` 的 `reason` 用于终止态（aborted/error 等）。

## 4. 源码位置索引（当前安装版本）

```
dsh-host-apiproxy/lib/index.js
  1068  buildModelCatalog          # 模型目录
  1238  sessionBlank               # 空白检查
  1708  agentOptions()             # 默认模型播种
  1750  selectionFor               # picked 层（模块私有 WeakMap）
  2131  ensureSession              # 创建/恢复
  2674  selectModel RPC            # 模型选择（镜像对象）
  3323  agentPreset.select RPC     # 预设切换（镜像对象）

dsh-agent/lib/index.js
  543   AgentRegistry.create       # 公开创建入口
  580   register / 660 announce    # 发布语义
dsh-agent/lib/types/model-selection.js  17  installModelSelection   # 覆盖语义镜像
dsh-agent/lib/types/runtime-types.d.ts  60  Agent / 254 agent/request
dsh-scope/lib/index.js                  316 scopeTarget            # untagged 全局收听
dsh-session/lib/types/invariant.js      111 request/header turn 约束
dsh-session/lib/types/types.d.ts        191 EpochHeader / 223 SessionEventMap
dsh-llm/lib/types/message.d.ts           94 MessageSource / 131 UserMessage
dsh-client-runtime/lib/types/client/contract/session.d.ts
   26 ISession（prompt/cancel/rename/loadOlder/command）
   96 SessionFace = ISession & ObservableSnapshot<ConversationSnapshot>
dsh-client-runtime/lib/types/client/sessions/conversation.d.ts
   260 ConversationNode / 367 ConversationSnapshot（nodes/partial/running/openState…）
dsh-client-runtime/lib/client.js
   9146 binding(id) / 9194 resolve(id)（惰性创建） / 9173 followCurrent（staged=窗口打开）
dsh-client-runtime/lib/types/client/workspaces/service.d.ts  145 archiveSession
dsh-agent-presets/lib/types/index.d.ts  274 recompose（调用方负责空白检查）
```

## 5. 设计令牌与真实样式速查（原型与实现共用）

来源（当前安装版本，均为真实生产样式）：

- `dsh-client-ui-theme/lib/styles/design-platform.css` —— 静态色 + 别名令牌（浅色在 `body{}`，深色在 `body[data-ds-dark-theme]{}`）；
- `dsh-client-ui-theme/lib/styles/base.css` —— 字体族与动效：`--dsw-font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", …`；`--ds-font-family-code: "SF Mono", "JetBrains Mono", "Fira Code", Consolas, …`；`--ds-ease-in-out`、过渡时长 0.1/0.2/0.3s；
- `dsh-client-ui-theme/lib/styles/gradient-shadow-text.css` —— `--dsw-shadow-lv1/lv1-blur/lv2/lv3` 与 `--dsw-font-*` 完整字号体系（xl-24 … xxxs-11）；
- 组件实样：`dsh-client-ui-sidebar/lib/client.js`（logoRow 高 60、`newSession` 高 38/圆角 12/elevated 底）、`dsh-client-ui-workspace/lib/client.js`（projectRow 34px / sessionRow 32px / 圆角 8 / hover `interactive-bg-hover` / title 14px / time 12px tertiary）、`dsh-client-ui-conversation/lib/client.js`（会话头 `padding:12px 28px 0 20px`、tab 底部 2px 蓝色指示、`--dsh-chat-content-width:748px`）。

### 5.1 关键令牌值（浅色 / 深色）

| 令牌 | 浅色 | 深色 |
| --- | --- | --- |
| `--dsw-alias-bg-base` | `#ffffff`（bluish-00） | `#151517`（bluish-950） |
| `--dsw-alias-bg-layer-1 / -2` | `#ffffff` | `#232324` / `#2c2c2e` |
| `--dsw-specific-sidebar-fill` | `#f9fafb`（bluish-50） | `#1b1b1c`（bluish-900） |
| `--dsw-alias-border-l1 / -l2 / -l3` | `rgba(0,0,0,.04/.10/.12)` | `rgba(255,255,255,.06/.12/.16)` |
| `--dsw-alias-label-primary` | `#0f1115` | `#f9fafb` |
| `--dsw-alias-label-secondary` | `#61666b` | `#cfd3d6` |
| `--dsw-alias-label-tertiary` | `#81858c` | `#adb2b8` |
| `--dsw-alias-label-caption` | `#adb2b8` | `#81858c` |
| `--dsw-alias-state-business-primary` | `#4176e6`（deepseek-500） | `#5686fe`（deepseek-400） |
| `--dsw-alias-brand-primary` | `#0f1115`（近黑，主按钮） | `#f9fafb`（近白） |
| `--dsw-specific-bubble`（用户气泡） | `#edf3fe`（deepseek-50） | `#232324` |
| `--dsw-specific-bubble-highlight` | `#d3e2ff`（deepseek-200） | `#43454a` |
| `--dsw-alias-interactive-bg-hover` | `rgba(38,49,72,.06)` | `rgba(255,255,255,.08)` |
| `--dsw-shadow-lv2` | `0 4px 12px rgba(0,0,0,.02), 0 2px 8px rgba(0,0,0,.04)` | 深色加浓 |
| `--dsw-alias-state-error/success/warn-primary` | `#ec1313` / `#22c55e` / `#f59e0b` | 同左（error 深色用 `red-400`） |

要点：DSH 品牌强调色是 **DeepSeek 蓝**（`state-business-primary`）；主按钮用 `brand-primary`（浅色近黑）；面板/浮层一律 `bg-base + border-l1 + 圆角 12 + shadow-lv2`（**本插件卡片与弹窗按评审不使用阴影**）；侧边栏会话行高 32px、标题 14px、时间 12px tertiary；卡片圆角 8–12px。原型 `prototype/index.html` 已按此实现（深色切换用 `body[data-ds-dark-theme]`）。

## 6. 待实现前复核项

1. `agents.create` 的 `setup` 回调签名与错误回滚行为（以当时安装的 dsh-agent-loop 为准）；
2. `agent-preset/selected` 事件在 `sessionPersistence` 冷读时是否为"必知事件"（当前版本 dsh-agent-presets 已注册该类型，冷读可识别）；
3. `workspaceRegistry.archiveSession` 对未分组会话的行为（registry 全局归档，需在真实环境确认列表投影）；
4. `agentDefaultModel.saveSelection` 失败时的降级路径（只影响冷启动默认，不影响 override 生效）；
5. `binding.session.prompt()` 对**从未打开**的冷会话的完整行为（wire 层应经 `ensureSession` 恢复 agent；真实环境验证首条消息发送与接受帧）；
6. `session.prompt` 的乐观上屏语义（客户端 `prompt` 返回 `RpcResult`，失败时消息不上屏、错误入 `promptError`——卡片渲染需对齐该语义）。
