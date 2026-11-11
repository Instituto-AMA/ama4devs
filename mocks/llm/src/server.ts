import { createApp } from './app.ts'
import { loadConfig } from './config.ts'

const config = loadConfig()

// A boot file that could not be read is told, never fatal: the mock starts
// with what it has.
for (const error of config.bootErrors) console.error(`llm: ${error}`)

const app = createApp(config)

Bun.serve({
  port: config.port,
  hostname: '0.0.0.0',
  fetch: app.fetch,
  idleTimeout: 255,
})

console.log(`llm: listening on http://localhost:${config.port}`)
