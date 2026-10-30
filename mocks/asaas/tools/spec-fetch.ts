/**
 * Downloads the Asaas spec and rewrites `spec/openapi.json` + `spec/openapi.lock.json`.
 *
 * It is NOT part of the build. The build is hermetic and offline: it only reads the
 * vendored file. Run this by hand when you want to update the spec, and review the diff.
 *
 *   bun run spec:fetch
 */
import { buildLock, fetchSpec, LOCK_PATH, readLock, SPEC_PATH, sha256 } from './spec.ts'

const previous = await readLock()

console.log('Baixando a spec do Asaas…')
const raw = await fetchSpec()
const hash = await sha256(raw)

if (previous && previous.sha256 === hash) {
  console.log(`No changes. sha256=${hash.slice(0, 12)}…`)
  process.exit(0)
}

// Re-serializes it indented: a 1 MB blob in a single line makes the git diff useless.
const pretty = `${JSON.stringify(JSON.parse(raw), null, 2)}\n`
await Bun.write(SPEC_PATH, pretty)

const lock = await buildLock(pretty, new Date().toISOString())
await Bun.write(LOCK_PATH, `${JSON.stringify(lock, null, 2)}\n`)

console.log(`Spec atualizada.`)
console.log(`  paths      ${lock.pathCount}`)
console.log(`  operations  ${lock.operationCount}`)
console.log(`  schemas    ${lock.schemaCount}`)
console.log(`  sha256     ${lock.sha256.slice(0, 12)}…`)
if (previous) {
  console.log(`\nThe spec CHANGED. Run "bun run spec:diff" to see what, and "bun run codegen".`)
}
