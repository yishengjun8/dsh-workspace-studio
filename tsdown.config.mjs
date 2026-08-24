import { defineConfig } from 'tsdown'

const ID = '@deepseek-ai/dsh-workspace-studio'
const EXTERNALS = [
  'react',
  'react-dom',
  '@deepseek-ai/dsh-client-runtime/client',
]

export default defineConfig({
  name: `${ID}/client`,
  entry: { client: 'src/client/index.js' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  dts: false,
  sourcemap: false,
  minify: true,
  clean: false,
  deps: {
    neverBundle: EXTERNALS,
    alwaysBundle: id => !EXTERNALS.includes(id),
    onlyBundle: false,
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
  },
  outputOptions: {
    entryFileNames: 'client.js',
    codeSplitting: false,
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
})
