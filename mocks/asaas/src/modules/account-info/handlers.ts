/**
 * Track G1 — Account info.
 *
 * Nine operations over the authenticated account. None of them takes an id: the
 * resource is ALWAYS `auth.accountId`. It is the module where the isolation per
 * account is structural, and not a WHERE clause someone can forget.
 *
 * The fee table (GET /v3/myAccount/fees) is derived from `config.fees` — the
 * SAME source the engine uses to debit the fee when the charge is paid. If it
 * were a separate JSON, the answer could lie about what the mock charges, and a
 * subtly wrong mock is worse than no mock.
 */
import { eq } from 'drizzle-orm'
import type { Config } from '../../core/config.ts'
import { invalid, notFound } from '../../core/errors.ts'
import { listEnvelope } from '../../core/pagination.ts'
import type { DB } from '../../db/client.ts'
import type { HandlerMap } from '../../http/register.ts'
import { accounts } from '../../db/schema/accounts.ts'
import { accountCheckoutConfigs, accountDisablements } from '../../db/schema/account-config.ts'
import { isValidCpfCnpj, personTypeOf } from '../../domain/cpf-cnpj.ts'
import { bpToPercent, brlToCents, centsToBrl } from '../../domain/money.ts'
import { documentationStatus } from '../account-documents/service.ts'

type AccountRow = typeof accounts.$inferSelect

/** Only the authenticated account. A 404 here would mean a corrupted database. */
async function loadAccount(db: DB, accountId: string): Promise<AccountRow> {
  const [row] = await db.select().from(accounts).where(eq(accounts.id, accountId)).limit(1)
  if (!row) throw notFound('Conta')
  return row
}

function serializeCommercialInfo(a: AccountRow) {
  return {
    status: a.status,
    personType: a.personType,
    cpfCnpj: a.cpfCnpj,
    name: a.name,
    birthDate: a.birthDate ?? null,
    companyName: a.companyName ?? null,
    companyType: a.companyType ?? null,
    incomeValue: a.incomeCents === null ? null : centsToBrl(a.incomeCents as never),
    email: a.email,
    phone: a.phone ?? null,
    mobilePhone: a.mobilePhone ?? null,
    postalCode: a.postalCode ?? null,
    address: a.address ?? null,
    addressNumber: a.addressNumber ?? null,
    complement: a.complement ?? null,
    province: a.province ?? null,
    // The spec returns a complete `city` object (IBGE, district…), but the update
    // request has NO city field: in Asaas it is derived from the ZIP code. With no
    // ZIP code base, returning an invented object would be false confidence.
    city: a.city === null ? null : { object: 'city', name: a.city, state: a.state ?? null },
    denialReason: null,
    tradingName: a.tradingName ?? null,
    site: a.site ?? null,
    availableCompanyNames: null,
    commercialInfoExpiration: { isExpired: false, scheduledDate: null },
  }
}

/**
 * The fee table, derived from `config.fees`.
 *
 * What is `null` here is what this simulator does NOT charge (promotional fee,
 * percentage Pix fee). Returning an invented number would make the client
 * reconcile against a fee the engine never applies.
 */
