# dsh-notes 设计文档

> 版本：0.2 · 状态：**已实现**（M1 完成，M2-M5 待重启 DSH 后验收）· 关联原型：`prototype/index.html`

## 1. 概述

在 DSH Web 界面中，小记以**常驻竖栏**形式固定显示在左侧边栏与中间对话区之间（无独立入口按钮、无弹窗），持久化记录**不限于 todo** 的轻量内容。数据分两种作用域：

- **全局小记**：不分会话，长期跟随用户（如「给 API 充值」「整理文档」）。
- **会话小记**：以会话为单位隔离（如「LaptopAxisCheck」会话的待办），切换会话时自动跟随。

竖栏内容分为**两个部分**（每个作用域各自独立）：

- **待办区（todo）**：分点待办列表 —— 每行一个可勾选条目，支持添加/勾选/行内编辑/删除/清空已完成。
- **随记区（memo）**：自由多行文本 —— 随意输入、不需要分点（如电话、链接、会议纪要），输入防抖 + 失焦自动保存，不参与勾选统计。

用户已确认的范围：**待办（分点）+ 随记（自由文本）两类内容**，**常驻竖栏展示（无按钮/弹窗）**，且**内容不暴露给 agent**（隔离保证见 §2.1）。

## 2. 功能清单

| 能力 | 说明 |
| --- | --- |
| 常驻竖栏 | 固定显示在**左侧边栏与中间对话区之间**：宽 280、**部分高度**（`min(62vh, 560px)`）、**底部对齐**，无独立入口按钮、无弹窗；无会话 hero 视图时仍显示（仅全局 tab） |
| 折叠/展开 | 竖栏头部右侧「▾」按钮折叠；折叠后在同位置显示「📝 小记」按钮条（圆角胶囊，点击展开），折叠状态持久化；折叠/展开前先落盘随记 |
| 定位机制 | 实现与原型一致：`shell.overlay` **常驻条目** + `position: absolute` 浮层（定位上下文 = overlay 层，该层 `inset: 0` 覆盖整个 AppFrame），**不参与布局**（折叠/窗口缩放不影响对话区宽度）；`left` = AppFrame 网格第一列（侧栏列）实测宽度，由组件从自身 DOM 向上找到 grid 帧、解析 `gridTemplateColumns`，`MutationObserver` 跟随侧栏折叠/拖拽；`bottom: 0`、`height: min(62vh, 560px)`、`pointer-events: auto`；折叠时仅渲染按钮条 |
| Tab | 「全局」/「本会话（会话标题）」；无当前会话（`s.current === undefined`）时隐藏会话 tab；切换时各自独立读写 |
| 待办区 | 分区标题行（标题 + 「共 X 项 · 未完成 Y」+「清空已完成」）+ 添加输入行 + 分点列表：勾选/取消（显式传 done，幂等）、双击行内编辑（Enter 保存 / Esc 取消 / 失焦保存，空文本忽略）、删除（行悬停出现）、清空已完成（仅移除已完成条目，无已完成时禁用） |
| 随记区 | 分区标题行（标题 + 保存状态）+ 多行 textarea：自由文本（不限制格式/行数），输入防抖 600ms 自动保存 + 失焦立即保存（含切 tab/切会话前的落盘），状态显示「保存中…/已保存」；清空 = 文本置空 |
| 空/错状态 | 待办空列表提示；host 存储不可用时竖栏顶部错误条，UI 不崩溃 |
| 主题 | 全部使用 `--dsw-alias-*` 语义令牌，明暗由 `body[data-ds-dark-theme]` 自动适配（见 §7） |
| Agent 隔离 | 小记内容对 agent 完全不可见（见 §2.1） |

### 2.1 Agent 隔离（不可见保证）

小记是**用户私有**数据，agent（模型）在任何路径上都接触不到：

