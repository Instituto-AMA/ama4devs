import { Hono } from 'hono'
import { describe, expect, test } from 'vitest'
import { panelRouter } from './panel.ts'

describe('Panel route', () => {
	const app = new Hono()
	app.route('/', panelRouter)

	test('GET / serves the html panel', async () => {
		const res = await app.request('/')
		expect(res.status).toBe(200)
		expect(res.headers.get('content-type')).toContain('text/html')
		const body = await res.text()
		expect(body).toContain('Responder como paciente')
	})

	test('the page references no external host', async () => {
		const res = await app.request('/')
		const body = await res.text()
		expect(body).not.toMatch(/https?:\/\//)
	})
})
