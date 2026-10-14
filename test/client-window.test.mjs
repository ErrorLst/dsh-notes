/**
 * dsh-notes 全局浮动窗口回归测试（零依赖）。
 * 运行：`node --test test/client-window.test.mjs`（与 package.json 的 `scripts.test` 一致）。
 *
 * v0.8.0 把「贴侧栏的全高竖栏」改成「全局自由浮动窗口」，本测试固化这次改造的两组事实：
 *
 *  A. 几何纯函数（从产物 lib/client.js 抽出 `winDefaults` / `clampWin` / `winRead` / `winWrite`
 *     连同 `WIN_*` 常量一起执行，注入 window / localStorage 桩）：
 *     - 默认几何落在视口内；
 *     - 窗口永远被钳制在视口内（超界坐标 / 超大尺寸 / 小于最小值都被收回）；
 *     - 持久化记录可往返，损坏的 JSON 回退默认值，折叠标记保留。
 *
 *  B. 结构事实（源码 + 产物）：外壳是 `position: fixed`、有标题栏 / 两个页签 / 三个尺寸手柄 /
 *     折叠态；旧的「自适应隐藏」（covered-hidden / view-hidden）与单条右缘手柄已不存在。
 *
 * 本测试只读文件 + 执行纯函数，不模拟 React / DOM 渲染。
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

/**
 * 抽出产物里「几何常量 + winDefaults / clampWin / winRead / winWrite」整段并求值。
 * 结束锚点是紧随其后的 `function scopeOf(`（几何段之后的第一个顶层声明）。
 * @returns {{ make: (win: object, store: object) => object, lastStore: () => object }}
 */
function extractGeometry() {
  const from = bundle.indexOf('const WIN_KEY')
  const to = bundle.indexOf('function scopeOf(data, tab)')
  assert.ok(from > 0 && to > from, 'lib/client.js 里找不到浮动窗口几何段（WIN_KEY … scopeOf）')
  const code = bundle.slice(from, to)
  return (win, store) => {
    const make = new Function(
      'window',
      'localStorage',
      `${code}\nreturn { winDefaults, clampWin, winRead, winWrite };`,
    )
    return make(win, store)
  }
}

/** 可控的 localStorage 桩。 */
function makeStore(initial) {
  const map = new Map(initial === undefined ? [] : Object.entries(initial))
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)) },
    get: (key) => (map.has(key) ? map.get(key) : null),
  }
}

const WINDOW_1280 = { innerWidth: 1280, innerHeight: 800 }

test('几何段抽取有效（避免后续断言空转）', () => {
  const build = extractGeometry()
  const api = build(WINDOW_1280, makeStore())
  for (const name of ['winDefaults', 'clampWin', 'winRead', 'winWrite']) {
    assert.equal(typeof api[name], 'function', `几何段里缺少 ${name}`)
  }
})

test('默认几何：贴右上角，宽高为默认值，落在视口内', () => {
  const { winDefaults } = extractGeometry()(WINDOW_1280, makeStore())
  const win = winDefaults()
  assert.deepEqual(win, { x: 1280 - 320 - 24, y: 76, w: 320, h: 460, collapsed: false })
})

test('clampWin：超界坐标 / 超大尺寸被收回视口内', () => {
  const { clampWin } = extractGeometry()(WINDOW_1280, makeStore())
  const win = clampWin({ x: 5000, y: 5000, w: 5000, h: 5000, collapsed: false })
  assert.equal(win.w, 1280 - 12 * 2)
  assert.equal(win.h, 800 - 12 * 2)
  assert.equal(win.x, 12)
  assert.equal(win.y, 12)
})

test('clampWin：小于最小值抬到最小值，负坐标抬到边距', () => {
  const { clampWin } = extractGeometry()(WINDOW_1280, makeStore())
  const win = clampWin({ x: -100, y: -100, w: 10, h: 10, collapsed: false })
  assert.equal(win.w, 240)
  assert.equal(win.h, 200)
  assert.equal(win.x, 12)
  assert.equal(win.y, 12)
})

