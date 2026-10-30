/**
 * Drift detector: downloads the Asaas spec and compares it structurally with the vendored
 * lock. It writes nothing.
 *
 * It runs in a scheduled job (weekly), separate from the build. It exits with code 1 if there is
 * drift, so that the CI opens an issue.
 *
 *   bun run spec:diff
 */
import { buildLock, readLock } from './spec.ts'
import { fetchSpec } from './spec.ts'

const lock = await readLock()
if (!lock) {
  console.error('spec/openapi.lock.json does not exist. Run "bun run spec:fetch" first.')
  process.exit(1)
}

const raw = await fetchSpec()
const fresh = await buildLock(`${JSON.stringify(JSON.parse(raw), null, 2)}\n`, 'n/a')

if (fresh.sha256 === lock.sha256) {
  console.log('No drift. The vendored spec is up to date with Asaas.')
  process.exit(0)
}

const diffKeys = (before: Record<string, string>, after: Record<string, string>) => ({
  added: Object.keys(after).filter((k) => !(k in before)),
  removed: Object.keys(before).filter((k) => !(k in after)),
  changed: Object.keys(after).filter((k) => k in before && before[k] !== after[k]),
})

const ops = diffKeys(lock.operations, fresh.operations)
const schemas = diffKeys(lock.schemas, fresh.schemas)

const report = (label: string, d: ReturnType<typeof diffKeys>) => {
  if (!d.added.length && !d.removed.length && !d.changed.length) return
  console.log(`\n${label}`)
  for (const k of d.added) console.log(`  + ${k}`)
  for (const k of d.removed) console.log(`  - ${k}`)
  for (const k of d.changed) console.log(`  ~ ${k}`)
}

console.log('DRIFT DETECTADO — a spec do Asaas mudou.')
console.log(`  operations  ${lock.operationCount} → ${fresh.operationCount}`)
console.log(`  schemas    ${lock.schemaCount} → ${fresh.schemaCount}`)
report('Operations', ops)
report('Schemas', schemas)
console.log(
  `\nPara adotar: "bun run spec:fetch" && "bun run codegen" && "bun test".` +
    `\nPay special attention to the overlays in spec/overlays/ — if Asaas fixed what the` +
    `\noverlay was patching, the codegen will fail pointing at the path that no longer resolves.`,
)
process.exit(1)
