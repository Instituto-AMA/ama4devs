import 'dotenv/config'
import { serve } from '@hono/node-server'
import { createNodeWebSocket } from '@hono/node-ws'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { graphEngine } from '../graph/engine.ts'
import { NodeRegistry } from '../graph/nodes.ts'
import type { GraphSpec } from '../graph/spec.ts'
import { loadSpecs, statefulOperations } from '../graph/versions.ts'
import { closeStaleCalls, listCalls } from './calls.ts'
import { allowedHosts, getWebhookConfig, serverPort } from './config.ts'
import { getTemplatesConfig } from './configuration.ts'
import { isAllowedOrigin, localGuard } from './middleware/local-guard.ts'
import {
	createAccountsRouter,
	createAccountsSettingsRouter,
} from './routes/accounts.ts'
import { createCallsRouter } from './routes/calls.ts'
import { createExamplesRouter } from './routes/examples.ts'
import { createMediaDownloadRouter, createMediaRouter } from './routes/media.ts'
import { createMessagesRouter } from './routes/messages.ts'
import { createNodesRouter } from './routes/nodes.ts'
import { createPanelRouter } from './routes/panel.ts'
import { settingsRouter } from './routes/settings.ts'
import { startStatsInterval, statusRouter } from './routes/status.ts'
import { createTemplatesRouter } from './routes/templates.ts'
import { accountStore } from './store/account-store.ts'
import { mediaStore } from './store/media-store.ts'
import { TemplateStore } from './store/template-store.ts'
import { TemplateResolver } from './template-resolver.ts'
import { resumeReviews } from './template-review.ts'
import { addClient, removeClient } from './websocket.ts'

/** The specifications are read once per process: every app shares them. */
let specs: Map<string, GraphSpec> | null = null
export function graphSpecs(): Map<string, GraphSpec> {
	specs ??= loadSpecs()
	return specs
}

const REDACTED_HEADERS = new Set([
	'authorization',
	'cookie',
	'x-hub-signature-256',
])

