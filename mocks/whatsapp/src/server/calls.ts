/**
 * Voice calls between a business number and a user (Meta's Calling API).
 *
 * The media is real WebRTC: the SDP offer and answer travel through the Cloud
 * API calls and webhooks exactly as on Meta, and the two ends (the
 * application and the panel, which plays the user's phone) connect to each
 * other. The mock keeps what Meta keeps: the call, its state, and the user's
 * permission to be called.
 *
 * - The user calls (the panel, `POST /{phone}/calls` with `X-Mock-From` and
 *   `action: connect`): the application hears `calls` / `connect` with the
 *   offer, answers `pre_accept` / `accept` with its SDP answer, or `reject`.
 * - The business calls (`action: connect`, `to`, the offer): the number must
 *   be on the Cloud API with calling enabled and the user must have granted
 *   permission (138000, 138006 otherwise). The user's phone rings; the
 *   application hears `statuses` RINGING, then ACCEPTED with `calls` /
 *   `connect` and the answer, or REJECTED.
 * - Either side ends it (`terminate`); the application hears `calls` /
 *   `terminate` with COMPLETED and, when it was answered, the duration.
 * - A call nobody answers ends after the ring time (Meta: 30 to 60 s).
 */
import { randomBytes } from 'node:crypto'
import { getWebhookUrl } from './config.ts'
import { accountStore, type PhoneNumber } from './store/account-store.ts'
import { mockStore } from './store/mock-store.ts'
import type { WebhookPayload } from './types/api-types.ts'
import { redactUrl, sendWebhook } from './webhook-target.ts'
import { broadcast } from './websocket.ts'

export type CallDirection = 'USER_INITIATED' | 'BUSINESS_INITIATED'
export type CallState = 'ringing' | 'pre_accepted' | 'active' | 'ended'
export type CallEnd = 'completed' | 'rejected' | 'unanswered' | 'failed'

export interface Call {
	id: string
	phoneNumberId: string
	contact: string
	contactName: string | null
	direction: CallDirection
	state: CallState
	/** The offer of whoever called; the answer of whoever picked up. */
	offer: string
	answer: string | null
	bizOpaqueCallbackData: string | null
	createdAt: number
	startTime: number | null
	endTime: number | null
	endReason: CallEnd | null
	endedBy: 'user' | 'business' | 'timeout' | null
}

export interface CallPermission {
	status: 'no_permission' | 'temporary' | 'permanent'
	/** When a temporary permission ends, in ms. */
	expiresAt: number | null
	/** When the business sent call permission requests, in ms. */
	requests: number[]
	/** When the business started calls to the user, in ms. */
	calls: number[]
	/** Business calls in a row the user did not answer (4 revoke the permission). */
	unanswered: number
}

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
/** A temporary permission lasts 7 days from the user's approval. */
const TEMPORARY_PERMISSION_MS = 7 * DAY
/** Permission requests: 1 per 24 hours, 2 per 7 days. */
const REQUESTS_PER_DAY = 1
const REQUESTS_PER_WEEK = 2
/** Calls the business may start to a user per 24 hours. */
const CALLS_PER_DAY = 100

let ringMs = Number(process.env.WHAP_CALL_RING_MS ?? 60_000)

/** How long a call rings before it ends unanswered (tests shorten it). */
export function setRingTimeoutMs(ms: number): void {
	ringMs = ms
}

/* ---------- persistence ---------- */

function saveCall(call: Call): void {
	mockStore.db
		.query(
			`INSERT INTO calls (id, phone_number_id, contact, created_at, data) VALUES (?, ?, ?, ?, ?)
			 ON CONFLICT (id) DO UPDATE SET data = excluded.data`
		)
		.run(
			call.id,
			call.phoneNumberId,
			call.contact,
			new Date(call.createdAt).toISOString(),
			JSON.stringify(call)
		)
}

export function getCall(id: string): Call | undefined {
	const row = mockStore.db
		.query<{ data: string }, [string]>('SELECT data FROM calls WHERE id = ?')
		.get(id)
	return row ? (JSON.parse(row.data) as Call) : undefined
}

