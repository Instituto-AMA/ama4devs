/**
 * Route registration driven by the MANIFEST.
 *
 * The 213 operations of Asaas's spec are built by iterating `OPERATIONS`. An
 * operationId without a handler automatically gets a `notImplemented`.
 *
 * The consequence that is the whole point: "the 213 routes exist" is a BUILD
 * INVARIANT, not a checklist in a document. It is impossible to forget to register
 * a route, and the coverage (`GET /_admin/coverage`) is computed, never kept by
 * hand.
 */
import { OptionalKind, Type, type TSchema } from '@sinclair/typebox'
import type { Elysia } from 'elysia'
import type { AppContext, AuthContext } from '../core/context.ts'
import { notImplemented } from '../core/errors.ts'
import {
  getOperation,
  OPERATIONS,
  type OperationId,
  type OperationMeta,
} from '../generated/operations.ts'

export interface HandlerArgs {
  ctx: AppContext
  auth: AuthContext
  params: Record<string, string>
  query: Record<string, unknown>
  body: unknown
  headers: Record<string, string | undefined>
  operation: OperationMeta
}

export type OpHandler = (args: HandlerArgs) => Promise<unknown> | unknown

export type HandlerMap = Partial<Record<OperationId, OpHandler>>

export interface RegisterResult {
  implemented: OperationId[]
  stubbed: OperationId[]
  /** Operations that share a route with another one — they do not register a route of their own. */
  variants: OperationId[]
}

/**
 * The body of a canonical operation PLUS the one of its variants.
 *
 * This is not a detail: Elysia REMOVES from the body every property that is not
 * in the schema. `POST /v3/payments` is registered with the schema of
 * `create-new-payment` — which does not know `creditCard`, `creditCardToken`,
 * `remoteIp` or `authorizeOnly`. Without the merge, the canonical handler would
 * receive an already pruned body and would NEVER see the card: the
 * `create-new-payment-with-credit-card` variant would be unreachable, silently.
 *
 * In the real Asaas it is a single endpoint, and the body decides. Here the schema
 * is the union of the two: the fields that only exist in the variant come in as
 * OPTIONAL (otherwise `remoteIp`, mandatory in the card variant, would end up
 * being required for a bank slip charge). Who requires what is the handler — which
 * is who knows whether the body is a card or not.
 */
/**
 * The fields whose INTERNAL REQUIREDNESS is decided by the handler, not by the
 * schema.
 *
 * The spec's `creditCard` is an `anyOf` that requires the 5 fields. A body like
 * `{creditCardToken, creditCard: {ccv}}` matches no branch, and the validator
 * answers **"Expected union value"** — a TypeBox string, which Asaas would never
 * send. Asaas answers FOUR errors, one per missing field, with its own sentences.
 *
 * An error the client will never see in production is worse than no error at all:
 * it teaches the client to handle a message that does not exist. So we relax the
 * schema here and let the handler refuse — it is who knows the right sentences
 * (`assertCompleteCard`).
 *
 * The schema keeps PRUNING unknown fields; it only stops requiring presence.
 */
const HANDLER_VALIDATED = new Set(['creditCard'])

/** The same object, with all the properties optional. No `required`. */
function relaxObject(schema: TSchema): TSchema {
  const anyOf = (schema as { anyOf?: TSchema[] }).anyOf
  // The union comes from the spec (e.g. "card" | "card with token"). We keep the most
  // complete branch: it is the superset of the fields the handler knows how to read.
  const chosen = anyOf?.length
    ? anyOf.reduce((a, b) =>
        Object.keys((b as { properties?: object }).properties ?? {}).length >
        Object.keys((a as { properties?: object }).properties ?? {}).length
          ? b
          : a,
      )
    : schema

  const props = (chosen as { properties?: Record<string, TSchema> }).properties
  if (!props) return schema

  return Type.Object(
    Object.fromEntries(Object.entries(props).map(([k, v]) => [k, Type.Optional(v)])),
  )
}

function mergeVariantBodies(op: OperationMeta, variants: OperationMeta[]): TSchema | undefined {
  const base = op.body as (TSchema & { properties?: Record<string, TSchema> }) | undefined
  if (!base?.properties || op.bodyContentType !== 'application/json') return op.body

  const properties: Record<string, TSchema> = { ...base.properties }
  let merged = false

  for (const variant of variants) {
    const vb = variant.body as (TSchema & { properties?: Record<string, TSchema> }) | undefined
    if (!vb?.properties || variant.bodyContentType !== 'application/json') continue

    for (const [name, schema] of Object.entries(vb.properties)) {
      if (name in properties) continue
      properties[name] = Type.Optional(schema)
      merged = true
    }
  }

  for (const name of HANDLER_VALIDATED) {
    const schema = properties[name]
    if (!schema) continue
    properties[name] = Type.Optional(relaxObject(schema))
    merged = true
  }

  return merged ? Type.Object(properties) : op.body
}

