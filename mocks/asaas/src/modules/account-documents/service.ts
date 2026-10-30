/**
 * KYC: creation, approval and serialization of the documents of an account.
 *
 * It lives in a service, and not only in the handlers, because what CREATES the
 * groups is not a route: it is the birth of an account (the seed of the main
 * account and `POST /v3/accounts`). A subaccount born without a pending group
 * would have nothing to send, and the KYC flow of the client would stop at the
 * first step.
 */
import { and, eq, ne } from 'drizzle-orm'
import type { Clock } from '../../core/clock.ts'
import type { Config } from '../../core/config.ts'
import type { Rng } from '../../core/rng.ts'
import type { DB } from '../../db/client.ts'
import { accountDocumentGroups, accountDocuments } from '../../db/schema/account-documents.ts'
import { addDays } from '../../domain/calendar.ts'
import * as ids from '../../domain/ids.ts'

type GroupRow = typeof accountDocumentGroups.$inferSelect
type DocumentRow = typeof accountDocuments.$inferSelect

export interface DocumentDeps {
  clock: Clock
  rng: Rng
  config: Config
}

/**
 * The group every account is born with. The title and the description are the
 * ones the real sandbox returns — they are not invented text.
 *
 * TODO(rule): the real Asaas varies the groups according to the type of person
 * and the type of company (articles of incorporation for LTDA, MEI
 * certificate…). We did not capture a non-approved account, so we model ONE
 * group, the identification one, which is the only one that exists in every
 * account. Creating more groups would be inventing.
 */
const IDENTIFICATION_GROUP = {
  type: 'IDENTIFICATION',
  title: 'Documentos de identificação',
  description:
    'Para enviar esse documento acesse nosso aplicativo ou utilize o link de onboarding.',
} as const

/** TODO(rule): the docs do not say for how long the onboarding link is valid. */
const ONBOARDING_URL_TTL_DAYS = 30

/**
 * Who is responsible for the documents, derived from the registration of the
 * account.
 *
 * TODO(rule): we only have the capture of ONE account (JURIDICA,
 * `INDIVIDUAL_COMPANY`). The rest of the map is a deduction from the
 * `AccountDocumentResponsibleType` enum of the spec.
 */
export function responsibleTypeFor(
  personType: string,
  companyType: string | null,
): string {
  if (personType === 'FISICA') return 'ASAAS_ACCOUNT_OWNER'

  switch (companyType) {
    case 'MEI':
      return 'MEI'
    case 'LIMITED':
      return 'LIMITED_COMPANY'
    case 'ASSOCIATION':
      return 'ASSOCIATION'
    default:
      return 'INDIVIDUAL_COMPANY'
  }
}

export interface NewAccountDocuments {
  accountId: string
  name: string
  personType: string
  companyType: string | null
  /** The primary (seed) account starts approved; a subaccount starts with KYC pending. */
  approved: boolean
}

/**
 * Creates the groups/documents of a newly created account. Call it INSIDE the
 * transaction that creates the account.
 */
export async function createAccountDocuments(
  tx: DB,
  deps: DocumentDeps,
  account: NewAccountDocuments,
): Promise<void> {
  const now = deps.clock.timestamp()
  const groupId = ids.genericId(deps.rng)
  const approved = account.approved

  await tx.insert(accountDocumentGroups).values({
    id: groupId,
    accountId: account.accountId,
    type: IDENTIFICATION_GROUP.type,
    title: IDENTIFICATION_GROUP.title,
    description: IDENTIFICATION_GROUP.description,
    status: approved ? 'APPROVED' : 'NOT_SENT',
    responsibleName: account.name,
    responsibleType: responsibleTypeFor(account.personType, account.companyType),
    // The link only exists while there is something to send — in the approved
    // group the real sandbox returns `onboardingUrl: null`.
    onboardingUrl: approved ? null : onboardingUrl(deps),
    onboardingUrlExpirationDate: approved
      ? null
      : `${addDays(deps.clock.today(), ONBOARDING_URL_TTL_DAYS)} 00:00:00`,
    dateCreated: now,
  })

  await tx.insert(accountDocuments).values({
    id: ids.genericId(deps.rng),
    groupId,
    accountId: account.accountId,
    status: approved ? 'APPROVED' : 'NOT_SENT',
    fileName: null,
    sentAt: approved ? now : null,
    dateCreated: now,
  })
}