/** Every call, newest first, for the panel. */
export function listCalls(limit = 500): Call[] {
	return mockStore.db
		.query<{ data: string }, [number]>(
			'SELECT data FROM calls ORDER BY created_at DESC LIMIT ?'
		)
		.all(limit)
		.map((row) => JSON.parse(row.data) as Call)
}

function activeCallWith(
	phoneNumberId: string,
	contact: string
): Call | undefined {
	return mockStore.db
		.query<{ data: string }, [string, string]>(
			'SELECT data FROM calls WHERE phone_number_id = ? AND contact = ? ORDER BY created_at DESC LIMIT 5'
		)
		.all(phoneNumberId, contact)
		.map((row) => JSON.parse(row.data) as Call)
		.find((call) => call.state !== 'ended')
}

function readPermission(
	phoneNumberId: string,
	contact: string
): CallPermission {
	const row = mockStore.db
		.query<{ data: string }, [string, string]>(
			'SELECT data FROM call_permissions WHERE phone_number_id = ? AND contact = ?'
		)
		.get(phoneNumberId, contact)
	const permission: CallPermission = row
		? (JSON.parse(row.data) as CallPermission)
		: {
				status: 'no_permission',
				expiresAt: null,
				requests: [],
				calls: [],
				unanswered: 0,
			}
	if (
		permission.status === 'temporary' &&
		permission.expiresAt !== null &&
		permission.expiresAt < Date.now()
	) {
		return { ...permission, status: 'no_permission', expiresAt: null }
	}
	return permission
}

function savePermission(
	phoneNumberId: string,
	contact: string,
	permission: CallPermission
): void {
	mockStore.db
		.query(
			`INSERT INTO call_permissions (phone_number_id, contact, data) VALUES (?, ?, ?)
			 ON CONFLICT (phone_number_id, contact) DO UPDATE SET data = excluded.data`
		)
		.run(phoneNumberId, contact, JSON.stringify(permission))
}

/** Forget every call and permission (tests). */
export function clearCalls(): void {
	for (const timer of timers.values()) clearTimeout(timer)
	timers.clear()
	mockStore.db.exec('DELETE FROM calls')
	mockStore.db.exec('DELETE FROM call_permissions')
}

/** A call the mock was running when it stopped cannot go on: it ended. */
export function closeStaleCalls(): void {
	for (const call of listCalls()) {
		if (call.state === 'ended') continue
		saveCall({
			...call,
			state: 'ended',
			endTime: Date.now(),
			endReason: call.startTime ? 'completed' : 'failed',
			endedBy: null,
		})
	}
}

/* ---------- permissions ---------- */

const within = (times: number[], ms: number) =>
	times.filter((t) => t > Date.now() - ms)

/** `GET /{phone-number-id}/call_permissions?user_wa_id=`, as Meta answers it. */
export function permissionView(phoneNumberId: string, contact: string) {
	const p = readPermission(phoneNumberId, contact)
	const day = within(p.requests, DAY)
	const week = within(p.requests, 7 * DAY)
	const calls = within(p.calls, DAY)
	const limit = (period: string, max: number, used: number[], ms: number) => ({
		time_period: period,
		max_allowed: max,
		current_usage: used.length,
		...(used.length >= max
			? { limit_expiration_time: Math.floor((Math.min(...used) + ms) / 1000) }
			: {}),
	})
	return {
		messaging_product: 'whatsapp',
		permission: {
			status: p.status,
			...(p.status === 'temporary' && p.expiresAt
				? { expiration_time: Math.floor(p.expiresAt / 1000) }
				: {}),
		},
		actions: [
			{
				action_name: 'send_call_permission_request',
				can_perform_action:
					p.status !== 'permanent' &&
					day.length < REQUESTS_PER_DAY &&
					week.length < REQUESTS_PER_WEEK,
				limits: [
					limit('PT24H', REQUESTS_PER_DAY, day, DAY),
					limit('P7D', REQUESTS_PER_WEEK, week, 7 * DAY),
				],
			},
			{
				action_name: 'start_call',
				can_perform_action:
					p.status !== 'no_permission' && calls.length < CALLS_PER_DAY,
				limits: [limit('PT24H', CALLS_PER_DAY, calls, DAY)],
			},
		],
	}
}

