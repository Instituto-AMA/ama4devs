// WhatsApp Cloud API Types for Mock Server

/** The states of a template in the review of Meta. */
export type TemplateStatus =
	| 'PENDING'
	| 'APPROVED'
	| 'REJECTED'
	| 'PAUSED'
	| 'DISABLED'

/** Template structure based on WhatsApp Business API format */
export interface Template {
	/** The id Meta gives the template; derived from the name and the language. */
	id?: string
	name: string
	language?: string
	category?: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION'
	components: TemplateComponent[]
	/** Where the template is in the review. A template without one is approved. */
	status?: TemplateStatus
	/** The business account the template was created in, for the status webhook. */
	wabaId?: string
	variables?: Record<
		string,
		{
			description: string
			example: string
		}
	>
	/**
	 * The verdict the review of the mock gives this template (the
	 * `X-Mock-Template-Review*` headers of the call that created or edited it).
	 * The template waits `delayMs` as PENDING, then takes `event` as its status
	 * and the application hears it through `message_template_status_update`.
	 */
	review?: {
		event: TemplateStatus
		reason?: string
		delayMs?: number
	}
}

/** A button of a template, as Meta writes it at creation. */
export interface TemplateButton {
	/** QUICK_REPLY, URL, PHONE_NUMBER, COPY_CODE, OTP, FLOW, CATALOG, MPM… */
	type: string
	text?: string
	url?: string
	phone_number?: string
	/** The sample of a URL suffix or of a code to copy. */
	example?: string | string[]
}

export interface TemplateComponent {
	/** HEADER, BODY, FOOTER, BUTTONS, CAROUSEL, LIMITED_TIME_OFFER… */
	type: 'HEADER' | 'BODY' | 'FOOTER' | 'BUTTONS' | 'CAROUSEL' | (string & {})
	format?: 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'LOCATION' | (string & {})
	text?: string
	/** The example values Meta asks for at creation (`body_text`, `header_text`, `header_handle`). */
	example?: Record<string, unknown>
	buttons?: TemplateButton[]
	/** The cards of a carousel: each a header, a body and buttons. */
	cards?: Array<{ components: TemplateComponent[] }>
	/** The offer line of a LIMITED_TIME_OFFER component. */
	limited_time_offer?: { text?: string; has_expiration?: boolean }
	/** Authentication: the security line Meta adds to the body. */
	add_security_recommendation?: boolean
	/** Authentication: the expiry line Meta writes in the footer. */
	code_expiration_minutes?: number
}

export interface WhatsAppSendMessageRequest {
	messaging_product: 'whatsapp'
	to: string
	type: 'text' | 'template'
	text?: {
		body: string
	}
	template?: {
		name: string
		language: { code: string }
		components?: Array<{
			type: 'header' | 'body' | 'button'
			parameters: Array<{
				type: 'text'
				/** The Cloud API lets it out: without a name, the parameter fills the next variable. */
				parameter_name?: string
				text: string
			}>
		}>
	}
}

export interface WhatsAppSendMessageResponse {
	messaging_product: string
	contacts?: Array<{
		input: string
		wa_id: string
	}>
	messages?: Array<{
		id: string
	}>
}

export interface WhatsAppTypingRequest {
	messaging_product: 'whatsapp'
	status: 'read'
	message_id: string
	typing_indicator: {
		type: 'text'
	}
}

export interface WhatsAppTypingResponse {
	success: boolean
}

export interface WhatsAppErrorResponse {
	error: {
		message: string
		type: string
		code: number
		error_subcode?: number
		fbtrace_id?: string
	}
}

// Webhook simulation types
export interface WebhookConfiguration {
	url: string
	verify_token?: string
	enabled: boolean
	phoneNumberId: string
}

export interface SimulateMessageParams {
	from: string
	to: string
	/** Contact profile name; the webhook falls back to `User <from>` */
	name?: string
	message: {
		/** Generated (`wamid.…`) when absent */
		id?: string
		type: 'text'
		/** Unix seconds; the current time when absent */
		timestamp?: string
		text: {
			body: string
		}
	}
}

/** Standard message status update payload */
export interface MessageStatusUpdate {
	id: string
	status: 'sent' | 'delivered' | 'read' | 'failed'
	timestamp: string
	recipient_id: string
	/** Cloud API errors carried by a `failed` status */
	errors?: Array<{ code: number; title: string }>
	conversation?: {
		id: string
		expiration_timestamp: string
		origin: {
			type: string
		}
	}
	pricing?: {
		category: string
		pricing_model: string
	}
}

/** Template-specific message status update with template metadata */
export interface TemplateMessageStatusUpdate extends MessageStatusUpdate {
	template?: {
		name: string
		language: string
		category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION'
	}
	/** Template processing error details for failed status */
	error?: {
		code: string
		title: string
		message: string
		error_data?: {
			details?: string
		}
	}
}

/** Template approval/rejection status update */
export interface TemplateStatusUpdate {
	event: 'PENDING' | 'APPROVED' | 'REJECTED' | 'PAUSED' | 'DISABLED'
	message_template_id: string
	message_template_name: string
	message_template_language: string
	category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION'
	reason?: string
	status_details?: string
	timestamp?: string
	/** Additional error details for rejected templates */
	errors?: Array<{
		code: string
		title: string
		message: string
		error_data?: {
			component_index?: number
			button_position?: number
			details?: string
		}
	}>
}

export interface WebhookPayload {
	object: 'whatsapp_business_account'
	entry: Array<{
		id: string
		/** Unix seconds, on the business account events (template reviews). */
		time?: number
		changes: Array<{
			value:
				| {
						messaging_product: 'whatsapp'
						metadata: {
							display_phone_number: string
							phone_number_id: string
						}
						contacts?: Array<{
							profile?: { name: string }
							wa_id: string
						}>
						messages?: Array<
							({
								from: string
								id: string
								timestamp: string
							} & (
								| {
										text: { body: string }
										type: 'text'
								  }
								| {
										type: string
								  }
							)) & {
								context?: {
									id: string
									from?: string
									forwarded?: boolean
									frequently_forwarded?: boolean
								}
							}
						>
						/** Standard message delivery statuses */
						statuses?: MessageStatusUpdate[]
						/** Template-specific message delivery statuses */
						template_statuses?: TemplateMessageStatusUpdate[]
				  }
				| ({
						/** Template approval/rejection status updates */
						messaging_product: 'whatsapp'
						metadata: {
							display_phone_number: string
							phone_number_id: string
						}
				  } & TemplateStatusUpdate)
			field: 'messages' | 'message_template_status_update'
		}>
	}>
}