function onboardingUrl(deps: DocumentDeps): string {
  return `${deps.config.publicBaseUrl}/onboarding/${deps.rng.hex(32)}`
}

/** Approves all the documents and groups of the account. Used by the sandbox action. */
export async function approveAccountDocuments(
  tx: DB,
  accountId: string,
  now: string,
): Promise<void> {
  await tx
    .update(accountDocuments)
    .set({ status: 'APPROVED', sentAt: now })
    .where(and(eq(accountDocuments.accountId, accountId), ne(accountDocuments.status, 'APPROVED')))

  await tx
    .update(accountDocumentGroups)
    .set({ status: 'APPROVED', onboardingUrl: null, onboardingUrlExpirationDate: null })
    .where(
      and(
        eq(accountDocumentGroups.accountId, accountId),
        ne(accountDocumentGroups.status, 'APPROVED'),
      ),
    )
}

/**
 * Approves the document and, if it was the last pending one, the whole group.
 * In the sandbox any file is accepted — there is no analysis to wait for.
 */
export async function approveDocument(
  tx: DB,
  doc: DocumentRow,
  fileName: string | null,
  now: string,
): Promise<void> {
  await tx
    .update(accountDocuments)
    .set({ status: 'APPROVED', fileName, sentAt: now })
    .where(eq(accountDocuments.id, doc.id))

  const pending = await tx
    .select({ id: accountDocuments.id })
    .from(accountDocuments)
    .where(
      and(eq(accountDocuments.groupId, doc.groupId), ne(accountDocuments.status, 'APPROVED')),
    )

  if (pending.length > 0) return

  await tx
    .update(accountDocumentGroups)
    .set({ status: 'APPROVED', onboardingUrl: null, onboardingUrlExpirationDate: null })
    .where(eq(accountDocumentGroups.id, doc.groupId))
}

/**
 * The documentation status of the account, for `GET /v3/myAccount/status`.
 *
 * `null` = the account has no group at all (a database created before this
 * table); whoever calls falls back to the status of the account instead of
 * rejecting the account in silence.
 */
export async function documentationStatus(
  db: DB,
  accountId: string,
): Promise<'APPROVED' | 'PENDING' | null> {
  const groups = await db
    .select({ status: accountDocumentGroups.status })
    .from(accountDocumentGroups)
    .where(eq(accountDocumentGroups.accountId, accountId))

  if (groups.length === 0) return null

  const done = groups.every((g) => g.status === 'APPROVED' || g.status === 'IGNORED')
  return done ? 'APPROVED' : 'PENDING'
}

/**
 * The answer of `GET /v3/myAccount/documents`, in the format captured from the
 * sandbox.
 *
 * Two things the real format does and a naive serializer would get wrong:
 *
 * 1. the APPROVED group does NOT bring the `documents` array nor
 *    `onboardingUrlExpirationDate` — only `onboardingUrl: null`;
 * 2. `responsible.type` is a STRING, not an array. The spec declares an array;
 *    the sandbox capture denies it. The golden wins (AGENTS.md).
 */
export async function listDocumentGroups(db: DB, accountId: string) {
  const groups = await db
    .select()
    .from(accountDocumentGroups)
    .where(eq(accountDocumentGroups.accountId, accountId))

  const docs = await db
    .select()
    .from(accountDocuments)
    .where(eq(accountDocuments.accountId, accountId))

  return {
    // TODO(rule): we never reject an account in the sandbox, so there is no reason
    // to refuse to report one.
    rejectReasons: null,
    data: groups.map((g) => serializeGroup(g, docs.filter((d) => d.groupId === g.id))),
  }
}

function serializeGroup(g: GroupRow, docs: DocumentRow[]): Record<string, unknown> {
  const group: Record<string, unknown> = {
    id: g.id,
    status: g.status,
    type: g.type,
    title: g.title,
    description: g.description,
    responsible: { name: g.responsibleName, type: g.responsibleType },
    onboardingUrl: g.onboardingUrl,
  }

  if (g.status === 'APPROVED') return group

  group.onboardingUrlExpirationDate = g.onboardingUrlExpirationDate
  group.documents = docs.map((d) => ({ id: d.id, status: d.status }))
  return group
}
