import { defineConfig } from 'tsdown'

const ID = '@yishengjun8/dsh-workspace-studio'
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
  },
  outputOptions: {
    entryFileNames: 'client.js',
    codeSplitting: false,
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
})

/* Host entry: bundle src/host/*.js into the single lib/index.js artifact that
   cordis loads. Node builtins stay external (platform: 'node' default);
   schemastery and iconv-lite remain bare runtime imports resolved from the
   profile's node_modules, so the artifact shape is unchanged. */
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
