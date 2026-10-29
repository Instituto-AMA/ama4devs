// @ts-check

/**
 * Phone helpers shared by the server and the panel: turn a raw string into
 * E.164, format an E.164 back for a person, and pick the outcome a `To`
 * number ends with. The magic suffixes `0001`–`0005` stage the failures.
 */

/**
 * An outcome for a `To` number: `normal` delivers; every other kind is the
 * failure the mock stages, with the carrier-style code and message when
 * there is one.
 * @typedef {Object} PhoneOutcome
 * @property {'normal' | 'failed' | 'undelivered' | 'rejected' | 'stuck' | 'filtered'} kind
 * @property {number} [errorCode]
 * @property {string} [errorMessage]
 */

/**
 * Whether a digit-only body fits the E.164 subscriber count (8–15 digits).
 * @param {string} digits
 * @returns {boolean}
 */
function isBodyLength(digits) {
  return digits.length >= 8 && digits.length <= 15
}

/**
 * Normalize a raw phone into E.164 (`'+5511912345678'`), or null when it
 * cannot be one. A leading `+` (or `00`) keeps only the digits, 8–15 of
 * them; without one, 10–11 digits gain the default country code and 12–15
 * count as already international. Letters in the input make it null.
 * @param {string} raw
 * @param {string} [defaultCountryCode]
 * @returns {string | null}
 */
export function normalizePhone(raw, defaultCountryCode = '55') {
  const text = String(raw).trim()
  if (text === '' || /\p{L}/u.test(text)) return null
  const digits = text.replace(/\D/g, '')
  if (text.startsWith('+')) return isBodyLength(digits) ? `+${digits}` : null
  if (digits.startsWith('00')) {
    const body = digits.slice(2)
    return isBodyLength(body) ? `+${body}` : null
  }
  if (digits.length === 10 || digits.length === 11) return `+${defaultCountryCode}${digits}`
  if (digits.length >= 12 && digits.length <= 15) return `+${digits}`
  return null
}

/**
 * Whether the text is an alphanumeric sender id: a letter first, then up to
 * ten more letters, digits or spaces.
 * @param {string} raw
 * @returns {boolean}
 */
export function isAlphaSender(raw) {
  return /^[A-Za-z][A-Za-z0-9 ]{0,10}$/.test(String(raw).trim())
}

/**
 * Format an E.164 for a person. Brazilian numbers read `'+55 11 91234-5678'`;
 * any other country takes its first two digits plus the rest in groups of
 * three (`'+14155550123'` → `'+14 155 550 123'`), a deliberately simple,
 * country-agnostic grouping. Not an E.164 (an alphanumeric sender) comes
 * back unchanged.
 * @param {string} e164
 * @returns {string}
 */
export function formatPhone(e164) {
  const text = String(e164)
  if (!/^\+\d+$/.test(text)) return e164
  const body = text.slice(1)
  if ((body.length === 12 || body.length === 13) && body.startsWith('55')) {
    const area = body.slice(2, 4)
    const rest = body.slice(4)
    const local = rest.length === 9 ? `${rest.slice(0, 5)}-${rest.slice(5)}` : `${rest.slice(0, 4)}-${rest.slice(4)}`
    return `+55 ${area} ${local}`
  }
  const parts = [body.slice(0, 2)]
  for (let i = 2; i < body.length; i += 3) parts.push(body.slice(i, i + 3))
  return `+${parts.join(' ')}`
}

/**
 * The outcome a `To` number ends with: a `To` whose last four digits are a
 * magic suffix stages the failure it names; any other number (and any
 * alphanumeric sender) delivers normally.
 * @param {string} e164
 * @returns {PhoneOutcome}
 */
export function outcomeFor(e164) {
  switch (String(e164).slice(-4)) {
    case '0001':
      return { kind: 'failed', errorCode: 30003, errorMessage: 'Unreachable destination handset' }
    case '0002':
      return { kind: 'undelivered', errorCode: 30005, errorMessage: 'Unknown destination handset' }
    case '0003':
      return { kind: 'rejected', errorCode: 21211, errorMessage: "Invalid 'To' Phone Number" }
    case '0004':
      return { kind: 'stuck' }
    case '0005':
      return { kind: 'filtered', errorCode: 30007, errorMessage: 'Message filtered by the carrier' }
    default:
      return { kind: 'normal' }
  }
}
