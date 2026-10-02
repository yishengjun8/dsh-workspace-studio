import { readFileSync } from 'node:fs'
import { defineConfig } from 'tsdown'

const ID = '@yishengjun8/dsh-workspace-studio'
/* The version of the bundle being built, inlined into the client so the settings page can show
   「当前版本」 the instant it opens, without waiting for a Host round-trip (the Host's own
   /update/installed answer stays authoritative and is preferred when it arrives). package.json
   remains the single source of truth. */
const VERSION = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version
const EXTERNALS = [
  'react',
  'react-dom',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-primitives',
]

const client = defineConfig({
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
    __DSH_WS_VERSION__: JSON.stringify(VERSION),
  },
  outputOptions: {
    entryFileNames: 'client.js',
    codeSplitting: false,
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
})

/* Host entry: bundle src/host/*.js into the single lib/index.js artifact cordis
   loads; Node builtins stay external and schemastery/iconv-lite remain bare
   runtime imports, so the artifact shape is unchanged. */
const host = defineConfig({
  name: `${ID}/host`,
  entry: { index: 'src/host/index.js' },
  outDir: 'lib',
  format: 'esm',
  platform: 'node',
  target: 'es2022',
  dts: false,
  sourcemap: false,
  minify: false,
  clean: false,
  deps: {
    neverBundle: ['@deepseek-ai/schemastery', 'iconv-lite'],
  },
  outputOptions: {
    entryFileNames: 'index.js',
    codeSplitting: false,
  },
})

export default [client, host]
