# dsh-notes · 小记（小计）

DSH（DeepSeek Harness）「小记」插件：常驻在侧栏与对话区之间的**全高竖栏**——**小计**持久化轻量笔记栏（**全局**与**工作区**两种作用域，待办 + 随记），右缘可拖拽调宽。

所有配色基于 DSH 主题令牌（`--dsw-alias-*`），自动适配明暗主题。

> 当前状态：**v0.7.18**——适配 dsh 0.1.7：当前会话解析从 `SessionListState.current`（0.1.7 已移除）改为 `byId[].retainedBy.mainView`，修复小计竖栏在 0.1.7 上始终退回**全局**作用域、工作区页签消失的问题；新增零依赖回归测试 `test/client-current-session.test.mjs`。Host half 改动需重启 DSH 生效，客户端改动刷新即见。

## 特性

- 📐 **常驻竖栏（顶栏之下全高）**：浮层贴住侧栏右缘（宽 280、从 DSH 顶部栏下缘到页面底部，**不覆盖上边栏**），**不参与布局**——折叠/缩放不影响对话区宽度；可折叠成「小记」按钮条（状态持久化），侧栏折叠时位置自动跟随
- 💬 **常驻会话卡片（上半）**：卡片内直接对话 —— 消息列表 + 发送/停止 + 流式显示；头部 ⚙ 可设预设 / 模型 / 思考等级；清空会话（归档 + 新建）；独立于任何工作区（未分组常驻会话，状态文件 `~/.dsh/session-card.json`）
- 🔀 **上下分区**：分隔条可拖拽调整会话卡片 / 小计的比例（比例持久化）
- 🌍 全局小记：不分工作区，跟随用户
- 🗂️ 工作区小记：以工作区为单位隔离，跟随当前工作区（0.1.7 起取 `byId[].retainedBy.mainView` 持有的会话，≤0.1.6 回退 `SessionListState.current`，再按 `sessionIds` / 归一化 `cwd` 匹配工作区）
- 📋 **待办区**：分点待办 —— 添加、勾选/取消、双击行打开**详情卡片**（标题 + 描述一并编辑）、删除、清空已完成、**置顶**、**拖拽排序**、**撤销删除**（5 秒内可恢复）
- ✍️ **随记区**：自由多行文本 —— 随意记录、不需要分点，输入防抖 + 失焦自动保存
- 🔒 **Agent 隔离（小计内容）**：小计内容对模型完全不可见 —— 不注册任何模型工具、不进提示词、不写会话日志，数据仅存于独立存储域；常驻会话是独立聊天通道，与 notes.json 互不相通
- 💾 持久化：小计落盘 `~/.dsh/storages/notes.json`（存储域 `notes`，JSON 后端）；常驻会话走 DSH 原生会话日志
- 🎨 主题适配：仅使用 DSH 语义令牌（`--dsw-alias-*`），明暗自动切换

## v0.7.0 · 移除 dsh-livefeed

- 删除「讯息」页签/页、未读角标、`/api/dsh-livefeed` 与 5s 轮询（`src/client/livefeed.js`、`src/livefeed-host.mjs` 已删除）。
- 竖栏仅剩「小计」（全局/工作区 todo + 随记）与右缘宽度拖拽；Host 注入服务精简为 `webServer`。
- 数据目录 `~/.dsh/dsh-livefeed/`（config/state/history）原样保留；需要时用 git 历史中的旧版恢复采集能力即可。

## v0.7.18 · 适配 dsh 0.1.7：当前会话解析改用 retainedBy.mainView

- **问题**：dsh 0.1.7 起 `useSessions` 读取的 `SessionListState` 不再携带 `current` 字段
  （0.1.5-alpha.1 仍有、0.1.7-rc.1 已移除；对照 `dsh-v0.1.5-alpha.1` 与 `dsh-v0.1.7-rc.1`
  的 `packages/api/session-controller/src/client/sessions/service.ts`）。旧代码以 `state.current`
  定位当前会话，在 0.1.7 上恒为 `undefined`，于是「当前会话 → 工作区」两级解析同时落空——
  小计竖栏永远退回**全局**作用域，工作区页签消失。
- **修复**：新增 `mainSessionIdOf(state)`——优先取 `byId[].retainedBy.mainView > 0` 的会话
  （与 DSH 自身 `UiSession.publishMain` 同一口径），无该字段时回退 `state.current`。
  两条路径并存，0.1.5 / 0.1.6 / 0.1.7 均可正确定位当前会话。
- **回归测试**：新增 `test/client-current-session.test.mjs`（零依赖），从产物 `lib/client.js`
  抽出 `mainSessionIdOf` 直接执行，覆盖 0.1.7（mainView 命中）、≤0.1.6（回退 current）、
  两者皆无三种形状，并固能源码 / 产物都带 mainView 逻辑、不再出现失效的 `state.current` 选择器。
- `README.md`「工作区小记」来源说明同步更新；`package.json` `version` → 0.7.18、`scripts.test`
  追加新测试文件。

## v0.7.17 · 文档修正：会话日志布局与代次

