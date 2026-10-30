/**
 * PARITY WITH THE REAL ASAAS.
 *
 * Replays against the simulator exactly the scenarios `bun run capture` ran
 * against the real sandbox, and compares field by field.
 *
 * Every divergence that shows up here is OUR BUG. Asaas is the truth; we are the
 * ones imitating it. Do not "fix" the golden — fix the simulator, and carry the
 * proven rule over to the unit golden test in tests/unit/.
 *
 * The suite SKIPS itself when there is no captured golden (nobody runs this
 * without a sandbox key). Do not confuse "skipped" with "passed": while there is
 * no golden, the fidelity of this project is a hypothesis, not a fact.
 */
import { describe, expect, it } from 'bun:test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { GoldenFile } from '../../tools/capture.ts'
import { RELATIVE_DATE_FIELDS, VOLATILE_FIELDS } from '../golden/scenarios.ts'
import { createHarness, type Harness } from '../helpers/harness.ts'

const GOLDEN_DIR = join(import.meta.dir, '..', 'golden')

const goldenFiles = existsSync(GOLDEN_DIR)
  ? readdirSync(GOLDEN_DIR).filter((f) => f.endsWith('.json'))
  : []

const DAY_MS = 86_400_000

/**
 * English labels for the immutable captured scenarios.
 *
 * The golden files stay byte-for-byte identical to the sandbox capture, including
 * their original Portuguese descriptions. Test names are repository-owned, so they
 * use these English equivalents instead of the captured prose.
 */
const ENGLISH_SCENARIOS: Record<string, { name: string; description: string }> = {
  'bank-slip-with-interest-and-fine.json': {
    name: 'bank slip with interest and fine',
    description:
      'A bank slip with a 2% fine and 1% monthly interest. It proves the netValue composition and the response shape of the discount, fine, and interest objects.',
  },
  'credit-card-single-payment.json': {
    name: 'single card payment',
    description:
      'The fee is R$ 0.49 + 2.99%, and estimatedCreditDate is D+32. The technical doc says 32 days; marketing says 30 — this script settles the discrepancy.',
  },
  'installment-350-in-12x.json': {
    name: 'R$ 350 in 12 installments',
    description:
      'The remainder rule: R$ 350 in 12 installments becomes 11 × R$ 29.16 + R$ 29.24 in the last one. This scenario proves the first line of the golden unit test.',
  },
  'installment-on-card.json': {
    name: 'installments on a card',
    description:
      'The issuer authorizes the total at once. It proves whether the installments start as CONFIRMED and whether the credit is D+32 from confirmation or from each due date.',
  },
  'monthly-subscription.json': {
    name: 'monthly subscription',
    description:
      'Creating the subscription creates the first charge. The following charges appear when their due date enters the 40-day lookahead window.',
  },
  'pix-received.json': {
    name: 'received Pix',
    description:
      'Pix goes from PENDING directly to RECEIVED, skips CONFIRMED, and has a fixed R$ 1.99 fee with netValue = 98.01.',
  },
  'validation-errors.json': {
    name: 'validation errors',
    description:
      'The error format is a contract: {"errors":[{"code":"invalid_<field>","description":"..."}]}. Charge creation answers 200, never 201.',
  },
}

/**
 * Turns an absolute date into its DISTANCE to the anchor.
 *
 * The real sandbox runs on today's calendar; the simulator, on a virtual clock.
 * Comparing '2026-08-15' with '2026-01-05' would say nothing. Comparing 'D+32'
 * with 'D+32' proves the card's credit rule, no matter when the capture ran.
 */
function relativize(value: string, anchor: string): string {
  if (!/^\d{4}-\d{2}-\d{2}/.test(value)) return value
  const a = Date.parse(`${anchor}T12:00:00Z`)
  const d = Date.parse(`${value.slice(0, 10)}T12:00:00Z`)
  const days = Math.round((d - a) / DAY_MS)
  return `D${days >= 0 ? '+' : ''}${days}`
}

/**
 * Prepares a response for the diff.
 *
 * Dates become relative offsets. Volatile fields (ids, URLs of their domain) lose
 * their VALUE but keep the KEY and the nullity — because "it came null" and "it
 * came filled" is contract information, and so is "the field exists".
 *
 * Everything else is compared literally. That is where a rule divergence shows
 * up: `value`, `netValue`, `status`, `billingType`, the shape of
 * discount/fine/interest, the set of keys of the object.
 */
