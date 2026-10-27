import { getWebhookUrl } from './config.ts'
import { mockStore, type StoredMessage } from './store/mock-store.ts'
import type { WebhookPayload } from './types/api-types.ts'
import { sendWebhook } from './webhook-target.ts'
import { broadcast } from './websocket.ts'

/** The statuses a clinic message walks; `received` belongs to the user's side. */
export type DeliveryStatus = Exclude<StoredMessage['status'], 'received'>

export type TemplateStatusData = {
	name: string
	language: string
	category?: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION'
	error?: {
		code: string
		title: string
		message: string
		details?: string
	}
}

/** Cloud API error entries carried by a `failed` status. */
export type StatusError = { code: number; title: string }

/** Enhanced delivery status webhook supporting template-specific data */
export function sendDeliveryStatusWebhook(
	messageId: string,
	phoneNumberId: string,
	to: string,
	status: DeliveryStatus,
	templateData?: TemplateStatusData,
	errors?: StatusError[]
): void {
	const webhookUrl = getWebhookUrl(phoneNumberId)
	if (!webhookUrl) return

	const baseStatus = {
		id: messageId,
		status,
		timestamp: Math.floor(Date.now() / 1000).toString(),
		recipient_id: to,
		conversation: {
			id: `conversation_${messageId}`,
			expiration_timestamp: Math.floor(Date.now() / 1000 + 86400).toString(), // 24 hours
			origin: {
				type: 'business_initiated',
			},
		},
		pricing: {
			category:
				templateData?.category === 'AUTHENTICATION'
					? 'authentication'
					: 'utility',
			pricing_model: 'CBP',
		},
		...(errors && { errors }),
	}

	const payload: WebhookPayload = {
		object: 'whatsapp_business_account',
		entry: [
			{
				id: phoneNumberId,
				changes: [
					{
						value: {
							messaging_product: 'whatsapp',
							metadata: {
								display_phone_number: phoneNumberId,
								phone_number_id: phoneNumberId,
							},
							// Use template_statuses for template messages, statuses for regular messages
							...(templateData
								? {
										template_statuses: [
											{
												...baseStatus,
												template: {
													name: templateData.name,
													language: templateData.language,
													category: templateData.category || 'UTILITY',
												},
												...(templateData.error && {
													error: templateData.error,
												}),
											},
										],
									}
								: {
										statuses: [baseStatus],
									}),
						},
						field: 'messages',
					},
				],
			},
		],
	}

	const messageType = templateData ? 'template' : 'text'
	console.log(
		`📤 Sending ${status} webhook for ${messageType} message ${messageId}`
	)

	sendWebhook(webhookUrl, payload).catch((error) => {
		console.error(`❌ Delivery status webhook failed: ${error.message}`)
	})
}

/** Update the stored status and tell the panel. */
export function applyStatus(id: string, status: DeliveryStatus): boolean {
	const updated = mockStore.updateMessageStatus(id, status)
	if (updated) {
		broadcast({ type: 'STATUS_UPDATE', payload: { id, status } })
	}
	return updated
}

/**
 * Schedule the status progression of a freshly sent message: `auto` walks
 * sent (1 s) → delivered (2 s) → read (3 s); `manual` stops at sent.
 */
export function scheduleDelivery(
	message: StoredMessage,
	templateData?: TemplateStatusData
): void {
	const steps: Array<[DeliveryStatus, number]> =
		mockStore.getDeliveryMode() === 'manual'
			? [['sent', 1000]]
			: [
					['sent', 1000],
					['delivered', 2000],
					['read', 3000],
				]

	for (const [status, delay] of steps) {
		setTimeout(() => {
			applyStatus(message.id, status)
			sendDeliveryStatusWebhook(
				message.id,
				message.phoneNumberId,
				message.contact,
				status,
				templateData
			)
		}, delay)
	}
}
