/** dsh-notes 双 half 构建：Node（esm）+ 官方 client bundle（cjs，__ModuleLoader__ 契约）。 */

export default [
  {
    entry: ['src/index.mjs'],
    format: 'esm',
    platform: 'node',
    target: 'es2024',
    outDir: 'lib',
    clean: true,
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
      // 平台模块保持外部（loader 提供）；其余依赖（如 marked）内联打包
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
