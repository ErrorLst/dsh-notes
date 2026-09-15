/**
 * dsh-notes 客户端 CSS 自洽性测试（零依赖）。
 * 运行：`node --test test/client-css.test.mjs`（与 package.json 的 `scripts.test` 字符串完全一致）。
 *
 * 为什么显式指定测试文件而不是目录：`node --test` 的位置参数按**文件 / glob** 解析（该变更并非
 * 一直如此——官方 glob 支持 PR nodejs/node#47653 随 **Node v21.0.0** 发布；本仓库只在本机实测过
 * v22.23.1 / v24.18.1，未实测 21），目录形式的 `node --test test/` 在实测版本上会报
 * `Cannot find module '.../test'` 并以非零码退出；
 * 显式列文件还能让「测试文件被改名 / 删除」直接报错，而不是 0 个测试静默变绿。
 *
 * 事实基线（逐条对照过生效中的 DSH checkout `deepseek-harness`，其 HEAD commit 为
 * `0d1f50007f9bca3f52b06e1c3074fa14d5fb0720` —— 40 位完整哈希）：
 *  - `lib/client.js` 的 `DOCK_CSS` 模板串里，插件私有令牌一律是 `--dsh-notes-*`，
 *    定义名与引用名同名（`--dsh-notes-font-base` / `-secondary` / `--dsh-notes-shadow`）。
 *    它们**不是** DSH 令牌，只是本插件的私有 CSS 变量。
 *  - 其余 `var(--dsh-*|--dsw-*|--ds-*)` 引用都由 DSH ui-theme 的样式表提供，
 *    逐条出处记在下面 `EXTERNAL_TOKEN_SOURCES` 的注释里。
 *  - `dsw-notes` 这个拼写从未出现在源（`src/client/index.ts`）或产物（`lib/client.js`）里；
 *    本测试把它固化成断言，防止未来把私有令牌误改名。
 *
 * 本测试只读文件、不改任何代码；它在当前代码上应当是绿的——这是**防未来回归**，
 * 不是用来暴露现有 bug 的。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CLIENT_SOURCE = join(ROOT, 'src', 'client', 'index.ts')
const CLIENT_BUNDLE = join(ROOT, 'lib', 'client.js')

/** 插件私有令牌前缀；这些令牌必须在本段 CSS 内自给自足。 */
const PRIVATE_PREFIX = '--dsh-notes-'

/**
 * 恰好这三个私有令牌：两个字号基准 + 一个浮层阴影。
 * 阴影两条规则里各声明一次：`.dsh-notes-dock`（浅色默认）与
 * `body[data-ds-dark-theme] .dsh-notes-dock`（深色覆盖）。
 * 坐标系：`src/client/index.ts` 的 `DOCK_CSS` **模板串内**第 24 / 27 行，
 * 亦即本测试实际读取的 `lib/client.js` **文件第** 64 / 67 行
 * （模板串第 1 行 = 反引号后的第一行；两个文件里的 DOCK_CSS 正文逐字符相同）。
 */
const PRIVATE_TOKENS = [
  '--dsh-notes-font-base',
  '--dsh-notes-font-base-secondary',
  '--dsh-notes-shadow',
]

/**
 * DOCK_CSS 中允许出现的外部令牌白名单，值为该令牌在 DSH 侧的定义出处。
 *
 * 引证坐标系（可机械校验）：`<文件名>:<行号>`，基准目录是上面事实基线所指那个 DSH checkout 的
 * `packages/client/ui-theme/src/styles/`，行号是**该文件内的 1-based 行号**；
 * 逐个 `sed -n '<行号>p' <文件名>` 应当正好看到该令牌的声明行 `<令牌>: …`。
 * 本表 29 条登记、共 50 个行号，已按此方式全部核对命中（无一条落在引用或其他令牌上）。
 * base.css / design-platform.css / gradient-shadow-text.css / scrollbar.css 里都有对应声明；
 * design-platform.css 浅色（`body`）与深色（`body[data-ds-dark-theme]`）各声明一次，因此记两个行号。
 */
const EXTERNAL_TOKEN_SOURCES = {
  // packages/client/ui-theme/src/styles/base.css
  '--dsw-font-family': 'base.css:7',
  '--ds-ease-in-out': 'base.css:11',
  '--ds-transition-duration': 'base.css:12',
  '--ds-transition-duration-fast': 'base.css:13',
  // packages/client/ui-theme/src/styles/gradient-shadow-text.css
  '--dsh-content-font-delta': 'gradient-shadow-text.css:55',
  '--dsh-content-font-delta-secondary': 'gradient-shadow-text.css:57',
  // packages/client/ui-theme/src/styles/scrollbar.css
  '--dsh-scrollbar-thumb': 'scrollbar.css:17',
  '--dsh-scrollbar-thumb-hover': 'scrollbar.css:18',
  // packages/client/ui-theme/src/styles/design-platform.css
  '--dsw-alias-bg-base': 'design-platform.css:157,252',
  '--dsw-alias-bg-layer-1': 'design-platform.css:158,253',
  '--dsw-alias-bg-layer-2': 'design-platform.css:159,254',
  '--dsw-alias-bg-overlay': 'design-platform.css:168,263',
  '--dsw-alias-border-l1': 'design-platform.css:172,267',
  '--dsw-alias-border-l2': 'design-platform.css:174,269',
  '--dsw-alias-brand-primary': 'design-platform.css:179,274',
  '--dsw-alias-button-ghost-active-fill': 'design-platform.css:186,281',
  '--dsw-alias-button-primary-fill': 'design-platform.css:191,286',
  '--dsw-alias-interactive-bg-hover-danger': 'design-platform.css:198,293',
  '--dsw-alias-interactive-bg-hover-solid': 'design-platform.css:199,294',
  '--dsw-alias-interactive-bg-hover': 'design-platform.css:200,295',
  '--dsw-alias-label-primary-foreground': 'design-platform.css:205,300',
  '--dsw-alias-label-primary': 'design-platform.css:207,302',
  '--dsw-alias-label-secondary': 'design-platform.css:208,303',
  '--dsw-alias-label-tertiary': 'design-platform.css:209,304',
  '--dsw-alias-scrollbar-bg-l1': 'design-platform.css:219,314',
  '--dsw-alias-scrollbar-hover-l1': 'design-platform.css:221,316',
  '--dsw-alias-state-business-primary': 'design-platform.css:223,318',
  '--dsw-alias-state-error-primary': 'design-platform.css:225,320',
  '--dsw-specific-input-major': 'design-platform.css:238,333',
}

