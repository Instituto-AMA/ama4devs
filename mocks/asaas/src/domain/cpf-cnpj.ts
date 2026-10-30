/**
 * CPF/CNPJ validation with the check digit — Asaas validates for real. A mock
 * that accepts "11111111111" lets through a bug that would only show up in
 * production.
 *
 * The error code is `invalid_object` (not `invalid_cpfCnpj`, as we assumed):
 * proven against the real sandbox, which returns
 * `{"code":"invalid_object","description":"O CPF/CNPJ informado é inválido."}`.
 */

const onlyDigits = (v: string): string => v.replace(/\D/g, '')

/**
 * Asaas refuses a mobile number with all the same digits — `47999999999` comes back
 * as `invalid_mobilePhone`. It is the same convention as the CPF `11111111111`: it
 * passes any format check, but it is obviously false.
 *
 * Proven against the sandbox: `47996321478` and even `47912345678` (sequential!) are
 * accepted; only the repeated digit is refused.
 */
export function isValidMobilePhone(raw: string): boolean {
  const phone = onlyDigits(raw)
  if (phone.length < 10 || phone.length > 11) return false

  // The part after the area code cannot be a single repeated digit.
  const subscriber = phone.slice(2)
  return !new RegExp(`^(\\d)\\1{${subscriber.length - 1}}$`).test(subscriber)
}

export function isValidCpf(raw: string): boolean {
  const cpf = onlyDigits(raw)
  if (cpf.length !== 11) return false
  // All the same digits pass the algorithm but are invalid by convention.
  if (/^(\d)\1{10}$/.test(cpf)) return false

  const digit = (upTo: number): number => {
    let sum = 0
    for (let i = 0; i < upTo; i++) {
      sum += Number(cpf[i]) * (upTo + 1 - i)
    }
    const rest = (sum * 10) % 11
    return rest === 10 ? 0 : rest
  }

  return digit(9) === Number(cpf[9]) && digit(10) === Number(cpf[10])
}

/** The CNPJ check digit over the first `upTo` digits. */
function cnpjDigit(cnpj: string, upTo: number): number {
  let sum = 0
  let weight = upTo - 7
  for (let i = 0; i < upTo; i++) {
    sum += Number(cnpj[i]) * weight
    weight = weight - 1 < 2 ? 9 : weight - 1
  }
  const rest = sum % 11
  return rest < 2 ? 0 : 11 - rest
}

export function isValidCnpj(raw: string): boolean {
  const cnpj = onlyDigits(raw)
  if (cnpj.length !== 14) return false
  if (/^(\d)\1{13}$/.test(cnpj)) return false

  return cnpjDigit(cnpj, 12) === Number(cnpj[12]) && cnpjDigit(cnpj, 13) === Number(cnpj[13])
}

/**
 * A valid CNPJ from its 12-digit base: the base plus both check digits. The
 * panel creates a profile without asking for a document, and the account still
 * needs one that every validation in this server accepts.
 */
export function cnpjFromBase(base: string): string {
  const head = onlyDigits(base).slice(0, 12).padStart(12, '0')
  const first = `${head}${cnpjDigit(head, 12)}`
  return `${first}${cnpjDigit(first, 13)}`
}

export function isValidCpfCnpj(raw: string): boolean {
  const v = onlyDigits(raw)
  if (v.length === 11) return isValidCpf(v)
  if (v.length === 14) return isValidCnpj(v)
  return false
}

/** Asaas derives the personType from the document's length. */
export function personTypeOf(raw: string): 'FISICA' | 'JURIDICA' {
  return onlyDigits(raw).length === 14 ? 'JURIDICA' : 'FISICA'
}