function serializeFees(config: Config) {
  const f = config.fees
  return {
    payment: {
      bankSlip: {
        defaultValue: centsToBrl(f.boleto),
        discountValue: null,
        expirationDate: null,
        daysToReceive: config.rules.bankSlipSettlementDays,
      },
      creditCard: {
        operationValue: centsToBrl(f.creditCard.fixed),
        oneInstallmentPercentage: bpToPercent(f.creditCard.oneInstallment),
        upToSixInstallmentsPercentage: bpToPercent(f.creditCard.upToSix),
        upToTwelveInstallmentsPercentage: bpToPercent(f.creditCard.upToTwelve),
        upToTwentyOneInstallmentsPercentage: bpToPercent(f.creditCard.upToTwentyOne),
        discountOneInstallmentPercentage: null,
        discountUpToSixInstallmentsPercentage: null,
        discountUpToTwelveInstallmentsPercentage: null,
        discountUpToTwentyOneInstallmentsPercentage: null,
        discountExpiration: null,
        daysToReceive: config.rules.creditCardSettlementDays,
      },
      debitCard: {
        operationValue: centsToBrl(f.debitCard.fixed),
        defaultPercentage: bpToPercent(f.debitCard.pct),
        daysToReceive: config.rules.debitCardSettlementDays,
      },
      pix: {
        // The engine charges a FIXED fee per Pix received, not a percentage one.
        fixedFeeValue: centsToBrl(f.pix),
        fixedFeeValueWithDiscount: null,
        percentageFee: null,
        minimumFeeValue: null,
        maximumFeeValue: null,
        discountExpiration: null,
        monthlyCreditsWithoutFee: null,
        creditsReceivedOfCurrentMonth: null,
      },
    },
    transfer: {
      monthlyTransfersWithoutFee: f.transfer.monthlyWithoutFee,
      ted: {
        feeValue: centsToBrl(f.transfer.ted),
        consideredInMonthlyTransfersWithoutFee: true,
      },
      pix: {
        feeValue: centsToBrl(f.transfer.pix),
        discountValue: null,
        expirationDate: null,
        consideredInMonthlyTransfersWithoutFee: true,
      },
    },
    notification: {
      phoneCallFeeValue: centsToBrl(f.notification.phoneCall),
      whatsAppFeeValue: centsToBrl(f.notification.whatsApp),
      messagingFeeValue: centsToBrl(f.notification.messaging),
    },
    creditBureauReport: {
      naturalPersonFeeValue: centsToBrl(f.creditBureauReport.naturalPerson),
      legalPersonFeeValue: centsToBrl(f.creditBureauReport.legalPerson),
    },
    paymentDunning: { feeValue: centsToBrl(f.paymentDunning) },
    invoice: { feeValue: centsToBrl(f.invoice) },
    anticipation: {
      creditCard: {
        detachedMonthlyFeeValue: bpToPercent(f.anticipation.creditCardDetached),
        installmentMonthlyFeeValue: bpToPercent(f.anticipation.creditCardInstallment),
      },
      bankSlip: { monthlyFeePercentage: bpToPercent(f.anticipation.bankSlip) },
    },
  }
}

const DEFAULT_CHECKOUT_CONFIG = {
  object: 'paymentCheckoutConfig',
  logoBackgroundColor: null,
  infoBackgroundColor: null,
  fontColor: null,
  enabled: false,
  logoUrl: null,
  observations: null,
  status: null,
}

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

/** multipart sends everything as a string: `enabled=false` arrives as "false". */
function asBoolean(v: unknown, fallback: boolean): boolean {
  if (v === undefined || v === null || v === '') return fallback
  if (typeof v === 'boolean') return v
  return String(v) === 'true' || String(v) === '1'
}

function requiredColor(body: any, field: string): string {
  const value = body?.[field]
  if (typeof value !== 'string' || value === '') {
    throw invalid(field, `O campo ${field} é obrigatório.`)
  }
  if (!HEX_COLOR.test(value)) {
    throw invalid(field, `O campo ${field} deve ser uma cor hexadecimal (ex.: #00ff00).`)
  }
  return value
}

