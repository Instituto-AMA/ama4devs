/**
 * The lifecycle of an outbound message: it leaves `queued`, reaches `sent` and
 * ends in the status the number stages, with a webhook on every change and a
 * manual status that wins over the timer.
 */
import { outcomeFor } from './core/phone.js'
import type { MessageStore, SettingsStore } from './store.ts'
import type { Message, Status } from './types.ts'
import type { Webhooks } from './webhooks.ts'

/** The outside world the lifecycle needs: the store, the settings, the webhooks and the timers. */
export interface LifecycleDeps {
  store: MessageStore
  settings: SettingsStore
  webhooks: Webhooks
  schedule: (fn: () => void, ms: number) => void
}

/** The lifecycle of the mock: it takes a stored message and moves it forward. */
export interface Lifecycle {
  /** Starts the life of an outbound message that was just stored as `queued`. */
  accept(message: Message): void
}

/** The outcome of a number, as the phone helper names it. */
type OutcomeKind = ReturnType<typeof outcomeFor>['kind']

/** One step of the life of a message: the status it reaches and when it reaches it. */
interface Step {
  status: Status
  errorCode?: number
  ms: number
}

/** The error a status carries when the caller names no code. */
const DEFAULT_ERRORS: Partial<Record<Status, { code: number; message: string }>> = {
  failed: { code: 30003, message: 'Unreachable destination handset' },
  undelivered: { code: 30005, message: 'Unknown destination handset' },
}

/** The message of the codes the carrier uses. */
const ERROR_MESSAGES: Record<number, string> = {
  30003: 'Unreachable destination handset',
  30005: 'Unknown destination handset',
  30007: 'Message filtered by the carrier',
}

/** The message of a code the mock does not know. */
const GENERIC_ERROR_MESSAGE = 'Delivery error'

/** The statuses a message does not leave anymore. */
const TERMINAL_STATUSES: readonly Status[] = ['delivered', 'failed', 'undelivered']

/**
 * The lifecycle: an accepted message is told to the webhooks as `queued` and
 * then walks the steps the outcome of its number stages.
 * @param deps The store, the settings, the webhooks and the timers.
 */
export function createLifecycle(deps: LifecycleDeps): Lifecycle {
  /**
   * Starts the life of a message: the `queued` state goes to the webhooks and
   * the steps of the outcome run now or on the timers.
   * @param message The message the store just took as `queued`.
   */
  const accept = (message: Message): void => {
    void deps.webhooks.notify(message, 'status')

    const settings = deps.settings.get()
    if (settings.autoDeliver === false) return

    const delay = settings.deliveryDelayMs
    for (const step of stepsFor(outcomeFor(message.to).kind, delay)) {
      if (delay <= 0) {
        stepOf(deps, message.id, step)
      } else {
        deps.schedule(() => stepOf(deps, message.id, step), step.ms)
      }
    }
  }

  return { accept }
}

/**
 * Changes the status of a message and tells the webhooks. The status carries
 * the error of its kind when the caller names no code; a code the mock knows
 * keeps its own message and any other code is a plain delivery error.
 * @param deps The store and the webhooks.
 * @param id The id of the message.
 * @param status The status the message reaches.
 * @param errorCode The code of the failure, when there is one.
 * @returns The changed message, or nothing when the store does not know the id.
 */
export function applyStatus(
  deps: Pick<LifecycleDeps, 'store' | 'webhooks'>,
  id: string,
  status: Status,
  errorCode?: number,
): Message | undefined {
  const failure =
    errorCode !== undefined
      ? { code: errorCode, message: ERROR_MESSAGES[errorCode] ?? GENERIC_ERROR_MESSAGE }
      : DEFAULT_ERRORS[status]

  const updated = deps.store.update(id, {
    status,
    errorCode: failure ? failure.code : null,
    errorMessage: failure ? failure.message : null,
  })
  if (!updated) return undefined

  void deps.webhooks.notify(updated, 'status')
  return updated
}

/**
 * Applies a step of the life: a message that is gone or that already reached
 * a final status keeps it, so a manual status or a delete wins over the timer.
 * @param deps The store and the webhooks.
 * @param id The id of the message.
 * @param step The status the message reaches.
 */
function stepOf(deps: Pick<LifecycleDeps, 'store' | 'webhooks'>, id: string, step: Step): void {
  const current = deps.store.get(id)
  if (!current) return
  if (TERMINAL_STATUSES.includes(current.status)) return

  applyStatus(deps, id, step.status, step.errorCode)
}

/**
 * The steps the outcome of a number stages: every outcome sends the message
 * first and then, except when the handset never answers, ends it.
 * @param kind The outcome of the number.
 * @param delay How long the whole life takes.
 */
function stepsFor(kind: OutcomeKind, delay: number): Step[] {
  const sent: Step = { status: 'sent', ms: Math.round(delay / 3) }

  switch (kind) {
    case 'failed':
      return [sent, { status: 'failed', errorCode: 30003, ms: delay }]
    case 'undelivered':
      return [sent, { status: 'undelivered', errorCode: 30005, ms: delay }]
    case 'filtered':
      return [sent, { status: 'failed', errorCode: 30007, ms: delay }]
    case 'stuck':
      return [sent]
    case 'rejected':
    case 'normal':
    default:
      return [sent, { status: 'delivered', ms: delay }]
  }
}
