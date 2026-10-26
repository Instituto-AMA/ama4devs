import { afterEach, describe, expect, test } from 'vitest'
import { rewriteLoopback } from './webhook-target.ts'

describe('rewriteLoopback', () => {
	const originalRewrite = process.env.WEBHOOK_LOCALHOST_REWRITE

	afterEach(() => {
		if (originalRewrite === undefined) {
			delete process.env.WEBHOOK_LOCALHOST_REWRITE
		} else {
			process.env.WEBHOOK_LOCALHOST_REWRITE = originalRewrite
		}
	})

	test('should return the URL unchanged when no rewrite host is configured', () => {
		delete process.env.WEBHOOK_LOCALHOST_REWRITE

		const url = 'http://localhost:3015/webhook'
		expect(rewriteLoopback(url)).toBe(url)
	})

	test('should rewrite localhost hosts', () => {
		process.env.WEBHOOK_LOCALHOST_REWRITE = 'host.docker.internal'

		expect(rewriteLoopback('http://localhost:3015/webhook')).toBe(
			'http://host.docker.internal:3015/webhook'
		)
	})

	test('should rewrite 127.0.0.1 hosts', () => {
		process.env.WEBHOOK_LOCALHOST_REWRITE = 'host.docker.internal'

		expect(rewriteLoopback('http://127.0.0.1:3015/webhook')).toBe(
			'http://host.docker.internal:3015/webhook'
		)
	})

	test('should rewrite IPv6 loopback hosts', () => {
		process.env.WEBHOOK_LOCALHOST_REWRITE = 'host.docker.internal'

		expect(rewriteLoopback('http://[::1]:3015/webhook')).toBe(
			'http://host.docker.internal:3015/webhook'
		)
	})

	test('should keep non-loopback hosts unchanged', () => {
		process.env.WEBHOOK_LOCALHOST_REWRITE = 'host.docker.internal'

		const url = 'https://example.com/webhook'
		expect(rewriteLoopback(url)).toBe(url)
	})

	test('should keep port and path', () => {
		process.env.WEBHOOK_LOCALHOST_REWRITE = 'host.docker.internal'

		expect(
			rewriteLoopback('http://localhost:8080/whatsapp/webhook?token=abc')
		).toBe('http://host.docker.internal:8080/whatsapp/webhook?token=abc')
	})

	test('should return the URL unchanged when it cannot be parsed', () => {
		process.env.WEBHOOK_LOCALHOST_REWRITE = 'host.docker.internal'

		const url = 'not-a-url'
		expect(rewriteLoopback(url)).toBe(url)
	})
})
