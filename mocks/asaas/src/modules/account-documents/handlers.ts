/**
 * KYC / onboarding of the authenticated account (tag "Account Document") and the
 * sandbox action that approves the account (tag "Sandbox Actions").
 *
 * The two live together because they are the SAME flow: the client lists the
 * pending documents, sends the files, and the account is approved. (The CHARGE
 * sandbox actions live in `payments/handlers.ts` — each sandbox action stays
 * next to the resource it moves, and not in a "sandbox" folder that gathers
 * domains that do not talk to each other.)
 *
 * None of the three operations takes an account id: the resource is always
 * `auth.accountId`.
 */
import { and, eq } from 'drizzle-orm'
import { invalid, notFound } from '../../core/errors.ts'
import type { DB } from '../../db/client.ts'
import { accounts } from '../../db/schema/accounts.ts'
import { accountDocuments } from '../../db/schema/account-documents.ts'
import type { HandlerMap } from '../../http/register.ts'
import {
  approveAccountDocuments,
  approveDocument,
  documentationStatus,
  listDocumentGroups,
} from './service.ts'

/**
 * The name of the sent file. In multipart, Elysia delivers a `File`; if someone
 * sends JSON (the schema validation does not run in multipart — see
 * `register.ts`), a string arrives.
 */
function fileNameOf(value: unknown): string | null {
  if (value instanceof File) return value.name
  if (typeof value === 'string' && value !== '') return value
  return null
}

export const accountDocumentHandlers: HandlerMap = {
  'check-pending-documents': async ({ ctx, auth }) => {
    return listDocumentGroups(ctx.db, auth.accountId)
  },

  /**
   * `POST /v3/myAccount/documents/{id}` — multipart/form-data, field
   * `documentFile`. The `{id}` is the one of the DOCUMENT (the one that came in
   * `group.documents[]`), not the one of the group.
   *
   * In the sandbox any file is accepted and approved on the spot: the document
   * becomes APPROVED and, if it was the last pending one of the group, the group
   * too.
   */
  'send-documents': async ({ ctx, auth, params, body }) => {
    const b = (body ?? {}) as Record<string, unknown>

    // multipart does not go through the Elysia schema validation (the JSON
    // TypeBox does not describe a File), so the required field is checked here.
    if (b.documentFile === undefined || b.documentFile === null || b.documentFile === '') {
      throw invalid('documentFile', 'O arquivo do documento é obrigatório.')
    }

    const [doc] = await ctx.db
      .select()
      .from(accountDocuments)
      .where(
        and(
          eq(accountDocuments.id, params.id!),
          eq(accountDocuments.accountId, auth.accountId),
        ),
      )
      .limit(1)

    if (!doc) throw notFound('Documento')

    const now = ctx.clock.timestamp()
    await ctx.db.transaction(async (tx) => {
      await approveDocument(tx as unknown as DB, doc, fileNameOf(b.documentFile), now)
    })

    // The `type` field of the request would only make sense to create a new
    // document in a CUSTOM group; here the document already exists and the group
    // defines the type.
    return { id: doc.id, status: 'APPROVED' }
  },

  /**
   * `POST /v3/sandbox/myAccount/approve` — approves the authenticated account.
   * It returns the same body as `GET /v3/myAccount/status`, already with the
   * effect applied: it is what allows the client to confirm the approval without
   * a second call.
   */
  'approve-account': async ({ ctx, auth }) => {
    const now = ctx.clock.timestamp()

    await ctx.db.transaction(async (tx) => {
      await tx
        .update(accounts)
        .set({ status: 'APPROVED' })
        .where(eq(accounts.id, auth.accountId))

      await approveAccountDocuments(tx as unknown as DB, auth.accountId, now)
    })

    const documentation = await documentationStatus(ctx.db, auth.accountId)

    return {
      id: auth.accountId,
      commercialInfo: 'APPROVED',
      bankAccountInfo: 'APPROVED',
      documentation: documentation ?? 'APPROVED',
      general: 'APPROVED',
    }
  },
}
