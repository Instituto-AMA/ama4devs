/**
 * Account info — the authenticated account.
 *
 * What these tests protect, besides the contract: the fee table returned by
 * GET /v3/myAccount/fees comes from the SAME config the engine charges with. If
 * someone "corrects" the response with a fixed number, the test breaks.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { accountInfoHandlers } from '../../src/modules/account-info/handlers.ts'
import { createHarness, createSecondAccount, type Harness } from '../helpers/harness.ts'

let h: Harness

beforeAll(async () => {
  h = await createHarness()
})
afterAll(() => h.close())

describe('commercial data', () => {
  it('retrieves the seeded account data', async () => {
    const { status, body } = await h.api.call('retrieve-business-data')

    expect(status).toBe(200)
    expect(body.name).toBe('Conta de Teste')
    expect(body.cpfCnpj).toBe('47960950000121')
    expect(body.personType).toBe('JURIDICA')
    expect(body.status).toBe('APPROVED')
  })

  it('updates and returns the new state — money round-trips in cents', async () => {
    const { status, body } = await h.api.call('update-business-data', {
      body: {
        companyName: 'ASAAS GESTAO',
        incomeValue: 2500.55,
        email: 'novo@localhost',
        site: 'https://exemplo.com.br',
        postalCode: '89223005',
      },
    })

    expect(status).toBe(200)
    expect(body.companyName).toBe('ASAAS GESTAO')
    expect(body.incomeValue).toBe(2500.55)
    expect(body.email).toBe('novo@localhost')
    // Asaas fills the display name by itself from the legal name.
    expect(body.tradingName).toBe('ASAAS GESTAO')

    const again = await h.api.call('retrieve-business-data')
    expect(again.body.incomeValue).toBe(2500.55)
    expect(again.body.site).toBe('https://exemplo.com.br')
  })

  it('an invalid CPF/CNPJ → 400 invalid_cpfCnpj (array, as always)', async () => {
    const { status, body } = await h.api.call('update-business-data', {
      body: { cpfCnpj: '11111111111' },
    })

    expect(status).toBe(400)
    expect(Array.isArray(body.errors)).toBe(true)
    expect(body.errors[0].code).toBe('invalid_cpfCnpj')
  })
})

describe('fees', () => {
  it('the response is derived from config.fees, not from a fixed JSON', async () => {
    const { status, body } = await h.api.call('retrieve-account-fees')
    const fees = h.app.config.fees

    expect(status).toBe(200)
    expect(body.payment.bankSlip.defaultValue).toBe(fees.boleto / 100)
    expect(body.payment.creditCard.operationValue).toBe(fees.creditCard.fixed / 100)
    expect(body.payment.creditCard.oneInstallmentPercentage).toBe(2.99)
    expect(body.payment.creditCard.daysToReceive).toBe(32)
    expect(body.payment.pix.fixedFeeValue).toBe(fees.pix / 100)
    expect(body.creditBureauReport.naturalPersonFeeValue).toBe(16.99)
    expect(body.transfer.ted.feeValue).toBe(5)
  })

  it('changing the config changes the response', async () => {
    const other = await createHarness({ fees: { ...h.app.config.fees, boleto: 349 as never } })
    try {
      const { body } = await other.api.call('retrieve-account-fees')
      expect(body.payment.bankSlip.defaultValue).toBe(3.49)
    } finally {
      other.close()
    }
  })
})

describe('the account number, the status and the wallet', () => {
  it('the account number is assigned once and does not change', async () => {
    const first = await h.api.call('retrieve-asaas-account-number')
    const second = await h.api.call('retrieve-asaas-account-number')

    expect(first.status).toBe(200)
    expect(first.body.agency).toBe('0001')
    expect(first.body.account).toMatch(/^\d{6}$/)
    expect(second.body).toEqual(first.body)
  })

  it('registration status: in sandbox the account is born approved', async () => {
    const { status, body } = await h.api.call('check-account-registration-status')

    expect(status).toBe(200)
    expect(body.id).toBe(h.accountId)
    expect(body.general).toBe('APPROVED')
    expect(body.commercialInfo).toBe('APPROVED')
  })

  it('walletId comes in the listing envelope, with the account’s wallet', async () => {
    const { status, body } = await h.api.call('retrieve-walletid')

    expect(status).toBe(200)
    expect(body.object).toBe('list')
    expect(body.totalCount).toBe(1)
    expect(body.data[0]).toEqual({ object: 'wallet', id: h.walletId })
  })
})

describe('the checkout personalization', () => {
  it('with no saved personalization, it comes disabled', async () => {
    const { status, body } = await h.api.call('retrieve-personalization-settings')

    expect(status).toBe(200)
    expect(body.object).toBe('paymentCheckoutConfig')
    expect(body.enabled).toBe(false)
    expect(body.logoUrl).toBeNull()
  })

  it('saves, approves itself in sandbox, and the next read returns the same', async () => {
    const { status, body } = await h.api.call('save-payment-checkout-personalization', {
      body: {
        logoBackgroundColor: '#00ff00',
        infoBackgroundColor: '#000fff',
        fontColor: '#ffffff',
        enabled: true,
      },
    })

    expect(status).toBe(200)
    expect(body.status).toBe('APPROVED')
    expect(body.enabled).toBe(true)

    const again = await h.api.call('retrieve-personalization-settings')
    expect(again.body.logoBackgroundColor).toBe('#00ff00')
    expect(again.body.fontColor).toBe('#ffffff')
  })

  it('multipart does not go through TypeBox — the mandatory one is checked in the handler', async () => {
    const { status, body } = await h.api.call('save-payment-checkout-personalization', {
      body: { logoBackgroundColor: '#00ff00', infoBackgroundColor: '#000fff' },
    })

    expect(status).toBe(400)
    expect(body.errors[0].code).toBe('invalid_fontColor')
  })

  it('a color that is not hexadecimal → 400', async () => {
    const { status, body } = await h.api.call('save-payment-checkout-personalization', {
      body: {
        logoBackgroundColor: 'green',
        infoBackgroundColor: '#000fff',
        fontColor: '#ffffff',
      },
    })

    expect(status).toBe(400)
    expect(body.errors[0].code).toBe('invalid_logoBackgroundColor')
  })
})

describe('disabling a white label subaccount', () => {
  it('the root account does not destroy itself', async () => {
    const { status, body } = await h.api.call('Delete-white-label-subaccount', {
      query: { removeReason: 'Release data' },
    })

    expect(status).toBe(400)
    expect(body.errors[0].code).toBe('invalid_account')
  })

  it('the subaccount is disabled — and only once', async () => {
    const sub = await createSecondAccount(h, 'White Label Subaccount')
    const client = h.as(sub.apiKey)

    const first = await client.call('Delete-white-label-subaccount', {
      query: { removeReason: 'Release data' },
    })
    expect(first.status).toBe(200)
    expect(first.body.observations).toBe('Conta desabilitada com sucesso')

    const second = await client.call('Delete-white-label-subaccount')
    expect(second.status).toBe(400)
    expect(second.body.errors[0].code).toBe('invalid_account')
  })

  it('each account sees ITS OWN commercial data', async () => {
    const sub = await createSecondAccount(h, 'Another Account')
    const { body } = await h.as(sub.apiKey).call('retrieve-business-data')

    expect(body.name).toBe('Another Account')
    expect(body.cpfCnpj).not.toBe('47960950000121')
  })
})
