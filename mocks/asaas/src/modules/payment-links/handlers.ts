/**
 * Track G1 — Payment Link (11 operations).
 *
 * The payment link is a "mould" of a charge: the end customer opens the URL,
 * fills in the data and the charge is born out of it. Here we implement the
 * mould and the images of the showcase; the generation of the charge out of a
 * checkout of the link belongs to the payments track.
 *
 * Two things the spec leaves implicit and that matter:
 *
 * - `deleted` is a SOFT delete. `restore` exists precisely because the removed
 *   link stays in the database (and stays listable with `includeDeleted=true`).
 * - Exactly ONE image is the main one. The rule is kept on the write (setting
 *   one as main drops the previous main), never on the read.
 */
import { and, asc, count, desc, eq, like, ne } from 'drizzle-orm'
import type { AppContext } from '../../core/context.ts'
import { invalid, notFound } from '../../core/errors.ts'
import { listEnvelope, paginationParams } from '../../core/pagination.ts'
import { paymentLinks } from '../../db/schema/misc.ts'
import { paymentLinkImages } from '../../db/schema/payment-link-images.ts'
import { paymentLinkId, paymentLinkImageId } from '../../domain/ids.ts'
import { brlToCents, centsToBrl } from '../../domain/money.ts'
import type { HandlerMap } from '../../http/register.ts'

type PaymentLinkRow = typeof paymentLinks.$inferSelect
type PaymentLinkImageRow = typeof paymentLinkImages.$inferSelect

function serialize(row: PaymentLinkRow) {
  return {
    id: row.id,
    name: row.name,
    value: row.valueCents === null ? null : centsToBrl(row.valueCents as never),
    active: row.active,
    chargeType: row.chargeType,
    url: row.url,
    billingType: row.billingType,
    subscriptionCycle: row.subscriptionCycle ?? null,
    description: row.description ?? null,
    endDate: row.endDate ?? null,
    deleted: row.deleted,
    viewCount: row.viewCount,
    maxInstallmentCount: row.maxInstallmentCount ?? null,
    dueDateLimitDays: row.dueDateLimitDays ?? null,
    notificationEnabled: row.notificationEnabled,
    isAddressRequired: row.isAddressRequired,
    externalReference: row.externalReference ?? null,
  }
}

function serializeImage(ctx: AppContext, row: PaymentLinkImageRow) {
  const base = ctx.config.publicBaseUrl
  return {
    id: row.id,
    main: row.main,
    image: {
      originalName: row.originalName,
      size: row.size,
      extension: row.extension,
      previewUrl: `${base}/file/preview/${row.publicToken}`,
      downloadUrl: `${base}/file/public/download/${row.publicToken}`,
    },
  }
}

/** Isolation per account: the link of another account simply DOES NOT EXIST (404). */
async function loadLink(
  ctx: AppContext,
  accountId: string,
  id: string,
): Promise<PaymentLinkRow> {
  const [row] = await ctx.db
    .select()
    .from(paymentLinks)
    .where(and(eq(paymentLinks.id, id), eq(paymentLinks.accountId, accountId)))
    .limit(1)

  if (!row) throw notFound('Link de pagamento')
  return row
}

async function loadImage(
  ctx: AppContext,
  accountId: string,
  linkId: string,
  imageId: string,
): Promise<PaymentLinkImageRow> {
  await loadLink(ctx, accountId, linkId) // 404 before leaking the existence of the image
  const [row] = await ctx.db
    .select()
    .from(paymentLinkImages)
    .where(
      and(eq(paymentLinkImages.id, imageId), eq(paymentLinkImages.paymentLinkId, linkId)),
    )
    .limit(1)

  if (!row) throw notFound('Imagem do link de pagamento')
  return row
}