1. **不注册模型工具**：不调用 `harness.defineTool` / `tools.register`，模型工具目录中不存在任何 notes 工具。
2. **不进提示词**：不注册 `systemPrompt` section / context / 变量，小记内容永不进入模型上下文。
3. **物理双通道**：数据只写入独立存储域文件 `~/.dsh/storages/notes.json`；对话消息则写在 `~/.dsh/sessions/<cwd>/<sessionId>/session.jsonl.zstd`（追加式 zstd JSONL）。agent 的整个生命周期（加载、恢复、搜索、导出）只接触会话日志通道，**结构上接触不到** notes 文件（详见 §3.6）。
4. **不注册 Remote 服务**：Host API 是普通 HTTP 路由（`webServer.register`，`/api/dsh-notes`），仅浏览器同源 `fetch` 调用；不经 typert gateway / api-remotes 暴露。
5. **键只是字符串**：会话小记仅以 `sessionId` 字符串为键，与 agent 会话对象无引用关系；客户端读取当前会话 id 仅发生在浏览器展示层（`useSessions`）。
6. **不依赖 agent 生命周期**：插件只依赖 `webServer` 与 `storageDomain`，与 agent/session 服务解耦。
7. **无鉴权面**：HTTP API 无登录/密钥，仅依赖 DSH Web 本机绑定（默认 `127.0.0.1:3080`），部署层网络边界即访问边界。

## 3. 已核实的运行时事实（实现时不再猜测）

以下事实来自本次调研（DSH 运行时 Inspect + 已安装插件源码 + 主题样式表），是实现的依据。

### 3.1 插槽

| 插槽 | 类型/作用域 | 注册项 | owner props | standard props |
| --- | --- | --- | --- | --- |
| `shell.overlay` | list / root | `{id, order, label}` | 无 | `useSessions: SnapshotSelectorHook<SessionListState>`、`useWorkspaces` |

- 竖栏是 `shell.overlay` 的一个**常驻条目**（始终注册，展开/折叠只切换自身渲染），新 id 会追加为新 cell，不覆盖现有项。
- overlay 层本身点击穿透（`.pI_x6G_overlayLayer`：`position:absolute; inset:0` 覆盖整个 AppFrame，z-index 20），竖栏根元素需 `pointer-events: auto`。
- 定位（**实现已落地，无硬编码产品选择器**）：
  - 竖栏为 `position: absolute; bottom: 0; width: 280px; height: min(62vh, 560px)`，定位上下文即 overlay 层；
  - `left` 取自 AppFrame 的 `grid-template-columns` 第一列（侧栏列，`<sidebar>px minmax(0,1fr) <details>px`，帧元素通过 `dockEl.parentElement…` 向上查找 display:grid 的节点获得）；
  - `MutationObserver`（`attributeFilter: ['style']`）监听帧的内联样式变更 + `window.resize`，跟随侧栏折叠动画与拖拽调宽。
- 折叠态：竖栏仅渲染一个胶囊按钮（「📝 小记」+ 展开箭头，`margin: 0 8px 8px`），点击展开并聚焦待办输入框；折叠状态存浏览器 `localStorage['dsh-notes.collapsed']`（UI 偏好，不进 notes.json）。
- 注册范式（参考 `dsh-deepseek-quota/lib/client.js` 的 slots 用法）：

```js
ctx.slots.inject('shell.overlay', () =>
  ctx.slots.register({ name: 'shell.overlay', id: 'notes-dock' }, NotesDock),
)
```

- `sidebar.footer.action` **不再使用**（无入口按钮方案）。

### 3.2 当前会话与标题

`SessionListState`（`dsh-client-runtime` 已核实）：
- `current: SessionId | undefined` —— 当前选中会话；
- `byId: Record<SessionId, SessionSummary>`，`SessionSummary.displayTitle` 为展示标题。

取值：
```ts
const current = useSessions((s) => s.current)
const title   = useSessions((s) => (s.current ? s.byId[s.current]?.displayTitle : undefined))
```

### 3.3 持久化（存储域）

- Host 服务 `storageDomain`（`ctx.get('storageDomain')`）已挂载；宿主组合配置 `backend: json`，JSON 后端根目录为 `dshHomePath('storages')`（即 `~/.dsh/storages`），域 `notes` 落盘为 `~/.dsh/storages/notes.json`。
- 域/表名必须匹配 `/^[a-z][a-z0-9_]*$/`。
- 打开/关闭范式（参考 `dsh-message-feedback`）：

```js
const domain = await ctx.storageDomain.open(spec)
ctx.effect(() => async () => { await domain.close() })
```

- 域 API：`domain.global.get()/set(v)`；`domain.table('sessions')` → `{get, put, delete, update(key, fn), entries}`；`update` 为写链上的原子 RMW；写入先落盘、后改内存、再发 `domain/changed`。
- **zod 不可用**：动态/独立 Host 代码无法 `import` zod，域 spec 的 schema 使用鸭子类型透传实现：

