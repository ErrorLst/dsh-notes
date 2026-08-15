// dsh-notes —— 浏览器 half（官方 client bundle，__ModuleLoader__ 契约）。
//
// 职责（实现中，待原型评审通过后按 docs/design.md 落地）：
//   1. shell.overlay 注册一个**常驻条目**（id: notes-dock），始终渲染
//      「小记」竖栏：position fixed，left = 侧栏实测宽度（ResizeObserver
//      跟随宽 260 / 窄轨 56 折叠），top/bottom 0，width 280，
//      pointer-events auto；无入口按钮、无弹窗。
//   2. 竖栏内容：
//       顶部  小记 + 全局/本会话 tab（useSessions 取 s.current / displayTitle）
//       待办区 添加输入 + 分点列表（勾选/双击行内编辑/删除/清空已完成）
//       随记区 多行 textarea（防抖 600ms + 失焦自动保存）
//   3. 数据经 fetch('/api/dsh-notes') 读写。
//   4. 样式只用 --dsw-alias-* 语义令牌（原型 prototype/index.html 即样式基准）。
//
// 构建：tsdown 以 banner/footer 包装为 ModuleLoader 工厂（见 tsdown.config.ts），
// 与 dsh-deepseek-quota / dsh-navbar 同一通道。

export default {
  name: 'notes-client',
  inject: ['slots'],
  apply(ctx) {
    // TODO(原型评审后)：实现上述 1-4。
    void ctx
  },
}