export function createApp(templateStore: TemplateStore) {
	const app = new Hono()

	// Initialize webhook configuration from CLI arguments and environment
	getWebhookConfig()

	// The accounts boot configured: the default business, WABA and number
	// (registered, calling on) and the configured numbers. A call that was
	// going on when the mock stopped is over.
	accountStore.seed()
	closeStaleCalls()

	const { upgradeWebSocket, injectWebSocket } = createNodeWebSocket({
		app,
	})

	// Middleware
	// The guard runs first: every route is key-free, so every request needs an
	// allowed Host (and an allowed Origin when it writes or upgrades).
	const hosts = allowedHosts()
	app.use('*', localGuard(hosts))
	app.use(
		'*',
		cors({
			origin: (origin) => (isAllowedOrigin(origin, hosts) ? origin : null),
		})
	)
	app.use('*', logger())

	// Custom logging middleware for request bodies
	app.use('*', async (c, next) => {
		const method = c.req.method
		const path = c.req.path
		console.log(`[${new Date().toISOString()}] ${method} ${path}`)

		// Log headers
		const headerEntries = Object.entries(c.req.header()).map(
			([name, value]) =>
				[
					name,
					REDACTED_HEADERS.has(name.toLowerCase()) ? '[redacted]' : value,
				] as const
		)
		console.log('Headers:', Object.fromEntries(headerEntries))

		// Log body for POST/PUT requests
		if (method === 'POST' || method === 'PUT') {
			try {
				const clone = c.req.raw.clone()
				const bodyText = await clone.text()
				console.log('Body:', bodyText)
			} catch {
				// Body might not be readable, that's okay
			}
		}

		await next()
	})

	// Routes
	app.get('/health', (c) =>
		c.json({
			ok: true,
			message: 'Server is healthy',
			templates: templateStore.getStats(),
		})
	)

	// Debug endpoints (only in development)
	if (process.env.NODE_ENV !== 'production') {
		// Debug endpoint for templates
		app.get('/debug/templates', (c) =>
			c.json({
				stats: templateStore.getStats(),
				templates: templateStore.getAllTemplates(),
				templateNames: templateStore.getTemplateNames(),
			})
		)

		// Manual refresh endpoint for testing
		app.post('/debug/reload-templates', async (c) => {
			try {
				await templateStore.reloadTemplates()
				return c.json({
					success: true,
					message: 'Templates reloaded successfully',
					stats: templateStore.getStats(),
				})
			} catch (error) {
				return c.json(
					{
						success: false,
						message: 'Failed to reload templates',
						error: error instanceof Error ? error.message : 'Unknown error',
					},
					500
				)
			}
		})
	}

	// The Cloud API, one specification per Graph version (spec/<version>/).
	// The engine checks the version, the token, the operation and its body
	// against Meta's spec, then runs the operation: the simulation below for
	// the operations the mock keeps state of, Meta's example for the rest.
	// What only a test needs travels in X-Mock-* headers (mock-headers.ts).
	const versionPath = '/:version{v[0-9]+\\.[0-9]+}'
	const simulation = new Hono()
	simulation.route(versionPath, createMessagesRouter(templateStore))
	simulation.route(versionPath, createTemplatesRouter(templateStore))
	// A media id is answered by the media router; any other id goes on to nodes.
	simulation.route(versionPath, createMediaRouter(mediaStore))
	simulation.route(versionPath, createAccountsRouter())
	simulation.route(versionPath, createCallsRouter())
	simulation.route(versionPath, createNodesRouter(templateStore))
	const nodes = new NodeRegistry()
	nodes.register('template', (id) => !!templateStore.getTemplateById(id))
	nodes.register('media', (id) => mediaStore.known(id))
	nodes.register('waba', (id) => !!accountStore.waba(id))
	nodes.register('business', (id) => !!accountStore.business(id))
	nodes.register('phone', (id) => !!accountStore.number(id))
	app.all(
		`${versionPath}/*`,
		graphEngine({
			specs: graphSpecs(),
			nodes,
			stateful: statefulOperations,
			simulation,
		})
	)
	// What Meta has no call for: how the mock behaves and what it shows.
	// Meta's download URL of a media (lookaside.fbsbx.com in production).
	app.route('/', createMediaDownloadRouter(mediaStore))
	app.route('/settings', settingsRouter)
	app.route('/settings', createExamplesRouter(templateStore))
	app.route('/settings', createAccountsSettingsRouter())
	app.get('/settings/calls', (c) => c.json({ calls: listCalls() }))
	app.route('/status', statusRouter)

	app.route('/', createPanelRouter(graphSpecs))

	// 404 handler
	app.notFound((c) => {
		return c.json(
			{
				error: {
					message: `WhatsApp Mock Server: Route ${c.req.method} ${c.req.path} not found`,
					type: 'not_found',
					code: 404,
				},
			},
			404
		)
	})

	// Error handler
	app.onError((err, c) => {
		console.error('Error:', err)
		return c.json(
			{
				error: {
					message: 'Internal server error',
					type: 'server_error',
					code: 500,
				},
			},
			500
		)
	})

	app.get(
		'/ws',
		upgradeWebSocket((c) => {
			return {
				onOpen: (_evt, ws) => {
					console.log('WebSocket connection opened')
					// biome-ignore lint/suspicious/noExplicitAny: agent wrote this
					addClient(ws as any)
				},
				onClose: (_evt, ws) => {
					console.log('WebSocket connection closed')
					// biome-ignore lint/suspicious/noExplicitAny: agent wrote this
					removeClient(ws as any)
				},
				onError: (err, ws) => {
					console.error('WebSocket error:', err)
					// biome-ignore lint/suspicious/noExplicitAny: agent wrote this
					removeClient(ws as any)
				},
			}
		})
	)

	return { app, injectWebSocket }
}

export async function startServer(port = serverPort()) {
	// Load templates configuration and create template store
	const templatesConfig = getTemplatesConfig()
	let templateResolver: TemplateResolver | undefined
	if (templatesConfig?.cmd) {
		templateResolver = new TemplateResolver(templatesConfig.cmd)
	}

	// Create template store with optional resolver
	const store = new TemplateStore('./templates', templateResolver)
	await store.initialize().catch((error) => {
		console.error('❌ Failed to initialize template store:', error)
		throw error
	})

	// A template that was in review when the mock stopped resumes its review.
	resumeReviews(store)

	const { app, injectWebSocket } = createApp(store)

	const server = serve({
		fetch: app.fetch,
		port: port,
	})

	injectWebSocket(server)

	// Start the stats broadcasting interval
	startStatsInterval()

	console.log(`🚀 Server is running on port ${port}`)
	console.log(`Websocket server is running on ws://localhost:${port}/ws`)

	return server
}
