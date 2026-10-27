/**
 * The Graph versions the mock serves.
 *
 * Each version is a folder of `spec/` (Meta's specification and its errata)
 * and a set of operations the mock simulates with state. Everything else in
 * the specification answers with Meta's example. A new version (v24.0) is a
 * new folder and a new entry here, starting from the previous set; when an
 * operation changes behaviour, its simulation branches on the version.
 */
import { type GraphSpec, loadSpec } from './spec.ts'

/** The operations of v23.0 the mock runs with state (operationIds of the spec). */
const V23_STATEFUL = [
	// Messages: both sides of the conversation, receipts, typing.
	'sendMessage',
	// Templates: the library, the review, the status webhook.
	'getTemplateByNameDefaultFields',
	'createAuthenticationTemplateWOtpCopyCodeButton',
	'deleteTemplateByName',
	'getTemplateByIdDefaultFields',
	'editTemplate',
	// Media: the upload, its URL and its bytes, the delete.
	'uploadImage',
	'retrieveMediaUrl',
	'deleteMedia',
	// Phone numbers: the node, its webhook override and its settings.
	'getPhoneNumberById',
	'updatePhoneNumberStatus',
	// Accounts: the business's WABAs, a WABA's numbers, the onboarding of a
	// number (code, verification, registration) and its feature settings.
	'getOwnedWhatsAppBusinessAccounts',
	'getWhatsAppBusinessAccountDetails',
	'updateWhatsAppBusinessAccount',
	'getWhatsAppBusinessAccountPhoneNumbers',
	'createWhatsAppBusinessAccountPhoneNumber',
	'requestVerificationCode',
	'verifyPhoneNumberCode',
	'registerWhatsAppBusinessPhoneNumber',
	'deregisterPhoneNumber',
	'getPhoneNumberSettings',
	'updatePhoneNumberSettings',
	// Calls: both directions, real WebRTC SDP, and the users' permissions.
	'manageCalls',
	'checkCallPermissions',
] as const

export const GRAPH_VERSIONS: Record<string, readonly string[]> = {
	'v23.0': V23_STATEFUL,
}

export const LATEST_VERSION = 'v23.0'

/** Load every version's specification. */
export function loadSpecs(): Map<string, GraphSpec> {
	return new Map(
		Object.keys(GRAPH_VERSIONS).map((version) => [version, loadSpec(version)])
	)
}

const statefulSets = new Map(
	Object.entries(GRAPH_VERSIONS).map(([version, ids]) => [
		version,
		new Set(ids),
	])
)

export function statefulOperations(version: string): Set<string> {
	return statefulSets.get(version) ?? new Set()
}
