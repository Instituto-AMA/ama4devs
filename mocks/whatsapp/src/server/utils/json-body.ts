import type { Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import type { WhatsAppErrorResponse } from '../types/api-types.ts'

/** Graph-shaped 400 answer for a request body that is not valid JSON. */
export function invalidJsonResponse(c: Context) {
	return c.json(
		{
			error: {
				message: 'Invalid JSON body',
				type: 'validation_error',
				code: 400,
			},
		} as WhatsAppErrorResponse,
		400
	)
}

/**
 * Reject malformed JSON payloads with the Graph error shape.
 *
 * The raw body is cloned before it is parsed, so the validation middleware
 * still receives the untouched request body.
 */
export const parseJsonBody = createMiddleware(async (c, next) => {
	try {
		JSON.parse(await c.req.raw.clone().text())
	} catch {
		return invalidJsonResponse(c)
	}

	await next()
})
