/**
 * Fiscal notes (tag Invoice) and fiscal information of the account (tag Fiscal
 * Info).
 *
 * Scheduling, editing, issuing and cancelling go through service.ts, the same
 * place the scheduler job and the `/_mock/invoices` controls use, so each path
 * sends the same INVOICE_* events.
 */
import { and, asc, count, eq, gte, lte } from 'drizzle-orm'
import { invalid, notFound } from '../../core/errors.ts'
import { listEnvelope, paginationParams } from '../../core/pagination.ts'
import { fiscalInfo, invoices } from '../../db/schema/index.ts'
import type { InvoiceTaxes } from '../../domain/invoice.ts'
import type { HandlerMap } from '../../http/register.ts'
import { serializeInvoice } from './serializer.ts'
import {
  cancelInvoice,
  findInvoice,
  fiscalInfoOf,
  issueInvoice,
  scheduleInvoice,
  updateInvoice,
  type InvoiceInput,
} from './service.ts'

function inputOf(b: Record<string, any>): InvoiceInput {
  const pick = <K extends keyof InvoiceInput>(k: K) => (b[k] === undefined ? {} : { [k]: b[k] })
  return {
    ...pick('payment'),
    ...pick('installment'),
    ...pick('customer'),
    ...pick('serviceDescription'),
    ...pick('observations'),
    ...pick('externalReference'),
    ...pick('value'),
    ...pick('deductions'),
    ...pick('effectiveDate'),
    ...pick('municipalServiceId'),
    ...pick('municipalServiceCode'),
    ...pick('municipalServiceName'),
    ...pick('updatePayment'),
    ...(b.taxes && typeof b.taxes === 'object' ? { taxes: b.taxes as InvoiceTaxes } : {}),
  }
}

/**
 * Services of the municipal list (LC 116/2003 items) offered to `municipalServiceId`.
 * TODO(rule): Asaas lists the services of the account's own city; this is a
 * fixed sample of common ones, with a typical ISS rate.
 */
const MUNICIPAL_SERVICES = [
  { id: '1.03', description: '1.03 - Processamento, armazenamento ou hospedagem de dados, textos, imagens, vídeos, páginas eletrônicas, aplicativos e sistemas de informação', issTax: 2 },
  { id: '1.05', description: '1.05 - Licenciamento ou cessão de direito de uso de programas de computação', issTax: 2 },
  { id: '1.07', description: '1.07 - Suporte técnico em informática, inclusive instalação, configuração e manutenção de programas de computação e bancos de dados', issTax: 2 },
  { id: '4.01', description: '4.01 - Medicina e biomedicina', issTax: 2 },
  { id: '4.08', description: '4.08 - Terapia ocupacional, fisioterapia e fonoaudiologia', issTax: 2 },
  { id: '4.16', description: '4.16 - Psicologia', issTax: 2 },
  { id: '8.02', description: '8.02 - Instrução, treinamento, orientação pedagógica e educacional, avaliação de conhecimentos de qualquer natureza', issTax: 2 },
  { id: '17.01', description: '17.01 - Assessoria ou consultoria de qualquer natureza', issTax: 5 },
]

const bool = (v: unknown) => (typeof v === 'string' ? v === 'true' : v === undefined ? undefined : Boolean(v))
const int = (v: unknown) => (v === undefined || v === '' ? undefined : Number(v))

/** What `GET /v3/fiscalInfo` answers: the secrets only as "sent". */
function serializeFiscalInfo(d: Record<string, any>) {
  return {
    object: 'fiscalInfo',
    email: d.email ?? null,
    municipalInscription: d.municipalInscription ?? null,
    simplesNacional: d.simplesNacional ?? false,
    culturalProjectsPromoter: d.culturalProjectsPromoter ?? false,
    cnae: d.cnae ?? null,
    specialTaxRegime: d.specialTaxRegime ?? null,
    serviceListItem: d.serviceListItem ?? null,
    nbsCode: d.nbsCode ?? null,
    rpsSerie: d.rpsSerie ?? null,
    rpsNumber: d.rpsNumber ?? null,
    loteNumber: d.loteNumber ?? null,
    username: d.username ?? null,
    passwordSent: d.passwordSent ?? false,
    accessTokenSent: d.accessTokenSent ?? false,
    certificateSent: d.certificateSent ?? false,
    nationalPortalTaxCalculationRegime: d.nationalPortalTaxCalculationRegime ?? null,
  }
}

