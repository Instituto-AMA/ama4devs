import { createApp, type MockServer } from './app.ts'
import { loadConfig } from './config.ts'
import { websocketHandlers } from './ws.ts'

const config = loadConfig()
const app = createApp(config)

Bun.serve({
  port: config.port,
  hostname: '0.0.0.0',
  // The handler answers nothing when the request became a WebSocket: Bun wants
  // the server of its own type, so it is narrowed here.
  fetch: (request, server) => app.fetch(request, server as unknown as MockServer),
  websocket: websocketHandlers(app),
})

console.log(`sms: listening on http://localhost:${config.port}`)
