// @ts-check
/**
 * Cards, bank accounts, Pix keys and charges: the money side of the generator.
 * Every value comes from the rng, so one seed reproduces the same card, the
 * same account and the same charge.
 */

import { cpf, cnpj } from './documents.js'
import { MALE_FIRST_NAMES, FEMALE_FIRST_NAMES, LAST_NAMES, BANKS, ACTIVITIES, EMAIL_DOMAINS } from './data.js'

/** @typedef {import('./rng.js').Rng} Rng */

/**
 * @typedef {object} CreditCard
 * @property {string} holderName
 * @property {string} number
 * @property {string} brand
 * @property {string} expiryMonth
 * @property {string} expiryYear
 * @property {string} ccv
 * @property {string} outcome
 */

/**
 * @typedef {object} BankAccount
 * @property {{ code: string, name: string, ispb: string }} bank
 * @property {string} agency
 * @property {string} agencyDigit
 * @property {string} account
 * @property {string} accountDigit
 * @property {string} type
 */

/** @typedef {'CPF' | 'CNPJ' | 'EMAIL' | 'PHONE' | 'EVP'} PixKeyType */

/**
 * @typedef {object} PixKey
 * @property {PixKeyType} type
 * @property {string} key
 */

/**
 * @typedef {object} Activity
 * @property {readonly string[]} products
 */

/**
 * @typedef {object} Charge
 * @property {string} billingType
 * @property {number} valueCents
 * @property {number} value
 * @property {string} dueDate
 * @property {string} description
 * @property {string} externalReference
 */

/** The brands a random card may carry: the prefix it starts with and its total length. */
const RANDOM_BRANDS = [
  { brand: 'VISA', prefix: ['4'], length: 16 },
  { brand: 'MASTERCARD', prefix: ['51', '52', '53', '54', '55'], length: 16 },
  { brand: 'ELO', prefix: ['636368'], length: 16 },
  { brand: 'AMEX', prefix: ['34', '37'], length: 15 },
]

/** The kinds a Pix key may have; the phone one uses the DDDs below. */
const PIX_KEY_TYPES = ['CPF', 'CNPJ', 'EMAIL', 'PHONE', 'EVP']

/** Real Brazilian area codes, one per region. */
const DDD_LIST = ['11', '21', '31', '41', '51', '61', '71', '81', '85', '91']

/** The billing types a charge may carry. */
const BILLING_TYPES = ['PIX', 'BOLETO', 'CREDIT_CARD']

/** The alphabet of an external reference: uppercase letters and digits. */
const REFERENCE_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'

/** The alphabet of a UUID. */
const HEX_CHARS = '0123456789abcdef'

/** The RFC 4122 variant nibbles a version 4 UUID may carry. */
const VARIANT_CHARS = ['8', '9', 'a', 'b']

/**
 * A Date or a 'YYYY-MM-DD' string. A bare day becomes noon UTC, so the day
 * never shifts with the timezone of whoever reads it.
 * @param {Date | string} value
 * @returns {Date}
 */
