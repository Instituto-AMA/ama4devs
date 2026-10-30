/**
 * The panel: one HTML page served at the ROOT of the simulator.
 *
 * It exists because the value of this project is watching the money move — the
 * charge settling, the balance changing at D+32, the split landing in the
 * subaccount — and until now that could only be observed with `curl` and a good
 * memory. Opening `localhost:8080` and seeing the accounts with their balances,
 * with a "+32 dias" button, is the difference between a simulator that works and
 * one that makes sense.
 *
 * The choices, and why:
 *
 *   - **A single HTML file, no build.** The simulator runs in Docker; a frontend
 *     toolchain would mean a second build stage in the Dockerfile for a dev
 *     screen. The file is served as it is.
 *
 *   - **It lives behind `ADMIN_ENABLED`**, together with the time travel. The
 *     panel reads `GET /_admin/accounts`, which returns the API KEYS of every
 *     account — something the Asaas API would never do, and only acceptable
 *     because this is a localhost simulator. With the admin off, the panel goes
 *     away with it. It is the reason the flag exists.
 */
import { Elysia } from 'elysia'
import { join } from 'node:path'
import type { AppContext } from '../core/context.ts'

/**
 * Read from disk, not embedded in the bundle: that way the HTML can be edited and
 * the page reloaded without recompiling anything. The cache avoids reading it on
 * every request.
 */
let cached: string | null = null

async function html(): Promise<string> {
  cached ??= await Bun.file(join(import.meta.dir, 'ui.html')).text()
  return cached
}

export function panelRoutes(ctx: AppContext) {
  const app = new Elysia({ name: 'panel' })

  // Without the admin there is no panel: it depends entirely on /_admin/accounts
  // and /_admin/clock. A panel that loads and does not work is worse than none.
  if (!ctx.config.adminEnabled) return app

  const serve = async () =>
    new Response(await html(), {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })

  return app.get('/', serve).get('/_admin/ui', serve)
}
