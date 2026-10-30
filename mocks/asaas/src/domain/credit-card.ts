/**
 * Credit card: brand, validation and the test cards. PURE.
 *
 * It touches no database, no clock and no HTTP — it receives the number (and the
 * `now`) and returns DATA.
 *
 * What this file guarantees, and the reason it exists:
 *
 *   1. The FULL PAN NEVER LEAVES HERE. `inspectCard` returns `last4`, the brand and
 *      the simulated outcome — never the number. The caller has no way to persist
 *      the PAN by accident, because it never gets it back.
 *
 *   2. The test cards and the error messages are DATA, not `if`s scattered through
 *      the handler. The panel serves the SAME table the engine consults — there is
 *      no way for the screen to document a card the server does not honour.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EVERYTHING BELOW WAS CAPTURED FROM THE REAL SANDBOX (tools/probe-cards.ts), not
 * deduced. The capture knocked down four things this file used to claim:
 *
 *   • The refusal is NOT `invalid_creditCard`. It is **`invalid_action`**, with a
 *     different sentence. A client that branches on `code` behaved differently
 *     against the mock and against Asaas — which is exactly the bug this project
 *     exists to prevent.
 *
 *   • Asaas does NOT validate Luhn. `4111111111111112` (wrong check digit) is
 *     APPROVED there. We used to refuse it: a card that worked in production broke
 *     in the local test. Luhn is still exported — it serves for the panel to
 *     suggest plausible numbers — but it no longer refuses anything.
 *
 *   • A 1-digit CVV is ACCEPTED. Only an empty one is refused.
 *
 *   • An expired card is REFUSED — and we did not even look at the date.
 *
 * If you change any message here, run `bun tools/probe-cards.ts` against the
 * sandbox and prove that Asaas changed first.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * The spec's `CreditCardBrand` enum, in full — the response is validated against
 * it. `BRAND_RULES` only knows how to detect a subset; the rest exists for whoever
 * wants to extend the table without touching the type.
 */
export type CardBrand =
  | 'VISA'
  | 'MASTERCARD'
  | 'ELO'
  | 'DINERS'
  | 'DISCOVER'
  | 'AMEX'
  | 'CABAL'
  | 'BANESCARD'
  | 'CREDZ'
  | 'SOROCRED'
  | 'CREDSYSTEM'
  | 'JCB'
  | 'UNKNOWN'

/**
 * The simulated outcome of a card.
 *
 * `APPROVE` and `DECLINE` are AUTHORIZATION outcomes: the card is valid, enters the
 * vault, becomes a token — and only at charging time does the "acquirer" answer. The
 * others are VALIDATION ones: Asaas refuses the request at the door, and no token
 * is ever born.
 *
 * The distinction is not academic: a tokenized `DECLINE` card keeps declining when
 * charged by the token, and that is how Asaas behaves.
 */
export type SimulatedOutcome =
  | 'APPROVE'
  | 'DECLINE'
  | 'DECLINE_ON_CHARGE'
  | 'EXPIRED'
  | 'INVALID_NUMBER'
  | 'INVALID_MONTH'
  | 'MISSING_CVV'
  | 'MISSING_HOLDER'

/** The outcomes that survive the validation and become a token. */
export type AuthorizationOutcome = Extract<
  SimulatedOutcome,
  'APPROVE' | 'DECLINE' | 'DECLINE_ON_CHARGE'
>

/** Domain error. Pure — the edge translates it into the Asaas error format. */
export class CreditCardError extends Error {
  constructor(
    readonly code: string,
    readonly description: string,
  ) {
    super(description)
    this.name = 'CreditCardError'
  }
}

/**
 * Asaas's messages, WORD BY WORD. Including the "invalido" without an accent in
 * INVALID_MONTH — the typo is theirs, and reproducing it is the point: a client
 * that compares the string finds the same string here and there.
 */
export const CARD_ERRORS: Readonly<
  Record<Exclude<SimulatedOutcome, 'APPROVE'>, { code: string; description: string }>
> = {
  DECLINE: {
    code: 'invalid_action',
    description:
      'Transação não autorizada. Verifique os dados do cartão de crédito e tente novamente.',
  },
  // The SAME error as DECLINE — what changes is WHEN it happens, not what the client
  // receives. See the DECLINE_ON_CHARGE comment in TEST_CARDS.
  DECLINE_ON_CHARGE: {
    code: 'invalid_action',
    description:
      'Transação não autorizada. Verifique os dados do cartão de crédito e tente novamente.',
  },
  INVALID_NUMBER: {
    code: 'invalid_creditCard',
    description:
      'O número do cartão é inválido. Verifique se todos os números foram informados corretamente.',
  },
  EXPIRED: {
    code: 'invalid_creditCard',
    description: 'O cartão informado está expirado.',
  },
  INVALID_MONTH: {
    code: 'invalid_creditCard',
    description: 'O mês de vencimento do cartão é invalido.',
  },
  MISSING_CVV: {
    code: 'invalid_creditCard',
    description: 'Informe o código de segurança do seu cartão.',
  },
  MISSING_HOLDER: {
    code: 'invalid_creditCard',
    description: 'Informe o nome do portador.',
  },
}