export type RequestCheck = { ok: true } | { ok: false; code: 138009 | 138017 }

/** Whether the business may send a call permission request now. */
export function checkPermissionRequest(
	phoneNumberId: string,
	contact: string
): RequestCheck {
	const p = readPermission(phoneNumberId, contact)
	if (p.status === 'permanent') return { ok: false, code: 138017 }
	if (
		within(p.requests, DAY).length >= REQUESTS_PER_DAY ||
		within(p.requests, 7 * DAY).length >= REQUESTS_PER_WEEK
	) {
		return { ok: false, code: 138009 }
	}
	return { ok: true }
}

export function recordPermissionRequest(
	phoneNumberId: string,
	contact: string
): void {
	const p = readPermission(phoneNumberId, contact)
	savePermission(phoneNumberId, contact, {
		...p,
		requests: [...p.requests, Date.now()],
	})
}

/**
 * The user answers a permission request (or calls the business, which
 * grants it on its own when callback permission is on). Returns the reply
 * as the webhook carries it.
 */
export function answerPermission(
	phoneNumberId: string,
	contact: string,
	response: 'accept' | 'reject',
	permanent: boolean,
	source: 'user_action' | 'automatic'
): Record<string, unknown> {
	const p = readPermission(phoneNumberId, contact)
	const expiresAt = Date.now() + TEMPORARY_PERMISSION_MS
	const granted: CallPermission =
		response === 'accept'
			? {
					...p,
					status: permanent ? 'permanent' : 'temporary',
					expiresAt: permanent ? null : expiresAt,
					unanswered: 0,
				}
			: { ...p, status: 'no_permission', expiresAt: null }
	savePermission(phoneNumberId, contact, granted)
	broadcast({
		type: 'CALL_UPDATE',
		payload: { kind: 'permission', phoneNumberId, contact },
	})
	return {
		response,
		is_permanent: response === 'accept' && permanent,
		...(response === 'accept' && !permanent
			? { expiration_timestamp: String(Math.floor(expiresAt / 1000)) }
			: {}),
		response_source: source,
	}
}

export function permissionStatus(phoneNumberId: string, contact: string) {
	return readPermission(phoneNumberId, contact).status
}

/* ---------- webhooks ---------- */

const seconds = (ms: number) => String(Math.floor(ms / 1000))
const digits = (number: PhoneNumber) =>
	number.display_phone_number.replace(/\D/g, '')

function envelope(
	number: PhoneNumber,
	call: Call,
	value: Record<string, unknown>
): WebhookPayload {
	return {
		object: 'whatsapp_business_account',
		entry: [
			{
				id: number.waba_id,
				changes: [
					{
						value: {
							messaging_product: 'whatsapp',
							metadata: {
								display_phone_number: digits(number),
								phone_number_id: number.id,
							},
							contacts: [
								{
									profile: { name: call.contactName ?? `User ${call.contact}` },
									wa_id: call.contact,
								},
							],
							...value,
						},
						field: 'calls',
					},
				],
			},
		],
	} as unknown as WebhookPayload
}

/** The ends of the call as Meta writes them: who called whom. */
function ends(number: PhoneNumber, call: Call) {
	return call.direction === 'USER_INITIATED'
		? { from: call.contact, to: digits(number) }
		: { from: digits(number), to: call.contact }
}

function deliver(
	number: PhoneNumber,
	payload: WebhookPayload,
	what: string
): void {
	const url = getWebhookUrl(number.id)
	if (!url) return
	console.log(`📞 Call ${what} to ${redactUrl(url)}`)
	sendWebhook(url, payload).catch((error) => {
		console.error(`❌ Call webhook failed: ${error.message}`)
	})
}

