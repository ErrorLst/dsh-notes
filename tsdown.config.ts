/** dsh-notes 双 half 构建：Node（esm）+ 官方 client bundle（cjs，__ModuleLoader__ 契约）。 */

export default [
  {
    entry: ['src/index.mjs'],
    format: 'esm',
    platform: 'node',
    target: 'es2024',
    outDir: 'lib',
    clean: true,
    deps: {
      // livefeed 合并：浏览器抓取用 playwright-core 动态 import，保持外部（profile 安装）
      neverBundle: [/playwright-core/],
    },
  },
  {
    name: '@dsh-external/dsh-notes/client',
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    dts: false,
    clean: false,
    deps: {
      // 平台模块保持外部（loader 提供）；marked 是 dependencies 里的真实依赖，
      // 必须 alwaysBundle 强制内联——否则 tsdown 默认外部化，浏览器端模块表
      // 没有 marked 工厂，运行时 require("marked") 会直接失败
      neverBundle: [/@deepseek-ai\/dsh-client-/, 'react', 'react-dom'],
    },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: 'window.__ModuleLoader__.load({ id: "@dsh-external/dsh-notes", factory: (require) => {',
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
]