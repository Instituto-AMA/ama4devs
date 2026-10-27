/**
 * The review of a template, the way Meta runs it.
 *
 * A template created or edited through the Cloud API is born PENDING. The
 * review lands later: the template takes the verdict as its status, the file
 * is rewritten, the panel hears it, and every webhook of the mock receives
 * `message_template_status_update` with the business account as the entry.
 * The verdict and the wait come from the `X-Mock-Template-Review*` headers of
 * the call (`mock-headers.ts`); without them the template is approved in 2 s.
 */
import { getAllWebhookMappings, getWebhookUrl } from './config.ts'
import type { ReviewPlan } from './mock-headers.ts'
import { statusOf, type TemplateStore } from './store/template-store.ts'
import type { Template, WebhookPayload } from './types/api-types.ts'
import { sendWebhook } from './webhook-target.ts'
import { broadcast } from './websocket.ts'

/** The business account a template belongs to when the call named none. */
export const DEFAULT_WABA_ID = '100000000000001'

/** The reason Meta reports for a verdict that carries none. */
const DEFAULT_REASON: Record<string, string> = {
	APPROVED: 'NONE',
	REJECTED: 'INVALID_FORMAT',
	PAUSED: 'LOW_QUALITY',
	DISABLED: 'POLICY_VIOLATION',
	PENDING: 'NONE',
}

/** The reviews still running, one per template key. */
const running = new Map<string, ReturnType<typeof setTimeout>>()

function keyOf(template: Template): string {
	return `${template.name}_${template.language ?? 'en'}`
}

/**
 * Every address that hears the business account: the app callback and each
 * number's override. A template belongs to the account, not to a number.
 */
export function accountWebhookUrls(): string[] {
	const urls = new Set<string>()
	const fallback = getWebhookUrl()
	if (fallback) urls.add(fallback)
	for (const mapping of getAllWebhookMappings()) urls.add(mapping.url)
	return [...urls]
}

/** The payload Meta sends when a template changes status. */
export function templateStatusPayload(
	template: Template,
	reason: string | undefined
): WebhookPayload {
	const status = statusOf(template)
	// Meta sends the review of a template without the messaging metadata of a
	// number: the value is the template status alone.
	return {
		object: 'whatsapp_business_account',
		entry: [
			{
				id: template.wabaId ?? DEFAULT_WABA_ID,
				time: Math.floor(Date.now() / 1000),
				changes: [
					{
						value: {
							event: status,
							message_template_id: template.id ?? '',
							message_template_name: template.name,
							message_template_language: template.language ?? 'en',
							category: template.category ?? 'UTILITY',
							reason: reason || DEFAULT_REASON[status] || 'NONE',
						},
						field: 'message_template_status_update',
					},
				],
			},
		],
	} as unknown as WebhookPayload
}

/** Tell the panel and every webhook that the template changed status. */
export function announceStatus(template: Template): void {
	broadcast({
		type: 'TEMPLATE_STATUS',
		payload: {
			id: template.id,
			name: template.name,
			language: template.language,
			status: statusOf(template),
			reason: template.review?.reason ?? null,
		},
	})
	const payload = templateStatusPayload(template, template.review?.reason)
	for (const url of accountWebhookUrls()) {
		sendWebhook(url, payload).catch((error) => {
			console.error(`❌ Template status webhook failed: ${error.message}`)
		})
	}
}

/** Land the verdict: the template takes it as its status, file and all. */
async function land(
	store: TemplateStore,
	name: string,
	language: string
): Promise<void> {
	running.delete(`${name}_${language}`)
	const template = store.getTemplate(name, language)
	if (!template || statusOf(template) !== 'PENDING' || !template.review) return
	if (template.review.event === 'PENDING') return

	const reviewed = await store.upsertTemplate({
		...template,
		status: template.review.event,
	})
	console.log(
		`📋 Template ${reviewed.name} (${reviewed.language}) reviewed: ${reviewed.status}`
	)
	announceStatus(reviewed)
}

/** Start (or restart) the review of a template that is PENDING. */
export function scheduleReview(store: TemplateStore, template: Template): void {
	const key = keyOf(template)
	const previous = running.get(key)
	if (previous) clearTimeout(previous)
	const delayMs = template.review?.delayMs ?? 0
	const { name } = template
	const language = template.language ?? 'en'
	running.set(
		key,
		setTimeout(() => {
			land(store, name, language).catch((error) => {
				console.error(`❌ Review of ${key} failed:`, error)
			})
		}, delayMs)
	)
}

/** Forget the review of a template that left the library. */
export function cancelReview(template: Template): void {
	const key = keyOf(template)
	const timer = running.get(key)
	if (timer) clearTimeout(timer)
	running.delete(key)
}

/**
 * Submit a template to the review: it becomes PENDING, carries the plan, and
 * the verdict lands after the delay.
 */
export async function submitForReview(
	store: TemplateStore,
	template: Template,
	plan: ReviewPlan
): Promise<Template> {
	const saved = await store.upsertTemplate({
		...template,
		status: 'PENDING',
		review: {
			event: plan.event,
			...(plan.reason ? { reason: plan.reason } : {}),
			delayMs: plan.delayMs,
		},
	})
	broadcast({
		type: 'TEMPLATE_STATUS',
		payload: {
			id: saved.id,
			name: saved.name,
			language: saved.language,
			status: 'PENDING',
			reason: null,
		},
	})
	scheduleReview(store, saved)
	return saved
}

/** A restart does not lose a review: the PENDING templates resume theirs. */
export function resumeReviews(store: TemplateStore): void {
	for (const template of store.getAllTemplates()) {
		if (statusOf(template) === 'PENDING' && template.review) {
			scheduleReview(store, template)
		}
	}
}
