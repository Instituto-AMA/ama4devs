// @ts-check
/**
 * The registry of what the generator can make, and the single call that makes
 * it. The server and the browser share this file: the same seed gives the same
 * people, companies and documents in both.
 */

import { createRng, randomSeed } from './rng.js'
import { cpf, cnpj, cnh, pis, rg, formatCpf, formatCnpj } from './documents.js'
import { address } from './address.js'
import { person } from './people.js'
import { company } from './companies.js'
import { creditCard, bankAccount, pixKey, charge } from './finance.js'

export * from './rng.js'
export * from './documents.js'
export * from './data.js'
export * from './address.js'
export * from './people.js'
export * from './companies.js'
export * from './finance.js'

/**
 * @typedef {object} Kind
 * @property {string} id The name the API and the UI ask for.
 * @property {string} label The name a person reads, in pt-BR.
 * @property {(rng: import('./rng.js').Rng, opts: any) => any} make Builds one item.
 */

/**
 * The error the generator raises when the caller asks for something it cannot
 * make. The code is what the API answers with.
 */
export class GeneratorError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message)
    this.name = 'GeneratorError'
    this.code = code
  }
}

/**
 * The PIS mask: '123.45678.90-1'. The core has no formatter for the PIS.
 * @param {string} value
 * @returns {string}
 */
function formatPisMask(value) {
  const raw = String(value)
  if (raw.length < 11) return raw
  return `${raw.slice(0, 3)}.${raw.slice(3, 8)}.${raw.slice(8, 10)}-${raw.slice(10)}`
}

/**
 * The São Paulo RG mask: '12.345.678-X'. The core has no formatter for the RG.
 * @param {string} value
 * @returns {string}
 */
function formatRgMask(value) {
  const raw = String(value)
  if (raw.length < 9) return raw
  return `${raw.slice(0, 2)}.${raw.slice(2, 5)}.${raw.slice(5, 8)}-${raw.slice(8)}`
}

/**
 * A document: the digits and the mask of those very digits. The document is
 * drawn once, so both forms always describe the same one.
 * @param {string} value
 * @param {(value: string) => string} mask
 * @returns {{ value: string, formatted: string }}
 */
function documentItem(value, mask) {
  return { value, formatted: mask(value) }
}

/**
 * The `now` of a batch: a Date, or a 'YYYY-MM-DD' day that becomes noon UTC so
 * the day never shifts with the timezone of whoever reads it.
 * @param {Date | string | undefined} value
 * @returns {Date}
 */
function resolveNow(value) {
  if (value === undefined || value === null) return new Date()
  if (value instanceof Date) return value
  const text = String(value)
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T12:00:00Z` : text)
  if (Number.isNaN(date.getTime())) throw new GeneratorError('invalid_now', `invalid now: ${text}`)
  return date
}

/** @type {Kind[]} */
export const KINDS = [
  { id: 'person', label: 'Pessoa', make: (rng, opts) => person(rng, opts) },
  { id: 'company', label: 'Empresa', make: (rng, opts) => company(rng, opts) },
  { id: 'address', label: 'Endereço', make: (rng, opts) => address(rng, opts) },
  { id: 'cpf', label: 'CPF', make: (rng) => documentItem(cpf(rng), formatCpf) },
  { id: 'cnpj', label: 'CNPJ', make: (rng) => documentItem(cnpj(rng), formatCnpj) },
  { id: 'cnh', label: 'CNH', make: (rng) => documentItem(cnh(rng), (value) => value) },
  { id: 'pis', label: 'PIS', make: (rng) => documentItem(pis(rng), formatPisMask) },
  { id: 'rg', label: 'RG', make: (rng) => documentItem(rg(rng), formatRgMask) },
  { id: 'credit-card', label: 'Cartão de crédito', make: (rng, opts) => creditCard(rng, opts) },
  { id: 'bank-account', label: 'Conta bancária', make: (rng) => bankAccount(rng) },
  { id: 'pix-key', label: 'Chave Pix', make: (rng, opts) => pixKey(rng, opts) },
  { id: 'charge', label: 'Cobrança', make: (rng, opts) => charge(rng, opts) },
]

/**
 * Makes `count` items of one kind with a single rng, so the whole batch is one
 * run. An unknown kind raises `GeneratorError` with the code 'unknown_kind'.
 * @param {string} kind
 * @param {{ count?: number | string, seed?: string | number, [key: string]: any }} [options]
 * @returns {{ kind: string, seed: string, count: number, items: any[] }}
 */
export function generate(kind, { count = 1, seed, ...opts } = {}) {
  const entry = KINDS.find((item) => item.id === kind)
  if (!entry) throw new GeneratorError('unknown_kind', `unknown kind: ${kind}`)

  const total = Math.min(1000, Math.max(1, Math.trunc(Number(count)) || 1))
  const finalSeed = seed ? String(seed) : randomSeed()
  const rng = createRng(finalSeed)
  const options = { ...opts, now: resolveNow(opts.now) }

  /** @type {any[]} */
  const items = []
  for (let i = 0; i < total; i++) items.push(entry.make(rng, options))

  return { kind, seed: finalSeed, count: total, items }
}
