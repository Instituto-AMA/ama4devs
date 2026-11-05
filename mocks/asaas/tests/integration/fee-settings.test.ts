import { describe, expect, it } from 'bun:test'
import { loadFees } from '../../src/admin/fees.ts'
import { calcFee } from '../../src/domain/fees.ts'
import { cents } from '../../src/domain/money.ts'
import { createHarness } from '../helpers/harness.ts'

describe('persistent simulator fees', () => {
  it('updates the public contract and engine together and reloads saved settings', async () => {
    const h = await createHarness()
    try {
      const original = structuredClone(h.app.config.fees)
      const response = await h.app.app.handle(new Request('http://localhost/_admin/fees', {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pix: 123, creditCard: { oneInstallment: 250 } }),
      }))
      expect(response.status).toBe(200)
      const { body } = await h.api.call('retrieve-account-fees')
      expect(body.payment.pix.fixedFeeValue).toBe(1.23)
      expect(body.payment.creditCard.oneInstallmentPercentage).toBe(2.5)
      expect(body.payment.creditCard.operationValue).toBe(original.creditCard.fixed / 100)
      expect(calcFee(h.app.config.fees, 'PIX', cents(10000))).toBe(cents(123))
      h.app.config.fees = original
      await loadFees(h.app.ctx)
      expect(h.app.config.fees.pix).toBe(cents(123))
    } finally { h.close() }
  })

  it('rejects invalid patches atomically', async () => {
    const h = await createHarness()
    try {
      const original = structuredClone(h.app.config.fees)
      for (const patch of [{ pix: -1 }, { pix: 1.5 }, { pix: null }, { unknown: 1 },
        { pix: 100, creditCard: { fixed: -1 } }, { creditCard: [] }]) {
        const response = await h.app.app.handle(new Request('http://localhost/_admin/fees', {
          method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch),
        }))
        expect(response.status).toBe(400)
        expect(h.app.config.fees).toEqual(original)
      }
    } finally { h.close() }
  })
})