const errorFor = (outcome: Exclude<SimulatedOutcome, 'APPROVE'>) => {
  const e = CARD_ERRORS[outcome]
  return new CreditCardError(e.code, e.description)
}

/** A row of the test card table. It is what the panel displays. */
export interface TestCard {
  number: string
  outcome: SimulatedOutcome
  /** What this card does, in Portuguese, for the screen. */
  label: string
  /**
   * `true` when the REAL Asaas sandbox does the same thing with this number.
   *
   * `false` is our own extension: in the real Asaas the number would be APPROVED.
   * The distinction has to show up in the panel, otherwise someone writes a test
   * against a behaviour that only exists here and finds out in production.
   */
  real: boolean
}

/**
 * The table. It is DATA, and it is injectable.
 *
 * The first four were verified against the sandbox. The next three are
 * SIMULATION: industry numbers (the "canonical" ones every developer recognizes)
 * that would approve in the real Asaas — here they force an error, so the error
 * handling can be exercised by swapping a number instead of forging a payload.
 *
 * Why only these three, and not one card per error? Because `MISSING_CVV` and
 * `MISSING_HOLDER` are properties of OTHER fields. A number that returned "Informe
 * o nome do portador" when the name WAS given would be a lying message. Those
 * errors fire by breaking the field — which is how Asaas produces them. `TRIGGERS`
 * below says how.
 */
export type TestCardTable = readonly TestCard[]

export const TEST_CARDS: TestCardTable = [
  { number: '5162306219378829', outcome: 'APPROVE', label: 'Aprova', real: true },
  { number: '4444444444444444', outcome: 'APPROVE', label: 'Aprova', real: true },
  { number: '5184019740373151', outcome: 'DECLINE', label: 'Recusa do emissor', real: true },
  { number: '4916561358240741', outcome: 'DECLINE', label: 'Recusa do emissor', real: true },

  { number: '4000000000000002', outcome: 'DECLINE', label: 'Recusa do emissor', real: false },
  { number: '4000000000000069', outcome: 'EXPIRED', label: 'Cartão expirado', real: false },
  { number: '4000000000000101', outcome: 'INVALID_NUMBER', label: 'Número inválido', real: false },

  /**
   * The card that TOKENIZES and only refuses LATER — the only one here that
   * exists to plug a hole in the sandbox, not to reproduce it.
   *
   * In the real Asaas the tokenization AUTHORIZES: a card that declines never
   * becomes a token. Consequence: there, a saved card ALWAYS approves, and there
   * is no way to test the scenario that actually breaks a "saved card" feature —
   * the customer's card, saved months ago, failing on renewal. It is a real
   * scenario (limit exceeded, card cancelled) that the sandbox cannot produce.
   *
   * This number produces it. The error delivered is the REAL one (`invalid_action`,
   * same sentence): what is ours is the trigger, not the payload — so the client
   * learns to handle exactly what production will send.
   */
  {
    number: '4000000000000341',
    outcome: 'DECLINE_ON_CHARGE',
    label: 'Tokeniza, recusa ao cobrar',
    real: false,
  },
]

/**
 * The errors that do NOT fire from a number, and the field that produces them. The
 * panel shows this next to the table: without it, three of the six Asaas errors
 * would have no way to be exercised.
 */
export const TRIGGERS: ReadonlyArray<{
  outcome: Exclude<SimulatedOutcome, 'APPROVE' | 'DECLINE'>
  label: string
  how: string
}> = [
  { outcome: 'EXPIRED', label: 'Cartão expirado', how: 'expiryYear no passado (ex.: 2020)' },
  { outcome: 'INVALID_MONTH', label: 'Mês inválido', how: 'expiryMonth = 13' },
  { outcome: 'MISSING_CVV', label: 'CVV ausente', how: 'ccv = "" (1 dígito é aceito!)' },
  { outcome: 'MISSING_HOLDER', label: 'Titular ausente', how: 'holderName = ""' },
  { outcome: 'INVALID_NUMBER', label: 'Número inválido', how: 'number com menos de 13 dígitos' },
]

/**
 * Prefixes per brand. The match is by LONGEST PREFIX — `6011` (Discover) wins
 * over `6` (Elo).
 */
