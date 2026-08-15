// dsh-notes —— Node half（宿主侧）。
//
// 职责（实现中，待原型评审通过后按 docs/design.md 落地）：
//   1. 打开持久化存储域 `notes`（backend json → ~/.dsh/storages/notes.json）：
//        global:  { items: NoteItem[] }                       —— 全局小记
//        table sessions: <sessionId> -> { items: NoteItem[] } —— 会话小记
//      域 spec 的 zod schema 在本环境不可 import，用鸭子类型透传 schema
//      （{ parse, safeParse }，safeParse(null) 必须失败，见 design.md §5）。
//   2. 通过 ctx.webServer.register 挂 HTTP API（同 dsh-deepseek-quota 通道）：
//        GET  /api/dsh-notes?sessionId=…   -> 状态快照
//        POST /api/dsh-notes               -> { action, scope, sessionId?, … }
//      动作：add / toggle / edit / delete / clear-done，全部返回更新后快照。
//   3. 所有变更走域写链（put/update 原子 RMW + 插件内串行链），
//      返回值只含 NoteItem 标量拷贝，绝不外泄域内部 live 对象。
//
// 参考实现：dsh-deepseek-quota（webServer 路由）、dsh-message-feedback
// （storageDomain.open + ctx.effect 关闭范式）。

export const name = 'dsh-notes'

export const inject = ['webServer']

export function apply(ctx, config = {}) {
  // TODO(原型评审后)：实现上述 1-3。
  // 骨架说明：inject 保证 webServer 就绪；storageDomain 用 ctx.get 探测，
  // 缺失时记录错误并跳过（客户端会收到存储不可用）。
  void ctx
  void config
}
