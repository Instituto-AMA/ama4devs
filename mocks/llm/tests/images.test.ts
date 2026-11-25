import { expect, test } from 'bun:test'
import { makeApp } from './helpers.ts'
import type { App } from '../src/app.ts'
import { IMAGE_COST_USD } from '../src/images.ts'

/** The answer of an image route, as the test reads it. */
interface ImageBody {
  created: number
  data: { b64_json: string; media_type: string }[]
  usage: { cost: number }
}

/** The bytes of the photo the tests send: any bytes do, the stub edits nothing. */
const PHOTO = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9])
const PHOTO_BASE64 = Buffer.from(PHOTO).toString('base64')

/**
 * A multipart edit request to the Vercel AI Gateway route.
 * @param app The app of the test.
 * @param fields What the form carries besides the photo.
 * @param authorization The authorization header, when there is one.
 */
function requestVercelEdit(
  app: App,
  fields: { model?: string; prompt?: string; image?: Blob | null; mask?: Blob },
  authorization: string | null = 'Bearer test-key',
): Promise<Response> {
  const form = new FormData()
  if (fields.model !== undefined) form.set('model', fields.model)
  if (fields.prompt !== undefined) form.set('prompt', fields.prompt)
  const image = fields.image ?? new Blob([PHOTO], { type: 'image/jpeg' })
  // The file name follows the media type: the runtime reads a part's type from its name.
  if (fields.image !== null) form.set('image', image, image.type.startsWith('image/') ? 'image.jpg' : 'file.pdf')
  if (fields.mask !== undefined) form.set('mask', fields.mask, 'mask.png')

  const headers: Record<string, string> = {}
  if (authorization !== null) headers.authorization = authorization
  return app.fetch(new Request('http://localhost/v1/images/edits', { method: 'POST', headers, body: form }))
}

/**
 * A JSON image request to the OpenRouter route.
 * @param app The app of the test.
 * @param body The JSON body.
 * @param authorization The authorization header, when there is one.
 */
function requestOpenRouterImage(
  app: App,
  body: unknown,
  authorization: string | null = 'Bearer test-key',
): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (authorization !== null) headers.authorization = authorization
  return app.fetch(
    new Request('http://localhost/api/v1/images', { method: 'POST', headers, body: JSON.stringify(body) }),
  )
}

/** A valid OpenRouter body with the photo as a data URL. */
function openRouterBody(): Record<string, unknown> {
  return {
    model: 'openai/gpt-image-2',
    prompt: 'whiten the teeth',
    n: 1,
    response_format: 'b64_json',
    input_references: [{ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${PHOTO_BASE64}` } }],
  }
}

test('the Vercel edit route takes several pictures as image[] and answers the first', async () => {
  const { app } = makeApp()
  const form = new FormData()
  form.set('model', 'openai/gpt-image-2')
  form.set('prompt', 'follow the reference smile')
  form.append('image[]', new Blob([PHOTO], { type: 'image/jpeg' }), 'source.jpg')
  form.append('image[]', new Blob(['reference-bytes'], { type: 'image/jpeg' }), 'reference.jpg')
  const response = await app.fetch(
    new Request('http://localhost/v1/images/edits', {
      method: 'POST',
      headers: { authorization: 'Bearer test-key' },
      body: form,
    }),
  )

  expect(response.status).toBe(200)
  const body = (await response.json()) as ImageBody
  expect(body.data[0]?.b64_json).toBe(PHOTO_BASE64)
})

test('the Vercel edit route answers the photo it received', async () => {
  const { app } = makeApp()
  const response = await requestVercelEdit(app, { model: 'openai/gpt-image-2', prompt: 'whiten the teeth' })

  expect(response.status).toBe(200)
  const body = (await response.json()) as ImageBody
  expect(body.data).toEqual([{ b64_json: PHOTO_BASE64, media_type: 'image/jpeg' }])
  expect(body.usage.cost).toBe(IMAGE_COST_USD)
  expect(body.created).toBeGreaterThan(0)
})

test('the Vercel edit route takes a mask beside the photo', async () => {
  const { app } = makeApp()
  const response = await requestVercelEdit(app, {
    model: 'bfl/flux-pro-1.0-fill',
    prompt: 'whiten the teeth',
    mask: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
  })

  expect(response.status).toBe(200)
  const body = (await response.json()) as ImageBody
  expect(body.data[0]?.b64_json).toBe(PHOTO_BASE64)
})

test('the Vercel edit route refuses a request without a key, a model, a prompt or a photo', async () => {
  const { app } = makeApp()
  const valid = { model: 'openai/gpt-image-2', prompt: 'whiten the teeth' }

  expect((await requestVercelEdit(app, valid, null)).status).toBe(401)
  expect((await requestVercelEdit(app, { prompt: valid.prompt })).status).toBe(400)
  expect((await requestVercelEdit(app, { model: valid.model })).status).toBe(400)
  expect((await requestVercelEdit(app, { ...valid, image: null })).status).toBe(400)
  const text = new Blob(['not a picture'], { type: 'application/pdf' })
  expect((await requestVercelEdit(app, { ...valid, image: text })).status).toBe(400)
})

test('the OpenRouter image route answers the photo it received', async () => {
  const { app } = makeApp()
  const response = await requestOpenRouterImage(app, openRouterBody())

  expect(response.status).toBe(200)
  const body = (await response.json()) as ImageBody
  expect(body.data).toEqual([{ b64_json: PHOTO_BASE64, media_type: 'image/jpeg' }])
  expect(body.usage.cost).toBe(IMAGE_COST_USD)
})

test('the OpenRouter image route refuses a request without a key, a model or a photo', async () => {
  const { app } = makeApp()

  expect((await requestOpenRouterImage(app, openRouterBody(), null)).status).toBe(401)
  expect((await requestOpenRouterImage(app, { ...openRouterBody(), model: '' })).status).toBe(400)
  expect((await requestOpenRouterImage(app, { ...openRouterBody(), input_references: [] })).status).toBe(400)
  const remote = [{ type: 'image_url', image_url: { url: 'https://example.com/photo.jpg' } }]
  expect((await requestOpenRouterImage(app, { ...openRouterBody(), input_references: remote })).status).toBe(400)
  expect((await requestOpenRouterImage(app, ['not', 'an', 'object'])).status).toBe(400)
})

test('the same photo always gets the same answer', async () => {
  const { app } = makeApp()
  const first = (await (await requestOpenRouterImage(app, openRouterBody())).json()) as ImageBody
  const second = (await (await requestOpenRouterImage(app, openRouterBody())).json()) as ImageBody

  expect(second.data).toEqual(first.data)
})
