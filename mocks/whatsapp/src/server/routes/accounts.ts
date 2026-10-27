/**
 * The accounts and numbers of the Cloud API, as Meta's onboarding runs them:
 *
 * - `GET /{business-id}/owned_whatsapp_business_accounts`: the business's WABAs;
 * - `GET`, `POST /{waba-id}/phone_numbers`: the WABA's numbers, and a new one
 *   (not verified, not registered);
 * - `POST /{phone-number-id}/request_code` and `verify_code`: the code Meta
 *   sends by SMS or voice; the mock shows it in the panel instead;
 * - `POST /{phone-number-id}/register` and `deregister`: on and off the Cloud
 *   API, with the two-step verification PIN;
 * - `GET`, `POST /{phone-number-id}/settings`: calling (and the other feature
 *   settings), one feature per call.
 */
import type { Context } from 'hono'
import { Hono } from 'hono'
import { getWebhookUrl } from '../config.ts'
import { graphError, invalidParameter, unknownObject } from '../graph-error.ts'
import { accountStore, type PhoneNumber } from '../store/account-store.ts'
import { broadcast } from '../websocket.ts'
import { phoneFields, wabaNode } from './nodes.ts'

type Json = Record<string, unknown>

const PAGING = { cursors: { before: '', after: '' } }

async function readJson(c: Context): Promise<Json | null> {
	try {
		const body = await c.req.json()
		return body && typeof body === 'object' ? (body as Json) : null
	} catch {
		return null
	}
}

/** The settings of a number as `GET /{phone-number-id}/settings` returns them. */
export function settingsOf(number: PhoneNumber): Json {
	const extra = (number.feature_settings as Json | undefined) ?? {}
	return {
		calling: { ...number.calling, ip_addresses: { default: ['127.0.0.1'] } },
		payload_encryption: { status: 'disabled' },
		storage_configuration: { status: 'default' },
		...extra,
	}
}

/** The words of the spec are lowercase; Meta's guides write them upper. */
const lower = (value: unknown) =>
	typeof value === 'string' ? value.toLowerCase() : value

function numberChanged(number: PhoneNumber): void {
	broadcast({
		type: 'ACCOUNT_UPDATE',
		payload: { kind: 'number', number: number.id },
	})
}

