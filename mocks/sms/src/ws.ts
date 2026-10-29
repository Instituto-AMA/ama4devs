/**
 * The live feed of the mock: the panel watches the store through it and sees
 * every message, every setting and every webhook attempt as it happens.
 */
import type { ServerWebSocket } from 'bun'
import type { App } from './app.ts'
import type { LiveEvent } from './types.ts'

/** What each connection keeps on its socket: the way out of the live events. */
export interface SocketData {
  /** The functions that stop the listening of this connection. */
  unsubscribes: (() => void)[]
}

/** The handlers the server of the mock gives to Bun. */
export interface WebsocketHandlers {
  /** A connection opened: it gets the snapshot and then the live events. */
  open(ws: ServerWebSocket<SocketData>): void
  /** A connection closed: it stops listening. */
  close(ws: ServerWebSocket<SocketData>): void
  /** A message arrived: only a ping is answered. */
  message(ws: ServerWebSocket<SocketData>, message: unknown): void
}

/**
 * The handlers of the live feed: the snapshot first, the events after it.
 * @param app The application of the mock.
 */
export function websocketHandlers(app: App): WebsocketHandlers {
  /**
   * Sends a frame to a connection; a socket that closed in between is not an
   * error.
   * @param ws The connection to write to.
   * @param event The frame to send.
   */
  const send = (ws: ServerWebSocket<SocketData>, event: LiveEvent): void => {
    try {
      ws.send(JSON.stringify(event))
    } catch {
      // The connection is gone: there is nobody left to tell.
    }
  }

  return {
    open(ws) {
      const snapshot: LiveEvent = {
        type: 'snapshot',
        messages: app.store.list(),
        settings: app.settings.get(),
        deliveries: app.webhooks.deliveries(),
        version: app.config.version,
      }
      send(ws, snapshot)

      const unsubscribe = app.onEvent((event) => send(ws, event))
      ws.data = { unsubscribes: [unsubscribe] }
    },

    close(ws) {
      for (const unsubscribe of ws.data?.unsubscribes ?? []) unsubscribe()
      ws.data = { unsubscribes: [] }
    },

    message(ws, message) {
      if (typeof message === 'string' && message.trim() === 'ping') ws.send('pong')
    },
  }
}
