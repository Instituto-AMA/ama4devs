/**
 * The panel compiles into ONE single file: `src/admin/ui.html`.
 *
 * `vite-plugin-singlefile` inlines the JS and the CSS in the HTML. It preserves
 * the property the panel had when it was a hand-written HTML, and that is worth
 * more than it looks: the RUNTIME is still just Bun serving one file. No asset
 * server, no static route, no cache-busting, no second thing that can 404
 * inside the container. The build happens in a separate stage of the Dockerfile
 * and disappears.
 */
import preact from '@preact/preset-vite'
import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

export default defineConfig({
  plugins: [preact(), viteSingleFile()],
  build: {
    // It builds to `panel/dist` and the `panel:build` script copies the HTML to
    // `src/admin/ui.html`. Pointing the outDir straight at `src/admin` would
    // make Vite want to clean a directory that is SERVER CODE.
    outDir: 'dist',
    emptyOutDir: true,
    minify: 'esbuild',
    target: 'es2022',
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    reportCompressedSize: false,
  },
  server: {
    // `bun run panel:dev` raises Vite with HMR and sends /v3 and /_admin to the
    // real simulator — it is what makes working on the screen bearable.
    port: 45446,
    proxy: {
      '/v3': 'http://localhost:45445',
      '/_admin': 'http://localhost:45445',
    },
  },
})