/** Rules the spec describes in prose and the TypeBox cannot express. */
function validateChargeRules(chargeType: string, body: Record<string, unknown>): void {
  if (chargeType === 'RECURRENT' && !body.subscriptionCycle) {
    throw invalid(
      'subscriptionCycle',
      'O ciclo da assinatura é obrigatório quando o tipo de cobrança é RECURRENT.',
    )
  }
  if (chargeType !== 'INSTALLMENT' && Number(body.maxInstallmentCount ?? 1) > 1) {
    throw invalid(
      'maxInstallmentCount',
      'O parcelamento só é permitido quando o tipo de cobrança é INSTALLMENT.',
    )
  }
}

function toValueCents(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) {
    throw invalid('value', 'O valor do link de pagamento deve ser maior que zero.')
  }
  return brlToCents(n)
}

/**
 * An upload arrives in two ways: real multipart (a `File`) or, in contract
 * tests, JSON with the image in base64. Both produce the same metadata.
 */
function readImageUpload(raw: unknown): { originalName: string; size: number } {
  if (raw instanceof File) {
    return { originalName: raw.name || 'image', size: raw.size }
  }
  if (typeof raw === 'string' && raw !== '') {
    const base64 = raw.includes(',') ? raw.slice(raw.indexOf(',') + 1) : raw
    return { originalName: 'image.png', size: Buffer.from(base64, 'base64').byteLength }
  }
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>
    if (typeof o.name === 'string') {
      return { originalName: o.name, size: Number(o.size ?? 0) }
    }
  }
  throw invalid('image', 'É obrigatório enviar a imagem.')
}

function extensionOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(i + 1).toLowerCase() : 'png'
}

function asBoolean(v: unknown, fallback: boolean): boolean {
  if (v === undefined || v === null || v === '') return fallback
  if (typeof v === 'boolean') return v
  return String(v) === 'true' || String(v) === '1'
}

/** Guarantees the "exactly one main" invariant after any write. */
async function ensureSingleMain(ctx: AppContext, linkId: string, mainId: string): Promise<void> {
  await ctx.db
    .update(paymentLinkImages)
    .set({ main: false })
    .where(and(eq(paymentLinkImages.paymentLinkId, linkId), ne(paymentLinkImages.id, mainId)))

  await ctx.db
    .update(paymentLinkImages)
    .set({ main: true })
    .where(eq(paymentLinkImages.id, mainId))
}