export const accountInfoHandlers: HandlerMap = {
  'retrieve-business-data': async ({ ctx, auth }) => {
    return serializeCommercialInfo(await loadAccount(ctx.db, auth.accountId))
  },

  'update-business-data': async ({ ctx, auth, body }) => {
    const b = (body ?? {}) as Record<string, unknown>
    const account = await loadAccount(ctx.db, auth.accountId)

    const patch: Partial<AccountRow> = {}

    if (b.cpfCnpj !== undefined && b.cpfCnpj !== null) {
      const cpfCnpj = String(b.cpfCnpj)
      if (!isValidCpfCnpj(cpfCnpj)) {
        throw invalid('cpfCnpj', 'O CPF/CNPJ informado é inválido.')
      }
      patch.cpfCnpj = cpfCnpj
      // Asaas DERIVES the personType from the size of the document — the field of
      // the request is ignored if it contradicts the CPF/CNPJ.
      patch.personType = personTypeOf(cpfCnpj)
    }

    if (b.incomeValue !== undefined && b.incomeValue !== null) {
      const income = Number(b.incomeValue)
      if (!Number.isFinite(income) || income < 0) {
        throw invalid('incomeValue', 'O faturamento/renda mensal deve ser um valor positivo.')
      }
      patch.incomeCents = brlToCents(income)
    }

    if (b.birthDate !== undefined) patch.birthDate = (b.birthDate as string) ?? null
    if (b.companyType !== undefined) patch.companyType = (b.companyType as string) ?? null
    if (b.companyName !== undefined) {
      patch.companyName = (b.companyName as string) ?? null
      // "Display name (auto-populated)" — o Asaas preenche o tradingName sozinho.
      patch.tradingName = (b.companyName as string) ?? null
    }
    if (b.email !== undefined && b.email !== null) patch.email = String(b.email)
    if (b.phone !== undefined) patch.phone = (b.phone as string) ?? null
    if (b.mobilePhone !== undefined) patch.mobilePhone = (b.mobilePhone as string) ?? null
    if (b.site !== undefined) patch.site = (b.site as string) ?? null
    if (b.postalCode !== undefined) patch.postalCode = (b.postalCode as string) ?? null
    if (b.address !== undefined) patch.address = (b.address as string) ?? null
    if (b.addressNumber !== undefined) patch.addressNumber = (b.addressNumber as string) ?? null
    if (b.complement !== undefined) patch.complement = (b.complement as string) ?? null
    if (b.province !== undefined) patch.province = (b.province as string) ?? null

    if (Object.keys(patch).length > 0) {
      await ctx.db.update(accounts).set(patch).where(eq(accounts.id, auth.accountId))
    }

    return serializeCommercialInfo({ ...account, ...patch })
  },

  'retrieve-account-fees': ({ ctx }) => serializeFees(ctx.config),

  'retrieve-asaas-account-number': async ({ ctx, auth }) => {
    const account = await loadAccount(ctx.db, auth.accountId)

    // The account number is assigned on the first access and never changes.
    // Generating it on every request would make the client see a different
    // number per call.
    let stored = account.accountNumber
    if (!stored) {
      stored = `${ctx.rng.digits(6)}-${ctx.rng.digits(1)}`
      await ctx.db
        .update(accounts)
        .set({ accountNumber: stored })
        .where(eq(accounts.id, auth.accountId))
    }

    const [number, digit] = stored.split('-')
    return { agency: '0001', account: number ?? stored, accountDigit: digit ?? '0' }
  },

  'check-account-registration-status': async ({ ctx, auth }) => {
    const account = await loadAccount(ctx.db, auth.accountId)
    const status = account.status

    /**
     * `documentation` comes from the DOCUMENT GROUPS, not from the status of the
     * registration — it is what makes the KYC observable: a newly created
     * subaccount transacts (registration APPROVED) but still owes documents, and
     * that is what the client checks before sending the user to the onboarding.
     * It goes back to APPROVED when the documents are sent or when
     * `POST /v3/sandbox/myAccount/approve` runs.
     *
     * `null` = account without groups (from before the table existed): it follows
     * the registration.
     */
    const documentation = (await documentationStatus(ctx.db, auth.accountId)) ?? status
    const general = status === 'APPROVED' && documentation === 'APPROVED' ? 'APPROVED' : 'PENDING'

    return {
      id: account.id,
      commercialInfo: status,
      bankAccountInfo: status,
      documentation,
      general,
    }
  },

  'retrieve-walletid': async ({ ctx, auth, query }) => {
    void ctx
    void query
    // The account has exactly one wallet. The envelope is a list anyway — it is
    // what the spec declares, and a client that iterates `data` keeps working.
    const data = [{ object: 'wallet', id: auth.walletId }]
    return listEnvelope(data, data.length, 10, 0)
  },

  'retrieve-personalization-settings': async ({ ctx, auth }) => {
    const [row] = await ctx.db
      .select()
      .from(accountCheckoutConfigs)
      .where(eq(accountCheckoutConfigs.accountId, auth.accountId))
      .limit(1)

    if (!row) return DEFAULT_CHECKOUT_CONFIG

    return {
      object: 'paymentCheckoutConfig',
      logoBackgroundColor: row.logoBackgroundColor,
      infoBackgroundColor: row.infoBackgroundColor,
      fontColor: row.fontColor,
      enabled: row.enabled,
      logoUrl: row.logoUrl,
      observations: row.observations,
      status: row.status,
    }
  },

  'save-payment-checkout-personalization': async ({ ctx, auth, body }) => {
    // multipart/form-data does not go through the schema validation (the JSON
    // TypeBox does not describe a File), so the required fields are checked here.
    const b = (body ?? {}) as Record<string, unknown>

    const logoBackgroundColor = requiredColor(b, 'logoBackgroundColor')
    const infoBackgroundColor = requiredColor(b, 'infoBackgroundColor')
    const fontColor = requiredColor(b, 'fontColor')
    const enabled = asBoolean(b.enabled, true)

    const [existing] = await ctx.db
      .select()
      .from(accountCheckoutConfigs)
      .where(eq(accountCheckoutConfigs.accountId, auth.accountId))
      .limit(1)

    const logoFile = b.logoFile
    const logoUrl =
      logoFile === undefined || logoFile === null || logoFile === ''
        ? (existing?.logoUrl ?? null)
        : `${ctx.config.publicBaseUrl}/file/public/download/${ctx.rng.alphanumeric(32)}`

    const row = {
      accountId: auth.accountId,
      logoBackgroundColor,
      infoBackgroundColor,
      fontColor,
      enabled,
      logoUrl,
      // The sandbox approves by itself — it is what the example of the spec shows.
      status: 'APPROVED',
      observations: 'Aprovado automaticamente pelo sistema.',
      updatedAt: ctx.clock.timestamp(),
    }

    if (existing) {
      await ctx.db
        .update(accountCheckoutConfigs)
        .set(row)
        .where(eq(accountCheckoutConfigs.accountId, auth.accountId))
    } else {
      await ctx.db.insert(accountCheckoutConfigs).values(row)
    }

    return {
      object: 'paymentCheckoutConfig',
      logoBackgroundColor: row.logoBackgroundColor,
      infoBackgroundColor: row.infoBackgroundColor,
      fontColor: row.fontColor,
      enabled: row.enabled,
      logoUrl: row.logoUrl,
      observations: row.observations,
      status: row.status,
    }
  },

  'Delete-white-label-subaccount': async ({ ctx, auth, query }) => {
    const account = await loadAccount(ctx.db, auth.accountId)

    // The endpoint is "Delete White Label subaccount": the root account does not
    // destroy itself. Without this, a distracted test would delete the main
    // account.
    if (!account.parentAccountId) {
      throw invalid(
        'account',
        'Somente subcontas white label podem ser removidas por este endpoint.',
      )
    }

    const [already] = await ctx.db
      .select()
      .from(accountDisablements)
      .where(eq(accountDisablements.accountId, auth.accountId))
      .limit(1)

    if (already) {
      throw invalid('account', 'Esta conta já está desabilitada.')
    }

    await ctx.db.insert(accountDisablements).values({
      accountId: auth.accountId,
      removeReason: (query.removeReason as string | undefined) ?? null,
      disabledAt: ctx.clock.timestamp(),
    })

    return { observations: 'Conta desabilitada com sucesso' }
  },
}
