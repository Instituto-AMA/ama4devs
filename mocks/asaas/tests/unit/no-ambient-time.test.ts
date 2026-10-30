/**
 * The guard of determinism.
 *
 * A single `Date.now()` or `Math.random()` outside core/clock.ts and core/rng.ts
 * destroys the virtual clock in silence: time travel starts writing the real
 * date, and the bug comes back as a flaky test three months from now.
 *
 * This test is ugly on purpose — it greps the source. A lint rule would be more
 * elegant, but the lint can be switched off with a comment and this test cannot.
 */
import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const SRC = join(import.meta.dir, '..', '..', 'src')

/** The only places allowed to touch ambient time and randomness. */
const ALLOWED = new Set(['core/clock.ts', 'core/rng.ts'])

/** The forbidden patterns and why. */
const BANNED: { pattern: RegExp; what: string }[] = [
  { pattern: /\bDate\.now\s*\(/, what: 'Date.now()' },
  { pattern: /\bnew Date\s*\(\s*\)/, what: 'new Date() without an argument' },
  { pattern: /\bMath\.random\s*\(/, what: 'Math.random()' },
  { pattern: /\bcrypto\.randomUUID\s*\(/, what: 'crypto.randomUUID()' },
  { pattern: /CURRENT_TIMESTAMP/i, what: 'CURRENT_TIMESTAMP (database time default)' },
]

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) yield* walk(full)
    else if (entry.endsWith('.ts')) yield full
  }
}

describe('determinism: no ambient time/randomness outside the core', () => {
  it('src/ does not use Date.now(), new Date(), Math.random() nor crypto.randomUUID()', () => {
    const violations: string[] = []

    for (const file of walk(SRC)) {
      const rel = relative(SRC, file)
      if (ALLOWED.has(rel)) continue
      // Generated code has no runtime logic — only schemas.
      if (rel.startsWith('generated/')) continue

      const source = readFileSync(file, 'utf8')
      source.split('\n').forEach((line, i) => {
        if (line.trimStart().startsWith('*') || line.trimStart().startsWith('//')) return
        for (const { pattern, what } of BANNED) {
          if (pattern.test(line)) {
            violations.push(`${rel}:${i + 1} uses ${what} — use ctx.clock / ctx.rng`)
          }
        }
      })
    }

    expect(violations).toEqual([])
  })
})
