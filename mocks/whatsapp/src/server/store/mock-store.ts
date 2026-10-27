import type { Database } from 'bun:sqlite'
import { readSetting, storeDatabase, writeSetting } from './database.ts'
import type { Template } from './template-store.ts'

/**
 * Where a message stands. The clinic's messages walk sent, delivered, read
 * (or failed) on the user's phone; the user's messages arrive as received and
 * become read when the clinic marks them.
 */
export type MessageStatus =
	| 'sent'
	| 'delivered'
	| 'read'
	| 'failed'
	| 'received'

/**
 * One message of a conversation, whoever wrote it. Both sides land here: the
 * clinic through `POST /{phone-number-id}/messages`, the user through the same
 * call with `X-Mock-From`. A conversation is a number and a contact.
 */
export interface StoredMessage {
	id: string
	/** out = the clinic (the application) wrote it; in = the user did. */
	direction: 'out' | 'in'
	/** The clinic's number. */
	phoneNumberId: string
	/** The user's wa_id, digits only. */
	contact: string
	/** The user's profile name, when the user side gave one. */
	contactName: string | null
	/** Meta's message type: text, template, image, location, interactive, reaction… */
	type: string
	content: {
		text?: { body: string; preview_url?: boolean }
		template?: {
			name: string
			language: { code: string }
			components?: Array<{
				type: string
				sub_type?: string
				index?: number | string
				parameters?: Array<Record<string, unknown>>
			}>
		}
		processedTemplate?: Template
		/** The object of any other type, as Meta reads it (`image`, `location`…). */
		payload?: Record<string, unknown>
		/** The message this one answers. */
		context?: { message_id: string }
	}
	timestamp: Date
	status: MessageStatus
}

/** What a side hands the store; the store gives the id, the time and the status. */
export type NewMessage = Omit<StoredMessage, 'id' | 'timestamp' | 'status'> & {
	id?: string
}

export interface WebhookEvent {
	id: string
	timestamp: Date
	payload: unknown
	url: string
	kind: 'message' | 'status' | 'template_status' | 'call'
	status: 'pending' | 'delivered' | 'failed'
	httpStatus: number | null
	error: string | null
}

export type DeliveryMode = 'auto' | 'manual'

/** Delivery mode from `MOCK_DELIVERY_MODE`; anything but `manual` means `auto`. */
function defaultDeliveryMode(): DeliveryMode {
	return process.env.MOCK_DELIVERY_MODE === 'manual' ? 'manual' : 'auto'
}

/** The delay the mock waits before delivering an event to the webhook. */
export const DEFAULT_RESPONSE_DELAY_MS = 5000

/** The largest delay the mock accepts: ten minutes is already a long wait. */
export const MAX_RESPONSE_DELAY_MS = 600_000

/**
 * How long the mock waits before it delivers an event to the webhook.
 *
 * The application behind the webhook often needs a moment: a queue, a lock, a
 * slow handler. The delay lets the developer see that in the panel instead of
 * discovering it as a race. It comes from `MOCK_WEBHOOK_RESPONSE_DELAY_MS`.
 */
function defaultResponseDelayMs(): number {
	// The suites wait for the webhook in real time: an artificial delay there
	// would only make them slower.
	if (process.env.NODE_ENV === 'test') return 0
	const raw = Number(process.env.MOCK_WEBHOOK_RESPONSE_DELAY_MS)
	return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_RESPONSE_DELAY_MS
}

const MAX_RECENT_WEBHOOK_EVENTS = 200

/** The webhook calls kept: the newest ones, so the file does not grow forever. */
const KEPT_WEBHOOK_EVENTS = 2000

const digitsOnly = (phone: string) => phone.replace(/\D/g, '')

/** A message read back from its row: the time is a Date again. */
function messageOf(row: { data: string }): StoredMessage {
	const message = JSON.parse(row.data) as StoredMessage
	message.timestamp = new Date(message.timestamp)
	return message
}

function eventOf(row: { data: string }): WebhookEvent {
	const event = JSON.parse(row.data) as WebhookEvent
	event.timestamp = new Date(event.timestamp)
	return event
}

/**
 * What the mock remembers: the conversations, the webhook calls and the
 * settings, in its SQLite file (`database.ts`), so a restart forgets nothing.
 * The typing indicator is a moment, not a fact: it stays in memory.
 */
