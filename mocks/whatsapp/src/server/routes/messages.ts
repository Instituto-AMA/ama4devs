/**
 * `/{phone-number-id}/messages`: the conversation of a number, both sides.
 *
 * The engine (graph/engine.ts) already checked the call against Meta's spec;
 * here it happens:
 * - a `status: read` body is a receipt: with a `typing_indicator` the clinic
 *   is typing; from the clinic it marks the user's message as read; from the
 *   user's phone (`X-Mock-From`) it is the user's receipt of a clinic message;
 * - with `X-Mock-From` the user writes, any type a user sends;
 * - otherwise the clinic sends, any type of the Cloud API: text, template,
 *   media, location, contacts, interactive, reaction, a reply (`context`).
 */
import type { Context } from 'hono'
import { Hono } from 'hono'
import {
	answerPermission,
	checkPermissionRequest,
	recordPermissionRequest,
} from '../calls.ts'
import { clinicReads, userReceipt, userWrites } from '../conversation.ts'
import { scheduleDelivery } from '../delivery-status.ts'
import { graphError, invalidParameter } from '../graph-error.ts'
import { MOCK_HEADERS, readReceipt } from '../mock-headers.ts'
import { toPanelMessage } from '../panel-message.ts'
import { accountStore } from '../store/account-store.ts'
import { mockStore, type StoredMessage } from '../store/mock-store.ts'
import type { Template, TemplateStore } from '../store/template-store.ts'
import {
	REVIEW_DETAILS,
	renderTemplate,
	type TemplateParameter,
} from '../template-render.ts'
import { broadcast } from '../websocket.ts'

type Json = Record<string, unknown>

/** Process template with variable substitution */
export function processTemplate(
	templateStore: TemplateStore,
	templateName: string,
	language: string,
	parameters: Array<{
		type: 'text'
		parameter_name: string
		text: string
	}>
): { processedTemplate: Template | null; error?: string } {
	const template = templateStore.getTemplate(templateName, language)
	if (!template) {
		return {
			processedTemplate: null,
			error: `Template "${templateName}" with language "${language}" not found`,
		}
	}

	const paramMap = new Map<string, string>()
	for (const param of parameters) {
		paramMap.set(param.parameter_name, param.text)
	}

	const processedComponents = template.components.map((component) => {
		if (!component.text) return component
		const text = component.text.replace(/\{\{([^}]+)\}\}/g, (match, name) => {
			const value = paramMap.get(name)
			if (value !== undefined) return value
			console.warn(
				`Template parameter ${name} not provided, keeping placeholder`
			)
			return match
		})
		return { ...component, text }
	})

	return {
		processedTemplate: { ...template, components: processedComponents },
		error: undefined,
	}
}

/** What the mock tells the application when a template does not pass the review. */
export { REVIEW_DETAILS }

const fbtrace = () => crypto.randomUUID().replaceAll('-', '').slice(0, 23)

/** The clinic is typing: the indicator lasts 25 s, or until the next message. */
function typing(phoneNumberId: string, messageId: string): void {
	mockStore.setTypingIndicator(phoneNumberId, messageId, true)
	const tell = (isTyping: boolean) =>
		broadcast({
			type: 'TYPING_INDICATOR',
			payload: { phoneNumberId, messageId, isTyping, timestamp: Date.now() },
		})
	tell(true)
	setTimeout(() => {
		mockStore.setTypingIndicator(phoneNumberId, messageId, false)
		tell(false)
	}, 25000)
}

/** A receipt: typing, the clinic reading the user, or the user's phone answering. */
function receipt(
	c: Context,
	phoneNumberId: string,
	body: Json,
	from: string | undefined
) {
	const message = mockStore.getMessage(String(body.message_id ?? ''))
	const wanted = from ? 'out' : 'in'
	if (
		!message ||
		message.phoneNumberId !== phoneNumberId ||
		message.direction !== wanted ||
		(from && message.contact !== from)
	) {
		return graphError(c, {
			message: '(#100) Invalid parameter',
			code: 100,
			userMessage: from
				? 'message_id is not a message the clinic sent to this user.'
				: 'message_id is not a message a user sent to this number.',
		})
	}
	if (!from) {
		clinicReads(message)
		if (body.typing_indicator) typing(phoneNumberId, message.id)
		return c.json({ success: true })
	}
	const answer = readReceipt(c.req.header(MOCK_HEADERS.messageStatus))
	if (!answer) {
		return invalidParameter(
			c,
			'X-Mock-Message-Status must be delivered, read or failed.'
		)
	}
	userReceipt(message, answer)
	return c.json({ success: true })
}

/** The parameters of a template call, per component, as the renderer reads them. */
function templateParameters(template: Json): {
	header: TemplateParameter[]
	body: TemplateParameter[]
} {
	const components = (template.components as Json[] | undefined) ?? []
	const of = (type: string) =>
		(components.find((c) => String(c.type).toLowerCase() === type)
			?.parameters as TemplateParameter[] | undefined) ?? []
	return { header: of('header'), body: of('body') }
}