- **路径修正**：**已废止的旧写法**——旧文档（v0.7.16 及以前的本 README）把会话日志写成
  `~/.dsh/sessions/<cwd>/<sessionId>/session.jsonl.zstd`，该写法**切勿照抄**（`<cwd>` / `<sessionId>`
  都是原始名、日志名是 v0 代次）；
  真实布局是 `<root>/<projectKey(cwd)>/<encodeSegment(sessionId)>/session.v3.jsonl.zstd`
  （`<root>` 即 `dshHomePath('sessions')`，默认 `~/.dsh/sessions`）。目录名是**编码后的
  安全段**，不是原始 cwd / 原始 sessionId。
- **代次校正**：当前会话格式代次是 **v3**（DSH 源码 `packages/core/session/src/types.ts`
  的 `SESSION_FORMAT_VERSION = 3`；文件名规则见 `packages/session/session-format/src/filename.ts`：
  v0 沿用 `session.jsonl`，此后为 `session.v<N>.jsonl`，压缩后端再加 `.zstd` 后缀），
  旧文档写的是**不含 `.vN` 的 v0 形式文件名** `session.jsonl.zstd`。旧代（v0/v1/v2）工件不可变，
  可能与当前代并存于同一会话目录。
- **同步范围**：为消除「README 说已同步、同仓库文档却仍是旧布局」的矛盾，本次一并改正了
  下列文件（全部是文档 / 测试 / 元数据，**无代码改动**）：

  | 文件 | 改了什么 |
  | --- | --- |
  | `README.md` | 本节 + 「持久化」一节（路径与代次） |
  | `docs/design.md` | §2.1 物理双通道、§3.6 对话消息持久化、§4 三条持久化通道 |
  | `docs/research.md` | §1.3 常驻会话日志路径的实测补充 |
  | `test/client-css.test.mjs` | 新增：零依赖 CSS 自洽性测试（私有令牌同名、外部令牌白名单） |
  | `package.json` | `version` → 0.7.17；`scripts.test` → 显式指定测试文件 |

  `src/`、`lib/` 未动（本版无代码改动）。

## v0.7.16 · 适配 dsh 0.1.5-alpha.1（官方右侧栏）

- **官方右侧栏全屏时暂停测量**：dsh 0.1.5 的 ui-sidebar-right 全屏面板是
  `position: fixed; inset: 0; z-index: 40`，盖在整个 `shell.overlay`（z-index 20）之上，
  竖栏此时不可见；此前仍按 1.5s 轮询 + MutationObserver + ResizeObserver 做强制布局。
  现在 frame 带 `data-rightbar-fullscreen` 时跳过测量，退出全屏由新增的
  attributeFilter 触发一次补测（正常态右侧栏 push 时行为不变：中栏变窄 → 消息列
  左缘右移 → 竖栏按既有规则自动隐藏/让位）。
- **滚动条颜色改走官方间接层**：`--dsh-scrollbar-thumb` / `--dsh-scrollbar-thumb-hover`
  （旧 `--dsw-alias-scrollbar-*` 作 fallback），高层级表面可自行 rebind 成 l2 档。
- **删掉失效的 `[class*="scrollBody"]` 兜底**：CSS Module 哈希类名随版本变化，
  只保留官方稳定属性 `[data-conversation-scroll]`。

## v0.7.15 · 随记滚动条与「自动滚回顶部」修复

- **随记 / 详情卡片的滚动条改为 6px 悬浮细轨 + 4px 圆头胶囊**（与待办列表同款，
  也同宿主 ui-tool 卡片内滚动区的做法）：Windows 系统默认滚动条要占 15~17px，280px
  宽的竖栏里正文被生生吃掉一截；现在轨道恒透明，拇指距轨道两侧各内缩 1px、两端
  留 3px 避开 8px 圆角，只在滚动 / 悬停时显形。`scrollbar-gutter: stable` 恒定
  预留这 6px，内容跨过「溢出」阈值时正文不再横向重排。
- **修复随记每隔一会儿自动滚回顶部**：竖栏尺寸自适原先会把竖栏自身临时设为
  `max-content` 测宽（长待办可撑到上千 px），随记 textarea 随之瞬时变宽、正文重排到
  一屏塞得下 → 浏览器把 `scrollTop` 夹到 0，恢复宽度后不再回来（1.5s 轮询 + 各类
  DOM 变化都会触发）。现在只把「小计」头部行设为 `max-content` 测量，测量结果不变，
  竖栏宽度全程不动。

## 快速开始

### 方式一：直接安装（git 分发，无需克隆/构建）

```bash
dsh plugin --profile web add github:ErrorLst/dsh-notes
dsh web               # 重启 dsh web 生效
```

说明：

- 首次使用该命令会自动初始化 web profile；命令转发为 profile 目录的
  `pnpm add github:ErrorLst/dsh-notes`，成功后 reconcile 自动把声明了
  `dsh.bundle.patch` 的包追加进 `dsh.profile.bundles`（无需手动登记）。
- 安装后**必须重启 dsh web**：bundle 层在启动时组合，客户端 bundle 在启动时扫描。

### 方式二：本地开发（克隆并构建）

