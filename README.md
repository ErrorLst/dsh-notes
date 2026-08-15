# dsh-notes · 小记

DSH（DeepSeek Harness）左下角「小记」插件：一个持久化的轻量 todo 面板，支持**全局小记**与**会话小记**两种作用域。所有配色基于 DSH 主题令牌（`--dsw-alias-*`），自动适配明暗主题。

> 当前状态：**设计/原型阶段**。项目骨架、设计文档与 HTML 原型已就绪，插件本体（`src/`）待原型评审通过后实现。

## 特性

- 📐 **常驻竖栏**：固定显示在侧栏与对话区之间（宽 280、通高），无独立按钮、无弹窗；侧栏折叠时位置自动跟随
- 🌍 全局小记：所有会话共享，跟随用户
- 💬 会话小记：以会话为单位隔离，切换会话自动跟随（会话标题取自 `SessionListState`）
- 📋 **待办区**：分点待办 —— 添加、勾选/取消、双击行内编辑、删除、清空已完成
- ✍️ **随记区**：自由多行文本 —— 随意记录、不需要分点，输入防抖 + 失焦自动保存
- 🔒 **Agent 隔离**：小记内容对模型完全不可见 —— 不注册任何模型工具、不进提示词、不写会话日志，数据仅存于独立存储域
- 💾 持久化：数据落盘 `~/.dsh/storages/notes.json`（DSH 存储域 `notes`，JSON 后端），刷新/重启不丢
- 🎨 主题适配：仅使用 DSH 语义令牌（`--dsw-alias-bg-layer-1`、`--dsw-alias-label-*`、`--dsw-alias-brand-primary` 等），明暗自动切换

## 快速开始

```bash
# 1. 安装依赖并构建（需要 pnpm）
pnpm install
pnpm build          # 产出 lib/index.mjs（Host half）+ lib/client.js（浏览器 bundle）

# 2. 安装进 DSH（二选一）
#    a) 通过 DSH 插件安装通道（推荐，见 docs/design.md §8）
#    b) 手动：把包加入 web profile 的 node_modules，并在 cordis.patch.yml 插入行
```

安装完成后刷新 Web 页面，左下角即出现「小记」入口。

## 文档

| 文档 | 说明 |
| --- | --- |
| [docs/design.md](docs/design.md) | 设计文档：需求、架构、数据模型、Host API 契约、插槽、主题适配规范、里程碑 |
| [prototype/index.html](prototype/index.html) | HTML 原型（可交互）：明暗主题切换、宽/窄侧栏、完整面板交互，用浏览器直接打开 |

## 目录结构

```
dsh-notes/
├── src/
│   ├── index.mjs          # Host half：存储域 + HTTP API（待实现）
│   └── client/index.ts    # 浏览器 half：触发按钮 + 面板（待实现）
├── prototype/index.html   # HTML 原型（当前评审对象）
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