export function createMessagesRouter(templateStore: TemplateStore) {
	const messagesRouter = new Hono()

	messagesRouter.post('/:phoneNumberId/messages', async (c) => {
		const { phoneNumberId } = c.req.param()
		const body = (await c.req.json().catch(() => null)) as Json | null
		if (!body) return invalidParameter(c, 'The request body is not valid JSON.')
		const from =
			c.req.header(MOCK_HEADERS.from)?.replace(/\D/g, '') || undefined

		if (body.status === 'read') return receipt(c, phoneNumberId, body, from)

		const type = String(body.type ?? 'text')
		const replyTo = (body.context as { message_id?: string } | undefined)
			?.message_id

		const number = accountStore.ensure(phoneNumberId)
		if (!accountStore.isRegistered(number)) {
			return graphError(c, {
				message: '(#133010) Account not registered',
				code: 133010,
				userMessage:
					'The number is not registered on the Cloud API (POST /{phone-number-id}/register).',
			})
		}

		if (from) {
			let payload = (body[type] as Json | undefined) ?? {}
			if (type === 'text' && !String(payload.body ?? '').trim()) {
				return invalidParameter(c, 'text.body is required.')
			}
			// The user answers a call permission request: the permission
			// changes, and the reply carries its expiry as Meta writes it.
			if (type === 'interactive' && payload.type === 'call_permission_reply') {
				const reply = (payload.call_permission_reply as Json | undefined) ?? {}
				const response = reply.response === 'reject' ? 'reject' : 'accept'
				payload = {
					type: 'call_permission_reply',
					call_permission_reply: answerPermission(
						phoneNumberId,
						from,
						response,
						reply.is_permanent === true,
						'user_action'
					),
				}
			}
			const name = c.req.header(MOCK_HEADERS.contactName)?.trim() || null
			const { message } = userWrites({
				phoneNumberId,
				from,
				name,
				type,
				payload,
				replyTo,
			})
			return c.json({
				messaging_product: 'whatsapp',
				contacts: [{ input: from, wa_id: from }],
				messages: [{ id: message.id }],
			})
		}

		const to = String(body.to ?? '')
		let content: StoredMessage['content'] = {
			...(replyTo ? { context: { message_id: replyTo } } : {}),
		}

		if (type === 'text') {
			content.text = body.text as { body: string }
		} else if (type === 'template') {
			const template = body.template as Json &
				StoredMessage['content']['template']
			const language = (template.language as { code: string }).code
			const render = renderTemplate(
				templateStore,
				String(template.name),
				language,
				templateParameters(template)
			)
			if (!render.ok) {
				// Meta refuses the send with the code of the template error. The
				// review was reported when it landed (template-review.ts).
				return c.json(
					{
						error: {
							message: render.error.message,
							type: 'OAuthException',
							code: render.error.subcode,
							error_data: {
								messaging_product: 'whatsapp',
								details: render.error.details,
								...render.error.data,
							},
							fbtrace_id: fbtrace(),
						},
					},
					400
				)
			}
			content = { ...content, template, processedTemplate: render.template }
		} else {
			content.payload = (body[type] as Json | undefined) ?? {}
		}

		// A call permission request: calling must be on, and Meta allows one
		// request per 24 hours and two per 7 days, none over a permanent one.
		const asksPermission =
			type === 'interactive' &&
			content.payload?.type === 'call_permission_request'
		if (asksPermission) {
			if (!accountStore.callingEnabled(number)) {
				return graphError(c, {
					message: '(#138000) Calling not enabled',
					code: 138000,
					userMessage: 'Calling is not enabled on this business number.',
				})
			}
			const allowed = checkPermissionRequest(
				phoneNumberId,
				to.replace(/\D/g, '')
			)
			if (!allowed.ok) {
				return graphError(c, {
					message:
						allowed.code === 138017
							? "(#138017) Call permission request can't be sent because a permanent permission already exists."
							: '(#138009) Call Permission Request Limit Hit',
					code: allowed.code,
					userMessage:
						allowed.code === 138017
							? 'The user already allows this business to call at any time.'
							: 'Too many call permission requests to this user: 1 per 24 hours and 2 per 7 days, reset by a connected call.',
				})
			}
		}

		const stored = mockStore.storeMessage({
			direction: 'out',
			phoneNumberId,
			contact: to,
			contactName: null,
			type,
			content,
		})
		broadcast({ type: 'NEW_MESSAGE', payload: toPanelMessage(stored) })
		if (asksPermission)
			recordPermissionRequest(phoneNumberId, stored.contact.replace(/\D/g, ''))

		// Delivery progression (sent → delivered → read) follows the delivery mode.
		scheduleDelivery(
			stored,
			content.template
				? {
						name: content.template.name,
						language: content.template.language.code,
						category: content.processedTemplate?.category ?? 'UTILITY',
					}
				: undefined
		)

		return c.json({
			messaging_product: 'whatsapp',
			contacts: [{ input: to, wa_id: to.replace(/\D/g, '') }],
			messages: [
				{
					id: stored.id,
					...(type === 'template' ? { message_status: 'accepted' } : {}),
				},
			],
		})
	})

	// GET /{phone-number-id}/messages[?contact=] — the conversations of the
	// number, both sides, oldest first, in the panel's shape (mock extension).
	messagesRouter.get('/:phoneNumberId/messages', (c) => {
		const phoneNumberId = c.req.param('phoneNumberId')
		const messages = mockStore.getConversation(
			phoneNumberId,
			c.req.query('contact') || undefined
		)
		return c.json({
			data: messages.map(toPanelMessage),
			paging: { cursors: { before: '', after: '' } },
		})
	})

	return messagesRouter
}
