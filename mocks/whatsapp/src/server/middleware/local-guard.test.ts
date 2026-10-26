import { Hono } from 'hono'
import { afterEach, describe, expect, test } from 'vitest'
import { allowedHosts, serverPort } from '../config.ts'
import { localGuard } from './local-guard.ts'

function buildApp(hosts = allowedHosts()) {
	const app = new Hono()
	app.use('*', localGuard(hosts))
	app.all('*', (c) => c.json({ ok: true }))
	return app
}

describe('localGuard', () => {
	const app = buildApp()

	test('allowed host GET passes', async () => {
		const res = await app.request('http://localhost:3010/')
		expect(res.status).toBe(200)
	})

	test.each([
		'/',
		'/v23.0/123/messages',
		'/mock/simulate-message',
	])('foreign Host gets 403 on %s', async (path) => {
		const res = await app.request(`http://evil.example${path}`)
		expect(res.status).toBe(403)
		const body = await res.json()
		expect(body.error.type).toBe('forbidden_host')
	})

	test('POST with foreign Origin gets 403', async () => {
		const res = await app.request(
			'http://localhost:3010/mock/simulate-message',
			{
				method: 'POST',
				headers: { Origin: 'http://evil.example' },
			}
		)
		expect(res.status).toBe(403)
		expect((await res.json()).error.type).toBe('forbidden_origin')
	})

	test('POST with allowed Origin passes', async () => {
		const res = await app.request(
			'http://localhost:3010/mock/simulate-message',
			{
				method: 'POST',
				headers: { Origin: 'http://localhost:5173' },
			}
		)
		expect(res.status).toBe(200)
	})

	test('POST without Origin passes', async () => {
		const res = await app.request(
			'http://localhost:3010/mock/simulate-message',
			{
				method: 'POST',
			}
		)
		expect(res.status).toBe(200)
	})

	test('Origin null gets 403', async () => {
		const res = await app.request('http://localhost:3010/webhook/trigger', {
			method: 'DELETE',
			headers: { Origin: 'null' },
		})
		expect(res.status).toBe(403)
	})

	test('/ws with foreign Origin gets 403', async () => {
		const res = await app.request('http://localhost:3010/ws', {
			headers: { Origin: 'http://evil.example' },
		})
		expect(res.status).toBe(403)
	})

	test('foreign Origin on a plain GET is not checked', async () => {
		const res = await app.request('http://localhost:3010/health', {
			headers: { Origin: 'http://evil.example' },
		})
		expect(res.status).toBe(200)
	})

	test('bracketed IPv6 Host passes', async () => {
		const res = await app.request('http://[::1]:3010/')
		expect(res.status).toBe(200)
	})

	test('MOCK_ALLOWED_HOSTS admits the compose service name', async () => {
		const previous = process.env.MOCK_ALLOWED_HOSTS
		process.env.MOCK_ALLOWED_HOSTS = 'whatsapp'
		try {
			const res = await buildApp().request('/', {
				headers: { Host: 'whatsapp:3010' },
			})
			expect(res.status).toBe(200)
		} finally {
			if (previous === undefined) delete process.env.MOCK_ALLOWED_HOSTS
			else process.env.MOCK_ALLOWED_HOSTS = previous
		}
	})
})

describe('serverPort', () => {
	const original = process.env.PORT

	afterEach(() => {
		if (original === undefined) delete process.env.PORT
		else process.env.PORT = original
	})

	test.each([
		['4000', 4000],
		['abc', 3010],
		['0', 3010],
		['70000', 3010],
		['1.5', 3010],
	])('PORT=%s gives %i', (value, expected) => {
		process.env.PORT = value
		expect(serverPort()).toBe(expected)
	})

	test('unset PORT gives 3010', () => {
		delete process.env.PORT
		expect(serverPort()).toBe(3010)
	})
})
