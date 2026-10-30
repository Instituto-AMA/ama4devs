/**
 * PARITY CAPTURE — runs the scenarios against the REAL Asaas sandbox and writes
 * the responses to tests/golden/.
 *
 *   ASAAS_SANDBOX_API_KEY='$aact_hmlg_…' bun run capture
 *   ASAAS_SANDBOX_API_KEY='…' bun run capture -- pix-received   # one scenario only
 *
 * After that: `bun test tests/parity` replays the same scenarios against the
 * simulator and diffs field by field.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS THE MOST IMPORTANT PIECE OF THE PROJECT
 *
 * Every business rule here was READ in the documentation, not PROVEN against the
 * API. And Asaas's documentation contradicts itself: it says "only HTTP 200 is a
 * success" on one page and "the 2xx family" on another; the marketing says the
 * card credits in 30 days and the technical doc says 32.
 *
 * A subtly wrong mock is WORSE than no mock, because it produces false
 * confidence: the developer tunes the code to please the simulator and breaks in
 * production. This is what closes that gap.
 *
 * NOTE: this capture covers the HTTP RESPONSES. Webhook payloads would require a
 * public tunnel (the sandbox does not deliver to localhost — which is, after all,
 * the reason this project exists). It is recorded in progress.md as a gap.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { getOperation } from '../src/generated/operations.ts'
import { SCENARIOS, type Scenario, type Step } from '../tests/golden/scenarios.ts'

const BASE = 'https://api-sandbox.asaas.com'
const GOLDEN_DIR = join(import.meta.dir, '..', 'tests', 'golden')

const apiKey = process.env.ASAAS_SANDBOX_API_KEY
if (!apiKey) {
  console.error(`
Missing the key of the REAL Asaas sandbox.

  ASAAS_SANDBOX_API_KEY='$aact_hmlg_…' bun run capture

Get it at: https://sandbox.asaas.com → Settings → Integrations → API.
A sandbox key starts with "$aact_hmlg_". Do NOT use the production one.
`)
  process.exit(1)
}

if (!apiKey.startsWith('$aact_hmlg_')) {
  console.error(
    `The key does not look like a sandbox one (it should start with "$aact_hmlg_").\n` +
      `Refusing for safety: a production key would create real charges.`,
  )
  process.exit(1)
}

/** '$today+5' → ISO date. The real sandbox uses the real calendar. */
function resolveDates(value: unknown, today: Date): unknown {
  if (typeof value === 'string') {
    const m = value.match(/^\$today(?:\+(\d+))?$/)
    if (m) {
      const d = new Date(today)
      d.setDate(d.getDate() + Number(m[1] ?? 0))
      return d.toISOString().slice(0, 10)
    }
    return value
  }
  if (Array.isArray(value)) return value.map((v) => resolveDates(v, today))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, resolveDates(v, today)]),
    )
  }
  return value
}

/** Replaces `$customerId` with the values captured in the previous steps. */
function resolveRefs(value: unknown, vars: Record<string, string>): unknown {
  if (typeof value === 'string' && value.startsWith('$') && vars[value.slice(1)]) {
    return vars[value.slice(1)]
  }
  if (Array.isArray(value)) return value.map((v) => resolveRefs(v, vars))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveRefs(v, vars)]))
  }
  return value
}

export interface CapturedStep {
  /**
   * The ORIGINAL step, with the `$refs` and `$today+N` still to be resolved.
   *
   * It is what lets the replay re-run the scenario against the simulator using the
   * ids IT generates — if we kept only the resolved request, the replay would send
   * a customer id of the real Asaas, which does not exist here.
   */
  step: Step
  /** What actually went to Asaas — to audit the golden afterwards. */
  request: { method: string; path: string; body?: unknown; query?: Record<string, string> }
  response: { status: number; body: unknown }
}

export interface GoldenFile {
  scenario: string
  description: string
  capturedAt: string
  /** The date the capture ran on — the anchor of the relative dates. */
  anchorDate: string
  source: 'asaas-sandbox'
  steps: CapturedStep[]
}

async function runScenario(scenario: Scenario, today: Date): Promise<GoldenFile> {
  const vars: Record<string, string> = {}
  const steps: CapturedStep[] = []

  console.log(`\n▶ ${scenario.name}`)
  console.log(`  ${scenario.description}`)

  for (const step of scenario.steps as Step[]) {
    const op = getOperation(step.operationId)

    let path: string = op.specPath
    for (const [k, v] of Object.entries(step.params ?? {})) {
      const resolved = String(resolveRefs(v, vars))
      path = path.replace(`{${k}}`, encodeURIComponent(resolved))
    }

    const url = new URL(BASE + path)
    const query: Record<string, string> = {}
    for (const [k, v] of Object.entries(step.query ?? {})) {
      const resolved = String(resolveRefs(v, vars))
      url.searchParams.set(k, resolved)
      query[k] = resolved
    }

    const body =
      step.body === undefined
        ? undefined
        : resolveRefs(resolveDates(step.body, today), vars)

    const res = await fetch(url, {
      method: op.method.toUpperCase(),
      headers: {
        access_token: apiKey!,
        'content-type': 'application/json',
        'user-agent': 'asaas-mock-server/parity-capture',
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })

    const text = await res.text()
    const responseBody = text ? JSON.parse(text) : null

    steps.push({
      step,
      request: {
        method: op.method.toUpperCase(),
        path,
        body,
        query: Object.keys(query).length ? query : undefined,
      },
      response: { status: res.status, body: responseBody },
    })

    // Keeps values for the following steps.
    for (const [name, field] of Object.entries(step.capture ?? {})) {
      const v = (responseBody as any)?.[field]
      if (v !== undefined) vars[name] = String(v)
    }

    const mark = res.status < 400 ? '✓' : '✗'
    console.log(`  ${mark} [${res.status}] ${step.label}`)

    // Asaas rate-limits requests; it is not worth running.
    await Bun.sleep(700)
  }

  return {
    scenario: scenario.name,
    description: scenario.description,
    capturedAt: new Date().toISOString(),
    anchorDate: today.toISOString().slice(0, 10),
    source: 'asaas-sandbox',
    steps,
  }
}

// ── main ─────────────────────────────────────────────────────

const only = process.argv.slice(2).filter((a) => !a.startsWith('-'))
const selected = only.length
  ? SCENARIOS.filter((s) => only.includes(s.name))
  : SCENARIOS

if (!selected.length) {
  console.error(`No scenario matched: ${only.join(', ')}`)
  console.error(`Available: ${SCENARIOS.map((s) => s.name).join(', ')}`)
  process.exit(1)
}

mkdirSync(GOLDEN_DIR, { recursive: true })
const today = new Date()

console.log(`Capturing against the REAL Asaas sandbox (${BASE})`)
console.log(`Key: ${apiKey.slice(0, 18)}…`)

for (const scenario of selected) {
  try {
    const golden = await runScenario(scenario, today)
    const path = join(GOLDEN_DIR, `${scenario.name}.json`)
    await Bun.write(path, `${JSON.stringify(golden, null, 2)}\n`)
    console.log(`  → tests/golden/${scenario.name}.json`)
  } catch (err) {
    console.error(`  ✗ ${scenario.name} failed: ${err}`)
  }
}

console.log(`
Done. Now run the parity:

  bun test tests/parity

Every divergence that shows up is OUR BUG — Asaas is the truth. Fix the
simulator, add the line to the unit golden test, and record it in progress.md.
`)
