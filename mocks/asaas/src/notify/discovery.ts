/**
 * The payer channels and the data generator find themselves: Mailpit, the
 * WhatsApp mock, the SMS mock and the generator of fake data.
 *
 * However this server runs (bun on the machine, `docker run`, a compose of
 * someone's project, the repo's `make setup`), whatever is up answers on one of a
 * few known places: the compose service name, this machine, the Docker host
 * (`NotifyDiscovery`, filled from the environment by `notifyDiscoveryFromEnv`). A
 * service whose variable is set is used as given; the others are looked for on
 * boot and again every LOOK_EVERY_MS (the process entry, src/index.ts, keeps that
 * cadence), so a mock that comes up later, moves or goes away is followed. A
 * place counts only when the service there says what it is
 * (Mailpit's version, the WhatsApp mock's template library, the SMS mock's
 * `service: 'sms'` and a settings answer past its guard, the generator's `service: 'generator'`), so another program on the same port is never taken
 * for it.
 *
 * The address the WhatsApp mock calls back on is found when the sender number is
 * registered (channels.ts, `ensureWhatsappSender`).
 */
import type { NotifyDiscovery } from '../core/config.ts'
import type { AppContext } from '../core/context.ts'
import { whatsappHeaders } from './channels.ts'

const PROBE_TIMEOUT_MS = 1_000

/**
 * Real time between two looks. Whether a container is up is a fact of the
 * machine, not of the simulated day, so the virtual clock does not pace it (a
 * frozen clock would never look again).
 */
export const LOOK_EVERY_MS = 10_000

/** The look in progress per server: a second caller shares it. */
const running = new WeakMap<AppContext, Promise<void>>()

async function answers(url: string, headers: Record<string, string>, is: (body: any) => boolean): Promise<boolean> {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
    return res.ok && is(await res.json())
  } catch {
    return false
  }
}

const isMailpit = (base: string) => answers(`${base}/api/v1/info`, {}, (body) => typeof body?.Version === 'string')

const isWhatsappMock = (base: string) =>
  answers(`${base}/health`, whatsappHeaders(base), (body) => body?.ok === true && body.templates !== undefined)

// `/health` is the one route the SMS mock answers before its Host guard, so a place that only
// passes it may still refuse every send: its settings route sits behind the guard.
const isSmsMock = async (base: string) =>
  (await answers(`${base}/health`, {}, (body) => body?.service === 'sms')) &&
  (await answers(`${base}/_mock/sms/settings`, {}, (body) => typeof body?.defaultFrom === 'string'))

const isGenerator = (base: string) => answers(`${base}/health`, {}, (body) => body?.service === 'generator')

/**
 * The first place, in order, that answers, asked anew on every look: the order
 * goes from the closest (the service of the same compose) to the farthest (the
 * Docker host), and the closest wins as soon as it is up, even when a farther one
 * answered first because it was already running.
 */
async function find(places: string[], is: (base: string) => Promise<boolean>): Promise<string | undefined> {
  const found = await Promise.all(places.map(is))
  return places[found.indexOf(true)]
}

async function look(ctx: AppContext, discover: NotifyDiscovery): Promise<void> {
  const notify = ctx.config.notify
  const [mailpit, whatsapp, sms, generator] = await Promise.all([
    discover.mailpit.length ? find(discover.mailpit, isMailpit) : notify.mailpitUrl,
    discover.whatsapp.length ? find(discover.whatsapp, isWhatsappMock) : notify.whatsappUrl,
    discover.sms?.length ? find(discover.sms, isSmsMock) : notify.smsUrl,
    discover.generator.length ? find(discover.generator, isGenerator) : ctx.config.generator.url,
  ])
  report(ctx, 'Mailpit', notify.mailpitUrl, mailpit)
  report(ctx, 'WhatsApp mock', notify.whatsappUrl, whatsapp)
  report(ctx, 'SMS mock', notify.smsUrl, sms)
  report(ctx, 'Generator', ctx.config.generator.url, generator)
  notify.mailpitUrl = mailpit
  notify.whatsappUrl = whatsapp
  notify.smsUrl = sms
  ctx.config.generator.url = generator
}

function report(ctx: AppContext, name: string, before: string | undefined, after: string | undefined): void {
  if (before === after) return
  if (after) ctx.log('info', `${name} found`, { url: after })
  else ctx.log('warn', `${name} stopped answering`, { url: before })
}

/**
 * Looks for the services this server finds by itself; a look already running is
 * shared. Does nothing when the config has no `discover` (the tests).
 */
export function lookForChannels(ctx: AppContext): Promise<void> {
  const discover = ctx.config.notify.discover
  if (!discover) return Promise.resolve()
  const current = running.get(ctx)
  if (current) return current
  const next = look(ctx, discover).finally(() => running.delete(ctx))
  running.set(ctx, next)
  return next
}
