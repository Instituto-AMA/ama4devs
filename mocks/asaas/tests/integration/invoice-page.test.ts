/**
 * The payer's invoice page behind `invoiceUrl`.
 *
 * What this file proves: the link the API returns opens on this server; the page
 * shows the charge and only the methods it accepts; paying there moves the charge
 * through the same paths as the API (status, ledger, webhooks), a declined test card
 * leaves it pending; an UNDEFINED charge takes the method the payer chose; and the
 * page refuses a foreign origin like the other key-free routes.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { createHarness, type Harness } from '../helpers/harness.ts'

let h: Harness
afterEach(() => h?.close())

const APPROVES = '4444444444444444'
const DECLINES = '5184019740373151'

async function customer(): Promise<string> {
  const res = await h.api.call('create-new-customer', {
    body: { name: 'Fulano de Tal', cpfCnpj: '24971563792' },
  })
  return res.body.id
}

async function charge(billingType: string, value = 100): Promise<any> {
  const res = await h.api.call('create-new-payment', {
    body: { customer: await customer(), billingType, value, dueDate: '2026-01-20' },
  })
  expect(res.status).toBe(200)
  return res.body
}

const tokenOf = (p: { id: string }) => p.id.replace('pay_', '')

async function page(token: string) {
  const res = await h.app.app.handle(
    new Request(`http://localhost/i/${token}`, { headers: { host: 'localhost:45445' } }),
  )
  return { status: res.status, html: await res.text() }
}

async function pay(token: string, body: unknown, origin = 'http://localhost:45445') {
  const res = await h.app.app.handle(
    new Request(`http://localhost/i/${token}/pay`, {
      method: 'POST',
      headers: { host: 'localhost:45445', origin, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
  return { status: res.status, body: (await res.json().catch(() => null)) as any }
}

const card = (number: string) => ({
  holderName: 'TITULAR TESTE',
  number,
  expiryMonth: '12',
  expiryYear: '2030',
  ccv: '123',
})

async function status(id: string): Promise<any> {
  return (await h.api.call('retrieve-a-single-payment', { params: { id } })).body
}

describe('invoice page', () => {
  it('the invoiceUrl opens on this server and shows the charge', async () => {
    h = await createHarness()
    const p = await charge('PIX', 150)

    expect(p.invoiceUrl).toBe(`${h.app.config.invoiceBaseUrl}/i/${tokenOf(p)}`)

    const res = await page(tokenOf(p))
    expect(res.status).toBe(200)
    expect(res.html).toContain('150,00')
    expect(res.html).toContain('Simular pagamento via Pix')
    expect(res.html).not.toContain('Pagar com cartão')
  })

  it('opens on the selected tab: a bank slip charge shows the bank slip, not the Pix', async () => {
    h = await createHarness()
    const p = await charge('BOLETO', 1400)
    const { html } = await page(tokenOf(p))

    const panel = (method: string) => html.match(new RegExp(`<section class="method" data-method="${method}"( hidden)?>`))
    expect(html).toMatch(/class="tab active" aria-selected="true" data-tab="BOLETO"/)
    expect(panel('BOLETO')?.[1]).toBeUndefined()
    expect(panel('PIX')?.[1]).toBe(' hidden')
  })

  it('paying by Pix receives the charge, credits the balance and sends the webhook', async () => {
    h = await createHarness()
    await h.subscribeWebhook(['PAYMENT_RECEIVED'])
    const p = await charge('PIX')

    const res = await pay(tokenOf(p), { method: 'PIX' })
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('RECEIVED')

    await h.tick()
    expect(h.sink.eventsOf('PAYMENT_RECEIVED').length).toBeGreaterThan(0)
    await h.assertLedgerBalances()

    const again = await page(tokenOf(p))
    expect(again.html).toContain('Paga')
    expect(again.html).not.toContain('Simular pagamento via Pix')
  })

  it('an UNDEFINED charge takes the method the payer chose', async () => {
    h = await createHarness()
    const p = await charge('UNDEFINED')

    const html = (await page(tokenOf(p))).html
    expect(html).toContain('Simular pagamento via Pix')
    expect(html).toContain('Simular pagamento do boleto')
    expect(html).toContain('Pagar com cartão')
    // Only the first method shows; the tabs switch the others in.
    expect(html).toContain('data-method="BOLETO" hidden')
    expect(html).toContain('data-method="CREDIT_CARD" hidden')
    expect(html).toContain('[hidden] { display:none !important; }')

    const res = await pay(tokenOf(p), { method: 'BOLETO' })
    expect(res.status).toBe(200)
    expect(res.body.billingType).toBe('BOLETO')
    expect(['CONFIRMED', 'RECEIVED']).toContain(res.body.status)
  })

  it('a card charge is paid with a test card; a declining card leaves it pending', async () => {
    h = await createHarness()
    const declined = await charge('CREDIT_CARD')
    const refused = await pay(tokenOf(declined), { method: 'CREDIT_CARD', card: card(DECLINES) })
    expect(refused.status).toBe(400)
    expect((await status(declined.id)).status).toBe('PENDING')

    const approved = await charge('CREDIT_CARD')
    const ok = await pay(tokenOf(approved), { method: 'CREDIT_CARD', card: card(APPROVES) })
    expect(ok.status).toBe(200)
    expect(ok.body.status).toBe('CONFIRMED')
    await h.assertLedgerBalances()
  })

  it('refuses a method the charge does not accept, and a charge already paid', async () => {
    h = await createHarness()
    const p = await charge('PIX')

    const wrong = await pay(tokenOf(p), { method: 'CREDIT_CARD', card: card(APPROVES) })
    expect(wrong.status).toBe(400)
    expect(wrong.body.errors[0].code).toBe('invalid_billingType')

    expect((await pay(tokenOf(p), { method: 'PIX' })).status).toBe(200)
    const twice = await pay(tokenOf(p), { method: 'PIX' })
    expect(twice.status).toBe(400)
    expect(twice.body.errors[0].code).toBe('invalid_action')
  })

  it('an installment invoice lists its siblings', async () => {
    h = await createHarness()
    const created = await h.api.call('create-installment', {
      body: {
        customer: await customer(),
        billingType: 'BOLETO',
        installmentCount: 3,
        totalValue: 300,
        dueDate: '2026-02-05',
      },
    })
    expect(created.status).toBe(200)
    const list = await h.api.call('list-payments-of-a-installment', {
      params: { id: created.body.id },
    })
    const first = list.body.data[0]

    const html = (await page(tokenOf(first))).html
    expect(html).toContain('Parcelas')
    for (const other of list.body.data.slice(1)) {
      expect(html).toContain(`/i/${tokenOf(other)}`)
    }
  })

  it('a card on an installment invoice pays every pending installment ("parcelado no cartão")', async () => {
    h = await createHarness()
    const created = await h.api.call('create-installment', {
      body: {
        customer: await customer(),
        billingType: 'UNDEFINED',
        installmentCount: 3,
        totalValue: 300,
        dueDate: '2026-02-05',
      },
    })
    const list = await h.api.call('list-payments-of-a-installment', { params: { id: created.body.id } })
    const first = list.body.data.find((p: any) => p.installmentNumber === 1)

    const html = (await page(tokenOf(first))).html
    expect(html).toContain('Pagar 3 parcelas no cartão')

    const res = await pay(tokenOf(first), { method: 'CREDIT_CARD', card: card(APPROVES) })
    expect(res.status).toBe(200)

    const after = await h.api.call('list-payments-of-a-installment', { params: { id: created.body.id } })
    expect(after.body.data.map((p: any) => p.status)).toEqual(['CONFIRMED', 'CONFIRMED', 'CONFIRMED'])
    expect(after.body.data.every((p: any) => p.billingType === 'CREDIT_CARD')).toBe(true)
    await h.assertLedgerBalances()
  })

  it('a foreign origin cannot pay, and an unknown token is 404', async () => {
    h = await createHarness()
    const p = await charge('PIX')

    const res = await pay(tokenOf(p), { method: 'PIX' }, 'http://evil.example')
    expect(res.status).toBe(403)
    expect((await status(p.id)).status).toBe('PENDING')

    expect((await page('000000000000')).status).toBe(404)
  })
})
