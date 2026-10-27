import { mediaStore } from './store/media-store.ts'
import type { MessageStatus, StoredMessage } from './store/mock-store.ts'
import type { TemplateButton, TemplateComponent } from './types/api-types.ts'

/** A media as a bubble shows it: where its bytes are, and its name. */
export interface MediaView {
	kind: string
	/** The bytes: the mock's copy of an uploaded id, or the link the call gave. */
	src: string | null
	filename: string | null
	mimeType: string | null
}

/** A button as the phone draws it: its label, and the link, number or code behind it. */
export interface ButtonView {
	type: string
	text: string
	detail: string | null
}

export interface HeaderView {
	format: string
	text: string | null
	media: MediaView | null
	location: Record<string, unknown> | null
}

/** A limited-time offer: its line, and when it ends (from the call, if sent). */
export interface OfferView {
	text: string
	expiresAt: number | null
}

/** A template as it reaches the phone: every component filled for this call. */
export interface TemplateView {
	name: string
	language: string
	header: HeaderView | null
	offer: OfferView | null
	body: string
	footer: string | null
	buttons: ButtonView[]
	cards: Array<{
		header: HeaderView | null
		body: string
		buttons: ButtonView[]
	}>
}

/** A message as the web panel (and `GET /{phone-number-id}/messages`) shows it. */
export type PanelMessage = {
	id: string
	/** out = the business (the application) sent it; in = the user */
	direction: 'out' | 'in'
	/** The phone_number_id */
	businessId: string
	/** The user's number, digits only */
	contact: string
	contactName: string | null
	/** Meta's message type: text, template, image, location, interactive… */
	type: string
	/** Text body; for a template, the rendered BODY; for any other type, what a person sees */
	text: string
	/** The object of the other types, as sent (`{ link, caption }`, `{ latitude, … }`) */
	payload: Record<string, unknown> | null
	/** The id of the message this one answers */
	replyTo: string | null
	template: TemplateView | null
	/** The media of an image, video, audio, document or sticker message. */
	media: MediaView | null
	status: MessageStatus
	timestamp: string
}

type Json = Record<string, unknown>
type Parameter = Json & { type?: string }
type SentComponent = {
	type?: string
	sub_type?: string
	index?: number | string
	parameters?: Parameter[]
	cards?: Json[]
}

const MEDIA_KINDS = ['image', 'video', 'audio', 'document', 'sticker']

/** Where a media object of a call (`{ id }` or `{ link }`) can be seen. */
export function mediaOf(
	kind: string,
	object: Json | undefined
): MediaView | null {
	if (!object) return null
	const id = typeof object.id === 'string' ? object.id : null
	const stored = id ? mediaStore.get(id) : undefined
	const link = typeof object.link === 'string' ? object.link : null
	return {
		kind,
		src: stored ? `/settings/media/${stored.id}` : link,
		filename:
			(typeof object.filename === 'string' ? object.filename : null) ??
			stored?.fileName ??
			null,
		mimeType: stored?.mimeType ?? null,
	}
}

/** A sample a template carries for its media header (`example.header_handle`). */
function sampleMedia(
	kind: string,
	component: TemplateComponent | undefined
): MediaView | null {
	const handle = (
		component?.example?.header_handle as unknown[] | undefined
	)?.[0]
	if (typeof handle !== 'string') return null
	const viewable = /^(https?:\/\/|\/settings\/(examples\/)?media\/)/.test(
		handle
	)
	return {
		kind,
		src: viewable ? handle : null,
		filename: viewable ? (handle.split('/').pop() ?? null) : null,
		mimeType: null,
	}
}

/** The text of a parameter, as Meta puts it in the message. */
function textOf(parameter: Parameter): string {
	const value =
		parameter.text ??
		(parameter.currency as Json | undefined)?.fallback_value ??
		(parameter.date_time as Json | undefined)?.fallback_value ??
		parameter.coupon_code ??
		parameter.payload ??
		''
	return String(value)
}

/** Fill `{{1}}` or `{{name}}` with the text parameters, in order or by name. */
function fill(text: string, parameters: Parameter[] = []): string {
	const values = new Map<string, string>()
	parameters
		.filter(
			(p) => !p.type || ['text', 'currency', 'date_time'].includes(p.type)
		)
		.forEach((p, i) => {
			values.set(
				String(p.parameter_name ?? '').trim() || String(i + 1),
				textOf(p)
			)
		})
	return text.replace(
		/\{\{([^}]+)\}\}/g,
		(match, name) => values.get(String(name).trim()) ?? match
	)
}

function headerOf(
	component: TemplateComponent | undefined,
	sent: Parameter[] = []
): HeaderView | null {
	if (!component) return null
	const format = String(component.format ?? 'TEXT').toUpperCase()
	if (format === 'TEXT') {
		return {
			format,
			text: fill(component.text ?? '', sent),
			media: null,
			location: null,
		}
	}
	if (format === 'LOCATION') {
		const location = sent.find((p) => p.type === 'location')?.location as
			| Json
			| undefined
		return { format, text: null, media: null, location: location ?? null }
	}
	const kind = format.toLowerCase()
	const parameter = sent.find((p) => p.type === kind)
	return {
		format,
		text: null,
		media:
			mediaOf(kind, parameter?.[kind] as Json | undefined) ??
			sampleMedia(kind, component),
		location: null,
	}
}

