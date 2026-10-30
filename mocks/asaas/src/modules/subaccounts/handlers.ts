/**
 * Subaccounts. (Track F)
 *
 * WHY THIS MATTERS MORE THAN IT LOOKS: a subaccount is born with an **API key
 * of its own** and a **walletId of its own**. It is what makes the split truly
 * testable — the money leaves one account, enters the other, and BOTH statements
 * close. Without a subaccount, the destination walletId would be a string with
 * no owner and the split would not be more than a note.
 *
 * The key is shown ONE SINGLE TIME, in the response of the creation (and of the
 * creation of a new key). After that it never comes back anywhere — it is what
 * Asaas does, and a mock that returned the key in a listing would teach the
 * integrator to trust something the real API will never deliver.
 */
import { and, count, eq } from 'drizzle-orm'
import type { AppContext } from '../../core/context.ts'
import { invalid, notFound } from '../../core/errors.ts'
import { listEnvelope, paginationParams } from '../../core/pagination.ts'
import { accounts, apiKeys, webhooks } from '../../db/schema/index.ts'
import type { DB } from '../../db/client.ts'
import { isValidCpfCnpj, personTypeOf } from '../../domain/cpf-cnpj.ts'
import * as ids from '../../domain/ids.ts'
import { brlToCents } from '../../domain/money.ts'
import type { HandlerMap } from '../../http/register.ts'
import { createAccountDocuments } from '../account-documents/service.ts'

type AccountRow = typeof accounts.$inferSelect
type ApiKeyRow = typeof apiKeys.$inferSelect

const digitsOnly = (v: string): string => v.replace(/\D/g, '')

/**
 * The subaccount only exists for whoever created it. For any other account it is
 * a 404 — not a 403: the API neither confirms nor denies the existence of
 * someone else's account.
 */
async function findSubaccount(
  ctx: AppContext,
  parentAccountId: string,
  id: string,
): Promise<AccountRow> {
  const [row] = await ctx.db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, id), eq(accounts.parentAccountId, parentAccountId)))
    .limit(1)

  if (!row) throw notFound('Subconta')
  return row
}

/** `"235104-7"` → `{ agency: '0001', account: '235104', accountDigit: '7' }` */
function serializeAccountNumber(stored: string | null): Record<string, unknown> | null {
  if (!stored) return null
  const [number, digit] = stored.split('-')
  return { agency: '0001', account: number ?? stored, accountDigit: digit ?? '0' }
}

function serializeAccount(a: AccountRow): Record<string, unknown> {
  return {
    object: 'account',
    id: a.id,
    name: a.name,
    email: a.email,
    loginEmail: a.loginEmail,
    phone: a.phone,
    mobilePhone: a.mobilePhone,
    address: a.address,
    addressNumber: a.addressNumber,
    complement: a.complement,
    province: a.province,
    postalCode: a.postalCode,
    cpfCnpj: a.cpfCnpj,
    birthDate: a.birthDate,
    personType: a.personType,
    companyType: a.companyType,
    /**
     * TODO(rule): `city` is the numeric id of the city in the Asaas registry, and
     * there is no public table of that registry. The creation request does not
     * even have the field — we return null instead of inventing a number nobody
     * could check.
     */
    city: null,
    state: a.state,
    country: a.country,
    tradingName: a.tradingName,
    site: a.site,
    walletId: a.walletId,
    accountNumber: serializeAccountNumber(a.accountNumber),
    commercialInfoExpiration: { isExpired: false, scheduledDate: null },
  }
}

/**
 * The API key WITHOUT the secret. It is what comes out of a listing.
 * `projectedExpirationDateByLackOfUse`: TODO(rule) — the docs do not define the
 * inactivity window that expires a key; we return null instead of guessing.
 */
function serializeApiKey(k: ApiKeyRow): Record<string, unknown> {
  return {
    id: k.id,
    name: k.name,
    enabled: k.active,
    disabledReason: k.active ? null : 'MANUAL',
    expirationDate: k.expirationDate,
    dateCreated: k.dateCreated,
    projectedExpirationDateByLackOfUse: null,
  }
}

