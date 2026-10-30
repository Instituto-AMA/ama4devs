/**
 * Regression: the config merge has to be DEEP on nested objects.
 *
 * A shallow spread has actually broken things here. Passing `webhook: { timeoutMs: 500 }`
 * wiped `retentionDays` along with it, and the error did not show up in the config — it showed up three
 * layers deeper, at the time of inserting a delivery:
 *
 *     NOT NULL constraint failed: webhook_deliveries.expires_at_ms
 *
 * because `now + undefined * DAY_MS` is NaN. This test exists so that nobody
 * "simplifies" the merge back into a spread.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { bootstrap, type App } from '../../src/bootstrap.ts'
import { cents } from '../../src/domain/money.ts'

let app: App | undefined
afterEach(() => app?.close())

describe('config merge', () => {
  it('a partial override of a nested object preserves its siblings', async () => {
    app = await bootstrap({
      config: {
        databasePath: ':memory:',
        logLevel: 'silent',
        webhook: { timeoutMs: 500 }, // <- only ONE field of the five
      },
    })

    expect(app.config.webhook.timeoutMs).toBe(500)

    // The siblings survive — it is the whole point of the test.
    expect(app.config.webhook.retentionDays).toBeGreaterThan(0)
    expect(app.config.webhook.maxAttempts).toBeGreaterThan(0)
    expect(app.config.webhook.maxPerAccount).toBeGreaterThan(0)
  })

  it('a partial override of the fee table preserves the other fees', async () => {
    app = await bootstrap({
      config: {
        databasePath: ':memory:',
        logLevel: 'silent',
        fees: { pix: 0 as never }, // simulating an account without a Pix fee
      },
    })

    // `Cents` is a branded type: comparing it with the raw number does not compile.
    expect(app.config.fees.pix).toBe(cents(0))
    expect(app.config.fees.boleto).toBe(cents(199)) // intact
    expect(app.config.fees.creditCard.fixed).toBe(cents(49)) // the nested object too
  })
})
