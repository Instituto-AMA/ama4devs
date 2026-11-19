/**
 * The image edit routes: the Vercel AI Gateway's multipart edit and
 * OpenRouter's JSON image request. The stub edits nothing: it answers the
 * photo it received, so a caller gets a real, decodable picture of the right
 * size and the same answer every time.
 */

/** The biggest body of an image request: a 15 MiB photo as a base64 data URL, with room. */
export const MAX_IMAGE_BODY_BYTES = 32 * 1024 * 1024

/** What one image request costs, in US dollars, as the gateways report it. */
export const IMAGE_COST_USD = 0.04

/** The media types the routes take as a photo. */
const IMAGE_MEDIA_TYPES = new Set(['image/jpeg', 'image/png'])

/** A data URL of a base64 picture: its media type and its payload. */
const DATA_URL = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i

/** The photo of a request: its bytes in base64 and its media type. */
export interface ImageInput {
  base64: string
  mediaType: string
}

/** What the reading of an image request found. */
export type ImageRequest =
  | { status: 'ok'; model: string; prompt: string; image: ImageInput; masked: boolean }
  | { status: 'invalid'; message: string }
  | { status: 'too-large' }

/**
 * The answer of both gateways to an image request.
 * @param image The picture to answer with.
 * @param created The moment of the answer, in seconds.
 */
export function imageBody(image: ImageInput, created: number): Record<string, unknown> {
  return {
    created,
    data: [{ b64_json: image.base64, media_type: image.mediaType }],
    usage: { cost: IMAGE_COST_USD },
  }
}

/**
 * The image request of the Vercel AI Gateway: a multipart form with the
 * `model`, the `prompt`, the `image` file and an optional `mask` file.
 * @param request The request to read.
 */
export async function readVercelImageRequest(request: Request): Promise<ImageRequest> {
  if (declaredTooLarge(request)) return { status: 'too-large' }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return invalid('body must be a multipart form')
  }

  const model = form.get('model')
  if (typeof model !== 'string' || model.trim() === '') return invalid('model must be a string')
  const prompt = form.get('prompt')
  if (typeof prompt !== 'string' || prompt.trim() === '') return invalid('prompt must be a string')
  const image = form.get('image')
  if (!(image instanceof Blob)) return invalid('image must be a file')
  if (!IMAGE_MEDIA_TYPES.has(image.type)) return invalid('image must be a JPEG or a PNG')
  if (image.size > MAX_IMAGE_BODY_BYTES) return { status: 'too-large' }

  const bytes = new Uint8Array(await image.arrayBuffer())
  return {
    status: 'ok',
    model,
    prompt,
    image: { base64: Buffer.from(bytes).toString('base64'), mediaType: image.type },
    masked: form.get('mask') instanceof Blob,
  }
}

/**
 * The image request of OpenRouter: a JSON object with the `model`, the
 * `prompt`, the photo as the first of `input_references` (a data URL) and an
 * optional `markup` with the marked region.
 * @param value The parsed JSON body.
 */
export function readOpenRouterImageRequest(value: unknown): ImageRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalid('body must be a JSON object')
  }
  const body = value as Record<string, unknown>
  if (typeof body.model !== 'string' || body.model.trim() === '') return invalid('model must be a string')
  if (typeof body.prompt !== 'string' || body.prompt.trim() === '') return invalid('prompt must be a string')

  const references = body.input_references
  if (!Array.isArray(references) || references.length === 0) {
    return invalid('input_references must hold the photo')
  }
  const image = imageOfReference(references[0])
  if (image === null) return invalid('input_references[0] must be a JPEG or PNG data URL')

  return { status: 'ok', model: body.model, prompt: body.prompt, image, masked: body.markup != null }
}

/**
 * The picture a reference carries (`{ type: 'image_url', image_url: { url } }`),
 * or null when it carries none the routes take.
 * @param reference One entry of `input_references`.
 */
function imageOfReference(reference: unknown): ImageInput | null {
  if (typeof reference !== 'object' || reference === null) return null
  const imageUrl = (reference as Record<string, unknown>).image_url
  if (typeof imageUrl !== 'object' || imageUrl === null) return null
  const url = (imageUrl as Record<string, unknown>).url
  if (typeof url !== 'string') return null

  const match = DATA_URL.exec(url)
  if (match === null) return null
  const mediaType = (match[1] ?? '').toLowerCase()
  if (!IMAGE_MEDIA_TYPES.has(mediaType)) return null
  return { base64: (match[2] ?? '').replace(/\s+/g, ''), mediaType }
}

/**
 * Whether the request declares a body bigger than the routes read.
 * @param request The request to check.
 */
function declaredTooLarge(request: Request): boolean {
  const declared = request.headers.get('content-length')
  return declared !== null && Number(declared) > MAX_IMAGE_BODY_BYTES
}

/**
 * An invalid request with its reason.
 * @param message What is wrong with the request.
 */
function invalid(message: string): ImageRequest {
  return { status: 'invalid', message: `invalid request: ${message}` }
}
