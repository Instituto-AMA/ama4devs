/**
 * The accounts the mock plays, arranged as Meta arranges them: a business
 * owns WhatsApp Business Accounts (WABAs), a WABA owns phone numbers.
 *
 * A number is born the way Meta's onboarding makes it: created on a WABA
 * (`POST /{waba-id}/phone_numbers`), not verified, not on the Cloud API. The
 * code Meta would send by SMS or voice (`request_code`) is shown in the
 * panel; `verify_code` checks it; `register` (with the two-step PIN) puts the
 * number on the Cloud API (`status: CONNECTED`, `platform_type: CLOUD_API`).
 * Calling is a setting of the number (`POST /{phone-number-id}/settings`).
 *
 * The mock boots configured: the default business, its WABA and the default
 * number, registered with calling enabled, plus every number of the
 * configuration file. A number the mock has never seen that a call uses
 * joins the default WABA registered, so an application pointed at any id
 * keeps working; its calling starts disabled, as on Meta.
 */
import type { Database } from 'bun:sqlite'
import { randomInt } from 'node:crypto'
import { MOCK_IDS } from '../../graph/nodes.ts'
import { getPhoneNumbersConfig } from '../configuration.ts'
import { mockStore } from './mock-store.ts'

/** The calling settings of a number, in the words of the v23 spec (lowercase). */
export interface CallingSettings {
	status: 'enabled' | 'disabled'
	call_icon_visibility: 'visible' | 'hidden'
	callback_permission_status: 'enabled' | 'disabled'
	/** call_hours, sip, video, srtp_key_exchange_protocol… as the call set them. */
	[key: string]: unknown
}

export interface PhoneNumber {
	id: string
	waba_id: string
	display_phone_number: string
	verified_name: string
	/** CONNECTED once registered on the Cloud API. */
	status: 'PENDING' | 'CONNECTED' | 'DISCONNECTED'
	platform_type: 'CLOUD_API' | 'NOT_APPLICABLE'
	code_verification_status: 'NOT_VERIFIED' | 'VERIFIED' | 'EXPIRED'
	quality_rating: string
	calling: CallingSettings
	/** The code request_code sent, until verify_code reads it. */
	pending_code?: { code: string; method: string; expires_at: number }
	/** The two-step verification PIN set by the first register. */
	pin?: string
	/** What else `POST /{phone-number-id}` told it (display name, username…). */
	[key: string]: unknown
}

export interface Waba {
	id: string
	business_id: string
	name: string
	currency: string
	timezone_id: string
	message_template_namespace: string
}

export interface Business {
	id: string
	name: string
}

/** The number the panel and the reference use, seeded on every boot. */
export const DEFAULT_PHONE_NUMBER_ID =
	process.env.MOCK_PHONE_NUMBER_ID ?? '1234567890'

/** How long a verification code is good for. */
const CODE_TTL_MS = 10 * 60 * 1000

const CALLING_OFF: CallingSettings = {
	status: 'disabled',
	call_icon_visibility: 'visible',
	callback_permission_status: 'disabled',
}

const CALLING_ON: CallingSettings = {
	status: 'enabled',
	call_icon_visibility: 'visible',
	callback_permission_status: 'enabled',
}

/** A number as it stands right after register: on the Cloud API, verified. */
function registered(
	id: string,
	wabaId: string,
	display: string,
	calling: CallingSettings
): PhoneNumber {
	return {
		id,
		waba_id: wabaId,
		display_phone_number: display,
		verified_name: 'Mock WhatsApp Business',
		status: 'CONNECTED',
		platform_type: 'CLOUD_API',
		code_verification_status: 'VERIFIED',
		quality_rating: 'GREEN',
		calling,
	}
}

/** The number as WhatsApp writes it: +55 11 97777-6666 for Brazil, grouped digits elsewhere. */
function displayOf(cc: string, national: string): string {
	if (cc === '55' && /^\d{10,11}$/.test(national)) {
		const area = national.slice(0, 2)
		const local = national.slice(2)
		return `+55 ${area} ${local.slice(0, -4)}-${local.slice(-4)}`
	}
	return `+${cc} ${national}`
}

/** Sixteen digits, the shape of Meta's ids. */
function newId(): string {
	return `${randomInt(1, 10)}${String(randomInt(0, 10 ** 7)).padStart(7, '0')}${String(randomInt(0, 10 ** 8)).padStart(8, '0')}`
}

export type NumberResult =
	| { ok: true; number: PhoneNumber }
	| {
			ok: false
			reason:
				| 'unknown'
				| 'duplicate'
				| 'no_code'
				| 'wrong_code'
				| 'not_verified'
				| 'pin_mismatch'
	  }