function normalize(value: unknown, anchor: string): unknown {
  if (Array.isArray(value)) return value.map((v) => normalize(v, anchor))
  if (!value || typeof value !== 'object') return value

  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value)) {
    if (v === null || v === undefined) {
      out[k] = null
    } else if (RELATIVE_DATE_FIELDS.includes(k) && typeof v === 'string') {
      out[k] = relativize(v, anchor)
    } else if (VOLATILE_FIELDS.includes(k)) {
      out[k] = '<volatile>'
    } else {
      out[k] = normalize(v, anchor)
    }
  }
  return out
}

/** '$today+5' → ISO date, counted from the golden's anchor. */
function resolveDates(value: unknown, anchor: string): unknown {
  if (typeof value === 'string') {
    // Captured goldens still use the original '$hoje+N' marker; new captures use '$today+N'.
    const m = value.match(/^\$(?:today|hoje)(?:\+(\d+))?$/)
    if (!m) return value
    const d = new Date(`${anchor}T12:00:00Z`)
    d.setUTCDate(d.getUTCDate() + Number(m[1] ?? 0))
    return d.toISOString().slice(0, 10)
  }
  if (Array.isArray(value)) return value.map((v) => resolveDates(v, anchor))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, resolveDates(v, anchor)]),
    )
  }
  return value
}

/** '$customerId' → the id the SIMULATOR generated in the previous step. */
function resolveRefs(value: unknown, vars: Record<string, string>): unknown {
  if (typeof value === 'string') {
    return value.startsWith('$') && vars[value.slice(1)] !== undefined
      ? vars[value.slice(1)]!
      : value
  }
  if (Array.isArray(value)) return value.map((v) => resolveRefs(v, vars))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, resolveRefs(v, vars)]),
    )
  }
  return value
}

if (goldenFiles.length === 0) {
  describe('parity with the real Asaas', () => {
    it.skip('NO GOLDEN CAPTURED — the fidelity is still a hypothesis', () => {
      // To capture (it needs a SANDBOX key, which starts with $aact_hmlg_):
      //
      //   ASAAS_SANDBOX_API_KEY='$aact_hmlg_…' bun run capture
      //   bun test tests/parity
      //
      // Until this runs, every business rule of this simulator is our best
      // reading of the documentation — and Asaas's documentation contradicts
      // itself in more than one point (see "known divergences" in progress.md).
    })
  })
} else {
  describe('parity with the real Asaas', () => {
    for (const file of goldenFiles) {
      const golden = JSON.parse(readFileSync(join(GOLDEN_DIR, file), 'utf8')) as GoldenFile
      const scenario = ENGLISH_SCENARIOS[file] ?? {
        name: file.replace(/\.json$/, ''),
        description: 'parity with the real Asaas',
      }

      describe(scenario.name, () => {
        it(scenario.description, async () => {
          // The simulator's clock is anchored on the date the capture ran, so that
          // '$today+5' means the same thing on both sides.
          const h: Harness = await createHarness({
            clock: {
              mode: 'VIRTUAL_FROZEN',
              start: `${golden.anchorDate}T09:00:00-03:00`,
              tickIntervalMs: 0,
            },
          })

          try {
            const vars: Record<string, string> = {}

            for (const captured of golden.steps) {
              const { step, response: expected } = captured

              const params = Object.fromEntries(
                Object.entries(step.params ?? {}).map(([k, v]) => [
                  k,
                  String(resolveRefs(v, vars)),
                ]),
              )
              const query = Object.fromEntries(
                Object.entries(step.query ?? {}).map(([k, v]) => [
                  k,
                  String(resolveRefs(v, vars)),
                ]),
              )
              const body =
                step.body === undefined
                  ? undefined
                  : resolveRefs(resolveDates(step.body, golden.anchorDate), vars)

              const actual = await h.api.call(step.operationId, {
                ...(Object.keys(params).length ? { params } : {}),
                ...(Object.keys(query).length ? { query } : {}),
                ...(body !== undefined ? { body } : {}),
              })

              // Keeps the ids the SIMULATOR generated, for the following steps.
              for (const [name, field] of Object.entries(step.capture ?? {})) {
                const v = (actual.body as Record<string, unknown> | null)?.[field]
                if (v !== undefined && v !== null) vars[name] = String(v)
              }

              const where = `${golden.scenario} › ${step.label}`

              expect(actual.status, `Divergent HTTP status at "${where}"`).toBe(
                expected.status,
              )

              expect(
                normalize(actual.body, golden.anchorDate),
                `Divergent response at "${where}" — Asaas is the truth, ` +
                  `fix the simulator`,
              ).toEqual(normalize(expected.body, golden.anchorDate) as never)
            }
          } finally {
            h.close()
          }
        })
      })
    }
  })
}
