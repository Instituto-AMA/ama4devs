/**
 * Small helpers the charge and customer forms share: money typed the Brazilian way,
 * dates counted from the SIMULATOR's today, the labels of cycles and billing types,
 * and a valid CPF for a test customer.
 */

/** "1.234,56" → 1234.56; anything unreadable → 0. */
export function parseMoney(text: string): number {
  const n = Number(text.replace(/\s|R\$/g, '').replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

/** The simulator's date plus `days` (the virtual clock rules, not the machine's). */
export function addDays(today: string, days: number): string {
  const d = new Date(`${today}T12:00:00`)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

/** The billing types a charge can be created with, as the dashboard names them. */
export const BILLING_CHOICES = [
  { id: 'UNDEFINED', label: 'Pergunte ao cliente' },
  { id: 'PIX', label: 'Pix' },
  { id: 'BOLETO', label: 'Boleto' },
  { id: 'CREDIT_CARD', label: 'Cartão de crédito' },
] as const

export const CYCLE_LABEL: Record<string, string> = {
  WEEKLY: 'Semanal',
  BIWEEKLY: 'Quinzenal',
  MONTHLY: 'Mensal',
  BIMONTHLY: 'Bimestral',
  QUARTERLY: 'Trimestral',
  SEMIANNUALLY: 'Semestral',
  YEARLY: 'Anual',
}

export const SUBSCRIPTION_STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Ativa',
  INACTIVE: 'Inativa',
  EXPIRED: 'Encerrada',
}

/** A valid CPF with random digits, for a test customer. */
export function randomCpf(): string {
  const base = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10))
  const digit = (nums: number[]) => {
    const sum = nums.reduce((acc, n, i) => acc + n * (nums.length + 1 - i), 0)
    const rest = (sum * 10) % 11
    return rest === 10 ? 0 : rest
  }
  const d1 = digit(base)
  const d2 = digit([...base, d1])
  return [...base, d1, d2].join('')
}

/** "24971563792" → "249.715.637-92"; a CNPJ likewise; anything else as it is. */
export function formatDocument(value: string): string {
  const d = value.replace(/\D/g, '')
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
  return value
}