export const invoiceHandlers: HandlerMap = {
  'schedule-invoice': async ({ ctx, auth, body }) =>
    serializeInvoice(await scheduleInvoice(ctx, auth.accountId, inputOf(body as Record<string, any>))),

  'list-invoices': async ({ ctx, auth, query }) => {
    const { limit, offset } = paginationParams(query)
    const filters = [eq(invoices.accountId, auth.accountId)]
    if (query.status) filters.push(eq(invoices.status, String(query.status)))
    if (query.payment) filters.push(eq(invoices.paymentId, String(query.payment)))
    if (query.installment) filters.push(eq(invoices.installmentId, String(query.installment)))
    if (query.customer) filters.push(eq(invoices.customerId, String(query.customer)))
    if (query.externalReference) filters.push(eq(invoices.externalReference, String(query.externalReference)))
    if (query['effectiveDate[Ge]']) filters.push(gte(invoices.effectiveDate, String(query['effectiveDate[Ge]'])))
    if (query['effectiveDate[Le]']) filters.push(lte(invoices.effectiveDate, String(query['effectiveDate[Le]'])))
    const where = and(...filters)

    const [total] = await ctx.db.select({ n: count() }).from(invoices).where(where)
    const rows = await ctx.db
      .select()
      .from(invoices)
      .where(where)
      .orderBy(asc(invoices.dateCreated), asc(invoices.id))
      .limit(limit)
      .offset(offset)
    return listEnvelope(rows.map(serializeInvoice), total?.n ?? 0, limit, offset)
  },

  'retrieve-a-single-invoice': async ({ ctx, auth, params }) =>
    serializeInvoice(await findInvoice(ctx, auth.accountId, params.id!)),

  'update-invoice': async ({ ctx, auth, params, body }) => {
    const inv = await findInvoice(ctx, auth.accountId, params.id!)
    return serializeInvoice(await updateInvoice(ctx, inv, inputOf(body as Record<string, any>)))
  },

  'issue-an-invoice': async ({ ctx, auth, params }) => {
    const inv = await findInvoice(ctx, auth.accountId, params.id!)
    return serializeInvoice(await issueInvoice(ctx, inv))
  },

  'cancel-an-invoice': async ({ ctx, auth, params, body }) => {
    const inv = await findInvoice(ctx, auth.accountId, params.id!)
    const onlyOnAsaas = (body as Record<string, any> | undefined)?.cancelOnlyOnAsaas === true
    return serializeInvoice(await cancelInvoice(ctx, inv, onlyOnAsaas))
  },

  // ── Fiscal information ─────────────────────────────────────────────────────

  'retrieve-tax-information': async ({ ctx, auth }) => {
    const info = await fiscalInfoOf(ctx.db, auth.accountId)
    if (!info) throw notFound('Informações fiscais')
    return serializeFiscalInfo(info)
  },

  /**
   * multipart/form-data (the certificate is a file), so the schema validation
   * does not run (see register.ts): the required fields are checked here, and
   * the form's strings become booleans and numbers. Secrets are kept only as
   * "sent" — the mock has no city hall to log into.
   */
  'create-and-update-tax-information': async ({ ctx, auth, body }) => {
    const b = (body ?? {}) as Record<string, any>
    const current = (await fiscalInfoOf(ctx.db, auth.accountId)) ?? {}

    const email = b.email ?? current.email
    if (!email) throw invalid('email', 'Informe o e-mail para envio das notas fiscais.')
    const simplesNacional = bool(b.simplesNacional) ?? current.simplesNacional
    if (simplesNacional === undefined) {
      throw invalid('simplesNacional', 'Informe se a empresa é optante pelo Simples Nacional.')
    }

    const next: Record<string, unknown> = { ...current, email, simplesNacional }
    for (const k of ['municipalInscription', 'cnae', 'specialTaxRegime', 'serviceListItem', 'nbsCode', 'rpsSerie', 'username', 'nationalPortalTaxCalculationRegime']) {
      if (b[k] !== undefined) next[k] = b[k] === '' ? null : String(b[k])
    }
    if (b.culturalProjectsPromoter !== undefined) next.culturalProjectsPromoter = bool(b.culturalProjectsPromoter)
    for (const k of ['rpsNumber', 'loteNumber']) if (int(b[k]) !== undefined) next[k] = int(b[k])
    if (b.password) next.passwordSent = true
    if (b.accessToken) next.accessTokenSent = true
    if (b.certificateFile) next.certificateSent = true

    const now = ctx.clock.timestamp()
    await ctx.db
      .insert(fiscalInfo)
      .values({ accountId: auth.accountId, data: next, updatedAt: now })
      .onConflictDoUpdate({ target: fiscalInfo.accountId, set: { data: next, updatedAt: now } })
    return serializeFiscalInfo(next)
  },

  'list-municipal-services': async ({ query }) => {
    const { limit, offset } = paginationParams(query)
    const q = String(query.description ?? '').toLowerCase()
    const all = MUNICIPAL_SERVICES.filter((s) => !q || s.description.toLowerCase().includes(q))
    return listEnvelope(all.slice(offset, offset + limit), all.length, limit, offset)
  },

  'list-municipal-configurations': async () => ({
    authenticationType: 'CERTIFICATE',
    supportsCancellation: true,
    usesSpecialTaxRegimes: true,
    usesServiceListItem: true,
    specialTaxRegimesList: [
      { label: 'Microempresa municipal', value: '1' },
      { label: 'Estimativa', value: '2' },
      { label: 'Sociedade de profissionais', value: '3' },
      { label: 'Cooperativa', value: '4' },
      { label: 'Microempresário individual (MEI)', value: '5' },
      { label: 'Microempresa ou empresa de pequeno porte (ME/EPP)', value: '6' },
    ],
    nationalPortalTaxCalculationRegimeList: [],
    nationalPortalTaxCalculationRegimeHelp: null,
    municipalInscriptionHelp: 'A inscrição municipal da empresa, como consta no cadastro da prefeitura.',
    specialTaxRegimeHelp: 'O regime especial de tributação, quando a empresa tiver um.',
    serviceListItemHelp: 'O item da lista de serviços da LC 116/2003.',
    digitalCertificatedHelp: 'O certificado digital A1 (.pfx) da empresa.',
    accessTokenHelp: null,
    municipalServiceCodeHelp: 'O código do serviço na lista da prefeitura.',
  }),
}