export class MockStore {
	readonly db: Database
	private typingIndicators: Map<
		string,
		{ messageId: string; isTyping: boolean; timestamp: number }
	> = new Map()
	private messageIdCounter = 1
	private seq: number

	constructor(db: Database = storeDatabase()) {
		this.db = db
		const last = db
			.query<{ seq: number | null }, []>(
				'SELECT MAX(seq) AS seq FROM (SELECT seq FROM messages UNION ALL SELECT seq FROM webhook_events)'
			)
			.get()
		this.seq = last?.seq ?? 0
	}

	private nextSeq(): number {
		this.seq += 1
		return this.seq
	}

	// Generate realistic WhatsApp message ID
	generateMessageId(): string {
		const prefix = 'wamid.'
		const timestamp = Date.now().toString()
		const random = Math.random().toString(36).substring(2, 15)
		return `${prefix}${timestamp}_${random}_${this.messageIdCounter++}`
	}

	/**
	 * Put a message in its conversation, whichever side wrote it. The clinic's
	 * message starts as sent, the user's as received.
	 */
	storeMessage(message: NewMessage): StoredMessage {
		const id = message.id ?? this.generateMessageId()
		const stored: StoredMessage = {
			...message,
			id,
			contact: digitsOnly(message.contact),
			timestamp: new Date(),
			status: message.direction === 'out' ? 'sent' : 'received',
		}
		this.db
			.query(
				'INSERT OR REPLACE INTO messages (id, seq, phone_number_id, contact, data) VALUES (?, ?, ?, ?, ?)'
			)
			.run(
				id,
				this.nextSeq(),
				stored.phoneNumberId,
				stored.contact,
				JSON.stringify(stored)
			)
		console.log(
			`${message.direction === 'out' ? '📤' : '📥'} ${message.phoneNumberId} ${message.direction === 'out' ? '→' : '←'} ${stored.contact}: ${id}`
		)
		return stored
	}

	// Get message by ID
	getMessage(id: string): StoredMessage | undefined {
		const row = this.db
			.query<{ data: string }, [string]>(
				'SELECT data FROM messages WHERE id = ?'
			)
			.get(id)
		return row ? messageOf(row) : undefined
	}

	/** Every message of every conversation, oldest first. */
	getAllMessages(): StoredMessage[] {
		return this.db
			.query<{ data: string }, []>('SELECT data FROM messages ORDER BY seq')
			.all()
			.map(messageOf)
	}

	/** The conversations of a number, or one of them when a contact is given. */
	getConversation(phoneNumberId: string, contact?: string): StoredMessage[] {
		if (contact) {
			return this.db
				.query<{ data: string }, [string, string]>(
					'SELECT data FROM messages WHERE phone_number_id = ? AND contact = ? ORDER BY seq'
				)
				.all(phoneNumberId, digitsOnly(contact))
				.map(messageOf)
		}
		return this.db
			.query<{ data: string }, [string]>(
				'SELECT data FROM messages WHERE phone_number_id = ? ORDER BY seq'
			)
			.all(phoneNumberId)
			.map(messageOf)
	}

	/** Clear both sides of every conversation. */
	clearMessages(): void {
		this.db.exec('DELETE FROM messages')
		console.log('🧹 Cleared all messages')
	}

	// Update message status
	updateMessageStatus(id: string, status: StoredMessage['status']): boolean {
		const message = this.getMessage(id)
		if (!message) return false
		message.status = status
		this.db
			.query('UPDATE messages SET data = ? WHERE id = ?')
			.run(JSON.stringify(message), id)
		console.log(`📊 Updated message ${id} status to ${status}`)
		return true
	}

	// Webhook event management
	storeWebhookEvent(event: Omit<WebhookEvent, 'id'>): WebhookEvent {
		const id = `webhook_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`
		const storedEvent: WebhookEvent = {
			...event,
			id,
		}
		const seq = this.nextSeq()
		this.db
			.query('INSERT INTO webhook_events (id, seq, data) VALUES (?, ?, ?)')
			.run(id, seq, JSON.stringify(storedEvent))
		this.db
			.query('DELETE FROM webhook_events WHERE seq <= ?')
			.run(seq - KEPT_WEBHOOK_EVENTS * 2)
		return storedEvent
	}