function toDate(value) {
  if (value instanceof Date) return value
  const text = String(value)
  return new Date(/^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T12:00:00Z` : text)
}

/**
 * Upper case without the accents: a card terminal prints the holder that way.
 * @param {string} value
 * @returns {string}
 */
function upper(value) {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
}

/**
 * The Luhn check digit that closes a card base.
 * @param {string} base The digits without the check digit.
 * @returns {string}
 */
function luhnCheckDigit(base) {
  let sum = 0
  let double = true
  for (let i = base.length - 1; i >= 0; i--) {
    let digit = Number(base.charAt(i))
    if (double) {
      digit *= 2
      if (digit > 9) digit -= 9
    }
    double = !double
    sum += digit
  }
  return String((10 - (sum % 10)) % 10)
}

/**
 * True when a card number passes the Luhn check.
 * @param {string} number
 * @returns {boolean}
 */
export function isLuhnValid(number) {
  const digits = String(number).replace(/\D/g, '')
  if (digits.length < 12) return false
  let sum = 0
  let double = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = Number(digits.charAt(i))
    if (double) {
      digit *= 2
      if (digit > 9) digit -= 9
    }
    double = !double
    sum += digit
  }
  return sum % 10 === 0
}

/**
 * The holder name as the terminal prints it: the first and the last name, upper
 * case and without accents.
 * @param {Rng} rng
 * @param {'F' | 'M' | undefined} gender
 * @returns {string}
 */
function holderName(rng, gender) {
  const kind = gender ?? (rng.bool() ? 'F' : 'M')
  const first = kind === 'F' ? rng.pick(FEMALE_FIRST_NAMES) : rng.pick(MALE_FIRST_NAMES)
  const last = rng.pick(LAST_NAMES)
  return `${upper(first)} ${upper(last)}`
}

/**
 * A card for a payment test. APPROVE and DECLINE are the two numbers the Asaas
 * sandbox answers with; RANDOM draws a brand and closes it with a Luhn digit.
 * The card expires between one and six years from `now`.
 * @param {Rng} rng
 * @param {{ outcome?: 'APPROVE' | 'DECLINE' | 'RANDOM', now?: Date | string, gender?: 'F' | 'M' }} [options]
 * @returns {CreditCard}
 */
export function creditCard(rng, { outcome = 'APPROVE', now = new Date(), gender } = {}) {
  const when = toDate(now)
  let number = ''
  let brand = ''
  let cardOutcome = /** @type {string} */ (outcome)
  if (outcome === 'APPROVE') {
    number = '4444444444444444'
    brand = 'VISA'
  } else if (outcome === 'DECLINE') {
    number = '5184019740373151'
    brand = 'MASTERCARD'
  } else {
    const drawn = rng.pick(RANDOM_BRANDS)
    const prefix = rng.pick(drawn.prefix)
    const base = prefix + rng.digits(drawn.length - 1 - prefix.length)
    number = base + luhnCheckDigit(base)
    brand = drawn.brand
    cardOutcome = 'UNKNOWN'
  }
  const ccv = rng.digits(brand === 'AMEX' ? 4 : 3)
  const expiryMonth = String(rng.int(1, 12)).padStart(2, '0')
  const expiryYear = String(when.getUTCFullYear() + rng.int(1, 6))
  return {
    holderName: holderName(rng, gender),
    number,
    brand,
    expiryMonth,
    expiryYear,
    ccv,
    outcome: cardOutcome,
  }
}

/**
 * A Brazilian bank account: the bank, the agency, the account and the digit
 * each of them carries. Four out of five accounts are a checking account.
 * @param {Rng} rng
 * @returns {BankAccount}
 */
export function bankAccount(rng) {
  const bank = rng.pick(BANKS)
  const accountLength = rng.int(5, 8)
  return {
    bank: { code: bank.code, name: bank.name, ispb: bank.ispb },
    agency: rng.digits(4),
    agencyDigit: rng.digits(1),
    account: rng.digits(accountLength),
    accountDigit: rng.digits(1),
    type: rng.bool(0.8) ? 'CONTA_CORRENTE' : 'CONTA_POUPANCA',
  }
}

/**
 * A UUID version 4 built from the rng: the version nibble is 4 and the variant
 * is one of 8, 9, a, b.
 * @param {Rng} rng
 * @returns {string}
 */
function uuidV4(rng) {
  const hex = (/** @type {number} */ length) => {
    let out = ''
    for (let i = 0; i < length; i++) out += HEX_CHARS.charAt(rng.int(0, 15))
    return out
  }
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${rng.pick(VARIANT_CHARS)}${hex(3)}-${hex(12)}`
}

/**
 * A Pix key of the asked kind; the kind is drawn when it is not given. A phone
 * key carries the country code, the DDD, the nine and the subscriber digits.
 * @param {Rng} rng
 * @param {{ type?: string }} [options]
 * @returns {PixKey}
 */
export function pixKey(rng, { type } = {}) {
  const kind = String(type ?? rng.pick(PIX_KEY_TYPES)).toUpperCase()
  switch (kind) {
    case 'CPF':
      return { type: 'CPF', key: cpf(rng) }
    case 'CNPJ':
      return { type: 'CNPJ', key: cnpj(rng) }
    case 'EMAIL':
      return { type: 'EMAIL', key: `pix.${rng.digits(6)}@${rng.pick(EMAIL_DOMAINS)}` }
    case 'PHONE':
      return { type: 'PHONE', key: `+55${rng.pick(DDD_LIST)}9${rng.digits(8)}` }
    case 'EVP':
      return { type: 'EVP', key: uuidV4(rng) }
    default:
      throw new Error(`unknown pix key type: ${kind}`)
  }
}

/**
 * A charge: the amount in cents and in reais, a due date between today and
 * thirty days ahead, and a reference the caller can search for.
 * @param {Rng} rng
 * @param {{ billingType?: string, minCents?: number, maxCents?: number, now?: Date | string, activity?: Activity }} [options]
 * @returns {Charge}
 */
export function charge(rng, { billingType, minCents = 1000, maxCents = 500000, now = new Date(), activity } = {}) {
  const when = toDate(now)
  const type = billingType ?? rng.pick(BILLING_TYPES)
  const valueCents = rng.int(minCents, maxCents)
  const dueDate = new Date(when.getTime() + rng.int(0, 30) * 86400000).toISOString().slice(0, 10)
  const chosen = activity ?? rng.pick(ACTIVITIES)
  const description = rng.pick(chosen.products)
  let reference = ''
  for (let i = 0; i < 8; i++) reference += REFERENCE_CHARS.charAt(rng.int(0, 35))
  return {
    billingType: type,
    valueCents,
    value: valueCents / 100,
    dueDate,
    description,
    externalReference: `GEN-${reference}`,
  }
}
