// dsh-notes —— 浏览器 half（官方 client bundle，__ModuleLoader__ 契约）。
//
// 职责（实现中，待原型评审通过后按 docs/design.md 落地）：
//   1. sidebar.footer.action 注册「小记」触发按钮（id: notes-panel）：
//        wide 显示「📝 小记」+ 未完成徽标；窄轨只显示图标。
//   2. shell.overlay 注册面板（同 id），打开时渲染左下角浮动卡：
//        全局 / 本会话 两个 tab（无会话时隐藏会话 tab）；
//        添加、勾选、双击行内编辑、删除、清空已完成；Esc 关闭。
//   3. 数据经 fetch('/api/dsh-notes') 读写；会话 id 来自 useSessions
//      standard prop（s.current / s.byId[current].displayTitle）。
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
