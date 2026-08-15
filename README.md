# dsh-notes · 小记

DSH（DeepSeek Harness）「小记」插件：常驻在侧栏与对话区之间的持久化轻量笔记栏，支持**全局**与**工作区**两种作用域。所有配色基于 DSH 主题令牌（`--dsw-alias-*`），自动适配明暗主题。

> 当前状态：**已实现**（M1 完成，M2-M5 待重启 DSH 后验收）。`src/` 双 half 已落地并构建，安装命令已验证。

## 特性

- 📐 **常驻竖栏**：浮层贴住侧栏右缘（宽 280、部分高度、底部对齐），**不参与布局**——折叠/缩放不影响对话区宽度；可折叠成「小记」按钮条（状态持久化），侧栏折叠时位置自动跟随
- 🌍 全局小记：不分工作区，跟随用户
- 🗂️ 工作区小记：以工作区为单位隔离，跟随当前工作区（取自 `useWorkspaces.recentWorkspaceId`）
- 📋 **待办区**：分点待办 —— 添加、勾选/取消、双击行内编辑、删除、清空已完成、**置顶**、**拖拽排序**、**撤销删除**（5 秒内可恢复）
- ✍️ **随记区**：自由多行文本 —— 随意记录、不需要分点，输入防抖 + 失焦自动保存
- 🔒 **Agent 隔离**：小记内容对模型完全不可见 —— 不注册任何模型工具、不进提示词、不写会话日志，数据仅存于独立存储域
- 💾 持久化：数据落盘 `~/.dsh/storages/notes.json`（DSH 存储域 `notes`，JSON 后端），刷新/重启不丢
- 🎨 主题适配：仅使用 DSH 语义令牌（`--dsw-alias-bg-layer-1`、`--dsw-alias-label-*`、`--dsw-alias-brand-primary` 等），明暗自动切换

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
| [docs/design.md](docs/design.md) | 设计文档：需求、架构、数据模型、Host API 契约、插槽、主题适配规范、里程碑 |
| [prototype/index.html](prototype/index.html) | HTML 原型（可交互）：明暗主题切换、宽/窄侧栏、完整面板交互，用浏览器直接打开 |

## 目录结构

```
dsh-notes/
├── src/
│   ├── index.mjs          # Host half：存储域 + HTTP API（已实现）
│   └── client/index.ts    # 浏览器 half：常驻竖栏（已实现）
├── prototype/index.html   # HTML 原型（样式基准）
├── docs/design.md         # 设计文档
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