function connectWebhook(
	number: PhoneNumber,
	call: Call,
	sdpType: 'offer' | 'answer',
	sdp: string
) {
	deliver(
		number,
		envelope(number, call, {
			calls: [
				{
					id: call.id,
					...ends(number, call),
					event: 'connect',
					timestamp: seconds(Date.now()),
					direction: call.direction,
					session: { sdp_type: sdpType, sdp },
					...(call.bizOpaqueCallbackData
						? { biz_opaque_callback_data: call.bizOpaqueCallbackData }
						: {}),
				},
			],
		}),
		'connect'
	)
}

function statusWebhook(
	number: PhoneNumber,
	call: Call,
	status: 'RINGING' | 'ACCEPTED' | 'REJECTED'
) {
	deliver(
		number,
		envelope(number, call, {
			statuses: [
				{
					id: call.id,
					timestamp: seconds(Date.now()),
					type: 'call',
					status,
					recipient_id: call.contact,
					...(call.bizOpaqueCallbackData
						? { biz_opaque_callback_data: call.bizOpaqueCallbackData }
						: {}),
				},
			],
		}),
		status.toLowerCase()
	)
}

function terminateWebhook(number: PhoneNumber, call: Call) {
	const answered = call.startTime !== null && call.endTime !== null
	deliver(
		number,
		envelope(number, call, {
			calls: [
				{
					id: call.id,
					...ends(number, call),
					event: 'terminate',
					timestamp: seconds(call.endTime ?? Date.now()),
					direction: call.direction,
					status: call.endReason === 'failed' ? 'FAILED' : 'COMPLETED',
					...(answered && call.startTime && call.endTime
						? {
								start_time: seconds(call.startTime),
								end_time: seconds(call.endTime),
								duration: Math.round((call.endTime - call.startTime) / 1000),
							}
						: {}),
					...(call.bizOpaqueCallbackData
						? { biz_opaque_callback_data: call.bizOpaqueCallbackData }
						: {}),
				},
			],
		}),
		'terminate'
	)
}

/* ---------- the call ---------- */

const timers = new Map<string, ReturnType<typeof setTimeout>>()

function tell(call: Call): void {
	broadcast({ type: 'CALL_UPDATE', payload: { kind: 'call', call } })
}

function newCallId(): string {
	return `wacid.${randomBytes(24).toString('base64url')}`
}

/** A user's display name, from the conversation when the mock knows it. */
function knownName(phoneNumberId: string, contact: string): string | null {
	const last = mockStore
		.getConversation(phoneNumberId, contact)
		.filter((m) => m.contactName)
		.pop()
	return last?.contactName ?? null
}

/**
 * Ring until someone answers. A call that is not answered in time ends
 * unanswered, as Meta ends it (the caller sees "Not answered").
 */
function ring(call: Call): void {
	const timer = setTimeout(() => {
		timers.delete(call.id)
		const now = getCall(call.id)
		if (now && (now.state === 'ringing' || now.state === 'pre_accepted')) {
			finish(now, 'unanswered', 'timeout')
		}
	}, ringMs)
	timers.set(call.id, timer)
}

function stopRinging(id: string): void {
	const timer = timers.get(id)
	if (timer) clearTimeout(timer)
	timers.delete(id)
}

/** The call ends: Meta's terminate webhook, the panel told. */
function finish(call: Call, reason: CallEnd, by: Call['endedBy']): Call {
	stopRinging(call.id)
	const ended: Call = {
		...call,
		state: 'ended',
		endTime: Date.now(),
		endReason: reason,
		endedBy: by,
	}
	saveCall(ended)
	tell(ended)
	const number = accountStore.ensure(call.phoneNumberId)
	if (call.direction === 'BUSINESS_INITIATED') {
		const p = readPermission(call.phoneNumberId, call.contact)
		if (reason === 'unanswered' || reason === 'rejected') {
			// Four business calls in a row left unanswered revoke the permission.
			const unanswered = p.unanswered + 1
			savePermission(call.phoneNumberId, call.contact, {
				...p,
				unanswered,
				...(unanswered >= 4
					? { status: 'no_permission', expiresAt: null }
					: {}),
			})
		}
	}
	terminateWebhook(number, ended)
	return ended
}

