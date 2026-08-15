# dsh-notes 设计文档

> 版本：0.1（草案） · 状态：原型评审中 · 关联原型：`prototype/index.html`

## 1. 概述

在 DSH Web 界面左下角（侧边栏底部、设置按钮旁）提供「小记」入口与弹出面板，持久化记录**不限于 todo** 的轻量内容。数据分两种作用域：

- **全局小记**：不分会话，长期跟随用户（如「给 API 充值」「整理文档」）。
- **会话小记**：以会话为单位隔离（如「LaptopAxisCheck」会话的待办），切换会话时自动跟随。

面板内容区分为**两个部分**（每个作用域各自独立）：

- **待办区（todo）**：分点待办列表 —— 每行一个可勾选条目，支持添加/勾选/行内编辑/删除/清空已完成，未完成数计入入口徽标。
- **随记区（memo）**：自由多行文本 —— 随意输入、不需要分点（如电话、链接、会议纪要），输入防抖 + 失焦自动保存，不参与勾选统计、不计入徽标。

用户已确认的范围：**待办（分点）+ 随记（自由文本）两类内容**，**仅 UI**，且**内容不暴露给 agent**（隔离保证见 §2.1）。

## 2. 功能清单

| 能力 | 说明 |
| --- | --- |
| 入口按钮 | `sidebar.footer.action` 新增 cell（id: `notes-panel`）；宽模式显示「📝 小记」+ 未完成徽标，窄轨只显示图标；徽标 = 全局 + 当前会话未完成**待办**数之和（随记不计入） |
| 弹出面板 | `shell.overlay` 注册，固定左下角（`left: 8px; bottom: 8px`），宽 320、`height: min(62vh, 560px)`，`pointer-events: auto`（overlay 层本身点击穿透）；右上 × 或 Esc 关闭；再次点入口切换 |
| Tab | 「全局」/「本会话（会话标题）」；无当前会话（`s.current === undefined`）时隐藏会话 tab；切换时各自独立读写 |
| 待办区 | 分区标题行（标题 + 「共 X 项 · 未完成 Y」+「清空已完成」）+ 添加输入行 + 分点列表：勾选/取消（显式传 done，幂等）、双击行内编辑（Enter 保存 / Esc 取消 / 失焦保存，空文本忽略）、删除（行悬停出现）、清空已完成（仅移除已完成条目，无已完成时禁用） |
| 随记区 | 分区标题行（标题 + 保存状态）+ 多行 textarea：自由文本（不限制格式/行数），输入防抖 600ms 自动保存 + 失焦立即保存（含关面板/Esc/切 tab/切会话前的落盘），状态显示「保存中…/已保存」；清空 = 文本置空 |
| 空/错状态 | 待办空列表提示；host 存储不可用时面板顶部错误条，UI 不崩溃 |
| 主题 | 全部使用 `--dsw-alias-*` 语义令牌，明暗由 `body[data-ds-dark-theme]` 自动适配（见 §7） |
| Agent 隔离 | 小记内容对 agent 完全不可见（见 §2.1） |

### 2.1 Agent 隔离（不可见保证）

小记是**用户私有**数据，agent（模型）在任何路径上都接触不到：

1. **不注册模型工具**：不调用 `harness.defineTool` / `tools.register`，模型工具目录中不存在任何 notes 工具。
2. **不进提示词**：不注册 `systemPrompt` section / context / 变量，小记内容永不进入模型上下文。
3. **不进会话日志**：数据只写入独立存储域 `notes`（`~/.dsh/storages/notes.json`），不写入 session log、不产生会话事件（无 `ctx.on` 监听、不 append 事件）。
4. **不注册 Remote 服务**：Host API 是普通 HTTP 路由（`webServer.register`），仅浏览器 `fetch` 调用；不经 typert gateway / api-remotes 暴露。
5. **键只是字符串**：会话小记仅以 `sessionId` 字符串为键，与 agent 会话对象无引用关系；客户端读取当前会话 id 仅发生在浏览器展示层（`useSessions`）。
6. **不依赖 agent 生命周期**：插件只依赖 `webServer` 与 `storageDomain`，与 agent/session 服务解耦。

## 3. 已核实的运行时事实（实现时不再猜测）

以下事实来自本次调研（DSH 运行时 Inspect + 已安装插件源码 + 主题样式表），是实现的依据。

### 3.1 插槽

| 插槽 | 类型/作用域 | 注册项 | owner props | standard props |
| --- | --- | --- | --- | --- |
| `sidebar.footer.action` | list / root | `{id, order, label}` | `{wide: boolean}` | `useSessions: SnapshotSelectorHook<SessionListState>`、`useWorkspaces` |
| `shell.overlay` | list / root | `{id, order, label}` | 无 | 同上 |

- 新 id 会**追加**为新 cell，不覆盖现有项（现占用：`cordis-panel`、`deepseek-quota`）。
- 注册范式（参考 `dsh-deepseek-quota/lib/client.js`）：

```js
ctx.slots.inject('sidebar.footer.action', () =>
  ctx.slots.register({ name: 'sidebar.footer.action', id: 'notes-panel' }, Trigger),
)
```

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

### 3.4 Host API 通道

- 独立插件（非动态 cordis 插件）的浏览器↔宿主通信使用 `webServer.register` 注册 HTTP 路由（`dsh-deepseek-quota` 的 `GET /api/deepseek-quota` 即此通道）。
- 路由注册须包在 `ctx.effect(...)` 中，随 fiber 清理。

### 3.5 主题令牌

