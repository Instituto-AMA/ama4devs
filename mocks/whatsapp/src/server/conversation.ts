/**
 * The conversation between a clinic number and a user, both sides of it.
 *
 * Everything that happens in a chat goes through here and lands in the one
 * message store: the clinic's send (`routes/messages.ts`, the Cloud API call),
 * the user's message and the user's phone receipts (the same call, made with
 * `X-Mock-From`), and the clinic marking a user's message as read. Each step
 * tells the panel and, when Meta would, the application's webhook.
 */
import { getWebhookUrl } from './config.ts'
import { applyStatus, sendDeliveryStatusWebhook } from './delivery-status.ts'
import type { Receipt } from './mock-headers.ts'
import { toPanelMessage } from './panel-message.ts'
import { mediaStore } from './store/media-store.ts'
import { mockStore, type StoredMessage } from './store/mock-store.ts'
import type { WebhookPayload } from './types/api-types.ts'
import { redactUrl, sendWebhook } from './webhook-target.ts'
import { broadcast } from './websocket.ts'

/** What the user's phone sends: any type a user can send, as Meta writes it. */
export interface UserMessage {
	phoneNumberId: string
	from: string
	name: string | null
	/** text, image, audio, video, document, sticker, location, contacts, reaction, interactive… */
	type: string
	/** The object of that type (`{ body }` for text, `{ id, caption }` for an image…). */
	payload: Record<string, unknown>
	/** The clinic message the user answers, when it is a reply. */
	replyTo?: string
}

/**
 * A media the user sent, as Meta's webhook describes it: the id with its type,
 * hash and file name, read from the upload the id names.
 */
function inboundObject(
	payload: Record<string, unknown>
): Record<string, unknown> {
	const media =
		typeof payload.id === 'string' ? mediaStore.get(payload.id) : undefined
	if (!media) return payload
	return {
		...payload,
		// A voice note is Ogg Opus; Meta names the codec.
		mime_type:
			payload.voice === true && media.mimeType === 'audio/ogg'
				? 'audio/ogg; codecs=opus'
				: media.mimeType,
		sha256: media.sha256,
		...(media.fileName && !payload.filename
			? { filename: media.fileName }
			: {}),
	}
}

/** The webhook Meta sends when a user writes to the number. */
function inboundPayload(message: StoredMessage): WebhookPayload {
	return {
		object: 'whatsapp_business_account',
		entry: [
			{
				id: message.phoneNumberId,
				changes: [
					{
						value: {
							messaging_product: 'whatsapp',
							metadata: {
								display_phone_number: message.phoneNumberId,
								phone_number_id: message.phoneNumberId,
							},
							contacts: [
								{
									profile: {
										name: message.contactName ?? `User ${message.contact}`,
									},
									wa_id: message.contact,
								},
							],
							messages: [
								{
									...(message.content.context
										? {
												context: {
													from: message.phoneNumberId,
													id: message.content.context.message_id,
												},
											}
										: {}),
									from: message.contact,
									id: message.id,
									timestamp: Math.floor(
										message.timestamp.getTime() / 1000
									).toString(),
									type: message.type,
									[message.type]:
										message.type === 'text'
											? { body: message.content.text?.body ?? '' }
											: inboundObject(message.content.payload ?? {}),
								},
							],
						},
						field: 'messages',
					},
				],
			},
		],
	}
}

/**
 * The user writes to the clinic: the message enters the conversation and the
 * application hears it on the number's webhook.
 */
export function userWrites(input: UserMessage): {
	message: StoredMessage
	delivered: boolean
} {
	const message = mockStore.storeMessage({
		direction: 'in',
		phoneNumberId: input.phoneNumberId,
		contact: input.from,
		contactName: input.name,
		type: input.type,
		content: {
			...(input.type === 'text'
				? { text: { body: String(input.payload.body ?? '') } }
				: { payload: input.payload }),
			...(input.replyTo ? { context: { message_id: input.replyTo } } : {}),
		},
	})
	broadcast({ type: 'NEW_MESSAGE', payload: toPanelMessage(message) })

	const webhookUrl = getWebhookUrl(input.phoneNumberId)
	if (!webhookUrl) return { message, delivered: false }

	console.log(`🔗 Inbound message to ${redactUrl(webhookUrl)}`)
	sendWebhook(webhookUrl, inboundPayload(message)).catch((error) => {
		console.error(`❌ Inbound webhook failed: ${error.message}`)
	})
	return { message, delivered: true }
}

/**
 * The user's phone answers a clinic message: delivered, read or failed. The
 * application hears the status on the number's webhook.
 */
export function userReceipt(message: StoredMessage, receipt: Receipt): void {
	applyStatus(message.id, receipt)
	const template = message.content.template
	sendDeliveryStatusWebhook(
		message.id,
		message.phoneNumberId,
		message.contact,
		receipt,
		template
			? {
					name: template.name,
					language: template.language.code,
					category: message.content.processedTemplate?.category,
				}
			: undefined,
		receipt === 'failed'
			? [{ code: 131026, title: 'Message undeliverable' }]
			: undefined
	)
}

/** The clinic marks a user's message as read: the blue ticks on the user side. */
export function clinicReads(message: StoredMessage): void {
	applyStatus(message.id, 'read')
}