test('clampWin：保留 collapsed 标记（折叠态不因钳制丢失）', () => {
  const { clampWin } = extractGeometry()(WINDOW_1280, makeStore())
  assert.equal(clampWin({ x: 0, y: 0, w: 300, h: 300, collapsed: true }).collapsed, true)
})

test('winRead：无记录 → 默认几何；损坏记录 → 默认几何', () => {
  const { winRead, winDefaults } = extractGeometry()(WINDOW_1280, makeStore())
  assert.deepEqual(winRead(), winDefaults())
  const { winRead: readBroken } = extractGeometry()(WINDOW_1280, makeStore({ 'dsh-notes.window.v1': '{not json' }))
  assert.deepEqual(readBroken(), winDefaults())
})

test('winRead：合法记录读回并钳制，缺失字段回退默认', () => {
  const stored = JSON.stringify({ x: 100, y: 120, w: 400, h: 500, collapsed: true })
  const { winRead } = extractGeometry()(WINDOW_1280, makeStore({ 'dsh-notes.window.v1': stored }))
  assert.deepEqual(winRead(), { x: 100, y: 120, w: 400, h: 500, collapsed: true })

  const partial = JSON.stringify({ x: 100, y: 120 })
  const { winRead: readPartial } = extractGeometry()(WINDOW_1280, makeStore({ 'dsh-notes.window.v1': partial }))
  const win = readPartial()
  assert.equal(win.x, 100)
  assert.equal(win.y, 120)
  assert.equal(win.w, 320)
  assert.equal(win.h, 460)
  assert.equal(win.collapsed, false)
})

test('winWrite：写入后 winRead 可原样读回（超出视口的记录读回时被钳制）', () => {
  const store = makeStore()
  const { winWrite, winRead } = extractGeometry()(WINDOW_1280, store)
  winWrite({ x: 200, y: 160, w: 360, h: 420, collapsed: false })
  assert.deepEqual(winRead(), { x: 200, y: 160, w: 360, h: 420, collapsed: false })

  winWrite({ x: 9999, y: 9999, w: 360, h: 420, collapsed: true })
  const clamped = winRead()
  assert.equal(clamped.x, 1280 - 360 - 12)
  assert.equal(clamped.y, 800 - 420 - 12)
  assert.equal(clamped.collapsed, true)
})

test('外壳：position: fixed，且不再有自适应隐藏 / 单条右缘手柄', () => {
  const css = /const DOCK_CSS = `([\s\S]*?)`/.exec(bundle)
  assert.ok(css, '未能从 lib/client.js 抽出 DOCK_CSS')
  const text = css[1]
  const root = /\.dsh-notes-dock \{([\s\S]*?)\}/.exec(text)
  assert.ok(root, 'DOCK_CSS 里找不到 .dsh-notes-dock 规则')
  assert.match(root[1], /position:\s*fixed/, '浮动窗口必须是 position: fixed')
  for (const needle of ['.dock-header', '.dock-tabs', '.dock-tab', '.dock-resize-r', '.dock-resize-b', '.dock-resize-se', '.dsh-notes-dock.collapsed']) {
    assert.ok(text.includes(needle), `DOCK_CSS 缺少 ${needle}`)
  }
  for (const gone of ['covered-hidden', 'view-hidden', '.dock-resize {']) {
    assert.ok(!text.includes(gone), `DOCK_CSS 仍残留旧竖栏规则的 ${gone}`)
  }
})

test('两个独立页签：待办 / 随记，切换只渲染当前面板', () => {
  for (const [path, text] of [[CLIENT_SOURCE, source], [CLIENT_BUNDLE, bundle]]) {
    assert.match(text, /view === "todo"|view === 'todo'/, `${path} 缺少待办页签判定`)
    assert.match(text, /view === "memo"|view === 'memo'/, `${path} 缺少随记页签判定`)
    assert.match(text, /setView\("todo"\)|setView\('todo'\)/, `${path} 缺少待办页签切换`)
    assert.match(text, /setView\("memo"\)|setView\('memo'\)/, `${path} 缺少随记页签切换`)
    for (const label of ['待办', '随记']) assert.ok(text.includes(label), `${path} 缺少页签文案 ${label}`)
  }
})
