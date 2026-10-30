/**
 * Payment Link — create, retrieve, list, update, remove, restore, and the
 * showcase images.
 *
 * The case that really breaks integrations and that is covered here: `deleted` is a
 * SOFT delete. The removed link disappears from the listing, stays retrievable by id, and
 * comes back with `restore`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { paymentLinkHandlers } from '../../src/modules/payment-links/handlers.ts'
import { createHarness, createSecondAccount, TEST_API_KEY, type Harness } from '../helpers/harness.ts'

let h: Harness

beforeAll(async () => {
  h = await createHarness()
})
afterAll(() => h.close())

const newLink = async (over: Record<string, unknown> = {}) => {
  const { status, body } = await h.api.call('create-a-payments-link', {
    body: {
      name: 'Book sale',
      billingType: 'UNDEFINED',
      chargeType: 'DETACHED',
      value: 50,
      ...over,
    },
  })
  expect(status).toBe(200)
  return body
}

/** Image in base64 — the same path as a multipart upload, without the multipart. */
const IMAGE_B64 = Buffer.from('test-image').toString('base64')

const addImage = async (linkId: string, main = false) => {
  const { status, body } = await h.api.call('add-an-image-to-a-payments-link', {
    params: { id: linkId },
    body: { image: IMAGE_B64, main },
  })
  expect(status).toBe(200)
  return body
}

describe('life cycle', () => {
  it('creating returns 200 (never 201) and the link is born active', async () => {
    const link = await newLink({ externalReference: '056984' })

    expect(link.id).toMatch(/^\d{12}$/) // no prefix: it is neither pay_ nor a UUID
    expect(link.url).toContain(`/c/${link.id}`)
    expect(link.value).toBe(50)
    expect(link.active).toBe(true)
    expect(link.deleted).toBe(false)
    expect(link.viewCount).toBe(0)
    expect(link.maxInstallmentCount).toBe(1) // default da spec
    expect(link.notificationEnabled).toBe(true)
    expect(link.externalReference).toBe('056984')
  })

  it('retrieving by id returns the same object', async () => {
    const created = await newLink()
    const { status, body } = await h.api.call('retrieve-a-single-payments-link', {
      params: { id: created.id },
    })

    expect(status).toBe(200)
    expect(body).toEqual(created)
  })

  it('updating changes only what came in', async () => {
    const created = await newLink({ description: 'Qualquer livro' })

    const { status, body } = await h.api.call('update-a-payments-link', {
      params: { id: created.id },
      body: { name: 'Venda de e-books', value: 39.9 },
    })

    expect(status).toBe(200)
    expect(body.name).toBe('Venda de e-books')
    expect(body.value).toBe(39.9) // cents → reais, without a floating-point error
    expect(body.description).toBe('Qualquer livro') // intocado
  })

  it('removing is a SOFT delete: it disappears from the list, but stays retrievable and restorable', async () => {
    const link = await newLink({ name: 'Ephemeral' })

    const removed = await h.api.call('remove-a-payments-link', { params: { id: link.id } })
    expect(removed.status).toBe(200)
    expect(removed.body).toEqual({ deleted: true, id: link.id })

    const fetched = await h.api.call('retrieve-a-single-payments-link', {
      params: { id: link.id },
    })
    expect(fetched.body.deleted).toBe(true)
    expect(fetched.body.active).toBe(false)

    const listed = await h.api.call('list-payments-links', { query: { name: 'Ephemeral' } })
    expect(listed.body.totalCount).toBe(0)

    const withDeleted = await h.api.call('list-payments-links', {
      query: { name: 'Ephemeral', includeDeleted: 'true' },
    })
    expect(withDeleted.body.totalCount).toBe(1)

    const restored = await h.api.call('restore-a-payments-link', {
      params: { id: link.id },
      body: {},
    })
    expect(restored.status).toBe(200)
    expect(restored.body.deleted).toBe(false)
    expect(restored.body.active).toBe(true)
  })
})

describe('listing', () => {
  it("Asaas's envelope and a filter by externalReference", async () => {
    const link = await newLink({ externalReference: 'ref-unique-42' })

    const { status, body } = await h.api.call('list-payments-links', {
      query: { externalReference: 'ref-unique-42' },
    })

    expect(status).toBe(200)
    expect(body.object).toBe('list')
    expect(body.limit).toBe(10)
    expect(body.offset).toBe(0)
    expect(body.hasMore).toBe(false)
    expect(body.totalCount).toBe(1)
    expect(body.data[0].id).toBe(link.id)
  })

  it('limit above 100 → 400 invalid_limit', async () => {
    const { status, body } = await h.api.call('list-payments-links', {
      query: { limit: 200 },
    })

    expect(status).toBe(400)
    expect(body.errors[0].code).toBe('invalid_limit')
  })
})

