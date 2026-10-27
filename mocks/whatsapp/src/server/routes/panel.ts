import { Hono } from 'hono'
import { buildReference } from '../../graph/reference.ts'
import type { GraphSpec } from '../../graph/spec.ts'
import { LATEST_VERSION, statefulOperations } from '../../graph/versions.ts'
import { templateIdOf } from '../store/template-store.ts'
import { panelHtml } from '../ui/panel.ts'

/** Where the panel's script finds the Cloud API reference. */
const REFERENCE_SLOT = '<!--REFERENCE-->'

/**
 * The panel, with the reference of the latest Graph version inlined: the API
 * tab documents every operation of Meta's spec without a call of its own.
 * Built on the first visit, once per process.
 */
export function createPanelRouter(specs: () => Map<string, GraphSpec>) {
	let html: string | null = null
	const page = () => {
		if (html) return html
		const spec = specs().get(LATEST_VERSION)
		const reference = spec
			? buildReference(
					spec,
					statefulOperations(LATEST_VERSION),
					templateIdOf('hello_world', 'en_US')
				)
			: { version: LATEST_VERSION, topics: [] }
		// `<` is escaped so no text of the spec can close the script element.
		const json = JSON.stringify(reference).replaceAll('<', '\\u003c')
		html = panelHtml.replace(
			REFERENCE_SLOT,
			`<script type="application/json" id="reference">${json}</script>`
		)
		return html
	}

	const panelRouter = new Hono()
	// GET / - Serve the inline web panel
	panelRouter.get('/', (c) => c.html(page()))
	return panelRouter
}
