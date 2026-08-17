# dsh-notes · 小记（含常驻会话卡片）

DSH（DeepSeek Harness）「小记」插件：常驻在侧栏与对话区之间的**全高竖栏**，上半部分为**常驻会话卡片**（卡片内直接对话，融合自 dsh-session-card），下半部分为持久化轻量笔记栏（**全局**与**工作区**两种作用域）。所有配色基于 DSH 主题令牌（`--dsw-alias-*`），自动适配明暗主题。

> 当前状态：**融合已实现（v0.4.2）**——全高竖栏（上常驻会话卡片 / 下小计）已落地并构建，**重启 DSH 后验收**（Host half 需重启生效；客户端刷新即见）。

## 特性

- 📐 **常驻竖栏（顶栏之下全高）**：浮层贴住侧栏右缘（宽 280、从 DSH 顶部栏下缘到页面底部，**不覆盖上边栏**），**不参与布局**——折叠/缩放不影响对话区宽度；可折叠成「小记」按钮条（状态持久化），侧栏折叠时位置自动跟随
- 💬 **常驻会话卡片（上半）**：卡片内直接对话 —— 消息列表 + 发送/停止 + 流式显示；头部 ⚙ 可设预设 / 模型 / 思考等级；清空会话（归档 + 新建）；独立于任何工作区（未分组常驻会话，状态文件 `~/.dsh/session-card.json`）
- 🔀 **上下分区**：分隔条可拖拽调整会话卡片 / 小计的比例（比例持久化）
- 🌍 全局小记：不分工作区，跟随用户
- 🗂️ 工作区小记：以工作区为单位隔离，跟随当前工作区（取自 `useWorkspaces.recentWorkspaceId`）
- 📋 **待办区**：分点待办 —— 添加、勾选/取消、双击行内编辑、删除、清空已完成、**置顶**、**拖拽排序**、**撤销删除**（5 秒内可恢复）
- ✍️ **随记区**：自由多行文本 —— 随意记录、不需要分点，输入防抖 + 失焦自动保存
- 🔒 **Agent 隔离（小计内容）**：小计内容对模型完全不可见 —— 不注册任何模型工具、不进提示词、不写会话日志，数据仅存于独立存储域；常驻会话是独立聊天通道，与 notes.json 互不相通
- 💾 持久化：小计落盘 `~/.dsh/storages/notes.json`（存储域 `notes`，JSON 后端）；常驻会话走 DSH 原生会话日志
- 🎨 主题适配：仅使用 DSH 语义令牌（`--dsw-alias-*`），明暗自动切换

## 快速开始

```bash
# 1. 克隆并构建
git clone <本仓库地址> dsh-notes
cd dsh-notes
pnpm install
pnpm build            # 产出 lib/index.mjs（Host half）+ lib/client.js（浏览器 bundle）

# 2. 安装进 DSH（一步完成：加入 profile 依赖并自动登记为 bundle 层）
dsh plugin --profile web add .

# 3. 重启 DSH 使其生效
dsh web               # 或 dsh --profile web
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
- **与对话消息隔离**：对话消息存于 `~/.dsh/sessions/<cwd>/<sessionId>/session.jsonl.zstd`
  （追加式 JSONL + zstd 压缩），与小记是**两条独立通道**；agent 只接触会话日志，
  结构上接触不到 notes 文件（详见 [docs/design.md](docs/design.md) §3.6）

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
│   ├── index.mjs          # Host half：存储域 + HTTP API + 常驻会话管理（会话卡片）
│   └── client/index.ts    # 浏览器 half：全高竖栏（上会话卡片 / 下小计）
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