describe('validation', () => {
  it('without name → 400 invalid_name', async () => {
    const { status, body } = await h.api.call('create-a-payments-link', {
      body: { billingType: 'BOLETO', chargeType: 'DETACHED' },
    })

    expect(status).toBe(400)
    expect(body.errors.map((e: any) => e.code)).toContain('invalid_name')
  })

  it('RECURRENT without subscriptionCycle → 400', async () => {
    const { status, body } = await h.api.call('create-a-payments-link', {
      body: { name: 'Subscription', billingType: 'BOLETO', chargeType: 'RECURRENT' },
    })

    expect(status).toBe(400)
    expect(body.errors[0].code).toBe('invalid_subscriptionCycle')
  })

  it('an installment plan only exists in chargeType INSTALLMENT', async () => {
    const { status, body } = await h.api.call('create-a-payments-link', {
      body: {
        name: 'Livro',
        billingType: 'CREDIT_CARD',
        chargeType: 'DETACHED',
        maxInstallmentCount: 6,
      },
    })

    expect(status).toBe(400)
    expect(body.errors[0].code).toBe('invalid_maxInstallmentCount')
  })
})

describe('isolation between accounts', () => {
  it("the other account's link simply does not exist (404, never 403)", async () => {
    const link = await newLink()
    const other = await createSecondAccount(h, 'Conta Vizinha')
    const client = h.as(other.apiKey)

    const fetched = await client.call('retrieve-a-single-payments-link', {
      params: { id: link.id },
    })
    expect(fetched.status).toBe(404)

    const updated = await client.call('update-a-payments-link', {
      params: { id: link.id },
      body: { name: 'Sequestrado' },
    })
    expect(updated.status).toBe(404)

    const images = await client.call('list-images-from-a-payments-link', {
      params: { id: link.id },
    })
    expect(images.status).toBe(404)

    // And the other account's listing does not see anything of ours.
    const listed = await client.call('list-payments-links')
    expect(listed.body.totalCount).toBe(0)
  })
})

describe('images', () => {
  it('the first image is the main one by definition', async () => {
    const link = await newLink({ name: 'Com capa' })

    const first = await addImage(link.id)
    expect(first.main).toBe(true)
    expect(first.image.extension).toBe('png')
    expect(first.image.size).toBe(Buffer.from(IMAGE_B64, 'base64').byteLength)
    expect(first.image.downloadUrl).toContain('/file/public/download/')

    const second = await addImage(link.id)
    expect(second.main).toBe(false)
  })

  it('setting the main one knocks down the previous — there are never two', async () => {
    const link = await newLink({ name: 'Duas capas' })
    const first = await addImage(link.id)
    const second = await addImage(link.id)

    const { status, body } = await h.api.call('set-payments-link-main-image', {
      params: { paymentLinkId: link.id, imageId: second.id },
      body: {},
    })
    expect(status).toBe(200)
    expect(body.main).toBe(true)

    const list = await h.api.call('list-images-from-a-payments-link', {
      params: { id: link.id },
    })
    const mains = list.body.data.filter((i: any) => i.main)
    expect(mains.length).toBe(1)
    expect(mains[0].id).toBe(second.id)
    expect(list.body.data[0].id).toBe(second.id) // a principal vem primeiro

    const old = await h.api.call('retrieve-a-single-payments-link-image', {
      params: { paymentLinkId: link.id, imageId: first.id },
    })
    expect(old.body.main).toBe(false)
  })

  it('removing the main one promotes the oldest that is left', async () => {
    const link = await newLink({ name: 'Cover promotion' })
    const first = await addImage(link.id)
    const second = await addImage(link.id)

    const removed = await h.api.call('remove-an-image-from-payments-link', {
      params: { paymentLinkId: link.id, imageId: first.id },
    })
    expect(removed.status).toBe(200)
    expect(removed.body).toEqual({ deleted: true, id: first.id })

    const list = await h.api.call('list-images-from-a-payments-link', {
      params: { id: link.id },
    })
    expect(list.body.totalCount).toBe(1)
    expect(list.body.data[0].id).toBe(second.id)
    expect(list.body.data[0].main).toBe(true)
  })

  it('without an image in the body → 400 invalid_image', async () => {
    const link = await newLink()
    const { status, body } = await h.api.call('add-an-image-to-a-payments-link', {
      params: { id: link.id },
      body: { main: true },
    })

    expect(status).toBe(400)
    expect(body.errors[0].code).toBe('invalid_image')
  })

  it('a real multipart upload preserves the name, the extension and the size', async () => {
    const link = await newLink({ name: 'Multipart' })

    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7])
    const form = new FormData()
    form.append('main', 'true')
    form.append('image', new File([bytes], 'capa-da-vitrine.jpg', { type: 'image/jpeg' }))

    const res = await h.app.app.handle(
      new Request(`http://localhost/v3/paymentLinks/${link.id}/images`, {
        method: 'POST',
        headers: { access_token: TEST_API_KEY },
        body: form,
      }),
    )

    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(body.main).toBe(true)
    expect(body.image.originalName).toBe('capa-da-vitrine.jpg')
    expect(body.image.extension).toBe('jpg')
    expect(body.image.size).toBe(bytes.byteLength)
  })

  it('nonexistent image → 404', async () => {
    const link = await newLink()
    const { status } = await h.api.call('retrieve-a-single-payments-link-image', {
      params: { paymentLinkId: link.id, imageId: 'does-not-exist' },
    })

    expect(status).toBe(404)
  })
})