export function createAccountsRouter() {
	const router = new Hono()

	router.get('/:businessId/owned_whatsapp_business_accounts', (c) => {
		const { businessId } = c.req.param()
		if (!accountStore.business(businessId)) return unknownObject(c, businessId)
		return c.json({
			data: accountStore.wabas(businessId).map(wabaNode),
			paging: PAGING,
		})
	})

	router.get('/:wabaId/phone_numbers', (c) => {
		const { wabaId } = c.req.param()
		if (!accountStore.waba(wabaId)) return unknownObject(c, wabaId)
		return c.json({
			data: accountStore
				.numbers(wabaId)
				.map((number) => ({ id: number.id, ...phoneFields(number) })),
			paging: PAGING,
		})
	})

	router.post('/:wabaId/phone_numbers', async (c) => {
		const { wabaId } = c.req.param()
		if (!accountStore.waba(wabaId)) return unknownObject(c, wabaId)
		const body = await readJson(c)
		const cc = String(body?.cc ?? '').replace(/\D/g, '')
		const phone = String(body?.phone_number ?? '').replace(/\D/g, '')
		const name = String(body?.verified_name ?? '').trim()
		if (!cc || !phone || !name) {
			return invalidParameter(
				c,
				'cc, phone_number and verified_name are required.'
			)
		}
		const created = accountStore.createNumber(wabaId, {
			cc,
			phone_number: phone,
			verified_name: name,
		})
		if (!created.ok) {
			return invalidParameter(
				c,
				'This phone number is already on a WhatsApp Business Account.'
			)
		}
		numberChanged(created.number)
		return c.json({ id: created.number.id })
	})

	router.post('/:phoneNumberId/request_code', async (c) => {
		const { phoneNumberId } = c.req.param()
		const body = await readJson(c)
		const method = String(body?.code_method ?? 'SMS').toUpperCase()
		const sent = accountStore.requestCode(phoneNumberId, method)
		if (!sent.ok) return unknownObject(c, phoneNumberId)
		// Meta texts or calls the number; the mock shows the code in the panel.
		console.log(
			`📟 Verification code of ${phoneNumberId} (${method}): ${sent.code}`
		)
		broadcast({
			type: 'ACCOUNT_UPDATE',
			payload: { kind: 'code', number: phoneNumberId, method, code: sent.code },
		})
		return c.json({ success: true })
	})

	router.post('/:phoneNumberId/verify_code', async (c) => {
		const { phoneNumberId } = c.req.param()
		const body = await readJson(c)
		const verified = accountStore.verifyCode(
			phoneNumberId,
			String(body?.code ?? '')
		)
		if (verified.ok) {
			numberChanged(verified.number)
			return c.json({ success: true })
		}
		if (verified.reason === 'unknown') return unknownObject(c, phoneNumberId)
		return graphError(c, {
			message: '(#136025) Verify code error',
			code: 136025,
			userTitle: 'Code could not be verified',
			userMessage:
				verified.reason === 'no_code'
					? 'There is no code to verify: request a new one with request_code.'
					: 'The code is wrong. Check the code that was sent and try again.',
		})
	})

	router.post('/:phoneNumberId/register', async (c) => {
		const { phoneNumberId } = c.req.param()
		const body = await readJson(c)
		const pin = String(body?.pin ?? '')
		if (!/^\d{6}$/.test(pin))
			return invalidParameter(c, 'pin must be six digits.')
		const done = accountStore.register(phoneNumberId, pin)
		if (done.ok) {
			numberChanged(done.number)
			return c.json({ success: true })
		}
		if (done.reason === 'unknown') return unknownObject(c, phoneNumberId)
		if (done.reason === 'pin_mismatch') {
			return graphError(c, {
				message: '(#133005) Two step verification PIN Mismatch',
				code: 133005,
				userMessage:
					'The PIN is not the two-step verification PIN of this number.',
			})
		}
		return invalidParameter(
			c,
			'The number must be verified (request_code, then verify_code) before it is registered.'
		)
	})

	router.post('/:phoneNumberId/deregister', (c) => {
		const { phoneNumberId } = c.req.param()
		const done = accountStore.deregister(phoneNumberId)
		if (!done.ok) return unknownObject(c, phoneNumberId)
		numberChanged(done.number)
		return c.json({ success: true })
	})

	router.get('/:phoneNumberId/settings', (c) => {
		const { phoneNumberId } = c.req.param()
		return c.json(settingsOf(accountStore.ensure(phoneNumberId)))
	})

	router.post('/:phoneNumberId/settings', async (c) => {
		const { phoneNumberId } = c.req.param()
		const body = await readJson(c)
		if (!body) return invalidParameter(c, 'The request body is not valid JSON.')
		const number = accountStore.ensure(phoneNumberId)
		const calling = body.calling as Json | undefined
		if (!calling) {
			// One feature per call: user identity change, encryption, storage.
			const [feature] = Object.keys(body)
			const saved = accountStore.patch(phoneNumberId, {
				feature_settings: {
					...((number.feature_settings as Json | undefined) ?? {}),
					[feature]: body[feature],
				},
			})
			numberChanged(saved)
			return c.json({ success: true })
		}
		const next = {
			...number.calling,
			...calling,
			...(calling.status ? { status: lower(calling.status) } : {}),
			...(calling.call_icon_visibility
				? { call_icon_visibility: lower(calling.call_icon_visibility) }
				: {}),
			...(calling.callback_permission_status
				? {
						callback_permission_status: lower(
							calling.callback_permission_status
						),
					}
				: {}),
		} as PhoneNumber['calling']
		if (next.status === 'enabled' && number.calling.status !== 'enabled') {
			// Meta enables calling on a number on the Cloud API whose app hears
			// the calls webhook field (or that has SIP).
			const sip = lower((next.sip as Json | undefined)?.status) === 'enabled'
			if (
				!accountStore.isRegistered(number) ||
				(!sip && !getWebhookUrl(phoneNumberId))
			) {
				return graphError(c, {
					message:
						'(#138018) WhatsApp Business calling cannot be enabled because technical pre-requisites are not met.',
					code: 138018,
					userMessage: accountStore.isRegistered(number)
						? 'Subscribe an app to the calls webhook field (point a webhook at this number) or configure SIP.'
						: 'Register the number on the Cloud API first.',
				})
			}
		}
		const saved = accountStore.patch(phoneNumberId, { calling: next })
		numberChanged(saved)
		return c.json({ success: true })
	})

	return router
}

/**
 * What Meta has no call for, under `/settings`: the whole tree of accounts
 * for the panel (with the code a number is waiting for, which Meta would
 * text), a new WABA (Meta makes it in the embedded signup), and the calls.
 */
export function createAccountsSettingsRouter() {
	const router = new Hono()

	router.get('/accounts', (c) =>
		c.json({
			businesses: accountStore.businesses().map((business) => ({
				...business,
				wabas: accountStore.wabas(business.id).map((waba) => ({
					...wabaNode(waba),
					phone_numbers: accountStore.numbers(waba.id).map((number) => ({
						id: number.id,
						...phoneFields(number),
						calling: number.calling,
						webhook: getWebhookUrl(number.id) ?? null,
						pending_code:
							number.pending_code && number.pending_code.expires_at > Date.now()
								? {
										code: number.pending_code.code,
										method: number.pending_code.method,
									}
								: null,
						has_pin: !!number.pin,
					})),
				})),
			})),
		})
	)

	router.post('/accounts/wabas', async (c) => {
		const body = await readJson(c)
		const businessId = String(body?.business_id ?? '')
		const name = String(body?.name ?? '').trim()
		if (!accountStore.business(businessId)) return unknownObject(c, businessId)
		if (!name) return invalidParameter(c, 'name is required.')
		const waba = accountStore.createWaba(businessId, name)
		broadcast({
			type: 'ACCOUNT_UPDATE',
			payload: { kind: 'waba', waba: waba.id },
		})
		return c.json(wabaNode(waba))
	})

	return router
}