/** The buttons of a template, with what this call put behind them. */
function buttonsOf(
	component: TemplateComponent | undefined,
	sent: SentComponent[]
): ButtonView[] {
	return (component?.buttons ?? []).map((button: TemplateButton, index) => {
		const param = sent.find(
			(c) =>
				String(c.type).toLowerCase() === 'button' &&
				Number(c.index ?? -1) === index
		)?.parameters?.[0]
		const type = String(button.type).toUpperCase()
		const detail =
			type === 'URL'
				? fill(
						button.url ?? '',
						param ? [{ type: 'text', text: textOf(param) }] : []
					)
				: type === 'PHONE_NUMBER'
					? (button.phone_number ?? null)
					: type === 'COPY_CODE' || type === 'OTP'
						? param
							? textOf(param)
							: Array.isArray(button.example)
								? String(button.example[0] ?? '')
								: (button.example ?? null)
						: null
		return {
			type,
			text:
				button.text ??
				(type === 'COPY_CODE' || type === 'OTP' ? 'Copiar código' : type),
			detail,
		}
	})
}

const ofType = (components: TemplateComponent[], type: string) =>
	components.find((c) => String(c.type).toUpperCase() === type)

const sentOf = (components: SentComponent[], type: string) =>
	components.find((c) => String(c.type).toLowerCase() === type)

/** The offer line of the template, with the end the call gave. */
function offerOf(
	component: TemplateComponent | undefined,
	sent: SentComponent | undefined
): OfferView | null {
	const offer = component?.limited_time_offer as Json | undefined
	if (!offer || typeof offer.text !== 'string') return null
	const param = sent?.parameters?.[0]?.limited_time_offer as Json | undefined
	const end = Number(param?.expiration_time_ms)
	return { text: offer.text, expiresAt: Number.isFinite(end) ? end : null }
}

function toTemplateView(message: StoredMessage): TemplateView | null {
	const template = message.content.template
	if (!template) return null

	// The library's components, the variables of the header and body already
	// filled by the renderer; the call's components for media, buttons, cards.
	const components = message.content.processedTemplate?.components ?? []
	const sent = (template.components ?? []) as SentComponent[]
	const carousel = ofType(components, 'CAROUSEL')
	const sentCards = (sentOf(sent, 'carousel')?.cards ?? []) as Array<{
		card_index?: number
		components?: SentComponent[]
	}>

	return {
		name: template.name,
		language: template.language.code,
		header: headerOf(
			ofType(components, 'HEADER'),
			sentOf(sent, 'header')?.parameters
		),
		offer: offerOf(
			ofType(components, 'LIMITED_TIME_OFFER'),
			sentOf(sent, 'limited_time_offer')
		),
		body: ofType(components, 'BODY')?.text ?? '',
		footer: ofType(components, 'FOOTER')?.text ?? null,
		buttons: buttonsOf(ofType(components, 'BUTTONS'), sent),
		cards: (carousel?.cards ?? []).map((card, index) => {
			const cardSent =
				sentCards.find((c) => Number(c.card_index ?? -1) === index)
					?.components ?? []
			return {
				header: headerOf(
					ofType(card.components, 'HEADER'),
					sentOf(cardSent, 'header')?.parameters
				),
				body: fill(
					ofType(card.components, 'BODY')?.text ?? '',
					sentOf(cardSent, 'body')?.parameters
				),
				buttons: buttonsOf(ofType(card.components, 'BUTTONS'), cardSent),
			}
		}),
	}
}

const str = (value: unknown) => (typeof value === 'string' ? value : '')

/** What a person sees of a message that is not text: its caption, its title, its place. */
export function summaryOf(type: string, payload: Json): string {
	switch (type) {
		case 'image':
		case 'video':
		case 'audio':
		case 'sticker':
		case 'document':
			return (
				str(payload.caption) ||
				str(payload.filename) ||
				str(payload.link) ||
				str(payload.id)
			)
		case 'location':
			return (
				[str(payload.name), str(payload.address)].filter(Boolean).join(' · ') ||
				`${payload.latitude}, ${payload.longitude}`
			)
		case 'contacts': {
			const contacts = (payload as unknown as Json[]) ?? []
			const list = Array.isArray(contacts) ? contacts : []
			return list
				.map((c) => str((c.name as Json | undefined)?.formatted_name))
				.filter(Boolean)
				.join(', ')
		}
		case 'reaction':
			return str(payload.emoji)
		case 'interactive': {
			const body = str((payload.body as Json | undefined)?.text)
			const reply =
				str((payload.button_reply as Json | undefined)?.title) ||
				str((payload.list_reply as Json | undefined)?.title)
			return body || reply || str(payload.type)
		}
		case 'button':
			return str(payload.text)
		default:
			return ''
	}
}

/** Map a stored message, of either side, to the panel's shape. */
export function toPanelMessage(message: StoredMessage): PanelMessage {
	const template = toTemplateView(message)
	const payload = message.content.payload ?? null
	return {
		id: message.id,
		direction: message.direction,
		businessId: message.phoneNumberId,
		contact: message.contact,
		contactName: message.contactName,
		type: message.type,
		text: template
			? template.body
			: (message.content.text?.body ?? summaryOf(message.type, payload ?? {})),
		template,
		payload,
		media: MEDIA_KINDS.includes(message.type)
			? mediaOf(message.type, payload ?? undefined)
			: null,
		replyTo: message.content.context?.message_id ?? null,
		status: message.status,
		timestamp: message.timestamp.toISOString(),
	}
}
