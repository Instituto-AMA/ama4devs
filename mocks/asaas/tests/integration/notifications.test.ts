/**
 * Notification — PUT individual e PUT em lote.
 *
 * The notifications are born with the customer (track A). Here they are seeded straight
 * into the database: what is under test is the UPDATE — and, above all, that the id of
 * a notification (which is guessable) does not give access to the neighbour's account.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { customers, notifications } from '../../src/db/schema/index.ts'
import { customerId, notificationId } from '../../src/domain/ids.ts'
import { notificationHandlers } from '../../src/modules/notifications/handlers.ts'
import { createHarness, createSecondAccount, type Harness } from '../helpers/harness.ts'

let h: Harness

beforeAll(async () => {
  h = await createHarness()
})
afterAll(() => h.close())

const EVENTS = ['PAYMENT_CREATED', 'PAYMENT_OVERDUE', 'PAYMENT_RECEIVED'] as const

/** Seeds a customer and its notifications — it is what track A does on customer creation. */
async function seedCustomer(accountId: string): Promise<{ id: string; notifications: string[] }> {
  const rng = h.app.ctx.rng
  const id = customerId(rng)

  await h.app.db.insert(customers).values({
    id,
    accountId,
    name: 'Customer',
    cpfCnpj: '24971563792',
    personType: 'FISICA',
    notificationDisabled: false,
    deleted: false,
    dateCreated: h.app.ctx.clock.timestamp(),
  })

  const ids: string[] = []
  for (const event of EVENTS) {
    const notifId = notificationId(rng)
    ids.push(notifId)
    await h.app.db.insert(notifications).values({
      id: notifId,
      customerId: id,
      event,
      enabled: true,
      emailEnabledForProvider: true,
      smsEnabledForProvider: true,
      emailEnabledForCustomer: true,
      smsEnabledForCustomer: true,
      phoneCallEnabledForCustomer: false,
      whatsappEnabledForCustomer: false,
      scheduleOffset: 0,
      deleted: false,
    })
  }

  return { id, notifications: ids }
}

describe('PUT /v3/notifications/{id}', () => {
  it('updates the channels and the schedule', async () => {
    const customer = await seedCustomer(h.accountId)

    const { status, body } = await h.api.call('update-existing-notification', {
      params: { id: customer.notifications[0]! },
      body: {
        enabled: false,
        smsEnabledForCustomer: false,
        whatsappEnabledForCustomer: true,
        scheduleOffset: 10,
      },
    })

    expect(status).toBe(200)
    expect(body.object).toBe('notification')
    expect(body.customer).toBe(customer.id)
    expect(body.enabled).toBe(false)
    expect(body.smsEnabledForCustomer).toBe(false)
    expect(body.whatsappEnabledForCustomer).toBe(true)
    expect(body.scheduleOffset).toBe(10)
    // What did not come in the body does not change.
    expect(body.emailEnabledForCustomer).toBe(true)
    expect(body.event).toBe('PAYMENT_CREATED')
  })

  it('scheduleOffset outside the allowed set → 400', async () => {
    const customer = await seedCustomer(h.accountId)

    const { status, body } = await h.api.call('update-existing-notification', {
      params: { id: customer.notifications[0]! },
      body: { scheduleOffset: 3 },
    })

    expect(status).toBe(400)
    expect(body.errors[0].code).toBe('invalid_scheduleOffset')
  })

  it('a non-existent notification → 404', async () => {
    const { status } = await h.api.call('update-existing-notification', {
      params: { id: 'not_doesnotexist00' },
      body: { enabled: false },
    })

    expect(status).toBe(404)
  })

  it('the notification of a customer from ANOTHER account does not exist (404)', async () => {
    const mine = await seedCustomer(h.accountId)
    const other = await createSecondAccount(h, 'Neighbouring Account')

    const { status } = await h.as(other.apiKey).call('update-existing-notification', {
      params: { id: mine.notifications[0]! },
      body: { enabled: false },
    })

    expect(status).toBe(404)
  })
})

describe('PUT /v3/notifications/batch', () => {
  it("updates several and returns ALL the customer's notifications", async () => {
    const customer = await seedCustomer(h.accountId)

    const { status, body } = await h.api.call('update-existing-notifications-in-batch', {
      body: {
        customer: customer.id,
        notifications: [
          { id: customer.notifications[0], enabled: false },
          { id: customer.notifications[1], phoneCallEnabledForCustomer: true, scheduleOffset: 5 },
        ],
      },
    })

    expect(status).toBe(200)
    expect(body.notifications.length).toBe(EVENTS.length)

    const byId = new Map<string, any>(
      body.notifications.map((n: any) => [n.id as string, n]),
    )
    expect(byId.get(customer.notifications[0]!)!.enabled).toBe(false)
    expect(byId.get(customer.notifications[1]!)!.phoneCallEnabledForCustomer).toBe(true)
    expect(byId.get(customer.notifications[1]!)!.scheduleOffset).toBe(5)
    expect(byId.get(customer.notifications[2]!)!.enabled).toBe(true) // untouched
  })

  it('without customer → 400 invalid_customer', async () => {
    const { status, body } = await h.api.call('update-existing-notifications-in-batch', {
      body: { notifications: [] },
    })

    expect(status).toBe(400)
    expect(body.errors.map((e: any) => e.code)).toContain('invalid_customer')
  })

  it('an id of another customer in the batch refuses the WHOLE BATCH', async () => {
    const a = await seedCustomer(h.accountId)
    const b = await seedCustomer(h.accountId)

    const { status } = await h.api.call('update-existing-notifications-in-batch', {
      body: {
        customer: a.id,
        notifications: [
          { id: a.notifications[0], enabled: false },
          { id: b.notifications[0], enabled: false },
        ],
      },
    })

    expect(status).toBe(404)

    // Nothing was applied: a half-applied batch would be worse than a refused batch.
    const check = await h.api.call('update-existing-notifications-in-batch', {
      body: { customer: a.id, notifications: [] },
    })
    const first = check.body.notifications.find((n: any) => n.id === a.notifications[0])
    expect(first.enabled).toBe(true)
  })

  it('a customer from another account → 404', async () => {
    const mine = await seedCustomer(h.accountId)
    const other = await createSecondAccount(h, 'Neighbouring Batch Account')

    const { status } = await h.as(other.apiKey).call('update-existing-notifications-in-batch', {
      body: { customer: mine.id, notifications: [] },
    })

    expect(status).toBe(404)
  })
})
