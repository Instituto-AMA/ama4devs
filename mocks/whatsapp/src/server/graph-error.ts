/**
 * The error body of the Graph API.
 *
 * Meta answers every refused call with the same envelope: an `OAuthException`
 * with a numeric `code`, often an `error_subcode`, the text the developer
 * reads and the one a person reads. The mock answers the same way, so the
 * error handling of the application is tested on the real shape.
 */
import type { Context } from 'hono'

export interface GraphErrorInput {
	message: string
	code: number
	subcode?: number
	userTitle?: string
	userMessage?: string
}

/** A trace id shaped like Meta's, for the logs of the application. */
function traceId(): string {
	return crypto.randomUUID().replaceAll('-', '').slice(0, 23)
}

export function graphErrorBody(input: GraphErrorInput) {
	return {
		error: {
			message: input.message,
			type: 'OAuthException',
			code: input.code,
			...(input.subcode !== undefined ? { error_subcode: input.subcode } : {}),
			...(input.userTitle ? { error_user_title: input.userTitle } : {}),
			...(input.userMessage ? { error_user_msg: input.userMessage } : {}),
			fbtrace_id: traceId(),
		},
	}
}

export function graphError(
	c: Context,
	input: GraphErrorInput,
	status: 400 | 404 = 400
) {
	return c.json(graphErrorBody(input), status)
}

/** `(#100) Invalid parameter`, with the reason a person reads. */
export function invalidParameter(c: Context, userMessage: string) {
	return graphError(c, {
		message: '(#100) Invalid parameter',
		code: 100,
		userTitle: 'Invalid parameter',
		userMessage,
	})
}

/** The answer to an id the mock does not know. */
export function unknownObject(c: Context, id: string) {
	return graphError(c, {
		message: `Unsupported request - method type: ${c.req.method.toLowerCase()}. Object with ID '${id}' does not exist, cannot be loaded due to missing permissions, or does not support this operation.`,
		code: 100,
		subcode: 33,
	})
}
