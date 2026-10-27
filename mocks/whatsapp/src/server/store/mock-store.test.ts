import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { openDatabase } from './database.ts'
import { MockStore } from './mock-store.ts'

describe('What the mock remembers across a restart', () => {
	let dir = ''

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true })
	})

	test('the conversation, its statuses, the webhook calls and the settings come back', async () => {
		dir = await mkdtemp(join(tmpdir(), 'whap-db-'))
		const file = join(dir, 'whap.db')

		const before = new MockStore(openDatabase(file))
		const out = before.storeMessage({
			direction: 'out',
			phoneNumberId: '5511400000000',
			contact: '+55 11 92222-3333',
			contactName: null,
			type: 'text',
			content: { text: { body: 'Olá' } },
		})
		before.storeMessage({
			direction: 'in',
			phoneNumberId: '5511400000000',
			contact: '5511922223333',
			contactName: 'Maria',
			type: 'text',
			content: { text: { body: 'Oi' } },
		})
		before.updateMessageStatus(out.id, 'read')
		before.storeWebhookEvent({
			timestamp: new Date(),
			payload: { object: 'whatsapp_business_account' },
			url: 'http://app.test/hook',
			kind: 'status',
			status: 'delivered',
			httpStatus: 200,
			error: null,
		})
		before.setDeliveryMode('manual')
		before.setResponseDelayMs(1500)
		before.db.close()

		const after = new MockStore(openDatabase(file))
		const conversation = after.getConversation('5511400000000', '5511922223333')
		expect(conversation.map((m) => [m.direction, m.status])).toEqual([
			['out', 'read'],
			['in', 'received'],
		])
		expect(conversation[0].timestamp).toBeInstanceOf(Date)
		expect(after.getRecentWebhookEvents()).toHaveLength(1)
		expect(after.getDeliveryMode()).toBe('manual')
		expect(after.getResponseDelayMs()).toBe(1500)

		// New messages keep their place after the old ones.
		const next = after.storeMessage({
			direction: 'out',
			phoneNumberId: '5511400000000',
			contact: '5511922223333',
			contactName: null,
			type: 'text',
			content: { text: { body: 'Tudo bem?' } },
		})
		expect(after.getAllMessages().at(-1)?.id).toBe(next.id)
		after.db.close()
	})
})
