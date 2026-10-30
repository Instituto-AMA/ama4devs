import { Elysia } from 'elysia'
import { panelRoutes } from '../admin/panel.ts'
import { adminRoutes } from '../admin/routes.ts'
import type { AppContext } from '../core/context.ts'
import { AsaasError, unauthorized } from '../core/errors.ts'
import { nfseRoutes } from '../invoice/nfse.ts'
import { invoiceRoutes } from '../invoice/routes.ts'
import { mockRoutes } from '../mock/routes.ts'
import type { Scheduler } from '../scheduler/scheduler.ts'
import { authenticate } from './auth.ts'
import { localGuard, STATE_CHANGING_METHODS } from './local-guard.ts'
import { registerOperations, type HandlerMap, type RegisterResult } from './register.ts'
import { recordRequest } from './request-log.ts'

export interface AppDeps {
  ctx: AppContext
  handlers: HandlerMap
  scheduler: Scheduler
}

/**
 * Every error comes out in Asaas's format: { errors: [{ code, description }] }. A
 * refused API call enters the Request Logs with the body that went out.
 */
function errorHandler(ctx: AppContext) {
  const respond = asaasError(ctx)
  return async (context: any) => {
    const response = respond(context)
    await recordRequest(
      ctx,
      { request: context.request, body: context.body, status: context.set.status, auth: context.auth },
      response,
    )
    return response
  }
}

function asaasError(ctx: AppContext) {
  return ({ error, code, set }: any) => {
    if (error instanceof AsaasError) {
      set.status = error.status
      return error.toResponseBody()
    }

    // TypeBox failure → 400 in Asaas's `invalid_<field>` pattern,
    // not Elysia's default 422.
    if (code === 'VALIDATION') {
      set.status = 400
      const errors = (error.all ?? [])
        .filter((e: any) => e?.path)
        .map((e: any) => ({
          code: `invalid_${String(e.path).replace(/^\//, '').replace(/\//g, '.') || 'body'}`,
          description: e.message ?? 'Valor inválido.',
        }))
      return {
        errors: errors.length
          ? errors
          : [{ code: 'invalid_body', description: 'Requisição inválida.' }],
      }
    }

    if (code === 'NOT_FOUND') {
      set.status = 404
      return {
        errors: [
          {
            code: 'not_found',
            description: 'O endpoint solicitado não existe na API do Asaas.',
          },
        ],
      }
    }

    ctx.log('error', 'Unhandled error', { error: String(error), stack: error?.stack })
    set.status = 500
    return { errors: [{ code: 'internal_error', description: 'Erro interno do simulador.' }] }
  }
}

const DISPATCH_PREFIXES = ['/v3', '/_mock', '/_admin', '/i']

/** True for a finished 2xx mutating request under the API, mock or admin routes. */
function shouldDispatch(request: Request, status: unknown): boolean {
  if (!STATE_CHANGING_METHODS.has(request.method)) return false
  const code = status === undefined ? 200 : Number(status)
  if (!(code >= 200 && code < 300)) return false
  const path = new URL(request.url).pathname
  return DISPATCH_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))
}

export function createApp(deps: AppDeps): { app: Elysia; coverage: RegisterResult } {
  const { ctx } = deps

  /**
   * The API routes live in a plugin of their own so that the authentication
   * `derive` applies only to them — the /_admin and /health endpoints do not ask
   * for an access_token. The manifest paths already include the /v3 prefix, so we
   * do NOT use .group().
   */
  const api = new Elysia({ name: 'asaas-v3' })
    .onError(errorHandler(ctx))
    .derive(async ({ headers }) => {
      const token = headers['access_token']
      if (!token) throw unauthorized()
      return { auth: await authenticate(ctx.db, token, ctx.clock.timestamp()) }
    })
    // Logs de Requisições: the call and what it returned, before the response leaves.
    .onAfterHandle(async (context: any) => {
      await recordRequest(
        ctx,
        { request: context.request, body: context.body, status: context.set.status, auth: context.auth },
        context.responseValue ?? context.response,
      )
    })

  const coverage = registerOperations(api as unknown as Elysia, ctx, deps.handlers)
  ctx.coverage = coverage

  const app = new Elysia()
    .onError(errorHandler(ctx))
    .use(localGuard(ctx.config.allowedHosts))
    // The change is committed by now: send its webhooks without waiting for the tick.
    .onAfterResponse({ as: 'global' }, ({ request, set }) => {
      if (!shouldDispatch(request, set.status)) return
      deps.scheduler.dispatchNow().catch((err) =>
        ctx.log('error', 'Immediate webhook dispatch failed', { error: String(err) }),
      )
    })
    .get('/health', () => ({
      status: 'ok',
      clock: ctx.clock.timestamp(),
      clockMode: ctx.clock.mode,
    }))
    .use(panelRoutes(ctx))
    .use(adminRoutes(ctx, deps.scheduler))
    .use(mockRoutes(ctx))
    .use(invoiceRoutes(ctx))
    .use(nfseRoutes(ctx))
    .use(api)

  return { app: app as unknown as Elysia, coverage }
}