- 语义令牌（alias）与静态色板（static）定义于 `@deepseek-ai/dsh-client-ui-theme/lib/styles/design-platform.css`：
  - 静态色板挂在 `body`；暗色覆盖挂 `body[data-ds-dark-theme]`；
  - alias 令牌同样按 `body` / `body[data-ds-dark-theme]` 两段定义，**一律引用 static 令牌或 rgba**，组件侧只允许消费 alias。
- 字体：`--dsw-font-family`（含 PingFang SC / Microsoft YaHei）、`--ds-font-family-code`；动效 `--ds-ease-in-out`、`--ds-transition-duration*`。
- 本插件实际用到的 alias 令牌清单见 §7。

## 4. 架构

```
┌─ 浏览器（client bundle, lib/client.js）────────────────────┐
│  sidebar.footer.action ── 触发按钮（wide/rail + 徽标）      │
│  shell.overlay ────────── 面板（tab/输入/列表/操作）         │
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
- **Agent 隔离**：无模型工具、无 prompt 注入、数据不进会话日志；插件与 agent/session 服务完全解耦（见 §2.1）。
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
- 徽标/计数：只统计 `todos` 中未完成的条目。
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
| 面板背景/描边 | `--dsw-alias-bg-overlay` / `--dsw-alias-border-l2`（分隔线用 `--dsw-alias-border-l1`） |
| 文本 | `--dsw-alias-label-primary`（正文）、`--dsw-alias-label-secondary`（次要）、`--dsw-alias-label-tertiary`（时间/禁用/提示） |
| 品牌/强调 | `--dsw-alias-brand-primary`（勾选填充、按钮主填充）、`--dsw-alias-label-primary-foreground`（按钮/勾选上的前景） |
| 交互 | `--dsw-alias-interactive-bg-hover`（行悬停）、`--dsw-alias-interactive-bg-hover-danger`（删除悬停） |
| 输入框 | `--dsw-specific-input-major` |
| 错误 | `--dsw-alias-state-error-primary`（存储不可用提示） |
| 侧栏 | `--dsw-specific-sidebar-fill`、`--dsw-specific-sidebar-nav-item-active` / `-hover`（入口按钮 hover 底色参考） |
| 字体/动效 | `--dsw-font-family`、`--ds-ease-in-out`、`--ds-transition-duration-fast` |

弹层阴影：`shell.overlay` 层自带的提升感依赖阴影；DSH 未在 alias 层暴露通用弹层阴影令牌（`--dsw-shadow-lv3` 为运行时注入值，插件代码不可假设存在），故面板自带 `box-shadow`，明暗各一档（原型内已定义，见 `prototype/index.html` 中 `--dsh-notes-shadow`）。

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

安装（二选一，安装细节在实现阶段验证）：

1. **DSH 插件通道**：经 `plugin_install`（或等价机制）以本地路径加入 web profile 的依赖图，并写入 profile `cordis.patch.yml` 插入行；Host 半经 patch 挂载，客户端 bundle 经 `dsh.client` 声明由 client-modules 扫描进 boot 图。
2. **手动**：将包放入 profile `node_modules`（或 file: 依赖），patch 插入行同上。

## 9. 里程碑与验收

| 里程碑 | 内容 | 验收 |
| --- | --- | --- |
| M0 原型 | `prototype/index.html` 可交互评审（本阶段） | 明暗切换、宽/窄侧栏、待办/随记双分区、随记自动保存、完整面板交互、localStorage 模拟持久化 |
| M1 实现 | src 双 half 落地（§4-§6） | `pnpm build` 通过；安装后左下角出现入口 |
| M2 功能验收 | 全局/会话待办增删改查、随记自动保存、徽标、空态/错误态 | 对照 §2 功能清单逐项 |
| M3 持久化验收 | 刷新/重启后数据仍在 | `~/.dsh/storages/notes.json` 结构符合 §5 |
| M4 主题验收 | 明暗双主题下所有状态对比 | 与原型一致，无硬编码色值残留 |
| M5 隔离验收 | agent 不可见 | 工具目录无 notes 工具；会话日志/提示词中无小记内容；HTTP API 无鉴权面（仅本机 Web） |

## 10. 已知限制与风险

- 动态重启恢复：dsh-notes 是安装型插件（非常驻动态 cordis 插件），宿主重启后由组合自动恢复；数据在 `notes.json` 不受影响。
- 多窗口实时同步：第一版为「mutation 快照 + focus 重拉」，多窗口存在秒级延迟。
- 会话删除/归档：对应小记记录保留（无清理逻辑），无害遗留，后续版本可加。
- 结构演进：`NoteScope = { todos, memo }` 为 v1 结构；后续如需扩展（如条目类型、排序），bump 域 version 并提供迁移。
- 存储文件损坏：域 open 抛 `malformed-medium`，API 返回 `storage-unavailable`，UI 显示错误条，不影响宿主其他功能；schema 演进时 bump 域 version。
- zod 透传 schema 不做内容校验：数据全部由插件自身写入，风险可控；如未来需要强校验，可引入运行时 zod 构建路径。

## 11. 参考

- `dsh-deepseek-quota`（`.dsh-plugins/` 与 profile 内副本）：footer action 注册 + webServer 路由范式。
- `dsh-message-feedback`（profile node_modules）：storageDomain 打开/关闭范式、域 spec 声明。
- `@deepseek-ai/dsh-client-ui-theme/lib/styles/design-platform.css`：主题令牌唯一事实来源。
- `@deepseek-ai/dsh-client-runtime`：`SessionListState` / `useSessions` 契约。
- `dsh-navbar`（`.dsh-plugins/`）：TS 双 half 构建（tsdown）与项目结构范式。
