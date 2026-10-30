import { bootstrap } from './bootstrap.ts'
import { notifyDiscoveryFromEnv } from './core/config.ts'
import { OPERATION_COUNT } from './generated/operations.ts'
import { allowHost } from './http/local-guard.ts'
import {
  channelOffReason,
  ensureWhatsappSender,
  ensureWhatsappTemplates,
  WHATSAPP_TEMPLATES,
} from './notify/channels.ts'
import { LOOK_EVERY_MS, lookForChannels } from './notify/discovery.ts'

const { app, config, seed, coverage, scheduler, ctx } = await bootstrap()

// Mailpit and the WhatsApp mock are found wherever they run, unless a variable
// says where (src/notify/discovery.ts). A callback address given by
// NOTIFY_CALLBACK_BASE_URL is admitted by the guard as it is.
config.notify.discover = notifyDiscoveryFromEnv()
if (!config.notify.discover.callback) allowHost(config.allowedHosts, config.notify.callbackBaseUrl)

scheduler.start(config.clock.tickIntervalMs)

app.listen(config.port)

// The payer channels come up configured: Mailpit and the WhatsApp mock are looked
// for now and every LOOK_EVERY_MS, and a WhatsApp mock found gets the sender number
// and its templates at once (src/notify/channels.ts); the ticks put them back if it
// restarts.
let seen: { mailpit?: string; whatsapp?: string; sms?: string } | null = null
async function followChannels(): Promise<void> {
  await lookForChannels(ctx)
  const notify = config.notify
  const before = seen
  seen = { mailpit: notify.mailpitUrl, whatsapp: notify.whatsappUrl, sms: notify.smsUrl }
  const again = (places: string[] | undefined) =>
    places?.length ? `; looked for again every ${LOOK_EVERY_MS / 1000} s` : ''
  if (!before || before.mailpit !== notify.mailpitUrl) {
    console.log(
      notify.mailpitUrl
        ? `E-mail: Mailpit at ${notify.mailpitUrl}`
        : `E-mail: ${channelOffReason(notify, 'EMAIL')}${again(notify.discover?.mailpit)}`,
    )
  }
  if (!before || before.sms !== notify.smsUrl) {
    console.log(
      notify.smsUrl
        ? `SMS: mock em ${notify.smsUrl}`
        : `SMS: ${channelOffReason(notify, 'SMS')}${again(notify.discover?.sms)}`,
    )
  }
  if (before && before.whatsapp === notify.whatsappUrl) return
  if (!notify.whatsappUrl) {
    console.log(`WhatsApp: ${channelOffReason(notify, 'WHATSAPP')}${again(notify.discover?.whatsapp)}`)
    return
  }
  const sender = await ensureWhatsappSender(ctx)
  console.log(
    sender.registered
      ? `WhatsApp: number ${notify.whatsappPhoneNumberId} registered in the mock (${notify.whatsappUrl}), replies at ${notify.callbackBaseUrl}`
      : `WhatsApp: the mock has not answered yet (${sender.error}); the registration is redone on the next tick`,
  )
  const templates = await ensureWhatsappTemplates(ctx)
  console.log(
    templates.ready
      ? `WhatsApp: ${WHATSAPP_TEMPLATES.length} payer templates in the mock library`
      : `WhatsApp: the templates were not created yet (${templates.error}); redone on the next tick`,
  )
}
const follow = () => followChannels().catch((err) => ctx.log('warn', 'Channel lookup failed', { error: String(err) }))
const looking = setInterval(follow, LOOK_EVERY_MS)
void follow()

// The denominator is the total of ROUTES, not of operations: 5 operations of the
// spec share a route with the canonical one (the "with credit card" variant). See
// progress.md.
const routable = OPERATION_COUNT - coverage.variants.length
const pct = Math.round((coverage.implemented.length / routable) * 100)

console.log(`
┌─ Asaas Mock Server ──────────────────────────────────────────
│  API         http://localhost:${config.port}/v3
${
  config.adminEnabled
    ? `│  Panel       http://localhost:${config.port}   ← accounts, balances and time travel`
    : `│  Panel       off (ADMIN_ENABLED=false)`
}
│
│  Coverage    ${coverage.implemented.length}/${routable} operations (${pct}%) — the rest answer 501
│  Clock       ${config.clock.mode}${config.clock.tickIntervalMs > 0 ? ` · tick every ${config.clock.tickIntervalMs}ms` : ' · timer off'}
│  Database    ${config.databasePath}
│
│  Account     ${seed.accountId}${seed.created ? '  (created now)' : ''}
│  walletId    ${seed.walletId}
│  API key     ${seed.apiKey}
${
  config.webhook.localhostRewrite
    ? `│
│  Webhooks pointed at localhost are rewritten to
│  "${config.webhook.localhostRewrite}" — that is how the event leaves the
│  container and reaches your machine. Change it with WEBHOOK_LOCALHOST_REWRITE.`
    : `│
│  The localhost rewrite is OFF. If you are running in Docker, a webhook to
│  localhost will hit the container itself and never reach you. Set
│  WEBHOOK_LOCALHOST_REWRITE=host.docker.internal.`
}
└──────────────────────────────────────────────────────────────
`)

const shutdown = () => {
  console.log('\nEncerrando…')
  clearInterval(looking)
  scheduler.stop()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