```js
const passthroughSchema = {
  parse(v) { if (v === null) throw new Error('null not allowed'); return v },
  safeParse(v) { return v === null ? { success: false } : { success: true, data: v } },
}
```

> 注意：`defineDomain` 会校验 `global.schema.safeParse(null)`，**接受 null 会直接抛错**（null 是后端「从未写入」哨兵值），因此上面的 null 分支必须存在。

**完整写入链路（已实现，均在本机核实）：**

```
浏览器操作 → POST /api/dsh-notes → 插件内 promise 串行链
           → 域写链（读-改-写） → json 后端 → ~/.dsh/storages/notes.json
```

1. **落盘位置**：JSON 后端根目录为 `dshHomePath('storages')`（`~/.dsh/storages`），域 `notes` 对应文件 `notes.json`（与 `workspace.json`、`session_projcache.json` 同目录同机制）。
2. **写入顺序（域写链）**：先 `await` 后端落盘 → 成功后才改内存 → 最后发 `domain/changed` 事件；后端写失败则内存不动，读（内存态）与磁盘永不背离。
3. **原子性（JSON 后端）**：整文件重写 —— 先写临时文件再 `rename()` 覆盖目标，任意时刻磁盘上都是完整文件，崩溃不会留下半截 JSON。
4. **单写者串行**：插件内所有变更依次经过同一条 promise 链（读-改-写不交错）；会话记录用 `table.put` 整体替换，全局用 `global.set` 整体替换。
5. **文件生命周期**：文件在**首次写入时创建**（`global` 首次 `set` 或某会话首次 `put`）；在此之前磁盘上不存在 `notes.json`（已实测）。`initial` 只在内存侧生效，不落盘。
6. **折叠状态不落盘**：`localStorage['dsh-notes.collapsed']` 属浏览器 UI 偏好，与 notes.json 无关。

### 3.4 Host API 通道

- 独立插件（非动态 cordis 插件）的浏览器↔宿主通信使用 `webServer.register` 注册 HTTP 路由（`dsh-deepseek-quota` 的 `GET /api/deepseek-quota` 即此通道）。
- 路由注册须包在 `ctx.effect(...)` 中，随 fiber 清理。

### 3.5 主题令牌

- 语义令牌（alias）与静态色板（static）定义于 `@deepseek-ai/dsh-client-ui-theme/lib/styles/design-platform.css`：
  - 静态色板挂在 `body`；暗色覆盖挂 `body[data-ds-dark-theme]`；
  - alias 令牌同样按 `body` / `body[data-ds-dark-theme]` 两段定义，**一律引用 static 令牌或 rgba**，组件侧只允许消费 alias。
- 字体：`--dsw-font-family`（含 PingFang SC / Microsoft YaHei）、`--ds-font-family-code`；动效 `--ds-ease-in-out`、`--ds-transition-duration*`。
- 本插件实际用到的 alias 令牌清单见 §7。

### 3.6 对话消息持久化（对照，本机已核实）

小记与对话消息是**两条完全独立的持久化通道**：

| | 小记（本插件） | 对话消息（DSH 原生） |
| --- | --- | --- |
| 位置 | `~/.dsh/storages/notes.json` | `~/.dsh/sessions/<cwd 编码>/<sessionId>/session.jsonl.zstd` |
| 后端 | storage-domain（JSON 后端，`dsh-storage-json`） | session-persistence-jsonl（`dsh-session-persistence-jsonl`，root = `dshHomePath('sessions')`） |
| 格式 | 人类可读 JSON（整文件快照） | 追加式 JSONL，zstd 压缩 |
| 写入 | 原子整文件替换 + 域写链 | 追加事件（append-only） |
| 读取加速 | 无（文件即真相） | 投影缓存 `~/.dsh/storages/session_projcache.json`（只加速，非真相） |

- agent 的加载/恢复/搜索/导出全部基于会话日志通道；小记文件不在该通道内，模型与工具均无法触达（§2.1 第 3 点的物理基础）。
- 本插件不监听会话事件（无 `ctx.on`）、不 append 会话日志、不产生任何 `SessionEvent`。

## 4. 架构

