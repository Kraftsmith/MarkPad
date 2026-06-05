// Build the webview bundle (media-src/src/main.ts -> media/dist).
//
// Why this exists instead of a plain `esbuild` CLI call:
// Some helpers import from `vditor/src/*` (e.g. table-add-column.ts), which
// transitively bundles Vditor's TypeScript source. That source references a
// compile-time global `VDITOR_VERSION` that Vditor's own webpack build injects.
// If we don't define it, the webview crashes at runtime with
// "Uncaught ReferenceError: VDITOR_VERSION is not defined" and renders blank.
// esbuild's `define` substitutes it the same way Vditor's build does.

const esbuild = require('esbuild')
const vditorVersion = require('vditor/package.json').version

const watch = process.argv.includes('--watch')

esbuild
  .build({
    entryPoints: ['./src/main.ts'],
    bundle: true,
    minify: !watch,
    sourcemap: true,
    outdir: '../media/dist',
    define: {
      VDITOR_VERSION: JSON.stringify(vditorVersion),
    },
    logLevel: 'info',
    watch: watch
      ? {
          onRebuild(error) {
            if (error) console.error('[esbuild] rebuild failed:', error)
            else console.log('[esbuild] rebuilt')
          },
        }
      : false,
  })
  .then(() => {
    console.log(
      watch
        ? '[esbuild] watching for changes...'
        : `[esbuild] build complete (VDITOR_VERSION=${vditorVersion})`
    )
  })
  .catch(() => process.exit(1))