export interface BrandRule {
  brand: CardBrand
  prefixes: readonly string[]
}

export const BRAND_RULES: readonly BrandRule[] = [
  { brand: 'AMEX', prefixes: ['34', '37'] },
  { brand: 'DINERS', prefixes: ['30', '36', '38'] },
  { brand: 'JCB', prefixes: ['35'] },
  { brand: 'DISCOVER', prefixes: ['6011', '644', '645', '646', '647', '648', '649', '65'] },
  { brand: 'ELO', prefixes: ['6'] },
  { brand: 'VISA', prefixes: ['4'] },
  { brand: 'MASTERCARD', prefixes: ['5', '2'] },
]

/** Strips spaces and dashes. `4444 4444 4444 4444` → `4444444444444444`. */
export function normalizeCardNumber(raw: string): string {
  return String(raw ?? '').replace(/[\s.-]/g, '')
}

/**
 * The Luhn algorithm (mod 10).
 *
 * WARNING: **Asaas does not use this to refuse** — it was captured. It stays here
 * because it is useful to generate plausible numbers, not to judge the ones that
 * arrive.
 */
export function luhn(number: string): boolean {
  if (!/^\d+$/.test(number)) return false

  let sum = 0
  let double = false

  for (let i = number.length - 1; i >= 0; i--) {
    let digit = number.charCodeAt(i) - 48
    if (double) {
      digit *= 2
      if (digit > 9) digit -= 9
    }
    sum += digit
    double = !double
  }

  return sum % 10 === 0
}

/** The brand, by prefix. `UNKNOWN` when no range matches. */
export function detectBrand(number: string, rules: readonly BrandRule[] = BRAND_RULES): CardBrand {
  const n = normalizeCardNumber(number)

  let best: { brand: CardBrand; len: number } | null = null
  for (const rule of rules) {
    for (const prefix of rule.prefixes) {
      if (n.startsWith(prefix) && (best === null || prefix.length > best.len)) {
        best = { brand: rule.brand, len: prefix.length }
      }
    }
  }

  return best?.brand ?? 'UNKNOWN'
}

/**
 * The simulated outcome. `null` when the number is not in the table — and then the
 * card follows the normal path: any well-formed number APPROVES, as in Asaas.
 */
export function outcomeFor(
  number: string,
  table: TestCardTable = TEST_CARDS,
): SimulatedOutcome | null {
  const n = normalizeCardNumber(number)
  return table.find((c) => c.number === n)?.outcome ?? null
}

/** The raw card data, as it arrives in the body. */
export interface CardInput {
  number: string
  holderName?: string
  expiryMonth?: string
  expiryYear?: string
  ccv?: string
}

/** The card, without the PAN. This is EXACTLY what may be persisted or serialized. */
export interface CardInfo {
  last4: string
  brand: CardBrand
  /** Only APPROVE or DECLINE get here: the rest already became an exception. */
  outcome: AuthorizationOutcome
}

/**
 * `true` if the card has already expired. The expiry month is INCLUSIVE — a card
 * 05/2026 is good until 31/05/2026. It is the industry convention, and getting it
 * wrong would refuse good cards in the last month of their life.
 */
export function isExpired(month: number, year: number, now: Date): boolean {
  const nowYear = now.getFullYear()
  const nowMonth = now.getMonth() + 1
  return year < nowYear || (year === nowYear && month < nowMonth)
}

/**
 * Validates the card and returns what can be stored. Throws `CreditCardError`.
 *
 * The test table is consulted BEFORE the validation: a test card is valid by
 * decree (`4444444444444444` does not even pass Luhn, and Asaas approves it), and a
 * simulation card must be able to force its own error even while being
 * well-formed.
 *
 * `now` is there because "expired" is the only rule here that depends on time —
 * and the virtual clock has to reach it, otherwise advancing 5 years would not
 * expire a single card.
 */
