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
let seen: { mailpit?: string; whatsapp?: string } | null = null
async function followChannels(): Promise<void> {
  await lookForChannels(ctx)
  const notify = config.notify
  const before = seen
  seen = { mailpit: notify.mailpitUrl, whatsapp: notify.whatsappUrl }
  const again = (places: string[] | undefined) =>
    places?.length ? `; procurado de novo a cada ${LOOK_EVERY_MS / 1000} s` : ''
  if (!before || before.mailpit !== notify.mailpitUrl) {
    console.log(
      notify.mailpitUrl
        ? `E-mail: Mailpit em ${notify.mailpitUrl}`
        : `E-mail: ${channelOffReason(notify, 'EMAIL')}${again(notify.discover?.mailpit)}`,
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
      ? `WhatsApp: número ${notify.whatsappPhoneNumberId} cadastrado no mock (${notify.whatsappUrl}), respostas em ${notify.callbackBaseUrl}`
      : `WhatsApp: mock ainda não respondeu (${sender.error}); cadastro refeito no próximo tick`,
  )
  const templates = await ensureWhatsappTemplates(ctx)
  console.log(
    templates.ready
      ? `WhatsApp: ${WHATSAPP_TEMPLATES.length} templates do pagador na biblioteca do mock`
      : `WhatsApp: templates ainda não criados (${templates.error}); refeito no próximo tick`,
  )
}
const follow = () => followChannels().catch((err) => ctx.log('warn', 'Channel lookup failed', { error: String(err) }))
const looking = setInterval(follow, LOOK_EVERY_MS)
void follow()

// Denominador é o total de ROTAS, não de operações: 5 operações da spec dividem
// rota com a canônica (a variante "com cartão de crédito"). Ver progress.md.
const routable = OPERATION_COUNT - coverage.variants.length
const pct = Math.round((coverage.implemented.length / routable) * 100)

console.log(`
┌─ Asaas Mock Server ──────────────────────────────────────────
│  API         http://localhost:${config.port}/v3
${
  config.adminEnabled
    ? `│  Painel      http://localhost:${config.port}   ← contas, saldos e viagem no tempo`
    : `│  Painel      desligado (ADMIN_ENABLED=false)`
}
│
│  Cobertura   ${coverage.implemented.length}/${routable} operações (${pct}%) — as demais respondem 501
│  Relógio     ${config.clock.mode}${config.clock.tickIntervalMs > 0 ? ` · tick a cada ${config.clock.tickIntervalMs}ms` : ' · timer desligado'}
│  Banco       ${config.databasePath}
│
│  Conta       ${seed.accountId}${seed.created ? '  (criada agora)' : ''}
│  walletId    ${seed.walletId}
│  API key     ${seed.apiKey}
${
  config.webhook.localhostRewrite
    ? `│
│  Webhooks apontados para localhost são reescritos para
│  "${config.webhook.localhostRewrite}" — é assim que o evento sai do
│  container e chega na sua máquina. Ajuste com WEBHOOK_LOCALHOST_REWRITE.`
    : `│
│  Reescrita de localhost DESLIGADA. Se estiver rodando em Docker, um
│  webhook para localhost vai bater no próprio container e nunca chegar
│  em você. Defina WEBHOOK_LOCALHOST_REWRITE=host.docker.internal.`
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
