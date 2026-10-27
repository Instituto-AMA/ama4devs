/**
 * The example templates of the mock (`templates/examples/`), for the panel:
 * which templates of the library are examples, so it lists them apart, and
 * the sample files their media headers point at (`example.header_handle` is
 * `/settings/examples/media/<file>`), so a bubble can show them.
 */
import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { Hono } from 'hono'
import type { TemplateStore } from '../store/template-store.ts'

const SAMPLE_TYPES: Record<string, string> = {
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.png': 'image/png',
	'.mp4': 'video/mp4',
	'.pdf': 'application/pdf',
}

/** A file name and nothing else: no folder, no way out of media/. */
const SAMPLE_NAME = /^[a-z0-9][a-z0-9_-]*\.[a-z0-9]+$/i

export function createExamplesRouter(store: TemplateStore) {
	const router = new Hono()

	router.get('/examples', (c) => c.json({ data: store.getExamples() }))

	router.get('/examples/media/:file', async (c) => {
		const file = c.req.param('file')
		const type = SAMPLE_TYPES[extname(file).toLowerCase()]
		if (!SAMPLE_NAME.test(file) || !type) return c.notFound()
		const bytes = await readFile(join(store.examplesDir, 'media', file)).catch(
			() => null
		)
		if (!bytes) return c.notFound()
		return c.body(new Uint8Array(bytes), 200, {
			'Content-Type': type,
			'Cache-Control': 'public, max-age=3600',
		})
	})

	return router
}
