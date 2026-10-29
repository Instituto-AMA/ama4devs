// @ts-check
/**
 * @typedef {import('./rng.js').Rng} Rng
 * @typedef {{ formatted?: boolean }} DocumentOptions
 */

/**
 * Every digit of a value, whatever mask it carries.
 * @param {unknown} v
 * @returns {string}
 */
export const onlyDigits = (v) => String(v).replace(/\D/g, '')

/**
 * True when every digit of a value repeats the same one.
 * @param {string} value
 * @returns {boolean}
 */
function allSameDigit(value) {
  return /^(\d)\1+$/.test(value)
}

/**
 * `n` random digits, redrawn while they repeat the same digit.
 * @param {Rng} rng
 * @param {number} n
 * @returns {string}
 */
function randomBase(rng, n) {
  let base = rng.digits(n)
  while (allSameDigit(base)) base = rng.digits(n)
  return base
}

/**
 * The two CPF check digits over the first nine digits.
 * @param {string} base
 * @returns {string}
 */
function cpfCheckDigits(base) {
  /**
   * @param {string} digits
   * @param {number} upTo
   * @returns {number}
   */
  const digit = (digits, upTo) => {
    let sum = 0
    for (let i = 0; i < upTo; i++) sum += Number(digits[i]) * (upTo + 1 - i)
    const rest = (sum * 10) % 11
    return rest === 10 ? 0 : rest
  }
  const first = digit(base, 9)
  return `${first}${digit(base + first, 10)}`
}

/**
 * The two CNPJ check digits over the twelve-digit base.
 * @param {string} base
 * @returns {string}
 */
function cnpjCheckDigits(base) {
  /**
   * @param {string} digits
   * @param {number} upTo
   * @returns {number}
   */
  const digit = (digits, upTo) => {
    let sum = 0
    let weight = upTo - 7
    for (let i = 0; i < upTo; i++) {
      sum += Number(digits[i]) * weight
      weight = weight - 1 < 2 ? 9 : weight - 1
    }
    const rest = sum % 11
    return rest < 2 ? 0 : 11 - rest
  }
  const first = digit(base, 12)
  return `${first}${digit(base + first, 13)}`
}

/**
 * The two CNH check digits over the nine-digit base: weights 9..1 for the
 * first one, weights 1..9 plus the first digit for the second one.
 * @param {string} base
 * @returns {string}
 */
function cnhCheckDigits(base) {
  let first = 0
  let second = 0
  for (let i = 0; i < 9; i++) {
    first += Number(base[i]) * (9 - i)
    second += Number(base[i]) * (i + 1)
  }
  first = first % 11
  if (first >= 10) first = 0
  second = (second + first) % 11
  if (second >= 10) second = 0
  return `${first}${second}`
}

/**
 * The PIS/NIT check digit over the ten-digit base: weights 3,2,9,8,7,6,5,4,3,2.
 * @param {string} base
 * @returns {string}
 */