/**
 * The query string is ALWAYS text: `?limit=10` arrives as `"10"`.
 *
 * The spec declares those parameters as `integer`/`number`/`boolean`, and TypeBox
 * refuses `"10"` where it expects `10`. Without this, `GET /v3/financialTransactions?limit=10`
 * — a request the real Asaas accepts without flinching — would return
 * 400 "Expected integer". It is the worst kind of defect possible in a simulator:
 * it rejecting what the real API accepts.
 *
 * We relax ONLY the query schema, also accepting the textual form. The conversion
 * and the range validation stay in the handler (`paginationParams`), which is where
 * the error knows how to become `invalid_limit` with a pt-BR description — instead
 * of the validator's raw "Expected integer".
 */
function coerceQuerySchema(query: TSchema): TSchema {
  const props = (query as TSchema & { properties?: Record<string, TSchema> }).properties
  if (!props) return query

  const out: Record<string, TSchema> = {}
  let changed = false

  for (const [name, prop] of Object.entries(props)) {
    const p = prop as TSchema & { type?: string }
    const scalar = p.type === 'integer' || p.type === 'number' || p.type === 'boolean'

    if (!scalar) {
      out[name] = prop
      continue
    }

    const union = Type.Union([prop, Type.String()])
    const optional = (prop as unknown as Record<symbol, unknown>)[OptionalKind] === 'Optional'
    out[name] = optional ? Type.Optional(union) : union
    changed = true
  }

  return changed ? Type.Object(out) : query
}

export function registerOperations(
  app: Elysia,
  ctx: AppContext,
  handlers: HandlerMap,
): RegisterResult {
  const implemented: OperationId[] = []
  const stubbed: OperationId[] = []
  const variants: OperationId[] = []

  /** canonical → the variants that share a route with it. */
  const variantsOf = new Map<string, OperationMeta[]>()
  for (const id of Object.keys(OPERATIONS) as OperationId[]) {
    // `getOperation` and not `OPERATIONS[id]`: indexing the `as const` object returns
    // the union of the 213 literal types, and the members without `variantOf` do not
    // have the property — the access does not compile.
    const op = getOperation(id)
    if (!op.variantOf) continue
    const list = variantsOf.get(op.variantOf) ?? []
    list.push(op)
    variantsOf.set(op.variantOf, list)
  }

  for (const id of Object.keys(OPERATIONS) as OperationId[]) {
    const op: OperationMeta = OPERATIONS[id]

    // A variant of another operation (same method+route). The one that answers is the
    // canonical one, which decides by the body — just like the real Asaas.
    if (op.variantOf) {
      variants.push(id)
      continue
    }

    const handler = handlers[id]

    if (handler) implemented.push(id)
    else stubbed.push(id)

    const run = handler ?? (() => {
      throw notImplemented(id)
    })

    const schema: Record<string, unknown> = {}
    if (op.query) schema.query = coerceQuerySchema(op.query)
    // multipart does not go through schema validation: the body arrives as FormData
    // with a File inside, and the JSON's TypeBox does not describe that.
    if (op.body && op.bodyContentType === 'application/json') {
      schema.body = mergeVariantBodies(op, variantsOf.get(id) ?? [])
    }

    // We deliberately do NOT validate the response in production: one extra field in
    // our serialization must not bring down the user's request. The contract
    // validation runs in the tests, where it is supposed to break. (tests/helpers/harness)

    const paramNames = op.paramNames ?? []

    const elysiaHandler = (c: any) => {
      // The router hands over :p0, :p1… (normalized by position). We translate back
      // to the spec's names, so the handler sees `params.imageId`.
      const params: Record<string, string> = {}
      paramNames.forEach((name, i) => {
        params[name] = c.params?.[`p${i}`]
      })

      return run({
        ctx,
        auth: c.auth as AuthContext,
        params,
        query: (c.query ?? {}) as Record<string, unknown>,
        body: c.body,
        headers: c.headers as Record<string, string | undefined>,
        operation: op,
      })
    }

    // The type of `app[method]` is a union of overloads per route; the registration is
    // dynamic by nature. The strong typing lives at the handler's boundary.
    const register = (app as any)[op.method].bind(app)
    register(op.path, elysiaHandler, schema)
  }

  return { implemented, stubbed, variants }
}
