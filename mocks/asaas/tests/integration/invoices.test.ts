/**
 * Notas fiscais (NFS-e), end to end through the API, the scheduler and the webhooks.
 *
 * What this file proves: a note is scheduled for a charge, goes to the city hall
 * (SYNCHRONIZED) when issued or on its date, and comes back AUTHORIZED with a
 * number and a document that opens — or ERROR when the account has no fiscal
 * information; an issued note cancels through the city hall; every step sends
 * its INVOICE_* event, in order; a subscription with `invoiceSettings` gets a
 * note for each charge; and the rules that refuse a note answer in the Asaas
 * error format. Every response is checked against the spec by the harness.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { createHarness, createSecondAccount, type Harness } from '../helpers/harness.ts'

let h: Harness

beforeEach(async () => {
  h = await createHarness()
})
afterEach(() => h.close())

const TODAY = '2026-01-05'
const TAXES = { retainIss: false, iss: 2, pis: 0.65, cofins: 3, csll: 1, inss: 0, ir: 1.5 }
const EVENTS = [
  'INVOICE_CREATED',
  'INVOICE_UPDATED',
  'INVOICE_SYNCHRONIZED',
  'INVOICE_AUTHORIZED',
  'INVOICE_PROCESSING_CANCELLATION',
  'INVOICE_CANCELED',
  'INVOICE_CANCELLATION_DENIED',
  'INVOICE_ERROR',
]

async function customer() {
  return (await h.api.call('create-new-customer', { body: { name: 'Maria Souza', cpfCnpj: '24971563792' } })).body.id
}

async function charge(value = 300, dueDate = '2026-01-20') {
  return (
    await h.api.call('create-new-payment', {
      body: { customer: await customer(), billingType: 'PIX', value, dueDate },
    })
  ).body
}

const noteBody = (payment: string, over: Record<string, unknown> = {}) => ({
  payment,
  serviceDescription: 'Consulta de fisioterapia',
  observations: 'Sessão de janeiro',
  value: 300,
  deductions: 0,
  effectiveDate: TODAY,
  municipalServiceName: 'Fisioterapia',
  municipalServiceCode: '4.08',
  taxes: TAXES,
  ...over,
})

async function schedule(payment: string, over: Record<string, unknown> = {}) {
  const res = await h.api.call('schedule-invoice', { body: noteBody(payment, over) })
  expect(res.status).toBe(200)
  return res.body
}

const get = async (id: string) => (await h.api.call('retrieve-a-single-invoice', { params: { id } })).body
const fiscalInfo = () =>
  h.api.call('create-and-update-tax-information', {
    body: { email: 'nf@clinica.example', simplesNacional: true, municipalInscription: '123456', rpsSerie: 'E', rpsNumber: 100 },
  })
// The HTTP layer dispatches after the response; one more pass makes sure it ran.
const drain = () => h.app.scheduler.dispatchNow()
const invoiceEvents = async () => {
  await drain()
  return h.sink.received.filter((r) => String(r.payload?.event).startsWith('INVOICE_')).map((r) => r.payload.event)
}
const fetchPath = async (url: string) => h.app.app.handle(new Request(`http://localhost${new URL(url).pathname}`))

describe('nota fiscal — o ciclo da prefeitura', () => {
  it('agendada → emitida → autorizada na próxima resposta da prefeitura, com número e documento', async () => {
    await h.subscribeWebhook(EVENTS)
    await fiscalInfo()
    const p = await charge()

    const note = await schedule(p.id)
    expect(note.id).toMatch(/^inv_\d{12}$/)
    expect(note.status).toBe('SCHEDULED')
    expect(note.customer).toBe(p.customer)
    expect(note.payment).toBe(p.id)
    expect(note.type).toBe('NFS-e')
    expect(note.number).toBeNull()

    const issued = await h.api.call('issue-an-invoice', { params: { id: note.id } })
    expect(issued.status).toBe(200)
    expect(issued.body.status).toBe('SYNCHRONIZED')

    await h.tick()
    const done = await get(note.id)
    expect(done.status).toBe('AUTHORIZED')
    expect(done.number).toBe('1')
    expect(done.rpsSerie).toBe('E')
    expect(done.rpsNumber).toBe('100')
    expect(done.validationCode).toMatch(/^[A-Z0-9]{8}$/)

    const page = await fetchPath(done.pdfUrl)
    expect(page.status).toBe(200)
    expect(await page.text()).toContain('Fisioterapia')
    const xml = await fetchPath(done.xmlUrl)
    expect(xml.headers.get('content-type')).toContain('xml')
    expect(await xml.text()).toContain(`<CodigoVerificacao>${done.validationCode}</CodigoVerificacao>`)

    // The next note of the account takes the next number.
    const second = await schedule((await charge(50)).id, { value: 50 })
    await h.api.call('issue-an-invoice', { params: { id: second.id } })
    await h.tick()
    expect((await get(second.id)).number).toBe('2')

    expect((await invoiceEvents()).slice(0, 3)).toEqual(['INVOICE_CREATED', 'INVOICE_SYNCHRONIZED', 'INVOICE_AUTHORIZED'])
  })

  it('sem informações fiscais a prefeitura devolve ERROR; corrigida, a nota sai', async () => {
    await h.subscribeWebhook(EVENTS)
    const note = await schedule((await charge()).id)
    await h.api.call('issue-an-invoice', { params: { id: note.id } })
    await h.tick()

    const failed = await get(note.id)
    expect(failed.status).toBe('ERROR')
    expect(failed.statusDescription).toContain('Informações fiscais')
    expect(failed.pdfUrl).toBeNull()

    expect((await fiscalInfo()).status).toBe(200)
    const fixed = await h.api.call('update-invoice', { params: { id: note.id }, body: { observations: 'Reenviada' } })
    expect(fixed.body.status).toBe('SCHEDULED')
    await h.api.call('issue-an-invoice', { params: { id: note.id } })
    await h.tick()
    expect((await get(note.id)).status).toBe('AUTHORIZED')

    expect(await invoiceEvents()).toEqual([
      'INVOICE_CREATED',
      'INVOICE_SYNCHRONIZED',
      'INVOICE_ERROR',
      'INVOICE_UPDATED',
      'INVOICE_SYNCHRONIZED',
      'INVOICE_AUTHORIZED',
    ])
  })

  it('agendada para depois sai sozinha no dia: SYNCHRONIZED no dia, AUTHORIZED no tick seguinte', async () => {
    await fiscalInfo()
    const note = await schedule((await charge()).id, { effectiveDate: '2026-01-10' })

    await h.advance({ days: 4 })
    expect((await get(note.id)).status).toBe('SCHEDULED')

    await h.advance({ days: 1 })
    const sent = await get(note.id)
    expect(sent.status).toBe('SYNCHRONIZED')
    expect(sent.effectiveDate).toBe('2026-01-10')

    await h.tick()
    expect((await get(note.id)).status).toBe('AUTHORIZED')
  })

  it('cancelar uma autorizada passa pela prefeitura; uma agendada cancela na hora e libera a cobrança', async () => {
    await h.subscribeWebhook(EVENTS)
    await fiscalInfo()
    const p = await charge()
    const note = await schedule(p.id)
    await h.api.call('issue-an-invoice', { params: { id: note.id } })
    await h.tick()

    const asked = await h.api.call('cancel-an-invoice', { params: { id: note.id }, body: {} })
    expect(asked.body.status).toBe('PROCESSING_CANCELLATION')
    await h.tick()
    const cancelled = await get(note.id)
    expect(cancelled.status).toBe('CANCELED')
    // The document stays, marked as cancelled.
    expect(await (await fetchPath(cancelled.pdfUrl)).text()).toContain('CANCELADA')

    const again = await schedule(p.id)
    const dropped = await h.api.call('cancel-an-invoice', { params: { id: again.id }, body: {} })
    expect(dropped.body.status).toBe('CANCELED')

    expect((await invoiceEvents()).filter((e) => e.includes('CANCEL'))).toEqual([
      'INVOICE_PROCESSING_CANCELLATION',
      'INVOICE_CANCELED',
      'INVOICE_CANCELED',
    ])
  })

  it('cancelOnlyOnAsaas cancela uma autorizada sem passar pela prefeitura', async () => {
    await fiscalInfo()
    const note = await schedule((await charge()).id)
    await h.api.call('issue-an-invoice', { params: { id: note.id } })
    await h.tick()
    const res = await h.api.call('cancel-an-invoice', { params: { id: note.id }, body: { cancelOnlyOnAsaas: true } })
    expect(res.body.status).toBe('CANCELED')
  })

  it('a cobrança removida leva a nota agendada junto', async () => {
    await h.subscribeWebhook(EVENTS)
    const p = await charge()
    const note = await schedule(p.id, { effectiveDate: '2026-01-15' })
    await h.api.call('delete-payment', { params: { id: p.id } })
    await h.tick()
    expect((await get(note.id)).status).toBe('CANCELED')
    expect(await invoiceEvents()).toEqual(['INVOICE_CREATED', 'INVOICE_CANCELED'])
  })
})

describe('nota fiscal — as regras que recusam', () => {
  it('responde no formato de erro do Asaas', async () => {
    const p = await charge()
    const err = async (body: Record<string, unknown>) => {
      const res = await h.api.call('schedule-invoice', { body })
      expect(res.status).toBe(400)
      return res.body.errors[0].code
    }

    expect(await err(noteBody(p.id, { effectiveDate: '2026-01-04' }))).toBe('invalid_effectiveDate')
    expect(await err(noteBody(p.id, { value: 0 }))).toBe('invalid_value')
    expect(await err(noteBody(p.id, { deductions: 301 }))).toBe('invalid_deductions')
    expect(await err(noteBody(p.id, { taxes: { ...TAXES, iss: 120 } }))).toBe('invalid_iss')
    expect(await err(noteBody('pay_000000000000'))).toBe('invalid_payment')
    expect(await err({ ...noteBody(p.id), payment: undefined })).toBe('invalid_customer')

    await schedule(p.id)
    expect(await err(noteBody(p.id))).toBe('invalid_payment') // one standing note per charge

    const removed = await charge()
    await h.api.call('delete-payment', { params: { id: removed.id } })
    expect(await err(noteBody(removed.id))).toBe('invalid_payment')
  })

  it('só altera e emite antes da prefeitura; não cancela enquanto ela processa', async () => {
    await fiscalInfo()
    const note = await schedule((await charge()).id)
    await h.api.call('issue-an-invoice', { params: { id: note.id } })

    const cancel = await h.api.call('cancel-an-invoice', { params: { id: note.id }, body: {} })
    expect(cancel.status).toBe(400)
    expect(cancel.body.errors[0].code).toBe('invalid_action')

    await h.tick()
    const update = await h.api.call('update-invoice', { params: { id: note.id }, body: { value: 10 } })
    expect(update.status).toBe(400)
    const issue = await h.api.call('issue-an-invoice', { params: { id: note.id } })
    expect(issue.status).toBe(400)
  })

  it('a nota de outra conta não existe (404)', async () => {
    const note = await schedule((await charge()).id)
    const other = await createSecondAccount(h)
    const res = await h.as(other.apiKey).call('retrieve-a-single-invoice', { params: { id: note.id } })
    expect(res.status).toBe(404)
  })
})

describe('nota fiscal — cobrança, filtros e assinatura', () => {
  it('updatePayment desconta da cobrança os impostos retidos', async () => {
    await h.subscribeWebhook(['PAYMENT_UPDATED'])
    const p = await charge(300)
    // Retained: PIS 0,65 + COFINS 3 + CSLL 1 + IR 1,5 = 6,15% of 300 = 18,45 (ISS not retained).
    await schedule(p.id, { updatePayment: true })
    const after = (await h.api.call('retrieve-a-single-payment', { params: { id: p.id } })).body
    expect(after.value).toBe(281.55)
    await drain()
    expect(h.sink.eventsOf('PAYMENT_UPDATED')).toHaveLength(1)
  })

  it('lista com filtros de situação, cobrança e data', async () => {
    const a = await charge()
    const b = await charge()
    const n1 = await schedule(a.id, { externalReference: 'pedido-1' })
    await schedule(b.id, { effectiveDate: '2026-02-01' })
    await h.api.call('cancel-an-invoice', { params: { id: n1.id }, body: {} })

    const list = (q: Record<string, string>) => h.api.call('list-invoices', { query: q })
    expect((await list({})).body.totalCount).toBe(2)
    expect((await list({ status: 'CANCELED' })).body.data.map((n: any) => n.id)).toEqual([n1.id])
    expect((await list({ payment: b.id })).body.totalCount).toBe(1)
    expect((await list({ externalReference: 'pedido-1' })).body.totalCount).toBe(1)
    expect((await list({ 'effectiveDate[Ge]': '2026-01-15' })).body.totalCount).toBe(1)
  })

  it('a assinatura com invoiceSettings ganha a nota de cada cobrança, no vencimento', async () => {
    await fiscalInfo()
    const sub = (
      await h.api.call('create-new-subscription', {
        body: { customer: await customer(), billingType: 'BOLETO', value: 150, nextDueDate: '2026-01-12', cycle: 'MONTHLY', description: 'Plano mensal' },
      })
    ).body
    const cfg = await h.api.call('create-configuration-for-issuance-of-invoices', {
      params: { id: sub.id },
      body: { municipalServiceName: 'Fisioterapia', effectiveDatePeriod: 'ON_PAYMENT_DUE_DATE', observations: 'Mensalidade', taxes: TAXES },
    })
    expect(cfg.status).toBe(200)

    await h.tick()
    // One note per charge: the generation job already made February's (due in 38 days).
    const charges = (await h.api.call('list-payments-of-a-subscription', { params: { id: sub.id } })).body.data
    const list = await h.api.call('list-invoices-for-subscription-charges', { params: { id: sub.id } })
    expect(list.body.totalCount).toBe(charges.length)
    const note = list.body.data.find((n: any) => n.effectiveDate === '2026-01-12')
    expect(note.status).toBe('SCHEDULED')
    expect(note.effectiveDate).toBe('2026-01-12')
    expect(note.serviceDescription).toBe('Plano mensal')
    expect(note.value).toBe(150)

    // A second tick does not duplicate them.
    await h.tick()
    expect((await h.api.call('list-invoices-for-subscription-charges', { params: { id: sub.id } })).body.totalCount).toBe(charges.length)

    await h.advance({ days: 7 })
    await h.tick()
    expect((await get(note.id)).status).toBe('AUTHORIZED')
  })

  it('ON_PAYMENT_CONFIRMATION + receivedOnly: a nota só nasce quando o dinheiro entra', async () => {
    await fiscalInfo()
    const sub = (
      await h.api.call('create-new-subscription', {
        body: { customer: await customer(), billingType: 'PIX', value: 99, nextDueDate: '2026-01-12', cycle: 'MONTHLY' },
      })
    ).body
    await h.api.call('create-configuration-for-issuance-of-invoices', {
      params: { id: sub.id },
      body: { municipalServiceName: 'Fisioterapia', effectiveDatePeriod: 'ON_PAYMENT_CONFIRMATION', receivedOnly: true, taxes: TAXES },
    })
    await h.tick()
    const count = async () => (await h.api.call('list-invoices-for-subscription-charges', { params: { id: sub.id } })).body.totalCount
    expect(await count()).toBe(0)

    const charges = (await h.api.call('list-payments-of-a-subscription', { params: { id: sub.id } })).body.data
    await h.api.call('confirm-payment', { params: { id: charges[0].id } })
    await h.tick()
    expect(await count()).toBe(1)
    const [note] = (await h.api.call('list-invoices', { query: { payment: charges[0].id } })).body.data
    expect(note.status).toBe('SYNCHRONIZED')
    expect(note.effectiveDate).toBe(TODAY)
  })
})

describe('nota fiscal — controles do simulador (/_mock/invoices)', () => {
  const mock = async (path: string, body?: unknown) => {
    const res = await h.app.app.handle(
      new Request(`http://localhost/_mock/invoices${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
      }),
    )
    return { status: res.status, body: (await res.json()) as any }
  }

  it('autoriza na hora, mesmo sem informações fiscais', async () => {
    const note = await schedule((await charge()).id)
    const r = await mock(`/${note.id}/authorize`)
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ from: 'SCHEDULED', to: 'AUTHORIZED' })
    expect(r.body.invoice.number).toBe('1')
  })

  it('força o erro da prefeitura com o motivo dado', async () => {
    const note = await schedule((await charge()).id)
    const r = await mock(`/${note.id}/error`, { description: 'CNAE incompatível com o serviço.' })
    expect(r.body.to).toBe('ERROR')
    expect((await get(note.id)).statusDescription).toBe('CNAE incompatível com o serviço.')
  })

  it('nega ou confirma o cancelamento', async () => {
    await h.subscribeWebhook(EVENTS)
    const note = await schedule((await charge()).id)
    await mock(`/${note.id}/authorize`)
    await h.api.call('cancel-an-invoice', { params: { id: note.id }, body: {} })

    const denied = await mock(`/${note.id}/deny-cancellation`)
    expect(denied.body.to).toBe('CANCELLATION_DENIED')

    // Denied, it can be asked again; this time the city hall agrees.
    await h.api.call('cancel-an-invoice', { params: { id: note.id }, body: {} })
    expect((await mock(`/${note.id}/confirm-cancellation`)).body.to).toBe('CANCELED')
    expect((await mock(`/${note.id}/confirm-cancellation`)).status).toBe(400)

    expect(await invoiceEvents()).toContain('INVOICE_CANCELLATION_DENIED')
  })

  it('404 para nota inexistente', async () => {
    expect((await mock('/inv_000000000000/authorize')).status).toBe(404)
  })
})

describe('informações fiscais', () => {
  it('404 antes de cadastrar; depois devolve o cadastro com os segredos só como "enviado"', async () => {
    expect((await h.api.call('retrieve-tax-information')).status).toBe(404)

    const saved = await h.api.call('create-and-update-tax-information', {
      body: { email: 'nf@clinica.example', simplesNacional: false, cnae: '8650004', password: 'segredo' },
    })
    expect(saved.status).toBe(200)
    const read = (await h.api.call('retrieve-tax-information')).body
    expect(read).toMatchObject({ email: 'nf@clinica.example', simplesNacional: false, cnae: '8650004', passwordSent: true })
    expect(JSON.stringify(read)).not.toContain('segredo')

    const missing = await h.api.call('create-and-update-tax-information', { body: { cnae: '1' } })
    expect((await h.api.call('retrieve-tax-information')).body.cnae).toBe('1')
    expect(missing.status).toBe(200) // email and simplesNacional already on file

    const services = await h.api.call('list-municipal-services', { query: { description: 'fisio' } })
    expect(services.body.data[0].id).toBe('4.08')
    expect((await h.api.call('list-municipal-configurations')).status).toBe(200)
  })
})