function pisCheckDigit(base) {
  const weights = [3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
  let sum = 0
  for (const [index, weight] of weights.entries()) sum += Number(base[index]) * weight
  const digit = 11 - (sum % 11)
  return String(digit >= 10 ? 0 : digit)
}

/**
 * The São Paulo RG check digit over the eight-digit base: weights 2..9, `X`
 * for ten and `0` for eleven.
 * @param {string} base
 * @returns {string}
 */
function rgCheckDigit(base) {
  let sum = 0
  for (let i = 0; i < 8; i++) sum += Number(base[i]) * (i + 2)
  const digit = 11 - (sum % 11)
  if (digit === 10) return 'X'
  if (digit === 11) return '0'
  return String(digit)
}

/**
 * A PIS/NIT masked as `123.45678.90-1`.
 * @param {string} digits
 * @returns {string}
 */
function formatPis(digits) {
  return `${digits.slice(0, 3)}.${digits.slice(3, 8)}.${digits.slice(8, 10)}-${digits.slice(10)}`
}

/**
 * A São Paulo RG masked as `12.345.678-X`.
 * @param {string} digits
 * @returns {string}
 */
function formatRg(digits) {
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}-${digits.slice(8)}`
}

/**
 * A valid CPF: nine random digits plus the two check digits.
 * @param {Rng} rng
 * @param {DocumentOptions} [options]
 * @returns {string}
 */
export function cpf(rng, { formatted = false } = {}) {
  const base = randomBase(rng, 9)
  const digits = base + cpfCheckDigits(base)
  return formatted ? formatCpf(digits) : digits
}

/**
 * A valid CNPJ: eight random digits, the `0001` branch plus the two check digits.
 * @param {Rng} rng
 * @param {DocumentOptions} [options]
 * @returns {string}
 */
export function cnpj(rng, { formatted = false } = {}) {
  const base = rng.digits(8) + '0001'
  const digits = base + cnpjCheckDigits(base)
  return formatted ? formatCnpj(digits) : digits
}

/**
 * A valid CNH: nine random digits plus the two check digits. CNH has no mask,
 * so `formatted` answers the same eleven digits.
 * @param {Rng} rng
 * @param {DocumentOptions} [options]
 * @returns {string}
 */
export function cnh(rng, { formatted = false } = {}) {
  const base = randomBase(rng, 9)
  const digits = base + cnhCheckDigits(base)
  return formatted ? digits : digits
}

/**
 * A valid PIS/NIT: ten random digits plus the check digit.
 * @param {Rng} rng
 * @param {DocumentOptions} [options]
 * @returns {string}
 */
export function pis(rng, { formatted = false } = {}) {
  const base = randomBase(rng, 10)
  const digits = base + pisCheckDigit(base)
  return formatted ? formatPis(digits) : digits
}

/**
 * A valid São Paulo RG: eight random digits plus the check digit.
 * @param {Rng} rng
 * @param {DocumentOptions} [options]
 * @returns {string}
 */
export function rg(rng, { formatted = false } = {}) {
  const base = randomBase(rng, 8)
  const digits = base + rgCheckDigit(base)
  return formatted ? formatRg(digits) : digits
}

/**
 * A CPF is valid when its two check digits match and its digits are not all
 * the same one.
 * @param {unknown} v
 * @returns {boolean}
 */
export function isValidCpf(v) {
  const cpf = onlyDigits(v)
  if (cpf.length !== 11) return false
  if (allSameDigit(cpf)) return false
  return cpfCheckDigits(cpf.slice(0, 9)) === cpf.slice(9)
}

/**
 * A CNPJ is valid when its two check digits match and its digits are not all
 * the same one.
 * @param {unknown} v
 * @returns {boolean}
 */
export function isValidCnpj(v) {
  const cnpj = onlyDigits(v)
  if (cnpj.length !== 14) return false
  if (allSameDigit(cnpj)) return false
  return cnpjCheckDigits(cnpj.slice(0, 12)) === cnpj.slice(12)
}

/**
 * A CNH is valid when its two check digits match and its digits are not all
 * the same one.
 * @param {unknown} v
 * @returns {boolean}
 */
export function isValidCnh(v) {
  const cnh = onlyDigits(v)
  if (cnh.length !== 11) return false
  if (allSameDigit(cnh)) return false
  return cnhCheckDigits(cnh.slice(0, 9)) === cnh.slice(9)
}

/**
 * A PIS/NIT is valid when its check digit matches and its digits are not all
 * the same one.
 * @param {unknown} v
 * @returns {boolean}
 */
export function isValidPis(v) {
  const pis = onlyDigits(v)
  if (pis.length !== 11) return false
  if (allSameDigit(pis)) return false
  return pisCheckDigit(pis.slice(0, 10)) === pis.slice(10)
}

/**
 * A CPF or a CNPJ, told apart by its length.
 * @param {unknown} v
 * @returns {boolean}
 */
export function isValidCpfCnpj(v) {
  const digits = onlyDigits(v)
  if (digits.length === 11) return isValidCpf(digits)
  if (digits.length === 14) return isValidCnpj(digits)
  return false
}

/**
 * A CPF masked as `123.456.789-09`.
 * @param {unknown} v
 * @returns {string}
 */
export function formatCpf(v) {
  const digits = onlyDigits(v)
  if (digits.length !== 11) return digits
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`
}

/**
 * A CNPJ masked as `12.345.678/0001-95`.
 * @param {unknown} v
 * @returns {string}
 */
export function formatCnpj(v) {
  const digits = onlyDigits(v)
  if (digits.length !== 14) return digits
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`
}

/**
 * A CEP masked as `01310-100`.
 * @param {unknown} v
 * @returns {string}
 */
export function formatCep(v) {
  const digits = onlyDigits(v)
  if (digits.length !== 8) return digits
  return `${digits.slice(0, 5)}-${digits.slice(5)}`
}

/**
 * A phone masked as `(11) 3456-7890` or `(11) 98765-4321`; any other length
 * answers the bare digits.
 * @param {unknown} v
 * @returns {string}
 */
export function formatPhone(v) {
  const digits = onlyDigits(v)
  if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
  if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`
  return digits
}
