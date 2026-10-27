/**
 * The headers that tune the mock on a Cloud API call.
 *
 * Every Cloud API route of the mock behaves like Meta: the body is the body
 * Meta reads, the answer is the answer Meta gives. What only a test needs (the
 * verdict of a template review, how long the review takes, skipping the
 * callback verification) travels in these headers. They are optional: a call
 * without them gets the default behaviour, and Meta never sees them, because
 * only a development configuration sends them.
 */
import type { TemplateStatus } from './types/api-types.ts'

export const MOCK_HEADERS = {
	/** The verdict of the review of the template the call creates or edits. */
	review: 'x-mock-template-review',
	/** Why the review gave that verdict, reported in the status webhook. */
	reviewReason: 'x-mock-template-review-reason',
	/** How long the template stays PENDING before the verdict, in ms. */
	reviewDelay: 'x-mock-template-review-delay',
	/** `true` registers a webhook without calling it to verify it first. */
	skipCallbackVerification: 'x-mock-skip-callback-verification',
	/**
	 * The user's wa_id: the call on `/{phone-number-id}/messages` is made by
	 * the user's phone, not by the clinic. A message enters the conversation
	 * from the user; a `status` body is the user's phone receipt.
	 */
	from: 'x-mock-from',
	/** The profile name of that user, as the inbound webhook carries it. */
	contactName: 'x-mock-contact-name',
	/** The receipt the user's phone gives: delivered, read or failed. */
	messageStatus: 'x-mock-message-status',
} as const

/** The receipts a user's phone gives a clinic message. */
export const RECEIPTS = ['delivered', 'read', 'failed'] as const
export type Receipt = (typeof RECEIPTS)[number]

/** The receipt the caller asked for; the Meta body's `read` when it said none. */
export function readReceipt(header: string | undefined | null): Receipt | null {
	if (!header) return 'read'
	const value = header.trim().toLowerCase()
	return (RECEIPTS as readonly string[]).includes(value)
		? (value as Receipt)
		: null
}

/** The verdicts the review of the mock knows. PENDING keeps it in review. */
export const REVIEW_EVENTS = [
	'APPROVED',
	'PENDING',
	'REJECTED',
	'PAUSED',
	'DISABLED',
] as const satisfies readonly TemplateStatus[]

export type ReviewEvent = (typeof REVIEW_EVENTS)[number]

/** The longest review the mock holds a template for: ten minutes. */
export const MAX_REVIEW_DELAY_MS = 600_000

/** The review the mock gives when the call says nothing: approved in 2 s. */
export function defaultReviewDelayMs(): number {
	const fromEnv = Number(process.env.MOCK_TEMPLATE_REVIEW_DELAY_MS)
	return Number.isInteger(fromEnv) &&
		fromEnv >= 0 &&
		fromEnv <= MAX_REVIEW_DELAY_MS
		? fromEnv
		: 2000
}

export function isReviewEvent(value: unknown): value is ReviewEvent {
	return (
		typeof value === 'string' &&
		(REVIEW_EVENTS as readonly string[]).includes(value)
	)
}

/** The verdict the caller asked for, when the header carries a known one. */
export function readReview(
	header: string | undefined | null
): ReviewEvent | undefined {
	if (!header) return undefined
	const value = header.trim().toUpperCase()
	return isReviewEvent(value) ? value : undefined
}

/** The review delay in milliseconds, when the header carries a valid one. */
export function readReviewDelay(
	header: string | undefined | null
): number | undefined {
	if (!header) return undefined
	const value = Number(header.trim())
	if (!Number.isInteger(value) || value < 0 || value > MAX_REVIEW_DELAY_MS) {
		return undefined
	}
	return value
}

/** The plan of a review: the verdict, its reason and when it lands. */
export interface ReviewPlan {
	event: ReviewEvent
	reason?: string
	delayMs: number
}

/** Read the review plan of a call; the defaults fill what it left out. */
export function readReviewPlan(
	header: (name: string) => string | undefined
): ReviewPlan {
	const reason = header(MOCK_HEADERS.reviewReason)?.trim()
	return {
		event: readReview(header(MOCK_HEADERS.review)) ?? 'APPROVED',
		...(reason ? { reason } : {}),
		delayMs:
			readReviewDelay(header(MOCK_HEADERS.reviewDelay)) ??
			defaultReviewDelayMs(),
	}
}

/** Whether the caller asked to register a webhook without verifying it. */
export function skipsCallbackVerification(
	header: string | undefined | null
): boolean {
	return header?.trim().toLowerCase() === 'true'
}
