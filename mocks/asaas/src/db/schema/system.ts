import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { datetime, epochMs, json } from './_conventions.ts'

/** The runtime overrides (fee table, subscription lookahead…). */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: json<unknown>('value').notNull(),
  updatedAt: datetime('updated_at').notNull(),
})

/**
 * The virtual clock, persisted — otherwise time travel would be lost on every
 * container restart and the database state would be "in the future" relative to it.
 */
export const clockState = sqliteTable('clock_state', {
  id: integer('id').primaryKey(), // always 1
  mode: text('mode', {
    enum: ['REAL', 'VIRTUAL_FLOWING', 'VIRTUAL_FROZEN'],
  }).notNull(),
  /** VIRTUAL_FROZEN: the frozen instant. VIRTUAL_FLOWING: the base of the offset. */
  virtualEpochMs: epochMs('virtual_epoch_ms'),
  /** VIRTUAL_FLOWING: the reference real time, to compute the offset. */
  anchorRealEpochMs: epochMs('anchor_real_epoch_ms'),
  updatedAt: datetime('updated_at').notNull(),
})

/**
 * The idempotency guard of the daily jobs. `tickKey` is the SIMULATED DAY
 * ('2026-02-14'), so ticking 10 times on the same day runs each job only once.
 */
export const jobRuns = sqliteTable(
  'job_runs',
  {
    jobName: text('job_name').notNull(),
    tickKey: text('tick_key').notNull(),
    ranAt: datetime('ran_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.jobName, t.tickKey] })],
)

/** The monotonic counters: the `&<n>` of the event id, the `sequence` per webhook. */
export const sequences = sqliteTable('sequences', {
  name: text('name').primaryKey(),
  value: integer('value').notNull(),
})