/** A connected call resets the permission request limits and the unanswered count. */
function connected(call: Call): void {
	const p = readPermission(call.phoneNumberId, call.contact)
	savePermission(call.phoneNumberId, call.contact, {
		...p,
		requests: [],
		unanswered: 0,
	})
}

export type CallFailure = { code: number; message: string; userMessage: string }
export type CallResult =
	| { ok: true; call: Call }
	| { ok: false; failure: CallFailure }

const fail = (
	code: number,
	message: string,
	userMessage: string
): CallResult => ({
	ok: false,
	failure: { code, message, userMessage },
})

/** What stops a number from calling or being called. */
function numberProblem(number: PhoneNumber): CallResult | null {
	if (!accountStore.isRegistered(number)) {
		return fail(
			133010,
			'(#133010) Account not registered',
			'The number is not registered on the Cloud API.'
		)
	}
	if (!accountStore.callingEnabled(number)) {
		return fail(
			138000,
			'(#138000) Calling not enabled',
			'Calling is not enabled on this business number (POST /{phone-number-id}/settings).'
		)
	}
	return null
}

/** The user calls the business: the application hears the offer. */
export function userCalls(
	phoneNumberId: string,
	from: string,
	name: string | null,
	offer: string
): CallResult {
	const number = accountStore.ensure(phoneNumberId)
	const problem = numberProblem(number)
	if (problem) return problem
	if (activeCallWith(phoneNumberId, from)) {
		return fail(
			138003,
			'(#138003) Duplicate call',
			'A call with this user is already going on.'
		)
	}
	const call: Call = {
		id: newCallId(),
		phoneNumberId,
		contact: from,
		contactName: name ?? knownName(phoneNumberId, from),
		direction: 'USER_INITIATED',
		state: 'ringing',
		offer,
		answer: null,
		bizOpaqueCallbackData: null,
		createdAt: Date.now(),
		startTime: null,
		endTime: null,
		endReason: null,
		endedBy: null,
	}
	saveCall(call)
	tell(call)
	connectWebhook(number, call, 'offer', offer)
	// Calling the business grants it permission to call back, when it asks so.
	if (
		String(number.calling.callback_permission_status).toLowerCase() ===
		'enabled'
	) {
		answerPermission(phoneNumberId, from, 'accept', false, 'automatic')
	}
	ring(call)
	return { ok: true, call }
}

/** The business calls the user: permission, limits, then the user's phone rings. */
export function businessCalls(
	phoneNumberId: string,
	to: string,
	offer: string,
	opaque: string | null
): CallResult {
	const number = accountStore.ensure(phoneNumberId)
	const problem = numberProblem(number)
	if (problem) return problem
	const permission = readPermission(phoneNumberId, to)
	if (permission.status === 'no_permission') {
		return fail(
			138006,
			'(#138006) No approved call permission found',
			'The user has not granted this business number permission to call.'
		)
	}
	if (within(permission.calls, DAY).length >= CALLS_PER_DAY) {
		return fail(
			138012,
			'(#138012) Business Initiated Calls Limit Hit',
			'The 24-hour limit of business-initiated calls to this user was reached.'
		)
	}
	if (activeCallWith(phoneNumberId, to)) {
		return fail(
			138003,
			'(#138003) Duplicate call',
			'A call with this user is already going on.'
		)
	}
	savePermission(phoneNumberId, to, {
		...permission,
		calls: [...permission.calls, Date.now()],
	})
	const call: Call = {
		id: newCallId(),
		phoneNumberId,
		contact: to,
		contactName: knownName(phoneNumberId, to),
		direction: 'BUSINESS_INITIATED',
		state: 'ringing',
		offer,
		answer: null,
		bizOpaqueCallbackData: opaque,
		createdAt: Date.now(),
		startTime: null,
		endTime: null,
		endReason: null,
		endedBy: null,
	}
	saveCall(call)
	tell(call)
	statusWebhook(number, call, 'RINGING')
	ring(call)
	return { ok: true, call }
}