export function inspectCard(
  card: CardInput,
  now: Date,
  table: TestCardTable = TEST_CARDS,
  policy: CardPolicy = DEFAULT_CARD_POLICY,
): CardInfo {
  const number = normalizeCardNumber(card.number)
  const simulated = outcomeFor(number, table)

  // A simulation card fires ITS error and ignores the rest — that is what it is.
  // The AUTHORIZATION outcomes do not land here: they do not refuse the request,
  // they survive and decide at charging time.
  if (
    simulated !== null &&
    simulated !== 'APPROVE' &&
    simulated !== 'DECLINE' &&
    simulated !== 'DECLINE_ON_CHARGE'
  ) {
    throw errorFor(simulated)
  }

  // Luhn does NOT go here. See the header: Asaas accepts a wrong check digit.
  if (simulated === null && !/^\d{13,19}$/.test(number)) {
    throw errorFor('INVALID_NUMBER')
  }

  if (card.holderName !== undefined && String(card.holderName).trim() === '') {
    throw errorFor('MISSING_HOLDER')
  }

  const month = card.expiryMonth === undefined ? undefined : Number(card.expiryMonth)
  if (month !== undefined) {
    if (!/^\d{1,2}$/.test(String(card.expiryMonth)) || month < 1 || month > 12) {
      throw errorFor('INVALID_MONTH')
    }
  }

  if (card.expiryYear !== undefined) {
    if (!/^\d{4}$/.test(String(card.expiryYear))) throw errorFor('INVALID_MONTH')
    if (month !== undefined && isExpired(month, Number(card.expiryYear), now)) {
      throw errorFor('EXPIRED')
    }
  }

  // Only an EMPTY CVV is refused. A single digit passes — it was captured, however
  // strange it may look.
  if (card.ccv !== undefined && String(card.ccv).trim() === '') {
    throw errorFor('MISSING_CVV')
  }

  // A well-formed card outside the table approves, as in Asaas — unless the simulator
  // was told to accept only the listed cards: then the issuer refuses it.
  const unlisted: AuthorizationOutcome = policy.acceptAny ? 'APPROVE' : 'DECLINE'
  return {
    last4: number.slice(-4),
    brand: detectBrand(number),
    outcome:
      simulated === 'DECLINE' || simulated === 'DECLINE_ON_CHARGE'
        ? simulated
        : simulated === 'APPROVE'
          ? 'APPROVE'
          : unlisted,
  }
}

/**
 * How a number OUTSIDE the table is judged. `acceptAny` (the default, and what Asaas
 * does) approves any well-formed number; off, only the listed cards pass and any other
 * number is refused by the issuer — to test a flow that must not accept a random card.
 */
export interface CardPolicy {
  acceptAny: boolean
}

export const DEFAULT_CARD_POLICY: CardPolicy = { acceptAny: true }

/**
 * The outcomes a card added in the panel can force: the ones a NUMBER produces.
 * INVALID_MONTH, MISSING_CVV and MISSING_HOLDER are properties of other fields
 * (see TRIGGERS), so a number cannot honestly carry them.
 */
export const CUSTOM_CARD_OUTCOMES = [
  'APPROVE',
  'DECLINE',
  'DECLINE_ON_CHARGE',
  'EXPIRED',
  'INVALID_NUMBER',
] as const satisfies readonly SimulatedOutcome[]

export type CustomCardOutcome = (typeof CUSTOM_CARD_OUTCOMES)[number]

/** The default label of each outcome, as the table names them. */
export const OUTCOME_LABEL: Record<CustomCardOutcome, string> = {
  APPROVE: 'Aprova',
  DECLINE: 'Recusa do emissor',
  DECLINE_ON_CHARGE: 'Tokeniza, recusa ao cobrar',
  EXPIRED: 'Cartão expirado',
  INVALID_NUMBER: 'Número inválido',
}

/** Where a generated number starts and how long it is, per brand. */
export const GENERATED_BRANDS: Readonly<Record<string, { prefix: string; length: number }>> = {
  VISA: { prefix: '4', length: 16 },
  MASTERCARD: { prefix: '5', length: 16 },
  ELO: { prefix: '6363', length: 16 },
  AMEX: { prefix: '37', length: 15 },
}

/** The Luhn check digit that completes `partial`. */
export function luhnCheckDigit(partial: string): string {
  for (let d = 0; d <= 9; d++) {
    if (luhn(`${partial}${d}`)) return String(d)
  }
  throw new Error(`no Luhn digit for ${partial}`)
}

/**
 * A plausible card number: the brand's prefix, random digits from `digits(n)` (the
 * caller's seeded source, so the domain stays free of ambient randomness) and a valid
 * Luhn check digit.
 */
export function generateCardNumber(brand: string, digits: (n: number) => string): string {
  const spec = GENERATED_BRANDS[brand]
  if (!spec) throw new Error(`unknown brand ${brand}`)
  const body = spec.prefix + digits(spec.length - spec.prefix.length - 1)
  return body + luhnCheckDigit(body)
}

/** Does this outcome refuse when the charge is made? (both DECLINE ones refuse) */
export const declinesOnCharge = (o: AuthorizationOutcome): boolean => o !== 'APPROVE'

/**
 * Does this outcome refuse already at the TOKENIZATION?
 *
 * It is the only difference between `DECLINE` (the real Asaas one: never becomes a
 * token) and `DECLINE_ON_CHARGE` (ours: becomes a token and refuses later).
 */
export const declinesOnTokenize = (o: AuthorizationOutcome): boolean => o === 'DECLINE'
