/**
 * The payer's side of a hosted checkout: the page behind the checkout's `link`.
 * NOT part of the Asaas API; it is the page Asaas hosts at the same path.
 *
 *   GET  /checkoutSession/show/:id       the checkout: items, total, how to pay
 *   POST /checkoutSession/show/:id/pay   the payer pays: { chargeType?, billingType?, creditCard?, customerData? }
 *
 * Paying here is `payCheckout`, the same service as `/_mock/checkouts/:id/pay`.
 * The routes are key-free and sit behind the local guard, like the invoice page.
 */
import { and, eq } from 'drizzle-orm'
import { Elysia, t } from 'elysia'
import type { AppContext } from '../core/context.ts'
import { accounts, customers } from '../db/schema/index.ts'
import { brlToCents } from '../domain/money.ts'
import { loadCardRules } from '../modules/credit-cards/test-cards.ts'
import {
  isPastExpiration,
  loadCheckout,
  payCheckout,
  type CheckoutPayload,
} from '../modules/checkout/service.ts'
import { renderCheckout, type CheckoutView } from './page.ts'

const ID = /^[0-9a-f-]{36}$/i

export function checkoutRoutes(ctx: AppContext) {
  const view = async (id: string): Promise<CheckoutView> => {
    const row = await loadCheckout(ctx, ID.test(id) ? id : '')
    const p = row.payload as unknown as CheckoutPayload
    const [account] = await ctx.db.select().from(accounts).where(eq(accounts.id, row.accountId)).limit(1)
    const [customer] = p.customer
      ? await ctx.db
          .select()
          .from(customers)
          .where(and(eq(customers.id, p.customer), eq(customers.accountId, row.accountId)))
          .limit(1)
      : []
    // Past its time but not yet swept by the tick: the page already shows it expired.
    const status = row.status === 'ACTIVE' && isPastExpiration(ctx, row) ? 'EXPIRED' : row.status

    return {
      id: row.id,
      status,
      merchant: { name: account?.name ?? '', cpfCnpj: account?.cpfCnpj ?? '' },
      payer: customer
        ? { name: customer.name, cpfCnpj: customer.cpfCnpj }
        : p.customerData
          ? { name: String(p.customerData.name ?? ''), cpfCnpj: String(p.customerData.cpfCnpj ?? '') }
          : null,
      items: p.items.map((i) => ({
        name: String(i.name ?? ''),
        description: i.description ? String(i.description) : null,
        quantity: Number(i.quantity),
        valueCents: brlToCents(Number(i.value)),
      })),
      totalCents: Number(row.valueCents),
      chargeTypes: p.chargeTypes,
      billingTypes: p.billingTypes,
      subscription: p.subscription
        ? { cycle: String(p.subscription.cycle ?? ''), nextDueDate: String(p.subscription.nextDueDate ?? '') }
        : null,
      expirationDate: row.expirationDate,
      callback: {
        successUrl: (p.callback.successUrl as string | undefined) ?? null,
        cancelUrl: (p.callback.cancelUrl as string | undefined) ?? null,
        expiredUrl: (p.callback.expiredUrl as string | undefined) ?? null,
      },
      testCards: (await loadCardRules(ctx.db)).table.map((c) => ({ number: c.number, label: c.label })),
    }
  }

  const html = (body: string) =>
    new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8' } })

  return new Elysia({ name: 'checkout-page' })
    .get('/checkoutSession/show/:id', async ({ params }) => html(renderCheckout(await view(params.id))))
    .post(
      '/checkoutSession/show/:id/pay',
      ({ params, body }) => payCheckout(ctx, params.id, body),
      {
        body: t.Object({
          chargeType: t.Optional(t.String()),
          billingType: t.Optional(t.String()),
          creditCard: t.Optional(t.Record(t.String(), t.Unknown())),
          customerData: t.Optional(t.Record(t.String(), t.Unknown())),
        }),
      },
    )
}
