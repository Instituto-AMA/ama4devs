/**
 * Small HTTP helpers shared by the route modules: JSON responses and the
 * reading of a request body that may be JSON or a form.
 */

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

/**
 * The fields of a request body: a JSON object, or the fields of an
 * urlencoded / multipart form. An empty body reads as no fields; a body that
 * cannot be parsed reads as null.
 * @param request The request to read.
 */
export async function readFields(request: Request): Promise<Record<string, unknown> | null> {
  const type = request.headers.get('content-type') ?? ''
  try {
    if (type.includes('application/json')) {
      const text = await request.text()
      if (text.trim() === '') return {}
      const value: unknown = JSON.parse(text)
      return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null
    }
    if (type.includes('application/x-www-form-urlencoded') || type.includes('multipart/form-data')) {
      const form = await request.formData()
      const fields: Record<string, unknown> = {}
      for (const [key, value] of form.entries()) fields[key] = typeof value === 'string' ? value : ''
      return fields
    }
    const text = await request.text()
    return text.trim() === '' ? {} : null
  } catch {
    return null
  }
}

/**
 * The query string as a plain object (the last value of a repeated key wins).
 * @param url The request URL.
 */
export function queryFields(url: URL): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const [key, value] of url.searchParams.entries()) fields[key] = value
  return fields
}
