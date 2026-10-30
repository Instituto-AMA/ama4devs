/**
 * Credit Bureau Report — a query to Serasa.
 *
 * The asymmetry that breaks integrations and that is covered here: `reportFile` (the PDF
 * in base64) ONLY comes in the creation's response. Whoever retrieves the report afterwards
 * gets null and has to use the `downloadUrl`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { customers } from '../../src/db/schema/index.ts'
import { customerId } from '../../src/domain/ids.ts'
import { creditBureauHandlers } from '../../src/modules/credit-bureau/handlers.ts'
import { createHarness, createSecondAccount, type Harness } from '../helpers/harness.ts'

let h: Harness

beforeAll(async () => {
  h = await createHarness()
})
afterAll(() => h.close())

async function seedCustomer(accountId: string, cpfCnpj = '24971563792'): Promise<string> {
  const id = customerId(h.app.ctx.rng)
  await h.app.db.insert(customers).values({
    id,
    accountId,
    name: 'Queried Customer',
    cpfCnpj,
    personType: cpfCnpj.length === 14 ? 'JURIDICA' : 'FISICA',
    notificationDisabled: false,
    deleted: false,
    dateCreated: h.app.ctx.clock.timestamp(),
  })
  return id
}

describe('query', () => {
  it('by a standalone CPF/CNPJ: 200, reportFile in base64, dateCreated with the date only', async () => {
    const { status, body } = await h.api.call('make-consultation', {
      body: { cpfCnpj: '24971563792' },
    })

    expect(status).toBe(200)
    expect(body.cpfCnpj).toBe('24971563792')
    expect(body.customer).toBeNull()
    expect(body.dateCreated).toBe('2026-01-05') // the virtual clock, not the real one
    expect(body.downloadUrl).toContain(`/creditBureauReport/download/${body.id}`)
    expect(typeof body.reportFile).toBe('string')
  })

  it("by a customer: the queried document is the customer's", async () => {
    const customer = await seedCustomer(h.accountId, '47960950000121')

    const { status, body } = await h.api.call('make-consultation', {
      body: { customer },
    })

    expect(status).toBe(200)
    expect(body.customer).toBe(customer)
    expect(body.cpfCnpj).toBe('47960950000121')
  })

  it('the charged fee comes from config.fees and depends on the person type', async () => {
    const { creditBureauReports } = await import('../../src/db/schema/index.ts')
    const { eq } = await import('drizzle-orm')

    const pf = await h.api.call('make-consultation', { body: { cpfCnpj: '24971563792' } })
    const pj = await h.api.call('make-consultation', { body: { cpfCnpj: '47960950000121' } })

    const [rowPf] = await h.app.db
      .select()
      .from(creditBureauReports)
      .where(eq(creditBureauReports.id, pf.body.id))
    const [rowPj] = await h.app.db
      .select()
      .from(creditBureauReports)
      .where(eq(creditBureauReports.id, pj.body.id))

    expect(rowPf!.feeCents).toBe(h.app.config.fees.creditBureauReport.naturalPerson)
    expect(rowPj!.feeCents).toBe(h.app.config.fees.creditBureauReport.legalPerson)
  })

  it('without a customer and without CPF/CNPJ → 400', async () => {
    const { status, body } = await h.api.call('make-consultation', { body: {} })

    expect(status).toBe(400)
    expect(body.errors[0].code).toBe('invalid_cpfCnpj')
  })

  it('an invalid CPF/CNPJ → 400 (the check digit is really checked)', async () => {
    const { status, body } = await h.api.call('make-consultation', {
      body: { cpfCnpj: '11111111111' },
    })

    expect(status).toBe(400)
    expect(body.errors[0].code).toBe('invalid_cpfCnpj')
  })

  it('a customer from another account → 404', async () => {
    const other = await createSecondAccount(h, 'Neighbouring Account')
    const alien = await seedCustomer(other.accountId)

    const { status } = await h.api.call('make-consultation', { body: { customer: alien } })
    expect(status).toBe(404)
  })
})

describe('retrieval and listing', () => {
  it('retrieving does not return the reportFile — only the downloadUrl', async () => {
    const created = await h.api.call('make-consultation', {
      body: { cpfCnpj: '24971563792' },
    })

    const { status, body } = await h.api.call('retrieve-a-credit-bureau-report', {
      params: { id: created.body.id },
    })

    expect(status).toBe(200)
    expect(body.id).toBe(created.body.id)
    expect(body.reportFile).toBeNull()
    expect(body.downloadUrl).toBe(created.body.downloadUrl)
  })

  it("listing in Asaas's envelope, with a period filter", async () => {
    await h.api.call('make-consultation', { body: { cpfCnpj: '24971563792' } })

    const all = await h.api.call('list-credit-bureau-reports')
    expect(all.status).toBe(200)
    expect(all.body.object).toBe('list')
    expect(all.body.totalCount).toBeGreaterThan(0)
    expect(all.body.data[0].reportFile).toBeNull()

    const today = await h.api.call('list-credit-bureau-reports', {
      query: { startDate: '2026-01-05', endDate: '2026-01-05' },
    })
    expect(today.body.totalCount).toBe(all.body.totalCount)

    const outroDia = await h.api.call('list-credit-bureau-reports', {
      query: { startDate: '2026-02-01', endDate: '2026-02-28' },
    })
    expect(outroDia.body.totalCount).toBe(0)
  })

  it('a report from another account → 404, and its listing does not see ours', async () => {
    const created = await h.api.call('make-consultation', {
      body: { cpfCnpj: '24971563792' },
    })
    const other = await createSecondAccount(h, 'Conta Curiosa')
    const client = h.as(other.apiKey)

    const fetched = await client.call('retrieve-a-credit-bureau-report', {
      params: { id: created.body.id },
    })
    expect(fetched.status).toBe(404)

    const listed = await client.call('list-credit-bureau-reports')
    expect(listed.body.totalCount).toBe(0)
  })
})