	getAllWebhookEvents(): WebhookEvent[] {
		return this.db
			.query<{ data: string }, []>(
				'SELECT data FROM webhook_events ORDER BY seq'
			)
			.all()
			.map(eventOf)
	}

	// Newest first, capped for the panel
	getRecentWebhookEvents(limit = MAX_RECENT_WEBHOOK_EVENTS): WebhookEvent[] {
		return this.db
			.query<{ data: string }, [number]>(
				'SELECT data FROM webhook_events ORDER BY seq DESC LIMIT ?'
			)
			.all(limit)
			.map(eventOf)
	}

	// Delivery mode management: the environment's, until someone changes it.
	getDeliveryMode(): DeliveryMode {
		return (
			readSetting<DeliveryMode>(this.db, 'delivery_mode') ??
			defaultDeliveryMode()
		)
	}

	setDeliveryMode(mode: DeliveryMode): void {
		writeSetting(this.db, 'delivery_mode', mode)
		console.log(`🚚 Delivery mode set to ${mode}`)
	}

	// Response delay: how long the mock waits before delivering an event
	getResponseDelayMs(): number {
		return (
			readSetting<number>(this.db, 'response_delay_ms') ??
			defaultResponseDelayMs()
		)
	}

	setResponseDelayMs(delayMs: number): void {
		writeSetting(this.db, 'response_delay_ms', delayMs)
		console.log(`⏱️ Webhook response delay set to ${delayMs}ms`)
	}

	// Typing indicator management
	setTypingIndicator(
		phoneNumberId: string,
		messageId: string,
		isTyping: boolean
	): void {
		const key = `${phoneNumberId}_${messageId}`
		this.typingIndicators.set(key, {
			messageId,
			isTyping,
			timestamp: Date.now(),
		})
		console.log(`⌨️ Set typing indicator for ${phoneNumberId}: ${isTyping}`)
	}

	getTypingIndicator(phoneNumberId: string, messageId: string): boolean {
		const key = `${phoneNumberId}_${messageId}`
		const indicator = this.typingIndicators.get(key)
		return indicator?.isTyping ?? false
	}

	getAllTypingIndicators(): Array<{
		phoneNumberId: string
		messageId: string
		isTyping: boolean
		timestamp: number
	}> {
		return Array.from(this.typingIndicators.entries()).map(([key, value]) => {
			const [phoneNumberId] = key.split('_')
			return {
				phoneNumberId,
				...value,
			}
		})
	}

	clearTypingIndicatorsForPhone(
		phoneNumberId: string
	): Array<{ messageId: string }> {
		const clearedIndicators: Array<{ messageId: string }> = []

		for (const [key, value] of this.typingIndicators.entries()) {
			if (key.startsWith(`${phoneNumberId}_`) && value.isTyping) {
				this.typingIndicators.set(key, { ...value, isTyping: false })
				clearedIndicators.push({ messageId: value.messageId })
			}
		}

		if (clearedIndicators.length > 0) {
			console.log(
				`⌨️ Cleared ${clearedIndicators.length} typing indicators for ${phoneNumberId}`
			)
		}

		return clearedIndicators
	}

	// Clear the conversations and the webhook calls (useful for testing)
	clear(): void {
		this.db.exec('DELETE FROM messages')
		this.db.exec('DELETE FROM webhook_events')
		this.typingIndicators.clear()
		this.messageIdCounter = 1
		console.log('🧹 Cleared all mock data')
	}

	// Clear only webhook events
	clearWebhookEvents(): void {
		this.db.exec('DELETE FROM webhook_events')
		console.log('🧹 Cleared webhook events')
	}

	// Get stats
	getStats() {
		const count = (sql: string) =>
			this.db.query<{ n: number }, []>(sql).get()?.n ?? 0
		return {
			totalMessages: count('SELECT COUNT(*) AS n FROM messages'),
			fromClinic: count(
				`SELECT COUNT(*) AS n FROM messages WHERE json_extract(data, '$.direction') = 'out'`
			),
			fromUsers: count(
				`SELECT COUNT(*) AS n FROM messages WHERE json_extract(data, '$.direction') = 'in'`
			),
			totalWebhookEvents: count('SELECT COUNT(*) AS n FROM webhook_events'),
			phoneNumbers: count(
				'SELECT COUNT(DISTINCT phone_number_id) AS n FROM messages'
			),
		}
	}
}

// Singleton instance
export const mockStore = new MockStore()
