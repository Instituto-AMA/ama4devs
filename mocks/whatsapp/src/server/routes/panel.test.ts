import { Hono } from 'hono'
import { describe, expect, test } from 'vitest'
import { graphSpecs } from '../server.ts'
import { createPanelRouter } from './panel.ts'

describe('Panel route', () => {
	const app = new Hono()
	app.route('/', createPanelRouter(graphSpecs))

	test('GET / serves the html panel', async () => {
		const res = await app.request('/')
		expect(res.status).toBe(200)
		expect(res.headers.get('content-type')).toContain('text/html')
		const body = await res.text()
		expect(body).toContain('Responder como usuário')
	})

	test('the page carries the reference of every Cloud API operation', async () => {
		const body = await (await app.request('/')).text()
		const json = body.match(
			/<script type="application\/json" id="reference">(.*?)<\/script>/s
		)?.[1]
		expect(json).toBeDefined()
		const reference = JSON.parse(json ?? '{}') as {
			version: string
			topics: Array<{ name: string; operations: Array<{ id: string }> }>
		}
		expect(reference.version).toBe('v23.0')
		expect(reference.topics[0].name).toBe('Messages')
		const operations = reference.topics.flatMap((t) => t.operations)
		const spec = graphSpecs().get('v23.0')
		expect(operations).toHaveLength(spec?.operations.length ?? -1)
	})

	test('the page loads nothing from another host', async () => {
		const body = await (await app.request('/')).text()
		/*
		 * The panel is self-contained: no script, style, image or font comes
		 * from another host. Meta's descriptions may cite Meta's guides as
		 * text, which the page never fetches.
		 */
		const loads =
			body.match(
				/(?:src|href)=["']https?:\/\/[^"']+|url\(["']?https?:\/\/[^)"']+/g
			) ?? []
		for (const load of loads) {
			expect(load).toMatch(
				/https?:\/\/(localhost|127\.0\.0\.1|\[::1\])([:/]|$)/
			)
		}
	})
})
