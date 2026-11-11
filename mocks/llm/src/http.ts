/**
 * Small HTTP helpers shared by the routes: the JSON answers and the reading
 * of a JSON body that may be too big or broken.
 */

/** The biggest body the mock reads; a bigger one is refused with 413. */
export const MAX_BODY_BYTES = 4 * 1024 * 1024

/**
 * A JSON response.
 * @param body Anything JSON can carry.
 * @param status The HTTP status.
 * @param headers Extra headers.
 */
export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  })
}

/** An empty 204 response. */
export function noContent(): Response {
  return new Response(null, { status: 204 })
}

/** What the reading of a body found. */
export type BodyResult =
  | { status: 'ok'; value: unknown }
  | { status: 'invalid' }
  | { status: 'too-large' }

/**
 * The JSON body of a request.
 * @param request The request to read.
 * @param maxBytes The biggest body accepted.
 */
export async function readJsonBody(
  request: Request,
  maxBytes: number = MAX_BODY_BYTES,
): Promise<BodyResult> {
  const declared = request.headers.get('content-length')
  if (declared !== null && Number(declared) > maxBytes) return { status: 'too-large' }

  let text: string
  try {
    text = await request.text()
  } catch {
    return { status: 'invalid' }
  }

  if (new TextEncoder().encode(text).byteLength > maxBytes) return { status: 'too-large' }

  try {
    return { status: 'ok', value: JSON.parse(text) as unknown }
  } catch {
    return { status: 'invalid' }
  }
}