```
┌─ 浏览器（client bundle, lib/client.js）────────────────────┐
│  shell.overlay ── 常驻竖栏（侧栏与对话区之间，宽 280）       │
│    ├ 顶部：小记 + 全局/本会话 tab                            │
│    ├ 待办区：添加输入 + 分点列表 + 清空已完成                 │
│    └ 随记区：自由文本 textarea（自动保存）                   │
│        │  useSessions（当前会话 id + 标题）                  │
│        │  fetch('/api/dsh-notes')（读/写，JSON）             │
└────────┼───────────────────────────────────────────────────┘
         ▼
┌─ Node（host half, lib/index.mjs）──────────────────────────┐
│  webServer.register('/api/dsh-notes')                      │
│     │  串行链（防并发竞态）                                  │
│  storageDomain.open('notes', v1)  ← JSON 后端               │
│     └── ~/.dsh/storages/notes.json                          │
└─────────────────────────────────────────────────────────────┘
```

- 单一事实来源：Host 域内存态（写链保证落盘先于内存变更）；浏览器每次变更后直接用返回的快照渲染。
- 多窗口同步：mutation 返回全量快照 + window focus 时重拉；第一版不做实时推送。
- **两条持久化通道互不相交**：小记 → `storages/notes.json`；对话 → `sessions/…/session.jsonl.zstd`（§3.6）。agent 只接触后者。
- **Agent 隔离**：无模型工具、无 prompt 注入、不产生会话事件；插件与 agent/session 服务完全解耦（见 §2.1）。
- 插件不接触会话日志，只以 sessionId 为键。

## 5. 数据模型

每个作用域（全局 / 每个会话）是一个独立 NoteScope：

```ts
interface TodoItem {
  id: string        // `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  text: string
  done: boolean
  createdAt: number // epoch ms
  updatedAt: number
}