```bash
git clone <本仓库地址> dsh-notes
cd dsh-notes
pnpm install
pnpm build            # 产出 lib/index.mjs（Host half）+ lib/client.js（浏览器 bundle）
dsh plugin --profile web add .
dsh web               # 重启 DSH 使其生效
```

说明：

- `dsh plugin add .` 会把相对路径 `.` 锚定到**你执行命令的目录**（即仓库根目录），
  在 web profile 里执行 `pnpm add <绝对路径>`，随后自动把声明了 `dsh.bundle` 的包
  追加到 profile 的 `dsh.profile.bundles`（无需手动改配置）。
- 默认 profile 名为 `web`；其他 profile 用 `dsh plugin --profile <name> add .`。
- 安装后**必须重启 DSH 进程**：bundle 层在启动时组合，客户端 bundle 在启动时扫描。
- 卸载：`dsh plugin --profile web remove @dsh-external/dsh-notes`（同时从 bundles 移除）。

### 开发迭代

- 修改 `src/` 后执行 `pnpm build` 重新生成 `lib/`；profile 以 `link:` 指向本仓库，
  **刷新浏览器页面**即可看到客户端改动，Host half 改动需重启 DSH。
- 数据文件：`~/.dsh/storages/notes.json`（存储域 `notes`，JSON 后端）。

## 持久化

小记数据走 DSH **存储域（storage domain）+ JSON 后端**链路：

```
浏览器操作 → POST /api/dsh-notes → 插件内串行链 → storageDomain('notes', v1)
                                              → json 后端 → ~/.dsh/storages/notes.json
```

- **落盘位置**：`~/.dsh/storages/notes.json`（首次写入时创建，与 `workspace.json` 同机制）
- **文件结构**（人类可读 JSON）：

```json
{
  "unit": { "name": "notes", "version": 1 },
  "global": { "todos": [ { "id": "...", "text": "...", "done": false, "createdAt": 0, "updatedAt": 0 } ], "memo": "" },
  "tables": { "workspaces": { "<workspaceId>": { "todos": [], "memo": "" } } }
}
```

- **写入语义**：域写链 —— 先原子整文件落盘（临时文件 + rename，崩溃不留半截），
  再改内存、后发变更事件；插件内串行链保证读-改-写不交错
- **与对话消息隔离**：对话消息存于
  `~/.dsh/sessions/<projectKey(cwd)>/<encodeSegment(sessionId)>/session.v3.jsonl.zstd`
  （追加式 JSONL + zstd 压缩；`<root>` 由 base bundle 配为 `dshHomePath('sessions')`，
  默认 `~/.dsh/sessions`），与小记是**两条独立通道**；agent 只接触会话日志，
  结构上接触不到 notes 文件（详见 [docs/design.md](docs/design.md) §3.6）
- **目录名是编码段，不是原始名**：`projectKey(cwd)` 把路径/盘符分隔符折成 `-`、把不安全
  码元转义为 `~XXXX` 并在两侧补 `--`（会话无 cwd 时用 `_no-cwd`）；`encodeSegment(sessionId)`
  逐码元转义，因此目录名与原始 cwd / sessionId 不同名，按原值找不到目录。
  当前格式代次为 **v3**，日志名 `session.v3.jsonl.zstd`；旧代（v0/v1/v2）工件不可变，
  **可能与当前代并存于同一会话目录**，读取以最新代次为准。

## 文档

| 文档 | 说明 |
| --- | --- |
| [docs/design.md](docs/design.md) | 设计文档：需求、架构、数据模型、Host API 契约（小计 + 会话卡片）、插槽、主题适配规范、里程碑 |
| [docs/research.md](docs/research.md) | API 调研记录（会话卡片部分，融合自旧 dsh-session-card）：服务契约速查、关键机制验证、源码位置索引 |
| [prototype/index.html](prototype/index.html) | HTML 原型（可交互）：明暗主题切换、宽/窄侧栏、全高竖栏（上会话卡片 / 下小计）、分隔条拖拽，用浏览器直接打开 |

## 目录结构

```
dsh-notes/
├── src/
│   ├── index.mjs          # Host half：存储域 + HTTP API（小计）
│   └── client/
│       └── index.ts       # 浏览器 half：全高竖栏（小计 + 宽度拖拽）
├── prototype/index.html   # HTML 原型（样式基准）
├── docs/
│   ├── design.md          # 设计文档（v0.4 融合版）
│   └── research.md        # API 调研记录（会话卡片部分）
├── cordis.patch.yml       # bundle 组合补丁（挂 Host half）
├── tsdown.config.ts       # 双 half 构建
└── package.json           # @dsh-external/dsh-notes（dsh.bundle + dsh.client 元数据）
```

## 开发约定

- 构建：`pnpm build`（tsdown；Node 半为 ESM，浏览器半为 `__ModuleLoader__` CJS 工厂）
- 浏览器端代码**禁止 JSX/import 变换**，按官方 client 通道编写
- 样式**禁止硬编码色值**：一律使用 `--dsw-alias-*` 语义令牌（原型即样式基准）
- 实现前请阅读 [docs/design.md](docs/design.md)，其中含已核实的运行时接口事实

## License

MIT