export class AccountStore {
	constructor(private readonly db: Database) {}

	/** The default business, WABA and number, and the configured numbers. */
	seed(): void {
		this.db
			.query('INSERT OR IGNORE INTO businesses (id, data) VALUES (?, ?)')
			.run(
				MOCK_IDS.business,
				JSON.stringify({ id: MOCK_IDS.business, name: 'Mock Business' })
			)
		this.db
			.query(
				'INSERT OR IGNORE INTO wabas (id, business_id, data) VALUES (?, ?, ?)'
			)
			.run(
				MOCK_IDS.waba,
				MOCK_IDS.business,
				JSON.stringify({
					id: MOCK_IDS.waba,
					business_id: MOCK_IDS.business,
					name: 'Mock WhatsApp Business Account',
					currency: 'BRL',
					timezone_id: '25',
					message_template_namespace: 'mock_namespace',
				} satisfies Waba)
			)
		const configured = getPhoneNumbersConfig() ?? {}
		const seeds: Array<[string, string]> = [
			[DEFAULT_PHONE_NUMBER_ID, DEFAULT_PHONE_NUMBER_ID],
			...Object.entries(configured).map(
				([id, value]) => [id, value.displayPhoneNumber] as [string, string]
			),
		]
		for (const [id, display] of seeds) {
			// Seeded once: what a person changes afterwards stays changed.
			if (this.row(id)) continue
			this.save(registered(id, MOCK_IDS.waba, display, { ...CALLING_ON }))
		}
	}

	businesses(): Business[] {
		return this.db
			.query<{ data: string }, []>('SELECT data FROM businesses ORDER BY id')
			.all()
			.map((row) => JSON.parse(row.data) as Business)
	}

	business(id: string): Business | undefined {
		const row = this.db
			.query<{ data: string }, [string]>(
				'SELECT data FROM businesses WHERE id = ?'
			)
			.get(id)
		return row ? (JSON.parse(row.data) as Business) : undefined
	}

	wabas(businessId?: string): Waba[] {
		const rows = businessId
			? this.db
					.query<{ data: string }, [string]>(
						'SELECT data FROM wabas WHERE business_id = ? ORDER BY id'
					)
					.all(businessId)
			: this.db
					.query<{ data: string }, []>('SELECT data FROM wabas ORDER BY id')
					.all()
		return rows.map((row) => JSON.parse(row.data) as Waba)
	}

	waba(id: string): Waba | undefined {
		const row = this.db
			.query<{ data: string }, [string]>('SELECT data FROM wabas WHERE id = ?')
			.get(id)
		return row ? (JSON.parse(row.data) as Waba) : undefined
	}

	/** A new WABA on a business (Meta makes it in the onboarding; the panel here). */
	createWaba(businessId: string, name: string): Waba {
		const waba: Waba = {
			id: newId(),
			business_id: businessId,
			name,
			currency: 'BRL',
			timezone_id: '25',
			message_template_namespace: `mock_${newId().slice(0, 8)}`,
		}
		this.saveWaba(waba)
		return waba
	}

	saveWaba(waba: Waba): void {
		this.db
			.query(
				`INSERT INTO wabas (id, business_id, data) VALUES (?, ?, ?)
				 ON CONFLICT (id) DO UPDATE SET business_id = excluded.business_id, data = excluded.data`
			)
			.run(waba.id, waba.business_id, JSON.stringify(waba))
	}

	private row(id: string): Record<string, unknown> | undefined {
		const row = this.db
			.query<{ data: string }, [string]>(
				'SELECT data FROM phone_numbers WHERE id = ?'
			)
			.get(id)
		return row ? (JSON.parse(row.data) as Record<string, unknown>) : undefined
	}

	/**
	 * A number by id. A row written before the accounts existed (only what
	 * `POST /{phone-number-id}` said) reads as a registered number of the
	 * default WABA.
	 */
	number(id: string): PhoneNumber | undefined {
		const row = this.row(id)
		if (!row) return undefined
		if (typeof row.waba_id === 'string') return row as PhoneNumber
		return {
			...registered(id, MOCK_IDS.waba, id, { ...CALLING_OFF }),
			...row,
		}
	}

	numbers(wabaId?: string): PhoneNumber[] {
		const ids = this.db
			.query<{ id: string }, []>('SELECT id FROM phone_numbers ORDER BY id')
			.all()
			.map((row) => row.id)
		return ids
			.map((id) => this.number(id))
			.filter((n): n is PhoneNumber => !!n && (!wabaId || n.waba_id === wabaId))
	}

