/**
 * What an id is. The Graph API addresses every object as `/{version}/{id}`:
 * a phone number, a template, a media, a business account all share the
 * shape, and Meta tells them apart by the id. The mock does the same with
 * this registry: the libraries it simulates (templates, media) answer for
 * their own ids, the accounts it plays are fixed ids, and every id an
 * example answer handed out is remembered with its kind.
 */

/** The kind of object each path parameter of Meta's spec names. */
export const KIND_OF_PARAMETER: Record<string, string> = {
	'Phone-Number-ID': 'phone',
	'WABA-ID': 'waba',
	'WhatsApp-Business-Account-ID': 'waba',
	TEMPLATE_ID: 'template',
	'Media-ID': 'media',
	'Media-URL': 'media-url',
	group_id: 'group',
	'Flow-ID': 'flow',
	'Business-ID': 'business',
	'Application-ID': 'app',
	'User-ID': 'user',
	'Solution-ID': 'solution',
	'QR-Code-ID': 'qr-code',
	'Message-History-ID': 'message-history',
	'Migration-Intent-ID': 'migration-intent',
	'Pre-Verified-Phone-Number-ID': 'preverified-number',
	'WhatsApp-Account-Number-ID': 'account-number',
	'OBO-Mobility-Intent-ID': 'obo-intent',
	'WABA-Bot-ID': 'bot',
	'WhatsApp-Business-Profile-ID': 'business-profile',
}

/** The accounts the mock plays, one fixed id per kind. */
export const MOCK_IDS = {
	waba: process.env.MOCK_WABA_ID ?? '100000000000001',
	business: process.env.MOCK_BUSINESS_ID ?? '100000000000002',
	app: process.env.MOCK_APP_ID ?? '100000000000003',
	user: process.env.MOCK_USER_ID ?? '100000000000004',
} as const

/**
 * One sample object of every other kind the spec addresses (a flow, a group,
 * a QR code…), so each of those operations is reachable before the
 * application created one. The ids are fixed: the panel lists them.
 */
export const SAMPLE_IDS: Record<string, string> = {
	group: '200000000000001',
	flow: '200000000000002',
	'qr-code': 'ANED2T5QRU7HG1',
	solution: '200000000000004',
	'message-history': '200000000000005',
	'migration-intent': '200000000000006',
	'preverified-number': '200000000000007',
	'account-number': '200000000000008',
	'obo-intent': '200000000000009',
	bot: '200000000000010',
	'business-profile': '200000000000011',
	media: '200000000000012',
}

type Lookup = (id: string) => boolean

export class NodeRegistry {
	private readonly known = new Map<string, string>()
	private readonly lookups: Array<[string, Lookup]> = []

	constructor() {
		for (const [kind, id] of Object.entries(MOCK_IDS)) this.known.set(id, kind)
		for (const [kind, id] of Object.entries(SAMPLE_IDS))
			this.known.set(id, kind)
	}

	/** A library that answers for its own ids (templates, media). */
	register(kind: string, lookup: Lookup): void {
		this.lookups.push([kind, lookup])
	}

	/** Remember an id an answer handed out. */
	remember(id: string, kind: string): void {
		this.known.set(id, kind)
	}

	forget(id: string): void {
		this.known.delete(id)
	}

	/** The kind of an id, or null when the mock has never seen it. */
	kindOf(id: string): string | null {
		const known = this.known.get(id)
		if (known) return known
		for (const [kind, lookup] of this.lookups) {
			if (lookup(id)) return kind
		}
		return null
	}

	/** Every id the mock handed out, for the panel. */
	entries(): Array<{ id: string; kind: string }> {
		return [...this.known.entries()].map(([id, kind]) => ({ id, kind }))
	}
}
