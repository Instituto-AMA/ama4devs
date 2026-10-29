import { createApp } from './app.ts'
import { seedOnBoot } from './asaas.ts'
import { loadConfig } from './config.ts'

const config = loadConfig()
const app = createApp(config)

Bun.serve({
  port: config.port,
  fetch: app.fetch,
})

console.log(`generator: listening on http://localhost:${config.port}`)

// The seed runs on its own: the server answers while the Asaas comes up.
seedOnBoot(config).catch(() => {})