	save(number: PhoneNumber): void {
		this.db
			.query(
				'INSERT INTO phone_numbers (id, data) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET data = excluded.data'
			)
			.run(number.id, JSON.stringify(number))
	}

	/** The number a call names; an unseen id joins the default WABA, registered. */
	ensure(id: string): PhoneNumber {
		const known = this.number(id)
		if (known) return known
		const joined = registered(id, MOCK_IDS.waba, id, { ...CALLING_OFF })
		this.save(joined)
		return joined
	}

	/** Merge what `POST /{phone-number-id}` or the settings call told the number. */
	patch(id: string, fields: Record<string, unknown>): PhoneNumber {
		const number = { ...this.ensure(id), ...fields } as PhoneNumber
		this.save(number)
		return number
	}

	/** `POST /{waba-id}/phone_numbers`: a new number, not verified, not registered. */
	createNumber(
		wabaId: string,
		input: { cc: string; phone_number: string; verified_name: string }
	): NumberResult {
		const digits = `${input.cc}${input.phone_number}`.replace(/\D/g, '')
		const taken = this.numbers().some(
			(n) => n.display_phone_number.replace(/\D/g, '') === digits
		)
		if (taken) return { ok: false, reason: 'duplicate' }
		const number: PhoneNumber = {
			id: newId(),
			waba_id: wabaId,
			display_phone_number: displayOf(input.cc, input.phone_number),
			verified_name: input.verified_name,
			status: 'PENDING',
			platform_type: 'NOT_APPLICABLE',
			code_verification_status: 'NOT_VERIFIED',
			quality_rating: 'UNKNOWN',
			calling: { ...CALLING_OFF },
		}
		this.save(number)
		return { ok: true, number }
	}

	/** `request_code`: the six digits Meta would send by SMS or voice. */
	requestCode(
		id: string,
		method: string
	): { ok: true; code: string } | { ok: false } {
		const number = this.number(id)
		if (!number) return { ok: false }
		const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
		this.save({
			...number,
			pending_code: { code, method, expires_at: Date.now() + CODE_TTL_MS },
		})
		return { ok: true, code }
	}

	verifyCode(id: string, code: string): NumberResult {
		const number = this.number(id)
		if (!number) return { ok: false, reason: 'unknown' }
		const pending = number.pending_code
		if (!pending || pending.expires_at < Date.now())
			return { ok: false, reason: 'no_code' }
		if (pending.code !== code.trim()) return { ok: false, reason: 'wrong_code' }
		const { pending_code: _used, ...rest } = number
		const verified: PhoneNumber = {
			...rest,
			code_verification_status: 'VERIFIED',
		}
		this.save(verified)
		return { ok: true, number: verified }
	}

	/** `register`: on the Cloud API. The first PIN is kept; a later one must match. */
	register(id: string, pin: string): NumberResult {
		const number = this.number(id)
		if (!number) return { ok: false, reason: 'unknown' }
		if (number.code_verification_status !== 'VERIFIED')
			return { ok: false, reason: 'not_verified' }
		if (number.pin && number.pin !== pin)
			return { ok: false, reason: 'pin_mismatch' }
		const on: PhoneNumber = {
			...number,
			pin: number.pin ?? pin,
			status: 'CONNECTED',
			platform_type: 'CLOUD_API',
			quality_rating:
				number.quality_rating === 'UNKNOWN' ? 'GREEN' : number.quality_rating,
		}
		this.save(on)
		return { ok: true, number: on }
	}

	deregister(id: string): NumberResult {
		const number = this.ensure(id)
		const off: PhoneNumber = {
			...number,
			status: 'DISCONNECTED',
			platform_type: 'NOT_APPLICABLE',
			calling: { ...number.calling, status: 'disabled' },
		}
		this.save(off)
		return { ok: true, number: off }
	}

	/** A number on the Cloud API: it sends, receives and (with calling on) calls. */
	isRegistered(number: PhoneNumber): boolean {
		return number.status === 'CONNECTED' && number.platform_type === 'CLOUD_API'
	}

	callingEnabled(number: PhoneNumber): boolean {
		return String(number.calling.status).toLowerCase() === 'enabled'
	}

	/** Forget every account and number (tests). */
	clear(): void {
		this.db.exec('DELETE FROM businesses')
		this.db.exec('DELETE FROM wabas')
		this.db.exec('DELETE FROM phone_numbers')
	}
}

/** The process's accounts, in the mock's database. */
export const accountStore = new AccountStore(mockStore.db)