/**
 * 从客户端产物里抽出 `const DOCK_CSS = \`...\`` 模板串的正文。
 * 模板串内部不含反引号（下面的断言会守住这一点），所以非贪婪匹配到第一个反引号即结尾。
 * @param {string} path - 待读取的文件路径。
 * @returns {string} DOCK_CSS 的 CSS 正文。
 */
function extractDockCss(path) {
  const text = readFileSync(path, 'utf8')
  const match = /const DOCK_CSS = `([\s\S]*?)`/.exec(text)
  assert.ok(match, `未能从 ${path} 抽出 DOCK_CSS 模板字符串（变量名或引号写法可能变了）`)
  return match[1]
}

const dockCss = extractDockCss(CLIENT_BUNDLE)

const referenced = new Set([...dockCss.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/g)].map(m => m[1]))
const declared = new Set([...dockCss.matchAll(/(--[A-Za-z0-9_-]+)\s*:/g)].map(m => m[1]))

const privateReferenced = new Set([...referenced].filter(token => token.startsWith(PRIVATE_PREFIX)))
const privateDeclared = new Set([...declared].filter(token => token.startsWith(PRIVATE_PREFIX)))
const externalReferenced = [...referenced]
  .filter(token => !token.startsWith(PRIVATE_PREFIX))
  .sort()

test('DOCK_CSS 抽取有效且像一段 CSS（避免后续断言空转）', () => {
  assert.ok(dockCss.length > 5000, `DOCK_CSS 只抽到 ${dockCss.length} 个字符，抽取逻辑可能已失效`)
  assert.match(dockCss, /\.dsh-notes-dock\s*\{/, 'DOCK_CSS 里找不到 .dsh-notes-dock 规则')
  assert.ok(!dockCss.includes('`'), 'DOCK_CSS 模板串里出现反引号，抽取正则会在此截断')
})

test('私有令牌：每个 var(--dsh-notes-*) 引用都能在同段 CSS 里找到同名声明', () => {
  const undeclared = [...privateReferenced].filter(token => !privateDeclared.has(token)).sort()
  assert.deepEqual(
    undeclared,
    [],
    `以下私有令牌被引用却没有声明（定义名与引用名必须同名）:\n${undeclared.join('\n')}`,
  )
})

test('私有令牌恰好是那三个，且各自有声明、有引用', () => {
  const expected = [...PRIVATE_TOKENS].sort()
  assert.deepEqual(
    [...privateDeclared].sort(),
    expected,
    'DOCK_CSS 里 --dsh-notes-* 的声明集合与预期不符（增删/改名私有令牌时同步更新本测试）',
  )
  assert.deepEqual(
    [...privateReferenced].sort(),
    expected,
    'DOCK_CSS 里 --dsh-notes-* 的引用集合与预期不符（增删/改名私有令牌时同步更新本测试）',
  )
  for (const token of PRIVATE_TOKENS) {
    assert.ok(declared.has(token), `${token} 在 DOCK_CSS 里没有声明`)
    assert.ok(referenced.has(token), `${token} 在 DOCK_CSS 里没有被引用`)
  }
})

test('外部令牌：DOCK_CSS 引用的每个外部令牌都在白名单内', () => {
  const outside = externalReferenced.filter(token => !(token in EXTERNAL_TOKEN_SOURCES))
  assert.deepEqual(
    outside,
    [],
    `DOCK_CSS 引用了白名单外的外部令牌（需先到 DSH 侧核实定义，再登记进 EXTERNAL_TOKEN_SOURCES）:\n${outside.join('\n')}`,
  )
})

test('外部令牌：白名单没有过期条目（登记项都仍被引用）', () => {
  const unused = Object.keys(EXTERNAL_TOKEN_SOURCES)
    .filter(token => !referenced.has(token))
    .sort()
  assert.deepEqual(
    unused,
    [],
    `白名单登记了但 DOCK_CSS 已不再引用的外部令牌（请从 EXTERNAL_TOKEN_SOURCES 删除）:\n${unused.join('\n')}`,
  )
})

test('源与产物都不含 dsw-notes 拼写', () => {
  for (const path of [CLIENT_SOURCE, CLIENT_BUNDLE]) {
    const hits = readFileSync(path, 'utf8').match(/dsw-notes/g) ?? []
    assert.equal(
      hits.length,
      0,
      `${path} 中出现 ${hits.length} 处 dsw-notes：插件私有令牌前缀是 --dsh-notes-*（不是 --dsw-notes-*）`,
    )
  }
})