const unknownCall = () =>
	fail(
		100,
		'(#100) Invalid parameter',
		'call_id is not a call of this business number.'
	)
const over = () =>
	fail(100, '(#100) Invalid parameter', 'The call has already ended.')

/**
 * The business acts on a call: pre_accept / accept (with its answer) or
 * reject a user's call, or terminate any call.
 */
export function businessActs(
	phoneNumberId: string,
	callId: string,
	action: 'pre_accept' | 'accept' | 'reject' | 'terminate',
	answer: string | null,
	opaque: string | null
): CallResult {
	const call = getCall(callId)
	if (!call || call.phoneNumberId !== phoneNumberId) return unknownCall()
	if (call.state === 'ended') return over()
	if (action === 'terminate')
		return { ok: true, call: finish(call, 'completed', 'business') }
	if (call.direction !== 'USER_INITIATED') {
		return fail(
			100,
			'(#100) Invalid parameter',
			`${action} answers a call the user made; this call was made by the business.`
		)
	}
	if (action === 'reject') {
		if (call.state === 'active')
			return fail(
				100,
				'(#100) Invalid parameter',
				'The call is already in progress.'
			)
		return { ok: true, call: finish(call, 'rejected', 'business') }
	}
	if (call.state === 'active')
		return fail(
			100,
			'(#100) Invalid parameter',
			'The call is already in progress.'
		)
	if (!answer)
		return fail(
			100,
			'(#100) Invalid parameter',
			'session with sdp_type answer is required.'
		)
	if (call.state === 'pre_accepted' && call.answer && call.answer !== answer) {
		return fail(
			100,
			'(#100) Invalid parameter',
			'The SDP answer of accept differs from the one sent in pre_accept for this call.'
		)
	}
	const next: Call =
		action === 'pre_accept'
			? { ...call, state: 'pre_accepted', answer }
			: {
					...call,
					state: 'active',
					answer,
					startTime: Date.now(),
					bizOpaqueCallbackData: opaque ?? call.bizOpaqueCallbackData,
				}
	if (action === 'accept') {
		stopRinging(call.id)
		connected(next)
	}
	saveCall(next)
	tell(next)
	return { ok: true, call: next }
}

/** The user's phone acts: accept (with its answer) or reject a business call, or hang up. */
export function userActs(
	phoneNumberId: string,
	from: string,
	callId: string,
	action: 'accept' | 'reject' | 'terminate',
	answer: string | null
): CallResult {
	const call = getCall(callId)
	if (!call || call.phoneNumberId !== phoneNumberId || call.contact !== from)
		return unknownCall()
	if (call.state === 'ended') return over()
	const number = accountStore.ensure(phoneNumberId)
	if (action === 'terminate')
		return { ok: true, call: finish(call, 'completed', 'user') }
	if (call.direction !== 'BUSINESS_INITIATED' || call.state !== 'ringing') {
		return fail(
			100,
			'(#100) Invalid parameter',
			'Only a business call that is ringing can be accepted or rejected.'
		)
	}
	if (action === 'reject') {
		statusWebhook(number, call, 'REJECTED')
		return { ok: true, call: finish(call, 'rejected', 'user') }
	}
	if (!answer)
		return fail(
			100,
			'(#100) Invalid parameter',
			'session with sdp_type answer is required.'
		)
	stopRinging(call.id)
	const active: Call = {
		...call,
		state: 'active',
		answer,
		startTime: Date.now(),
	}
	saveCall(active)
	tell(active)
	connected(active)
	connectWebhook(number, active, 'answer', answer)
	statusWebhook(number, active, 'ACCEPTED')
	return { ok: true, call: active }
}

/** An SDP Meta would take: RFC 8866 text with an audio section. */
export function isSdp(sdp: unknown): sdp is string {
	return (
		typeof sdp === 'string' &&
		sdp.trimStart().startsWith('v=0') &&
		sdp.includes('m=audio')
	)
}
