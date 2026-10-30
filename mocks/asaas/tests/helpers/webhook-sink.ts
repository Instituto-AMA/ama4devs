/**
 * A real webhook endpoint, on a real HTTP server.
 *
 * It could be an in-memory spy, but then we would be testing nothing of
 * what matters: the `fetch`, the 10s timeout, the `asaas-access-token` header, and the
 * rule that only HTTP 200 counts as a success. It is exactly there that the
 * integrations break in the real world.
 */
type BunServer = ReturnType<typeof Bun.serve>

export interface ReceivedWebhook {
  payload: any
  headers: Record<string, string>
  receivedAtMs: number
}

export class WebhookSink {
  #server: BunServer
  readonly received: ReceivedWebhook[] = []

  /** Scheduled responses, consumed one by one. Then it goes back to the default. */
  #queued: (number | 'timeout')[] = []
  #default: number | 'timeout' = 200

  private constructor(server: BunServer) {
    this.#server = server
  }

  static async start(): Promise<WebhookSink> {
    let sink: WebhookSink
    const server = Bun.serve({
      port: 0, // ephemeral port — the tests run in parallel without colliding
      async fetch(req) {
        const payload = await req.json().catch(() => null)
        const headers: Record<string, string> = {}
        req.headers.forEach((v, k) => {
          headers[k] = v
        })

        sink.received.push({ payload, headers, receivedAtMs: Date.now() })

        const outcome = sink.#queued.shift() ?? sink.#default

        if (outcome === 'timeout') {
          // Never answers. Exercises the dispatcher's AbortSignal.timeout.
          await new Promise(() => {})
        }

        return new Response('ok', { status: outcome as number })
      },
    })
    sink = new WebhookSink(server)
    return sink
  }

  get url(): string {
    return `http://localhost:${this.#server.port}/webhook`
  }

  /** All the following responses use this status. 200 = success. */
  respondWith(status: number | 'timeout'): void {
    this.#default = status
  }

  /** The next `n` responses fail with `status`; then it goes back to the default. */
  failNext(n: number, status: number | 'timeout' = 500): void {
    for (let i = 0; i < n; i++) this.#queued.push(status)
  }

  eventsOf(event: string): ReceivedWebhook[] {
    return this.received.filter((r) => r.payload?.event === event)
  }

  /** The order the events arrived in — the SEQUENTIALLY test lives on it. */
  get eventNames(): string[] {
    return this.received.map((r) => r.payload?.event)
  }

  clear(): void {
    this.received.length = 0
    this.#queued.length = 0
    this.#default = 200
  }

  stop(): void {
    this.#server.stop(true)
  }
}