export const subaccountHandlers: HandlerMap = {
  /**
   * Creates the subaccount WITH an API key of its own. It is the only time the
   * key appears.
   *
   * The registration is born APPROVED (the subaccount already transacts), but
   * the KYC is NOT: it is born with a group of documents pending
   * (`GET /v3/myAccount/documents`), which is what the client needs to exercise
   * the onboarding. What closes the cycle is the upload of the file or
   * `POST /v3/sandbox/myAccount/approve`.
   */
  'create-subaccount': async ({ ctx, auth, body }) => {
    const b = body as Record<string, any>

    const cpfCnpj = digitsOnly(String(b.cpfCnpj ?? ''))
    if (!isValidCpfCnpj(cpfCnpj)) {
      throw invalid('cpfCnpj', 'O CPF ou CNPJ informado é inválido.')
    }

    // Asaas does not allow two accounts with the same document.
    const [dup] = await ctx.db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.cpfCnpj, cpfCnpj))
      .limit(1)
    if (dup) {
      throw invalid('cpfCnpj', 'Já existe uma conta cadastrada com este CPF/CNPJ.')
    }

    const income = Number(b.incomeValue)
    if (!Number.isFinite(income) || income < 0) {
      throw invalid('incomeValue', 'O faturamento/renda mensal deve ser um valor positivo.')
    }

    const now = ctx.clock.timestamp()
    const accountId = ids.accountId(ctx.rng)
    const walletId = ids.walletId(ctx.rng)
    const key = ids.apiKey(ctx.rng)
    const apiKeyId = ids.genericId(ctx.rng)
    const personType = personTypeOf(cpfCnpj)

    const row: AccountRow = {
      id: accountId,
      walletId,
      parentAccountId: auth.accountId,

      name: String(b.name),
      companyName: null,
      // "Display name (auto-populated)" — o Asaas preenche sozinho.
      tradingName: String(b.name),
      email: String(b.email),
      loginEmail: b.loginEmail ? String(b.loginEmail) : String(b.email),
      cpfCnpj,
      personType,
      companyType: personType === 'JURIDICA' ? (b.companyType ?? null) : null,
      birthDate: b.birthDate ?? null,
      mobilePhone: b.mobilePhone ? String(b.mobilePhone) : null,
      phone: b.phone ?? null,
      site: b.site ?? null,

      address: String(b.address),
      addressNumber: String(b.addressNumber),
      complement: b.complement ?? null,
      province: String(b.province),
      postalCode: String(b.postalCode),
      city: null,
      state: null,
      country: 'Brasil',

      incomeCents: brlToCents(income),
      status: 'APPROVED', // the registration, not the KYC — the documents are born pending
      balanceCents: 0,
      accountNumber: `${ctx.rng.digits(6)}-${ctx.rng.digits(1)}`,
      dateCreated: now,
    }

    await ctx.db.transaction(async (tx) => {
      await tx.insert(accounts).values(row)
      await tx.insert(apiKeys).values({
        id: apiKeyId,
        accountId,
        key,
        name: 'Chave principal',
        active: true,
        dateCreated: now,
        expirationDate: null,
      })

      await createAccountDocuments(
        tx as unknown as DB,
        { clock: ctx.clock, rng: ctx.rng, config: ctx.config },
        {
          accountId,
          name: row.name,
          personType: row.personType,
          companyType: row.companyType,
          approved: false,
        },
      )

      // The request may already carry the webhooks of the subaccount. Ignoring
      // them in silence would make the integrator believe they subscribed to
      // events that would never arrive.
      for (const w of (b.webhooks ?? []) as Record<string, any>[]) {
        await tx.insert(webhooks).values({
          id: ids.webhookConfigId(ctx.rng),
          accountId,
          name: String(w.name ?? 'Webhook'),
          url: String(w.url ?? ''),
          email: String(w.email ?? b.email),
          enabled: w.enabled ?? true,
          interrupted: w.interrupted ?? false,
          authToken: w.authToken ?? null,
          apiVersion: w.apiVersion ?? 3,
          sendType: w.sendType === 'NON_SEQUENTIALLY' ? 'NON_SEQUENTIALLY' : 'SEQUENTIALLY',
          events: (w.events ?? []) as string[],
          dateCreated: now,
        })
      }
    })

    return {
      ...serializeAccount(row),
      /**
       * `apiKey` at the top AND inside `accessToken`. The spec only declares the
       * `accessToken` object, but the Asaas docs and examples show `apiKey` at
       * the root — and that is where every integrator looks. Returning both does
       * not lie about anything and saves someone from not finding the key.
       */
      apiKey: key,
      accessToken: {
        id: apiKeyId,
        name: 'Chave principal',
        enabled: true,
        disabledReason: null,
        expirationDate: null,
        dateCreated: now,
        projectedExpirationDateByLackOfUse: null,
        apiKey: key,
      },
    }
  },

  'list-subaccounts': async ({ ctx, auth, query }) => {
    const { limit, offset } = paginationParams(query)

    const filters = [eq(accounts.parentAccountId, auth.accountId)]
    if (query.cpfCnpj) filters.push(eq(accounts.cpfCnpj, digitsOnly(String(query.cpfCnpj))))
    if (query.email) filters.push(eq(accounts.email, String(query.email)))
    if (query.name) filters.push(eq(accounts.name, String(query.name)))
    if (query.walletId) filters.push(eq(accounts.walletId, String(query.walletId)))

    const where = and(...filters)

    const [total] = await ctx.db.select({ n: count() }).from(accounts).where(where)
    const rows = await ctx.db
      .select()
      .from(accounts)
      .where(where)
      .limit(limit)
      .offset(offset)

    return listEnvelope(rows.map(serializeAccount), total?.n ?? 0, limit, offset)
  },

  'retrieve-a-single-subaccount': async ({ ctx, auth, params }) =>
    serializeAccount(await findSubaccount(ctx, auth.accountId, params.id!)),

  /**
   * Closes the subaccount. Its keys stop working right away (401 on the next
   * request) — it is the effect that matters, and the one a test can observe.
   */
  'close-non-baas-subaccount': async ({ ctx, auth, params }) => {
    const sub = await findSubaccount(ctx, auth.accountId, params.id!)

    await ctx.db.transaction(async (tx) => {
      await tx.update(accounts).set({ status: 'CLOSED' }).where(eq(accounts.id, sub.id))
      await tx.update(apiKeys).set({ active: false }).where(eq(apiKeys.accountId, sub.id))
    })

    return { deleted: true, id: sub.id }
  },

  /**
   * Resends the activation link. There is no e-mail to send here — what exists
   * is the guarantee that the subaccount exists and is yours. 204, no body.
   */
  'resend-activation-link-for-non-baas-subaccount': async ({ ctx, auth, params }) => {
    const sub = await findSubaccount(ctx, auth.accountId, params.id!)
    ctx.log('info', `Activation link resent to the subaccount ${sub.id} (${sub.email})`)
    return new Response(null, { status: 204 })
  },

  // ── Subaccount API keys ───────────────────────────────────

  'create-api-key-for-subaccount': async ({ ctx, auth, params, body }) => {
    const sub = await findSubaccount(ctx, auth.accountId, params.id!)
    const b = (body ?? {}) as Record<string, any>

    const now = ctx.clock.timestamp()
    const id = ids.genericId(ctx.rng)
    const key = ids.apiKey(ctx.rng)
    const name = b.name ? String(b.name) : 'Chave de API'
    const expirationDate = b.expirationDate ? String(b.expirationDate) : null

    await ctx.db.insert(apiKeys).values({
      id,
      accountId: sub.id,
      key,
      name,
      active: true,
      dateCreated: now,
      expirationDate,
    })

    // The ONLY response that carries the secret. The listing never returns it.
    return {
      id,
      name,
      enabled: true,
      disabledReason: null,
      expirationDate,
      dateCreated: now,
      projectedExpirationDateByLackOfUse: null,
      apiKey: key,
    }
  },

  'list-api-keys-for-subaccount': async ({ ctx, auth, params }) => {
    const sub = await findSubaccount(ctx, auth.accountId, params.id!)

    const rows = await ctx.db.select().from(apiKeys).where(eq(apiKeys.accountId, sub.id))
    return { accessTokens: rows.map(serializeApiKey) }
  },

  'update-api-key-for-a-subaccount': async ({ ctx, auth, params, body }) => {
    const sub = await findSubaccount(ctx, auth.accountId, params.id!)
    const b = (body ?? {}) as Record<string, any>

    const [key] = await ctx.db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.id, params.accessTokenId!), eq(apiKeys.accountId, sub.id)))
      .limit(1)
    if (!key) throw notFound('Chave de API')

    const patch: Partial<ApiKeyRow> = {}
    if (b.name !== undefined) patch.name = String(b.name)
    // Disabling the key kills it in practice: the authentication only accepts an active key.
    if (b.enabled !== undefined) patch.active = Boolean(b.enabled)
    if (b.expirationDate !== undefined) patch.expirationDate = b.expirationDate ?? null

    await ctx.db.update(apiKeys).set(patch).where(eq(apiKeys.id, key.id))
    return serializeApiKey({ ...key, ...patch })
  },

  'delete-api-key-for-a-subaccount': async ({ ctx, auth, params }) => {
    const sub = await findSubaccount(ctx, auth.accountId, params.id!)

    const [key] = await ctx.db
      .select({ id: apiKeys.id })
      .from(apiKeys)
      .where(and(eq(apiKeys.id, params.accessTokenId!), eq(apiKeys.accountId, sub.id)))
      .limit(1)
    if (!key) throw notFound('Chave de API')

    await ctx.db.delete(apiKeys).where(eq(apiKeys.id, key.id))
    return new Response(null, { status: 204 })
  },
}
