import type {
	StoredMessage,
	StoredWebhookMessage,
} from './store/memory-store.ts'

/** A message as the web panel shows it, in either direction. */
export type PanelMessage = {
	id: string
	/** out = the business (the Hub) sent it; in = the patient */
	direction: 'out' | 'in'
	/** The phone_number_id */
	businessId: string
	/** The patient's number, digits only */
	contact: string
	contactName: string | null
	type: 'text' | 'template'
	/** Text body; for a template, the rendered BODY */
	text: string
	template: null | {
		name: string
		language: string
		header: string | null
		body: string
		footer: string | null
		buttons: string[]
	}
	status: 'sent' | 'delivered' | 'read' | 'failed' | null
	timestamp: string
}

const digitsOnly = (phone: string) => phone.replace(/^\+/, '')

function toTemplateView(message: StoredMessage): PanelMessage['template'] {
	const template = message.content.template
	if (!template) return null

	const components = message.content.processedTemplate?.components ?? []
	const textOf = (type: 'HEADER' | 'BODY' | 'FOOTER') =>
		components.find((component) => component.type === type)?.text ?? null

	return {
		name: template.name,
		language: template.language.code,
		header: textOf('HEADER'),
		body: textOf('BODY') ?? '',
		footer: textOf('FOOTER'),
		buttons: components
			.filter((component) => component.type === 'BUTTONS')
			.flatMap((component) => component.buttons ?? [])
			.map((button) => button.text),
	}
}

/** Map a stored outbound or inbound message to the panel's shape. */
export function toPanelMessage(
	message: StoredMessage | StoredWebhookMessage
): PanelMessage {
	if ('content' in message) {
		const template = toTemplateView(message)
		return {
			id: message.id,
			direction: 'out',
			businessId: message.phoneNumberId,
			contact: digitsOnly(message.to),
			contactName: null,
			type: message.type,
			text: template ? template.body : (message.content.text?.body ?? ''),
			template,
			status: message.status,
			timestamp: message.timestamp.toISOString(),
		}
	}

	return {
		id: message.id,
		direction: 'in',
		businessId: message.phoneNumberId,
		contact: digitsOnly(message.from),
		contactName: message.contactName,
		type: 'text',
		text: message.text.body,
		template: null,
		status: null,
		timestamp: message.timestamp.toISOString(),
	}
}