export const paymentLinkHandlers: HandlerMap = {
  'create-a-payments-link': async ({ ctx, auth, body }) => {
    const b = (body ?? {}) as Record<string, unknown>
    const chargeType = String(b.chargeType)
    validateChargeRules(chargeType, b)

    const id = paymentLinkId(ctx.rng)
    const row = {
      id,
      accountId: auth.accountId,
      name: String(b.name),
      description: (b.description as string | null) ?? null,
      billingType: String(b.billingType),
      chargeType,
      valueCents: toValueCents(b.value),
      endDate: (b.endDate as string | null) ?? null,
      dueDateLimitDays:
        b.dueDateLimitDays === undefined || b.dueDateLimitDays === null
          ? null
          : Number(b.dueDateLimitDays),
      subscriptionCycle: (b.subscriptionCycle as string | null) ?? null,
      // "If not informed, the default value will be 1 installment."
      maxInstallmentCount:
        b.maxInstallmentCount === undefined || b.maxInstallmentCount === null
          ? 1
          : Number(b.maxInstallmentCount),
      notificationEnabled: asBoolean(b.notificationEnabled, true),
      isAddressRequired: asBoolean(b.isAddressRequired, false),
      externalReference: (b.externalReference as string | null) ?? null,
      callback: (b.callback as Record<string, unknown> | null) ?? null,
      url: `${ctx.config.publicBaseUrl}/c/${id}`,
      active: true,
      deleted: false,
      viewCount: 0,
      dateCreated: ctx.clock.timestamp(),
    }

    await ctx.db.insert(paymentLinks).values(row)
    return serialize(row as PaymentLinkRow) // 200, never 201
  },

  'list-payments-links': async ({ ctx, auth, query }) => {
    const { limit, offset } = paginationParams(query)

    const filters = [eq(paymentLinks.accountId, auth.accountId)]

    // A removed one disappears from the listing by default — it is what makes the
    // delete a "delete".
    if (!asBoolean(query.includeDeleted, false)) {
      filters.push(eq(paymentLinks.deleted, false))
    }
    if (query.active !== undefined) {
      filters.push(eq(paymentLinks.active, asBoolean(query.active, true)))
    }
    if (typeof query.name === 'string' && query.name !== '') {
      filters.push(like(paymentLinks.name, `%${query.name}%`))
    }
    if (typeof query.externalReference === 'string' && query.externalReference !== '') {
      filters.push(eq(paymentLinks.externalReference, query.externalReference))
    }

    const where = and(...filters)

    const [{ total } = { total: 0 }] = await ctx.db
      .select({ total: count() })
      .from(paymentLinks)
      .where(where)

    const rows = await ctx.db
      .select()
      .from(paymentLinks)
      .where(where)
      .orderBy(desc(paymentLinks.dateCreated), desc(paymentLinks.id))
      .limit(limit)
      .offset(offset)

    return listEnvelope(rows.map(serialize), total, limit, offset)
  },

  'retrieve-a-single-payments-link': async ({ ctx, auth, params }) => {
    return serialize(await loadLink(ctx, auth.accountId, params.id!))
  },

  'update-a-payments-link': async ({ ctx, auth, params, body }) => {
    const b = (body ?? {}) as Record<string, unknown>
    const current = await loadLink(ctx, auth.accountId, params.id!)

    const chargeType = (b.chargeType as string | undefined) ?? current.chargeType
    validateChargeRules(chargeType, {
      subscriptionCycle: b.subscriptionCycle ?? current.subscriptionCycle,
      maxInstallmentCount: b.maxInstallmentCount ?? current.maxInstallmentCount,
    })

    const patch: Partial<PaymentLinkRow> = {}
    if (b.name !== undefined && b.name !== null) patch.name = String(b.name)
    if (b.description !== undefined) patch.description = (b.description as string) ?? null
    if (b.endDate !== undefined) patch.endDate = (b.endDate as string) ?? null
    if (b.value !== undefined) patch.valueCents = toValueCents(b.value)
    if (b.active !== undefined && b.active !== null) patch.active = asBoolean(b.active, true)
    if (b.billingType !== undefined && b.billingType !== null) {
      patch.billingType = String(b.billingType)
    }
    if (b.chargeType !== undefined && b.chargeType !== null) patch.chargeType = chargeType
    if (b.dueDateLimitDays !== undefined) {
      patch.dueDateLimitDays =
        b.dueDateLimitDays === null ? null : Number(b.dueDateLimitDays)
    }
    if (b.subscriptionCycle !== undefined) {
      patch.subscriptionCycle = (b.subscriptionCycle as string) ?? null
    }
    if (b.maxInstallmentCount !== undefined) {
      patch.maxInstallmentCount =
        b.maxInstallmentCount === null ? 1 : Number(b.maxInstallmentCount)
    }
    if (b.externalReference !== undefined) {
      patch.externalReference = (b.externalReference as string) ?? null
    }
    if (b.notificationEnabled !== undefined && b.notificationEnabled !== null) {
      patch.notificationEnabled = asBoolean(b.notificationEnabled, true)
    }
    if (b.callback !== undefined) {
      patch.callback = (b.callback as Record<string, unknown>) ?? null
    }

    if (Object.keys(patch).length > 0) {
      await ctx.db
        .update(paymentLinks)
        .set(patch)
        .where(
          and(eq(paymentLinks.id, current.id), eq(paymentLinks.accountId, auth.accountId)),
        )
    }

    return serialize({ ...current, ...patch })
  },

  'remove-a-payments-link': async ({ ctx, auth, params }) => {
    const link = await loadLink(ctx, auth.accountId, params.id!)

    // Compare-and-swap: remover duas vezes altera zero linhas na segunda.
    await ctx.db
      .update(paymentLinks)
      .set({ deleted: true, active: false })
      .where(
        and(
          eq(paymentLinks.id, link.id),
          eq(paymentLinks.accountId, auth.accountId),
          eq(paymentLinks.deleted, false),
        ),
      )

    return { deleted: true, id: link.id }
  },

  'restore-a-payments-link': async ({ ctx, auth, params }) => {
    const link = await loadLink(ctx, auth.accountId, params.id!)

    await ctx.db
      .update(paymentLinks)
      .set({ deleted: false, active: true })
      .where(
        and(
          eq(paymentLinks.id, link.id),
          eq(paymentLinks.accountId, auth.accountId),
          eq(paymentLinks.deleted, true),
        ),
      )

    return serialize({ ...link, deleted: false, active: true })
  },

  'add-an-image-to-a-payments-link': async ({ ctx, auth, params, body }) => {
    const link = await loadLink(ctx, auth.accountId, params.id!)
    const b = (body ?? {}) as Record<string, unknown>

    const upload = readImageUpload(b.image)
    const existing = await ctx.db
      .select({ id: paymentLinkImages.id })
      .from(paymentLinkImages)
      .where(eq(paymentLinkImages.paymentLinkId, link.id))

    // The first image is the main one by definition: a link with images always
    // has a main one, otherwise the showcase would have no cover.
    const main = asBoolean(b.main, false) || existing.length === 0

    const row = {
      id: paymentLinkImageId(ctx.rng),
      paymentLinkId: link.id,
      main,
      originalName: upload.originalName,
      size: upload.size,
      extension: extensionOf(upload.originalName),
      publicToken: ctx.rng.alphanumeric(64),
      dateCreated: ctx.clock.timestamp(),
    }

    await ctx.db.insert(paymentLinkImages).values(row)
    if (main) await ensureSingleMain(ctx, link.id, row.id)

    return serializeImage(ctx, row)
  },

  'list-images-from-a-payments-link': async ({ ctx, auth, params, query }) => {
    const link = await loadLink(ctx, auth.accountId, params.id!)
    const { limit, offset } = paginationParams(query)

    // The main one first — it is the cover of the showcase.
    const rows = await ctx.db
      .select()
      .from(paymentLinkImages)
      .where(eq(paymentLinkImages.paymentLinkId, link.id))
      .orderBy(desc(paymentLinkImages.main), asc(paymentLinkImages.dateCreated))

    const page = rows.slice(offset, offset + limit)
    return listEnvelope(
      page.map((r) => serializeImage(ctx, r)),
      rows.length,
      limit,
      offset,
    )
  },

  'retrieve-a-single-payments-link-image': async ({ ctx, auth, params }) => {
    const row = await loadImage(ctx, auth.accountId, params.paymentLinkId!, params.imageId!)
    return serializeImage(ctx, row)
  },

  'remove-an-image-from-payments-link': async ({ ctx, auth, params }) => {
    const linkId = params.paymentLinkId!
    const image = await loadImage(ctx, auth.accountId, linkId, params.imageId!)

    await ctx.db.delete(paymentLinkImages).where(eq(paymentLinkImages.id, image.id))

    // Did it remove the main one? The oldest one left takes over — the link never
    // stays with images and no cover.
    // TODO(rule): the docs do not say what Asaas does here.
    if (image.main) {
      const [next] = await ctx.db
        .select({ id: paymentLinkImages.id })
        .from(paymentLinkImages)
        .where(eq(paymentLinkImages.paymentLinkId, linkId))
        .orderBy(asc(paymentLinkImages.dateCreated))
        .limit(1)

      if (next) await ensureSingleMain(ctx, linkId, next.id)
    }

    return { deleted: true, id: image.id }
  },

  'set-payments-link-main-image': async ({ ctx, auth, params }) => {
    const linkId = params.paymentLinkId!
    const image = await loadImage(ctx, auth.accountId, linkId, params.imageId!)

    await ensureSingleMain(ctx, linkId, image.id)
    return serializeImage(ctx, { ...image, main: true })
  },
}
