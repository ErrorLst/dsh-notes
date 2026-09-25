/**
 * dsh-notes 当前会话解析回归测试（零依赖）。
 * 运行：\`node --test test/client-current-session.test.mjs\`。
 *
 * 背景：dsh 0.1.7 起 \`SessionListState\` 不再携带 \`current\` 字段
 * （dsh-v0.1.5-alpha.1 仍有；dsh-v0.1.7-rc.1 已移除）。被主视图打开的会话改由
 * \`SessionSummary.retainedBy.mainView\` 标识——与 DSH 自身 \`UiSession.publishMain\`
 * 同一口径。旧实现只读 \`state.current\`，在 0.1.7 上恒为 undefined，导致小计竖栏
 * 永远退回「全局」作用域、工作区页签消失。
 *
 * 本测试从产物 lib/client.js 中抽出 \`mainSessionIdOf\` 并直接执行：
 *   - 0.1.7 形状：按 retainedBy.mainView 选中会话；
 *   - ≤0.1.6 形状：回退 state.current；
 *   - 两者都无：返回 undefined。
 * 同时固能源码与产物都带 mainView 逻辑、且不再出现失效的 \`state.current\` 选择器。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CLIENT_SOURCE = join(ROOT, 'src', 'client', 'index.ts')
const CLIENT_BUNDLE = join(ROOT, 'lib', 'client.js')

const source = readFileSync(CLIENT_SOURCE, 'utf8')
const bundle = readFileSync(CLIENT_BUNDLE, 'utf8')

/** 抽出产物里的 function mainSessionIdOf(state) { ... } 并返回可执行函数。 */
function extractMainSessionIdOf() {
  const match = /function mainSessionIdOf\(state\) \{[\s\S]*?\n\t\t\}/.exec(bundle)
  assert.ok(match, 'lib/client.js 里找不到 mainSessionIdOf（产物未同步修复？）')
  // eslint-disable-next-line no-new-func
  return new Function(match[0] + '; return mainSessionIdOf;')()
}

test('0.1.7 形状：按 retainedBy.mainView 选中当前会话', () => {
  const fn = extractMainSessionIdOf()
  const state = {
    ids: ['sess-a', 'sess-b'],
    byId: {
      'sess-a': { id: 'sess-a', retainedBy: { mainView: 0 }, cwd: 'C:\\a' },
      'sess-b': { id: 'sess-b', retainedBy: { mainView: 1 }, cwd: 'C:\\b' },
    },
    // 0.1.7 不应再依赖这个字段；给个会误导的值以证明走的是 mainView。
    current: 'sess-a',
  }
  assert.equal(fn(state), 'sess-b')
})

test('≤0.1.6 形状：无 retainedBy 时回退 state.current', () => {
  const fn = extractMainSessionIdOf()
  const state = {
    ids: ['sess-old'],
    byId: { 'sess-old': { id: 'sess-old', cwd: 'C:\\old' } },
    current: 'sess-old',
  }
  assert.equal(fn(state), 'sess-old')
})

test('两种形状都无当前会话：返回 undefined', () => {
  const fn = extractMainSessionIdOf()
  assert.equal(fn({ ids: ['x'], byId: { x: { id: 'x' } }, current: undefined }), undefined)
})

test('源与产物都带 mainView 逻辑，且不再出现失效的 state.current 选择器', () => {
  for (const [path, text] of [[CLIENT_SOURCE, source], [CLIENT_BUNDLE, bundle]]) {
    assert.match(text, /function mainSessionIdOf/, path + ' 缺少 mainSessionIdOf')
    assert.match(text, /retainedBy\?\.mainView/, path + ' 缺少 retainedBy.mainView 判定')
    assert.ok(
      !text.includes('useSessions((state) => state.current)'),
      path + ' 仍在使用失效的 useSessions((state) => state.current)：0.1.7 的 SessionListState 没有 current',
    )
  }
})
