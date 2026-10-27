import ky from 'ky'

/** The Graph API version the TUI talks to. */
const GRAPH_VERSION = 'v23.0'

export interface Message {
	id: string
	to: string
	from: string
	text: string
	timestamp: Date
	direction: 'sent' | 'received'
}

export interface ConversationHistory {
	messages: Message[]
	participants: string[]
}

export interface ServerStatus {
	connected: boolean
	uptime: number
	messageCount: number
}

/** Template component structure based on WhatsApp Business API format */
export interface TemplateComponent {
	type: 'HEADER' | 'BODY' | 'FOOTER' | 'BUTTONS'
	format?: 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT'
	text?: string
	buttons?: Array<{
		type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER'
		text: string
		url?: string
		phone_number?: string
	}>
}

/** Template structure based on WhatsApp Business API format */
export interface Template {
	name: string
	language: string
	category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION'
	components: TemplateComponent[]
	variables?: Record<
		string,
		{
			description: string
			example: string
		}
	>
}

export class ApiClient {
	private baseUrl
	private client
	private messageIdCounter = 1

	constructor(baseUrl = `http://localhost:${process.env.PORT ?? 3010}`) {
		this.baseUrl = baseUrl
		this.client = ky.create({
			prefixUrl: baseUrl,
			timeout: 5000,
			retry: 2,
		})
	}

	// Generate realistic WhatsApp message ID
	private generateWhatsAppMessageId(): string {
		const prefix = 'wamid.'
		const timestamp = Date.now().toString()
		const random = Math.random().toString(36).substring(2, 15)
		return `${prefix}${timestamp}_${random}_${this.messageIdCounter++}`
	}

	async getStatus(): Promise<ServerStatus> {
		const response = await this.client.get('status').json<ServerStatus>()
		return response
	}

	/**
	 * The user writes to the clinic number `to`: the Cloud API call made from
	 * the user's phone (`X-Mock-From`). The message enters the conversation and
	 * reaches the application's webhook.
	 */
	async sendMessage(
		from: string,
		to: string,
		text: string
	): Promise<{ messageId: string }> {
		try {
			const response = await this.client
				.post(`${GRAPH_VERSION}/${to}/messages`, {
					headers: { 'X-Mock-From': from },
					json: {
						messaging_product: 'whatsapp',
						type: 'text',
						text: { body: text },
					},
				})
				.json<{ messages: Array<{ id: string }> }>()
			return { messageId: response.messages[0]?.id ?? '' }
		} catch (error) {
			console.error('Error sending message:', error)
			return { messageId: '' }
		}
	}

	async sendTemplateMessage(
		from: string,
		to: string,
		templateName: string,
		parameters: string[] = []
	): Promise<{ messageId: string }> {
		const messageId = this.generateWhatsAppMessageId()
		const payload = {
			messaging_product: 'whatsapp',
			to,
			type: 'template',
			template: {
				name: templateName,
				language: { code: 'en_US' },
				components:
					parameters.length > 0
						? [
								{
									type: 'body',
									parameters: parameters.map((param) => ({
										type: 'text',
										text: param,
									})),
								},
							]
						: [],
			},
		}

		await this.client.post(`${GRAPH_VERSION}/${from}/messages`, {
			json: payload,
		})

		return { messageId }
	}

	/**
	 * The conversation between a user (`from`) and a clinic number (`to`), or
	 * every conversation when they are not given.
	 */
	async getConversationHistory(
		from?: string,
		to?: string
	): Promise<ConversationHistory> {
		type Row = {
			id: string
			direction: 'out' | 'in'
			businessId: string
			contact: string
			text: string
			timestamp: string
		}
		const rows =
			from && to
				? (
						await this.client
							.get(`${GRAPH_VERSION}/${to}/messages`, {
								searchParams: { contact: from },
							})
							.json<{ data: Row[] }>()
					).data
				: (
						await this.client
							.get('settings/conversations')
							.json<{ messages: Row[] }>()
					).messages

		const messages: Message[] = rows.map((row) => ({
			id: row.id,
			from: row.direction === 'out' ? row.businessId : row.contact,
			to: row.direction === 'out' ? row.contact : row.businessId,
			text: row.text,
			timestamp: new Date(row.timestamp),
			direction: row.direction === 'out' ? 'sent' : 'received',
		}))

		return {
			messages,
			participants: Array.from(
				new Set(messages.flatMap((message) => [message.from, message.to]))
			),
		}
	}

	async clearConversation(): Promise<void> {
		await this.client.delete('settings/conversations')
	}

	async getStats(): Promise<{
		totalMessages: number
		uptime: number
		lastActivity: Date | null
	}> {
		const response = await this.client.get('stats').json<{
			totalMessages: number
			uptime: number
			lastActivity: string | null
		}>()

		return {
			...response,
			lastActivity: response.lastActivity
				? new Date(response.lastActivity)
				: null,
		}
	}

	async simulateIncomingMessage(
		phoneNumberId: string,
		from: string,
		messageBody: string
	): Promise<{ messageId: string }> {
		return this.sendMessage(from, phoneNumberId, messageBody)
	}

	async sendTypingIndicator(
		phoneNumberId: string,
		messageId: string
	): Promise<{ success: boolean }> {
		const payload = {
			messaging_product: 'whatsapp',
			status: 'read',
			message_id: messageId,
			typing_indicator: {
				type: 'text',
			},
		}

		try {
			// Try the standard WhatsApp Cloud API messages endpoint first
			// This matches the external service implementation
			const response = await this.client
				.post(`${GRAPH_VERSION}/${phoneNumberId}/messages`, {
					json: payload,
				})
				.json<{ success: boolean }>()

			return response
		} catch (error) {
			console.error('Error sending typing indicator:', error)
			throw error
		}
	}

	/** Get all available templates */
	async getTemplates(businessAccountId = 'test'): Promise<Template[]> {
		try {
			const response = await this.client
				.get(`${GRAPH_VERSION}/${businessAccountId}/message_templates`)
				.json<{ data: Template[] }>()

			return response.data
		} catch (error) {
			console.error('Error fetching templates:', error)
			return []
		}
	}

	/** Get a specific template by name and language */
	async getTemplate(
		templateName: string,
		language = 'en',
		businessAccountId = 'test'
	): Promise<Template | null> {
		try {
			const response = await this.client
				.get(`${GRAPH_VERSION}/${businessAccountId}/message_templates`, {
					searchParams: { name: templateName, language },
				})
				.json<{ data: Template[] }>()

			return (
				response.data.find((template) => template.name === templateName) ?? null
			)
		} catch (error) {
			console.error(`Error fetching template ${templateName}:`, error)
			return null
		}
	}
}
