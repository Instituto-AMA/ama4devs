import { createApp } from './app.ts'
import { seedOnBoot } from './asaas.ts'
import { loadConfig } from './config.ts'
import { LOOK_EVERY_MS, findAsaas } from './discovery.ts'

const config = loadConfig()
const app = createApp(config)

// The Asaas comes up configured too: it is looked for before the server starts
// answering, and again every LOOK_EVERY_MS, so a mock that comes up later,
// moves or goes away is followed.
await findAsaas(config)

Bun.serve({
  port: config.port,
  fetch: app.fetch,
})

console.log(`generator: listening on http://localhost:${config.port}`)

if (config.asaasPlaces.length) {
  setInterval(() => void findAsaas(config), LOOK_EVERY_MS)
}

// The seed runs on its own: the server answers while the Asaas comes up.
seedOnBoot(config).catch(() => {})
