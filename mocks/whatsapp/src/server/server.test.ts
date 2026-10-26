import { afterEach, describe, expect, test, vi } from 'vitest'
import { createApp } from './server.ts'
import { TemplateStore } from './store/template-store.ts'

describe('request logging', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	test('redacts authorization, cookie and signature headers', async () => {
		const logs: string[] = []
		vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
			logs.push(args.map((arg) => JSON.stringify(arg)).join(' '))
		})
		const { app } = createApp(new TemplateStore('./templates'))

		const res = await app.request('http://localhost:3010/health', {
			headers: {
				Authorization: 'Bearer fake-token-123',
				Cookie: 'session=fake-cookie-456',
				'X-Hub-Signature-256': 'sha256=fake-signature-789',
			},
		})

		expect(res.status).toBe(200)
		const output = logs.join('\n')
		expect(output).toContain('[redacted]')
		expect(output).not.toContain('fake-token-123')
		expect(output).not.toContain('fake-cookie-456')
		expect(output).not.toContain('fake-signature-789')
	})

	test('a foreign Host is refused by the full app', async () => {
		const { app } = createApp(new TemplateStore('./templates'))
		const res = await app.request('http://evil.example/health')
		expect(res.status).toBe(403)
	})
})
