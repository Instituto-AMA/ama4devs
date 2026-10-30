/**
 * Schema conventions. Read this before adding any column.
 *
 * MONEY IS INTEGER IN CENTS. Always. `Cents` suffix in the name.
 *   SQLite REAL is IEEE-754: a running balance added up over thousands of
 *   entries accumulates error. And Asaas's rules are EXACT REMAINDER rules
 *   ("the rounding remainder goes to the last installment"), which only express
 *   themselves in integer arithmetic. R$ 1.99 → 199.
 *
 * SPLIT PERCENTAGE has 4 decimal places (92.3444%) → integer at the 1e4 scale,
 *   `E4` suffix. 92.3444% → 923444.
 * PERCENTAGE FEE in basis points (1 bp = 0.01%) → `Bp` suffix. 2.99% → 299.
 *
 * DATES ARE TEXT, in Asaas's wire format:
 *   date     'YYYY-MM-DD'
 *   datetime 'YYYY-MM-DD HH:mm:ss'
 *   Lexicographically sortable = chronologically sortable. No timezone
 *   surprises. Business timezone: America/Sao_Paulo.
 *
 * FORBIDDEN: `.default(sql`CURRENT_TIMESTAMP`)` or any time default.
 *   A timestamp is written by the application from `clock.now()`. A single
 *   database default and the virtual clock leaks — time travel starts writing
 *   the real date and determinism dies in silence.
 */
import { integer, text } from 'drizzle-orm/sqlite-core'

/** A monetary amount in cents. */
export const cents = (name: string) => integer(name, { mode: 'number' })

/** 'YYYY-MM-DD' */
export const date = (name: string) => text(name)

/** 'YYYY-MM-DD HH:mm:ss' */
export const datetime = (name: string) => text(name)

/** Epoch in ms. Only for stable ordering and scheduling — never for display. */
export const epochMs = (name: string) => integer(name, { mode: 'number' })

export const bool = (name: string) => integer(name, { mode: 'boolean' })

/** Objeto serializado (discount, fine, interest, bankAccount…). */
export const json = <T>(name: string) => text(name, { mode: 'json' }).$type<T>()
