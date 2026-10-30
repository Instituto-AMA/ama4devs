/**
 * Surface test: the 213 operations of Asaas's spec EXIST.
 *
 * It is the test that turns "full API coverage" from a promise into an invariant.
 * If Asaas publishes a new operation, the codegen brings it into the manifest, it
 * shows up here, and the test keeps passing — answering 501 instead of 404.
 * What it forbids is a spec route disappearing from the routing.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import {
  getOperation,
  OPERATION_COUNT,
  OPERATION_IDS,
} from '../../src/generated/operations.ts'
import { createHarness, TEST_API_KEY, type Harness } from '../helpers/harness.ts'

let h: Harness

beforeAll(async () => {
  h = await createHarness()
})
afterAll(() => h.close())

describe('the API surface', () => {
  it('the manifest has the 213 operations of the spec', () => {
    expect(OPERATION_IDS.length).toBe(OPERATION_COUNT)
    expect(OPERATION_COUNT).toBe(213)
  })

  it('every operation resolves to a route — none falls into a routing 404', async () => {
    const routingFailures: string[] = []

    for (const id of OPERATION_IDS) {
      const op = getOperation(id)

      // Fills the parameters with any value: here what matters is whether the
      // ROUTE exists, not whether the resource exists.
      let path: string = op.specPath
      for (const name of op.paramNames ?? []) path = path.replace(`{${name}}`, 'x')

      const res = await h.app.app.handle(
        new Request(`http://localhost${path}`, {
          method: op.method.toUpperCase(),
          headers: { access_token: TEST_API_KEY, 'content-type': 'application/json' },
          ...(op.body ? { body: '{}' } : {}),
        }),
      )

      // A 404 is only acceptable coming from the handler (non-existent resource), never from the
      // router — which returns the non-existent endpoint message.
      if (res.status === 404) {
        const body = (await res.clone().json()) as any
        const desc: string = body?.errors?.[0]?.description ?? ''
        if (desc.includes('não existe na API do Asaas')) {
          routingFailures.push(`${op.method.toUpperCase()} ${op.specPath} (${id})`)
        }
      }
    }

    expect(routingFailures).toEqual([])
  })

  it("operations without a handler answer 501 in Asaas's error format", async () => {
    // The operation is chosen DYNAMICALLY among the ones that still have no handler —
    // otherwise this test would break on every delivered track, which would be a false
    // alarm and would train everyone to ignore it.
    const stubbed = h.app.coverage.stubbed.find((id) => {
      const op = getOperation(id)
      return op.method === 'get' && !op.paramNames?.length && !op.query
    })
    expect(stubbed).toBeDefined()

    const op = getOperation(stubbed!)
    const res = await h.app.app.handle(
      new Request(`http://localhost${op.specPath}`, {
        headers: { access_token: TEST_API_KEY },
      }),
    )

    expect(res.status).toBe(501)
    const body = (await res.json()) as any
    expect(body.errors[0].code).toBe('not_implemented')
    // The message says WHICH operation is missing — it is what makes the 501 actionable.
    expect(body.errors[0].description).toContain(stubbed!)
  })

  it('every operation of the manifest is registered, is a variant, or both', () => {
    const { implemented, stubbed, variants } = h.app.coverage
    expect(implemented.length + stubbed.length + variants.length).toBe(OPERATION_COUNT)
  })

  it('the variants point to a canonical operation that exists', () => {
    // E.g.: "create a charge with a card" shares POST /v3/payments with "create a
    // charge" — in the real Asaas it is the same endpoint, and the body decides.
    const variants = OPERATION_IDS.map(getOperation).filter((o) => o.variantOf)
    expect(variants.length).toBe(5)

    for (const v of variants) {
      const canonical = getOperation(v.variantOf as never)
      expect(canonical).toBeDefined()
      expect(canonical.variantOf).toBeUndefined() // no variant chain
      expect(canonical.method).toBe(v.method)
      expect(canonical.path).toBe(v.path)
    }
  })
})
