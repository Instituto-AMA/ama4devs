import { createApp } from './app.ts'

const port = Number(process.env.PORT ?? 8095)
const app = createApp()

Bun.serve({
  port,
  hostname: '0.0.0.0',
  // The slow scenario holds a request for 25 s: lift Bun's default idle limit.
  idleTimeout: 60,
  fetch: (request) => app.fetch(request),
})

console.log(`directd: listening on http://localhost:${port}`)
