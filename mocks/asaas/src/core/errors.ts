/**
 * Errors in the exact Asaas format:
 *
 *   { "errors": [ { "code": "invalid_value", "description": "..." } ] }
 *
 * Always an ARRAY — even with a single error. The descriptions of the /v3
 * surface are in pt-BR, like the real Asaas; the simulator's own endpoints
 * (/_admin, /_mock) answer in English.
 *
 * There is no official catalog of codes. The real pattern is `invalid_<field>`,
 * in camelCase, the same as the request field name.
 */

export interface AsaasErrorItem {
  code: string
  description: string
}

export class AsaasError extends Error {
  readonly status: number
  readonly errors: AsaasErrorItem[]

  constructor(status: number, errors: AsaasErrorItem[]) {
    super(errors[0]?.description ?? 'Error')
    this.name = 'AsaasError'
    this.status = status
    this.errors = errors
  }

  toResponseBody() {
    return { errors: this.errors }
  }
}

/** 400 — the most common case. `invalid_<field>`. */
export function invalid(field: string, description: string): AsaasError {
  return new AsaasError(400, [{ code: `invalid_${field}`, description }])
}

export function badRequest(code: string, description: string): AsaasError {
  return new AsaasError(400, [{ code, description }])
}

export function unauthorized(): AsaasError {
  return new AsaasError(401, [
    {
      code: 'invalid_access_token',
      description: 'A chave de API fornecida é inválida.',
    },
  ])
}

export function invalidTokenFormat(): AsaasError {
  return new AsaasError(401, [
    {
      code: 'invalid_access_token_format',
      description: 'O formato da chave de API fornecida é inválido.',
    },
  ])
}

export function notFound(what = 'Object'): AsaasError {
  return new AsaasError(404, [
    { code: 'not_found', description: `${what} não encontrado.` },
  ])
}

/**
 * 404 for the simulator's own endpoints (/_admin, /_mock): the description is
 * written by this project and is not part of the Asaas wire contract.
 */
export function notFoundMessage(description: string): AsaasError {
  return new AsaasError(404, [{ code: 'not_found', description }])
}

export function forbidden(description = 'Requisição não autorizada.'): AsaasError {
  return new AsaasError(403, [{ code: 'forbidden', description }])
}

/**
 * A route that exists in the spec but has no business engine here yet.
 *
 * The real Asaas never returns 501 — but returning 404 would be lying (the route
 * does exist) and returning fake data would be worse: it would produce false
 * confidence, which is exactly what a mock must not do. The code is
 * self-explanatory and the `operationId` says what is missing.
 */
export function notImplemented(operationId: string): AsaasError {
  return new AsaasError(501, [
    {
      code: 'not_implemented',
      description:
        `The operation "${operationId}" exists in the Asaas API but is not ` +
        `implemented in this simulator yet. See progress.md.`,
    },
  ])
}

/** Status transition not allowed by the state machine. */
export function invalidStatusTransition(from: string, action: string): AsaasError {
  return badRequest(
    'invalid_action',
    `Não é possível executar "${action}" em um objeto com status ${from}.`,
  )
}
