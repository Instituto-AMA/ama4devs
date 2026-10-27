/**
 * `POST /{phone-number-id}/calls` and `GET /{phone-number-id}/call_permissions`.
 *
 * The business (the application, or the panel as the clinic) calls with
 * `action` connect, pre_accept, accept, reject or terminate, as on Meta.
 * With `X-Mock-From` the same call is the user's phone: connect (the user
 * calls), accept or reject (a business call), terminate (hang up). The
 * logic is in `calls.ts`.
 */
import type { Context } from 'hono'
import { Hono } from 'hono'
import {
	businessActs,
	businessCalls,
	type CallResult,
	isSdp,
	permissionView,
	userActs,
	userCalls,
} from '../calls.ts'
import { graphError, invalidParameter } from '../graph-error.ts'
import { MOCK_HEADERS } from '../mock-headers.ts'

type Json = Record<string, unknown>

const ACTIONS = [
	'connect',
	'pre_accept',
	'accept',
	'reject',
	'terminate',
] as const
type Action = (typeof ACTIONS)[number]

function answer(c: Context, result: CallResult, connect: boolean) {
	if (!result.ok) {
		return graphError(c, {
			message: result.failure.message,
			code: result.failure.code,
			userMessage: result.failure.userMessage,
		})
	}
	return connect
		? c.json({ messaging_product: 'whatsapp', calls: [{ id: result.call.id }] })
		: c.json({ messaging_product: 'whatsapp', success: true })
}

export function createCallsRouter() {
	const router = new Hono()

	router.post('/:phoneNumberId/calls', async (c) => {
		const { phoneNumberId } = c.req.param()
		const body = (await c.req.json().catch(() => null)) as Json | null
		if (!body) return invalidParameter(c, 'The request body is not valid JSON.')
		const action = String(body.action ?? '') as Action
		if (!ACTIONS.includes(action)) {
			return invalidParameter(c, `action must be one of ${ACTIONS.join(', ')}.`)
		}
		const session = body.session as
			| { sdp_type?: string; sdp?: unknown }
			| undefined
		const sdp = session?.sdp
		const from =
			c.req.header(MOCK_HEADERS.from)?.replace(/\D/g, '') || undefined
		const callId = String(body.call_id ?? '')
		const opaque =
			typeof body.biz_opaque_callback_data === 'string'
				? body.biz_opaque_callback_data
				: null

		if (action === 'connect') {
			if (session?.sdp_type !== 'offer' || !isSdp(sdp)) {
				return invalidParameter(
					c,
					'connect needs session.sdp_type "offer" and an RFC 8866 SDP with an audio section.'
				)
			}
			if (from) {
				const name = c.req.header(MOCK_HEADERS.contactName)?.trim() || null
				return answer(c, userCalls(phoneNumberId, from, name, sdp), true)
			}
			const to = String(body.to ?? body.recipient ?? '').replace(/\D/g, '')
			if (!to) return invalidParameter(c, 'to is required to start a call.')
			return answer(c, businessCalls(phoneNumberId, to, sdp, opaque), true)
		}

		if (!callId) return invalidParameter(c, 'call_id is required.')
		const needsAnswer = action === 'pre_accept' || action === 'accept'
		if (needsAnswer && (session?.sdp_type !== 'answer' || !isSdp(sdp))) {
			return invalidParameter(
				c,
				`${action} needs session.sdp_type "answer" and an RFC 8866 SDP with an audio section.`
			)
		}
		const sdpAnswer = needsAnswer ? (sdp as string) : null
		if (from) {
			if (action === 'pre_accept') {
				return invalidParameter(
					c,
					'pre_accept is the business answering a user call.'
				)
			}
			return answer(
				c,
				userActs(phoneNumberId, from, callId, action, sdpAnswer),
				false
			)
		}
		return answer(
			c,
			businessActs(phoneNumberId, callId, action, sdpAnswer, opaque),
			false
		)
	})

	router.get('/:phoneNumberId/call_permissions', (c) => {
		const { phoneNumberId } = c.req.param()
		const user = (c.req.query('user_wa_id') ?? '').replace(/\D/g, '')
		if (!user) return invalidParameter(c, 'user_wa_id is required.')
		return c.json(permissionView(phoneNumberId, user))
	})

	return router
}
