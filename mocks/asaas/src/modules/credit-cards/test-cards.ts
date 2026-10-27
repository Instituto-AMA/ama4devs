/**
 * The test-card table the engine consults, as the panel shapes it: the built-in
 * cards (src/domain/credit-card.ts), the cards added in the panel, and whether a
 * number outside the table is accepted.
 *
 * Both live in `settings`, simulator-wide (like the built-in table, not per
 * account). Every card decision — tokenizing, paying a charge, creating a card
 * charge or subscription, the invoice page — reads them through `loadCardRules`,
 * so the panel never announces a card the engine does not honor.
 */
import { eq } from 'drizzle-orm'
import type { AppContext } from '../../core/context.ts'
import { badRequest, notFound } from '../../core/errors.ts'
import type { DB } from '../../db/client.ts'
import { settings } from '../../db/schema/index.ts'
import {
  CUSTOM_CARD_OUTCOMES,
  DEFAULT_CARD_POLICY,
  GENERATED_BRANDS,
  generateCardNumber,
  normalizeCardNumber,
  OUTCOME_LABEL,
  TEST_CARDS,
  type CardPolicy,
  type CustomCardOutcome,
  type TestCard,
  type TestCardTable,
} from '../../domain/credit-card.ts'

const CUSTOM_KEY = 'credit_card.test_cards.custom'
const POLICY_KEY = 'credit_card.test_cards.policy'

/** A card added in the panel. */
export interface CustomTestCard extends TestCard {
  custom: true
  dateCreated: string
}

async function read<T>(db: DB, key: string): Promise<T | undefined> {
  const [row] = await db.select().from(settings).where(eq(settings.key, key)).limit(1)
  return row?.value as T | undefined
}

async function write(ctx: AppContext, key: string, value: unknown): Promise<void> {
  const updatedAt = ctx.clock.timestamp()
  await ctx.db
    .insert(settings)
    .values({ key, value, updatedAt })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt } })
}

export async function customCards(db: DB): Promise<CustomTestCard[]> {
  return (await read<CustomTestCard[]>(db, CUSTOM_KEY)) ?? []
}

export async function cardPolicy(db: DB): Promise<CardPolicy> {
  return (await read<CardPolicy>(db, POLICY_KEY)) ?? DEFAULT_CARD_POLICY
}

/** What `inspectCard` needs: the whole table (built-in first) and the policy. */
export async function loadCardRules(db: DB): Promise<{ table: TestCardTable; policy: CardPolicy }> {
  const [custom, policy] = await Promise.all([customCards(db), cardPolicy(db)])
  return { table: [...TEST_CARDS, ...custom], policy }
}

export async function setCardPolicy(ctx: AppContext, policy: CardPolicy): Promise<CardPolicy> {
  const value: CardPolicy = { acceptAny: Boolean(policy.acceptAny) }
  await write(ctx, POLICY_KEY, value)
  return value
}

export interface NewTestCard {
  /** Empty: a valid number of `brand` is generated. */
  number?: string
  brand?: string
  outcome: string
  label?: string
}

/** Adds a card to the table. A number already listed (built-in or added) is refused. */
export async function addTestCard(ctx: AppContext, input: NewTestCard): Promise<CustomTestCard> {
  if (!(CUSTOM_CARD_OUTCOMES as readonly string[]).includes(input.outcome)) {
    throw badRequest(
      'invalid_outcome',
      `Resultado inválido. Use um destes: ${CUSTOM_CARD_OUTCOMES.join(', ')}.`,
    )
  }
  const outcome = input.outcome as CustomCardOutcome
  const custom = await customCards(ctx.db)
  const taken = new Set([...TEST_CARDS, ...custom].map((c) => c.number))

  let number = normalizeCardNumber(input.number ?? '')
  if (number === '') {
    const brand = input.brand ?? 'VISA'
    if (!GENERATED_BRANDS[brand]) {
      throw badRequest('invalid_brand', `Bandeira inválida. Use: ${Object.keys(GENERATED_BRANDS).join(', ')}.`)
    }
    // A collision in the table is possible in principle; a few draws make it vanish.
    do {
      number = generateCardNumber(brand, (n) => ctx.rng.digits(n))
    } while (taken.has(number))
  } else if (!/^\d{13,19}$/.test(number)) {
    throw badRequest('invalid_number', 'O número do cartão deve ter de 13 a 19 dígitos.')
  } else if (taken.has(number)) {
    throw badRequest('duplicated_number', 'Este número já está na lista de cartões de teste.')
  }

  const card: CustomTestCard = {
    number,
    outcome,
    label: input.label?.trim() || OUTCOME_LABEL[outcome],
    real: false,
    custom: true,
    dateCreated: ctx.clock.timestamp(),
  }
  await write(ctx, CUSTOM_KEY, [...custom, card])
  return card
}

/** Removes a card added in the panel; the built-in ones stay. */
export async function removeTestCard(ctx: AppContext, number: string): Promise<void> {
  const custom = await customCards(ctx.db)
  const n = normalizeCardNumber(number)
  if (TEST_CARDS.some((c) => c.number === n)) {
    throw badRequest('invalid_action', 'Os cartões de fábrica não podem ser removidos.')
  }
  if (!custom.some((c) => c.number === n)) throw notFound('Cartão de teste')
  await write(
    ctx,
    CUSTOM_KEY,
    custom.filter((c) => c.number !== n),
  )
}
