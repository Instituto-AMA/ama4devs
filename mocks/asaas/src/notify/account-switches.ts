/**
 * The payer channels of one account: the simulator's switch per account
 * (e-mail, WhatsApp, SMS), read and changed by Integrações in the panel through
 * `/_admin/accounts/:id/notify`. Not an Asaas field: Asaas has no per-account
 * switch in the API. A new account starts with every channel on.
 *
 * enqueue.ts reads the same columns: a channel the account turned off queues
 * nothing for its customers, whatever their own notification settings say.
 */
import { eq } from 'drizzle-orm'
import { notFoundMessage } from '../core/errors.ts'
import type { DB } from '../db/client.ts'
import { accounts } from '../db/schema/index.ts'

export interface AccountChannels {
  email: boolean
  whatsapp: boolean
  sms: boolean
}

/** The channels of an account; 404 when it does not exist. */
export async function accountChannels(db: DB, accountId: string): Promise<AccountChannels> {
  const [row] = await db
    .select({ email: accounts.notifyEmail, whatsapp: accounts.notifyWhatsapp, sms: accounts.notifySms })
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .limit(1)
  if (!row) throw notFoundMessage('Account not found.')
  return row
}

/** Changes the channels named in `patch`; the others stay. Answers the new state. */
export async function setAccountChannels(
  db: DB,
  accountId: string,
  patch: Partial<AccountChannels>,
): Promise<AccountChannels> {
  await accountChannels(db, accountId)
  const set: Partial<typeof accounts.$inferInsert> = {}
  if (patch.email !== undefined) set.notifyEmail = patch.email
  if (patch.whatsapp !== undefined) set.notifyWhatsapp = patch.whatsapp
  if (patch.sms !== undefined) set.notifySms = patch.sms
  if (Object.keys(set).length > 0) await db.update(accounts).set(set).where(eq(accounts.id, accountId))
  return accountChannels(db, accountId)
}