interface NoteScope {
  todos: TodoItem[] // 待办区：分点待办
  memo: string      // 随记区：自由多行文本（空串 = 无内容）
}
```

存储域 `notes`，version `1`：

```
DomainSpec {
  name: 'notes',
  version: 1,
  global: { schema: passthroughSchema, initial: { todos: [], memo: '' } },
  tables: { sessions: domainTable(passthroughSchema) },  // key = sessionId, value = NoteScope
}
```

落盘文件结构（JSON 后端格式，与 `workspace.json` 同构）：

```json
{
  "unit": { "name": "notes", "version": 1 },
  "global": { "todos": [ { "id": "...", "text": "...", "done": false, "createdAt": 0, "updatedAt": 0 } ], "memo": "" },
  "tables": { "sessions": { "<sessionId>": { "todos": [], "memo": "" } } }
}
```

变更语义：

- 添加待办：`text.trim()` 为空则忽略；追加到列表**尾部**。
- 编辑待办：空文本忽略该次编辑（保留原文）。
- 勾选：客户端显式传 `done`（幂等）。
- 清空已完成：仅移除 `done === true` 的待办；随记不受影响。
- 随记：`set-memo` 以文本**整体替换**（可为空串 = 清空），不区分行；自动保存由客户端防抖 + 失焦触发。
- 计数：待办区标题行「共 X 项 · 未完成 Y」只统计 `todos`。
- 并发：所有变更走插件内 promise 串行链；`sessions` 表写入可用 `table.update(key, fn)` 原子 RMW。

## 6. Host API 契约

基址 `/api/dsh-notes`（`cache-control: no-store`，UTF-8 JSON）。

`GET /api/dsh-notes?sessionId=<id>` —— 状态快照：

```json
{ "ok": true, "global": { "todos": [...], "memo": "" }, "session": { "todos": [...], "memo": "" } | null, "counts": { "globalOpen": 2, "sessionOpen": 1 } }
```

`POST /api/dsh-notes` —— 动作，body：

| action | 附加字段 | 行为 |
| --- | --- | --- |
| `add` | `scope`, `sessionId?`, `text` | 添加待办（空文本忽略） |
| `toggle` | `scope`, `sessionId?`, `id`, `done: boolean` | 勾选/取消（幂等） |
| `edit` | `scope`, `sessionId?`, `id`, `text` | 行内编辑（空文本忽略） |
| `delete` | `scope`, `sessionId?`, `id` | 删除待办 |
| `clear-done` | `scope`, `sessionId?` | 移除全部已完成待办 |
| `set-memo` | `scope`, `sessionId?`, `text` | 整体替换随记文本（空串 = 清空） |

- `scope: 'global'` 时 `sessionId` 必须缺省；`scope: 'session'` 时 `sessionId` 必须为非空字符串，否则 `{ok: false, error: 'bad-args'}`。
- 成功返回 `{ok: true, state: <同 GET 的快照>}`；存储域不可用返回 `{ok: false, error: 'storage-unavailable'}`。
- 响应只包含 NoteItem 标量拷贝（构造小对象），绝不外泄域内部 live 对象。

## 7. 主题适配规范

**总原则：组件样式只允许引用 `--dsw-alias-*` 语义令牌，禁止硬编码色值。** 静态色板（`--dsw-static-*`）仅作令牌内部引用与兜底，组件不得直接使用。明暗切换由宿主主题机制完成（`body[data-ds-dark-theme]`），插件无需感知。

本插件使用的令牌（明暗值均已由 design-platform.css 定义，无需覆写）：

| 用途 | 令牌 |
| --- | --- |
| 竖栏背景/描边 | `--dsw-alias-bg-layer-1` / `--dsw-alias-border-l1`（右缘分隔线；无阴影、无圆角，与列布局融合） |
| 文本 | `--dsw-alias-label-primary`（正文）、`--dsw-alias-label-secondary`（次要）、`--dsw-alias-label-tertiary`（时间/禁用/提示/分区标题） |
| 品牌/强调 | `--dsw-alias-brand-primary`（勾选填充、按钮主填充）、`--dsw-alias-label-primary-foreground`（按钮/勾选上的前景） |
| 交互 | `--dsw-alias-interactive-bg-hover`（行悬停）、`--dsw-alias-interactive-bg-hover-danger`（删除悬停）、`--dsw-alias-button-ghost-active-fill`（tab 激活） |
| 输入框 | `--dsw-specific-input-major` |
| 错误 | `--dsw-alias-state-error-primary`（存储不可用提示） |
| 字体/动效 | `--dsw-font-family`、`--ds-ease-in-out`、`--ds-transition-duration-fast` |

**原型即样式基准**：`prototype/index.html` 内嵌了与 design-platform.css 一致的令牌定义（仅原型内嵌，插件本体不复制色板），插件实现时应以原型的组件样式为基准迁移。

## 8. 目录结构与构建

```
dsh-notes/
├── src/index.mjs          # Host half（webServer 路由 + 存储域）
├── src/client/index.ts    # 浏览器 half（ModuleLoader 工厂，禁止 JSX/import）
├── prototype/index.html   # HTML 原型（评审对象，样式基准）
├── docs/design.md         # 本文档
├── cordis.patch.yml       # 组合补丁：insert { id: dsh-notes, name: @dsh-external/dsh-notes }
├── tsdown.config.ts       # 双 half 构建（Node esm + client cjs 包装）
└── package.json           # dsh.bundle.patch + dsh.client{inject, platform} 元数据
```

构建：`pnpm build` → `lib/index.mjs` + `lib/client.js`（banner/footer 包装为 `window.__ModuleLoader__.load({id, factory})`）。

安装（已验证，`dsh plugin` 即 pnpm 转发 + bundle 自动登记）：

```bash
git clone <本仓库地址> dsh-notes
cd dsh-notes
pnpm install && pnpm build
dsh plugin --profile web add .     # 相对路径以调用目录为锚；自动追加 dsh.profile.bundles
dsh web                            # 重启生效（bundle 层启动时组合）
```

- 卸载：`dsh plugin --profile web remove @dsh-external/dsh-notes`。
- 客户端热更：profile 以 `link:` 指向仓库，`pnpm build` 后刷新浏览器即生效；
  Host half 改动需重启 DSH。

## 9. 里程碑与验收

| 里程碑 | 内容 | 验收 | 状态 |
| --- | --- | --- | --- |
| M0 原型 | `prototype/index.html` 可交互评审 | 明暗切换、宽/窄侧栏、竖栏部分高度 + 折叠/展开、待办/随记双分区、随记自动保存、完整交互、localStorage 模拟持久化 | ✅ 完成 |
| M1 实现 | src 双 half 落地（§4-§6），`pnpm build` 产出 lib | 构建通过；`dsh plugin --profile web add .` 安装成功并登记 bundle | ✅ 完成 |
| M2 功能验收 | 全局/会话待办增删改查、随记自动保存、tab 跟随、折叠/展开（状态持久化）、空态/错误态、窄轨侧栏下竖栏位置跟随 | 对照 §2 功能清单逐项 | ⏳ 待重启 DSH 后验收 |
| M3 持久化验收 | 刷新/重启后数据仍在 | `~/.dsh/storages/notes.json` 结构符合 §5 | ⏳ 待验收 |
| M4 主题验收 | 明暗双主题下所有状态对比 | 与原型一致，无硬编码色值残留 | ⏳ 待验收 |
| M5 隔离验收 | agent 不可见 | 工具目录无 notes 工具；会话日志/提示词中无小记内容；HTTP API 无鉴权面（仅本机 Web） | ⏳ 待验收 |

## 10. 已知限制与风险

- 动态重启恢复：dsh-notes 是安装型插件（非常驻动态 cordis 插件），宿主重启后由组合自动恢复；数据在 `notes.json` 不受影响。
- 多窗口实时同步：第一版为「mutation 快照 + focus 重拉」，多窗口存在秒级延迟。
- overlay 竖栏遮挡：竖栏以浮层覆盖对话列左缘；仅部分高度（底部对齐），且对话内容居中（max-width 860）时通常落在留白区，窄窗口下可能盖住对话区左下内容 —— 已知取舍；折叠后遮挡归零。
- 侧栏折叠/拖拽：竖栏 `left` 跟随 AppFrame 网格第一列（MutationObserver 监听帧内联样式），宽/窄/任意拖宽均正确对齐。
- 会话删除/归档：对应小记记录保留（无清理逻辑），无害遗留，后续版本可加。
- 结构演进：`NoteScope = { todos, memo }` 为 v1 结构；后续如需扩展（如条目类型、排序），bump 域 version 并提供迁移。
- 存储文件损坏：域 open 抛 `malformed-medium`，API 返回 `storage-unavailable`，UI 显示错误条，不影响宿主其他功能；schema 演进时 bump 域 version。
- zod 透传 schema 不做内容校验：数据全部由插件自身写入，风险可控；如未来需要强校验，可引入运行时 zod 构建路径。

### 10.1 后续候选功能（评审结论：本轮未采纳，留档备选）

> 评审日期：2026-08 · 结论：保持当前范围，以下候选不纳入本迭代。将来需要时按此列表评估，实现前各候选需更新为已核实的接口事实。

**A 档（数据可用性/可恢复性）**

| 候选 | 痛点 | 实现路径（基于已核实能力） |
| --- | --- | --- |
| 跨会话搜索/「全部」视图 | 会话小记只跟随当前会话，旧会话内容无法检索 | Host 增 `GET /api/dsh-notes/search?q=` 遍历 `table.entries()` 匹配；竖栏增搜索 tab；标题用 `sessionQuery.readTitleSnapshot`（只读元数据） |
| 误删撤销 | 删除/清空立即永久丢失 | 客户端内存级撤销（删除后 5s 出现「撤销」），无需改存储 |
| 无效会话清理 | 会话删除/归档后记录残留 | 维护接口对比 `sessionPersistence.list()`（只读会话头）清理；会给插件引入 session 服务只读依赖（与隔离不冲突，需确认） |

**B 档（增强）**：消息一键存入小记（`conversation.chat.assistant-actions` 加按钮，聊天→小记方向，不违反隔离）；导出/备份（JSON/Markdown 下载）；置顶/拖拽排序（域 version 2 + 迁移）。

**C 档（工程质量）**：Host API 冒烟测试（node --test）；多窗口实时同步（SSE 推送 `domain/changed`）；竖栏宽度可调。

**明确不做**：模型侧工具/agent 可见性（违反核心要求）；提醒/通知；随记 Markdown 渲染（违背自由文本定位）；多用户/云同步。

## 11. 参考

- `dsh-deepseek-quota`（`.dsh-plugins/` 与 profile 内副本）：webServer 路由 + slots 注册范式。
- `dsh-message-feedback`（profile node_modules）：storageDomain 打开/关闭范式、域 spec 声明。
- `@deepseek-ai/dsh-client-ui-theme/lib/styles/design-platform.css`：主题令牌唯一事实来源。
- `@deepseek-ai/dsh-client-runtime`：`SessionListState` / `useSessions` 契约。
- `dsh-navbar`（`.dsh-plugins/`）：TS 双 half 构建（tsdown）与项目结构范式。
