import { describe, expect, test } from 'vitest'
import type { TemplateStore } from '../store/template-store.ts'
import { renderTemplate } from '../template-render.ts'
import type { Template } from '../types/api-types.ts'

/** A store that knows one template. */
function storeWith(template: Template | null): TemplateStore {
	return {
		getTemplate: (name: string, language: string) => {
			if (!template) return undefined
			if (template.name !== name || template.language !== language) {
				return undefined
			}
			return template
		},
	} as unknown as TemplateStore
}

function templateWith(overrides: Partial<Template> = {}): Template {
	return {
		name: 'boas_vindas',
		language: 'pt_BR',
		category: 'UTILITY',
		components: [{ type: 'BODY', text: 'Olá, {{1}}!' }],
		...overrides,
	} as Template
}

describe('The renderer of the templates', () => {
	test('fills the variables of the body', () => {
		const result = renderTemplate(
			storeWith(templateWith()),
			'boas_vindas',
			'pt_BR',
			[{ type: 'text', parameter_name: '1', text: 'Mariana' }]
		)

		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.template.components[0].text).toBe('Olá, Mariana!')
	})

	test('fills a variable without a name by the position', () => {
		const result = renderTemplate(
			storeWith(templateWith()),
			'boas_vindas',
			'pt_BR',
			[{ type: 'text', text: 'Mariana' }]
		)

		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.template.components[0].text).toBe('Olá, Mariana!')
	})

	test('says that the template is not there', () => {
		const result = renderTemplate(storeWith(null), 'sumiu', 'pt_BR', [])

		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.error.details).toBe('TEMPLATE_NOT_FOUND')
		expect(result.error.message).toContain('not found')
		expect(result.error.data.template_name).toBe('sumiu')
	})

	test('says that the review did not approve the template', () => {
		const result = renderTemplate(
			storeWith(
				templateWith({
					review: { event: 'REJECTED', reason: 'The category does not match' },
				})
			),
			'boas_vindas',
			'pt_BR',
			[{ type: 'text', text: 'Mariana' }]
		)

		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.error.details).toBe('TEMPLATE_NOT_APPROVED')
		expect(result.error.message).toContain('not approved')
		expect(result.error.message).toContain('The category does not match')
		expect(result.error.data.review).toBe('REJECTED')
	})

	test('says that the variables of the body did not arrive', () => {
		const result = renderTemplate(
			storeWith(
				templateWith({
					components: [
						{ type: 'BODY', text: 'Olá, {{1}}! Sua cobrança de {{2}} venceu.' },
					],
				})
			),
			'boas_vindas',
			'pt_BR',
			[{ type: 'text', text: 'Mariana' }]
		)

		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.error.details).toBe('MISSING_PARAMETERS')
		expect(result.error.message).toContain('missing 1 parameter')
		expect(result.error.data.missing_parameters).toEqual(['2'])
		expect(result.error.data.expected).toBe(2)
		expect(result.error.data.got).toBe(1)
	})

	test('says that the call carries more variables than the body', () => {
		const result = renderTemplate(
			storeWith(templateWith()),
			'boas_vindas',
			'pt_BR',
			[
				{ type: 'text', text: 'Mariana' },
				{ type: 'text', text: 'extra' },
			]
		)

		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.error.details).toBe('PARAM_COUNT_MISMATCH')
		expect(result.error.message).toContain('expects 1 parameter')
	})

	test('the review is checked before the variables', () => {
		const result = renderTemplate(
			storeWith(
				templateWith({
					review: { event: 'PENDING' },
				})
			),
			'boas_vindas',
			'pt_BR',
			[]
		)

		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.error.details).toBe('TEMPLATE_NOT_APPROVED')
		expect(result.error.data.review).toBe('PENDING')
	})
})
