import { eq } from 'drizzle-orm'
import type { FeeTable } from '../core/config.ts'
import type { AppContext } from '../core/context.ts'
import { badRequest } from '../core/errors.ts'
import { settings } from '../db/schema/index.ts'

const KEY = 'simulator.fees'

/** Validate a partial table before changing any live value. Units are cents and basis points. */
function merge(base: Record<string, unknown>, patch: unknown): Record<string, unknown> {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw badRequest('invalid_fees', 'Fees must be an object.')
  }
  const result = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    if (!Object.hasOwn(base, key)) throw badRequest('invalid_fees', `Unknown fee: ${key}.`)
    if (typeof base[key] === 'object') {
      result[key] = merge(base[key] as Record<string, unknown>, value)
    } else {
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
        throw badRequest('invalid_fees', `Fee ${key} must be a non-negative safe integer.`)
      }
      result[key] = value
    }
  }
  return result
}

export async function loadFees(ctx: AppContext): Promise<void> {
  const [row] = await ctx.db.select().from(settings).where(eq(settings.key, KEY))
  if (row) ctx.config.fees = merge(ctx.config.fees as unknown as Record<string, unknown>, row.value) as unknown as FeeTable
}

export async function updateFees(ctx: AppContext, patch: unknown): Promise<FeeTable> {
  const fees = merge(ctx.config.fees as unknown as Record<string, unknown>, patch) as unknown as FeeTable
  const updatedAt = ctx.clock.timestamp()
  // Commit first: a failed write must leave the engine unchanged.
  ctx.db.transaction((tx) => {
    tx.insert(settings).values({ key: KEY, value: fees, updatedAt })
      .onConflictDoUpdate({ target: settings.key, set: { value: fees, updatedAt } }).run()
    ctx.config.fees = fees
  })
  return fees
}
