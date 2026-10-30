/**
 * Endpoints administrativos. NÃO existem na API do Asaas.
 *
 * São a razão de este simulador ser mais útil que o sandbox real: viagem no
 * tempo, reset determinístico, log de entregas de webhook. Ficam fora de /v3 e
 * não pedem `access_token`, para que nenhuma app cliente os alcance por engano.
 *
 * Desligue com ADMIN_ENABLED=false em qualquer ambiente compartilhado.
 */
import { and, asc, desc, eq, gt, gte, isNull, lt, notExists, or } from 'drizzle-orm'
import { Elysia, t } from 'elysia'
import { driftDays, realNowMs, VirtualClock } from '../core/clock.ts'
import type { AppContext } from '../core/context.ts'
import { badRequest, notFound } from '../core/errors.ts'
import {
  accounts,
  apiKeys,
  customers,
  notificationDeliveries,
  payments,
  requestLogs,
  webhookDeliveries,
  webhookEvents,
  webhooks,
} from '../db/schema/index.ts'
import { REQUEST_LOG_LIMIT } from '../http/request-log.ts'
import {
  NOTIFIABLE_EVENTS,
  NOTIFICATION_LABEL,
  type NotifiableEvent,
} from '../domain/notification-text.ts'
import { serializePayment, type PaymentRow } from '../modules/payments/serializer.ts'
import { arrivals, channelStatus } from '../notify/channels.ts'
import { dispatchNotifications, sendTestNotification } from '../notify/dispatcher.ts'
import { inboundWhatsapp } from '../notify/inbound.ts'
import { enqueuePaymentNotifications, type PaymentFacts } from '../notify/enqueue.ts'
import {
  CARD_ERRORS,
  CUSTOM_CARD_OUTCOMES,
  detectBrand,
  GENERATED_BRANDS,
  OUTCOME_LABEL,
  TEST_CARDS,
  TRIGGERS,
} from '../domain/credit-card.ts'
import {
  addTestCard,
  cardPolicy,
  customCards,
  removeTestCard,
  setCardPolicy,
} from '../modules/credit-cards/test-cards.ts'
import {
  captureSchedule,
  describeSchedule,
  listSavedCards,
  setCaptureSchedule,
  setSavedCardBehavior,
} from '../modules/credit-cards/capture.ts'
import { serialize as serializeCustomer } from '../modules/customers/handlers.ts'
import { WebhookEvent } from '../generated/enums.ts'
import { OPERATION_COUNT, OPERATION_IDS } from '../generated/operations.ts'
import type { Scheduler } from '../scheduler/scheduler.ts'
import { createKey, deleteKey, listKeys, rotateKey, updateKey } from './keys.ts'
import { generatorStatus, populateThroughGenerator } from './generator.ts'
import { createProfile, deleteProfile, seededDocuments } from './profiles.ts'
import { RESET_GROUPS, resetProfile } from './reset.ts'

/** Every event a webhook can subscribe to, in the spec's order. */
const WEBHOOK_EVENTS: string[] = WebhookEvent.anyOf.map((s) => String(s.const))

const keyBody = t.Object({
  name: t.Optional(t.String()),
  expirationDate: t.Optional(t.Nullable(t.String())),
  enabled: t.Optional(t.Boolean()),
})

export function adminRoutes(ctx: AppContext, scheduler: Scheduler) {
  const virtual = (): VirtualClock => {
    if (!(ctx.clock instanceof VirtualClock)) {
      throw badRequest(
        'clock_not_virtual',
        'O relógio está em modo REAL. Suba com CLOCK_MODE=VIRTUAL_FROZEN ou ' +
          'VIRTUAL_FLOWING para poder viajar no tempo.',
      )
    }
    return ctx.clock
  }

  const app = new Elysia({ name: 'admin', prefix: '/_admin' })

  if (!ctx.config.adminEnabled) {
    return app.all('/*', () => {
      throw badRequest('admin_disabled', 'Os endpoints administrativos estão desabilitados.')
    })
  }

  return (
    app
      /**
       * `driftDays` é o campo que faltava — e a falta dele custou caro.
       *
       * O relógio é GLOBAL ao container: um clique em `+32` no painel move o tempo
       * para TODO MUNDO, inclusive para a aplicação que está integrando do outro
       * lado. O sintoma não parece um relógio: parece que "o Pix nasce OVERDUE",
       * porque a cobrança criada com vencimento hoje já venceu faz um mês do ponto
       * de vista do simulador.
       *
       * Sem um número aqui, nem o painel nem ninguém tem como avisar.
       */
      .get('/clock', () => ({
        mode: ctx.clock.mode,
        now: ctx.clock.timestamp(),
        today: ctx.clock.today(),
        epochMs: ctx.clock.nowMs(),
        /** Dias à frente do tempo REAL. 0 = o simulador está no presente. */
        driftDays: driftDays(ctx.clock),
      }))

      /**
       * Volta o relógio para o tempo real. A saída da viagem no tempo.
       *
       * Existe porque `advance` só anda para a frente, e quem avançou 32 dias para
       * ver um cartão creditar ficava preso lá — com toda cobrança nova nascendo
       * vencida, sem nada na tela dizendo por quê.
       *
       * Voltar o relógio NÃO basta: as entregas de webhook que o backoff reagendou
       * enquanto estávamos no futuro continuam agendadas lá, inalcançáveis — e em
       * SEQUENTIALLY (o padrão do Asaas) a primeira delas trava a fila inteira por
       * trás. Por isso o reset também as puxa de volta. Sem isso, o relógio volta ao
       * presente e nenhum webhook chega mais, para sempre.
       */
      .post('/clock/reset', async () => {
        virtual()
        const clock = ctx.clock as unknown as { setTo(epochMs: number): void }
        clock.setTo(realNowMs())

        const { pullBackFutureDeliveries } = await import('../webhooks/dispatcher.ts')
        const rescheduled = await pullBackFutureDeliveries(ctx, ctx.clock.nowMs())

        return {
          now: ctx.clock.timestamp(),
          today: ctx.clock.today(),
          driftDays: 0,
          /** Entregas que estavam presas no futuro e voltaram para a fila. */
          rescheduledDeliveries: rescheduled,
        }
      })

      /**
       * Avança o relógio. UM TICK COMPLETO POR DIA SIMULADO — é o que faz uma
       * assinatura gerar várias cobranças em vez de uma, e o OVERDUE cair na
       * data certa.
       *
       * Devolve um TickReport por dia, com as transições que aconteceram. É isso
       * que faz um teste ler como especificação:
       *
       *   const [r] = await advance({ days: 32 })
       *   expect(r.transitions).toContainEqual({ from: 'CONFIRMED', to: 'RECEIVED', … })
       */
      .post(
        '/clock/advance',
        async ({ body }) => {
          virtual()
          const reports = []
          if (body.days) reports.push(...(await scheduler.advanceDays(body.days)))

          const subDayMs =
            (body.hours ?? 0) * 3_600_000 +
            (body.minutes ?? 0) * 60_000 +
            (body.seconds ?? 0) * 1000
          if (subDayMs > 0) reports.push(await scheduler.advanceMs(subDayMs))

          return { now: ctx.clock.timestamp(), reports }
        },
        {
          body: t.Object({
            days: t.Optional(t.Integer({ minimum: 0, maximum: 3650 })),
            hours: t.Optional(t.Integer({ minimum: 0 })),
            minutes: t.Optional(t.Integer({ minimum: 0 })),
            seconds: t.Optional(t.Integer({ minimum: 0 })),
          }),
        },
      )

      .post(
        '/clock/set',
        async ({ body }) => {
          const clock = virtual()
          const target = new Date(body.date)
          if (Number.isNaN(target.getTime())) {
            throw badRequest('invalid_date', `Data inválida: "${body.date}".`)
          }
          clock.setTo(target.getTime())

          // `set` também anda PARA TRÁS, e aí cai na mesma armadilha do reset: as
          // entregas reagendadas no futuro ficam inalcançáveis e travam a fila.
          const { pullBackFutureDeliveries } = await import('../webhooks/dispatcher.ts')
          const rescheduled = await pullBackFutureDeliveries(ctx, ctx.clock.nowMs())

          const report = await scheduler.tick()
          return { now: ctx.clock.timestamp(), report, rescheduledDeliveries: rescheduled }
        },
        { body: t.Object({ date: t.String() }) },
      )

      /** Um tick sem mexer no relógio. Útil para drenar a fila de webhooks. */
      .post('/tick', async () => scheduler.tick())

      /**
       * Provoca um chargeback numa cobrança paga. (Track H)
       *
       * Fica AQUI, e não em /v3, porque a API do Asaas não tem operação de criar
       * chargeback — quem abre é a bandeira, não o lojista. Sem esta porta, o
       * gatilho CHARGEBACK da máquina e as 3 operações da tag "Chargeback"
       * seriam inalcançáveis, e o dev não teria como testar o fluxo. É controle
       * do simulador, igual à viagem no tempo.
       */
      .post(
        '/payments/:id/chargeback',
        async ({ params, body }) => {
          const { openChargeback } = await import('../modules/chargebacks/service.ts')
          const b = (body ?? {}) as { reason?: string }
          const row = await openChargeback(ctx, params.id, b.reason ?? 'FRAUD')
          return { id: row.id, payment: row.paymentId, status: row.status, reason: row.reason }
        },
        { body: t.Optional(t.Object({ reason: t.Optional(t.String()) })) },
      )

      /**
       * "Situação das cobranças" — o agregado da home, por CONTA.
       *
       * Recebe o accountId em vez de deduzir da chave porque o painel troca de
       * conta sem trocar de sessão: é a única tela do mundo que enxerga o master e
       * as subcontas ao mesmo tempo, e é justamente assim que se vê o dinheiro de
       * um split andar de uma para a outra.
       */
      .get('/summary', async ({ query }) => {
        const { paymentsSummary } = await import('./summary.ts')
        const accountId = String(query.accountId ?? '')
        if (!accountId) throw badRequest('invalid_accountId', 'Informe accountId.')
        return { groups: await paymentsSummary(ctx, accountId) }
      })

      /**
       * The customers of an account, the removed ones on request. The real
       * `GET /v3/customers` has no filter for removed customers (the spec lists
       * none), yet a charge keeps naming its customer after an integration's
       * cleanup removed it: the panel needs both lists to stay readable.
       */
      .get('/customers', async ({ query }) => {
        const accountId = String(query.accountId ?? '')
        if (!accountId) throw badRequest('invalid_accountId', 'Informe accountId.')
        const removed = String(query.removed ?? '') === 'true'
        const rows = await ctx.db
          .select()
          .from(customers)
          .where(and(eq(customers.accountId, accountId), eq(customers.deleted, removed)))
          .orderBy(asc(customers.name))
        return { data: rows.map(serializeCustomer) }
      })

      /**
       * Por que a fila de cada webhook não está andando.
       *
       * No Asaas você olha o painel e vê que travou. Aqui, até agora, você só
       * descobria lendo a API — e o sintoma na ponta ("o pagamento consta RECEIVED
       * mas meu pedido não atualizou") não aponta para webhook nenhum.
       */
      .get('/webhooks/queue', async () => {
        const { queueHealth } = await import('../webhooks/dispatcher.ts')
        return { webhooks: await queueHealth(ctx) }
      })

      /**
       * The events a webhook can subscribe to — the panel's checkbox list. From
       * the generated enum, so the list and the validation never disagree.
       */
      .get('/webhooks/events', () => ({ events: WEBHOOK_EVENTS }))

      /**
       * The deliveries, newest first; `accountId` narrows them to one account. An
       * event no webhook took (none registered, or none subscribed to it) is listed
       * too, as NO_WEBHOOK: what the account produced is visible before a webhook
       * exists to receive it.
       */
      .get('/webhooks/deliveries', async ({ query }) => {
        const accountId = query.accountId ? String(query.accountId) : undefined
        const limit = Number(query.limit ?? 50)
        const delivered = ctx.db
          .select({ id: webhookDeliveries.id })
          .from(webhookDeliveries)
          .where(eq(webhookDeliveries.eventId, webhookEvents.id))
        const unsent = await ctx.db
          .select({
            id: webhookEvents.id,
            event: webhookEvents.event,
            eventId: webhookEvents.id,
            payload: webhookEvents.payload,
            dateCreated: webhookEvents.dateCreated,
            eventAtMs: webhookEvents.createdAtMs,
          })
          .from(webhookEvents)
          .where(and(accountId ? eq(webhookEvents.accountId, accountId) : undefined, notExists(delivered)))
          .orderBy(desc(webhookEvents.createdAtMs))
          .limit(limit)
        const rows = await ctx.db
          .select({
            id: webhookDeliveries.id,
            webhookId: webhookDeliveries.webhookId,
            webhookName: webhooks.name,
            url: webhooks.url,
            status: webhookDeliveries.status,
            attempt: webhookDeliveries.attempt,
            nextAttemptAtMs: webhookDeliveries.nextAttemptAtMs,
            lastStatusCode: webhookDeliveries.lastStatusCode,
            lastError: webhookDeliveries.lastError,
            lastAttemptAt: webhookDeliveries.lastAttemptAt,
            dateCreated: webhookDeliveries.dateCreated,
            event: webhookEvents.event,
            eventId: webhookEvents.id,
            payload: webhookEvents.payload,
            eventAtMs: webhookEvents.createdAtMs,
          })
          .from(webhookDeliveries)
          .innerJoin(webhookEvents, eq(webhookDeliveries.eventId, webhookEvents.id))
          .innerJoin(webhooks, eq(webhookDeliveries.webhookId, webhooks.id))
          .where(accountId ? eq(webhookDeliveries.accountId, accountId) : undefined)
          // `sequence` is per webhook; the event time orders across webhooks.
          .orderBy(desc(webhookEvents.createdAtMs), desc(webhookDeliveries.sequence))
          .limit(limit)

        const data = [
          ...rows,
          ...unsent.map((e) => ({
            ...e,
            webhookId: null,
            webhookName: null,
            url: null,
            status: 'NO_WEBHOOK' as const,
            attempt: 0,
            nextAttemptAtMs: null,
            lastStatusCode: null,
            lastError: null,
            lastAttemptAt: null,
          })),
        ]
          // Stable: a delivery keeps its place among the deliveries of the same event.
          .sort((a, b) => b.eventAtMs - a.eventAtMs)
          .slice(0, limit)
          .map(({ eventAtMs: _, ...row }) => row)
        return { data }
      })

      /**
       * Logs de Requisições: the account's calls to the API, newest first, without
       * their bodies (`/request-logs/:id` has them). `status` narrows to `success`
       * (2xx) or `error` (the rest).
       */
      .get('/request-logs', async ({ query }) => {
        const accountId = query.accountId ? String(query.accountId) : undefined
        const outcome =
          query.status === 'success'
            ? and(gte(requestLogs.status, 200), lt(requestLogs.status, 300))
            : query.status === 'error'
              ? or(lt(requestLogs.status, 200), gte(requestLogs.status, 300))
              : undefined
        const rows = await ctx.db
          .select({
            id: requestLogs.id,
            method: requestLogs.method,
            path: requestLogs.path,
            query: requestLogs.query,
            status: requestLogs.status,
            apiKeyName: apiKeys.name,
            dateCreated: requestLogs.dateCreated,
          })
          .from(requestLogs)
          .leftJoin(apiKeys, eq(requestLogs.apiKeyId, apiKeys.id))
          .where(and(accountId ? eq(requestLogs.accountId, accountId) : undefined, outcome))
          .orderBy(desc(requestLogs.id))
          .limit(Math.min(Number(query.limit ?? 100), REQUEST_LOG_LIMIT))
        return { data: rows }
      })

      /** One call of the Logs de Requisições, with what went in and what came back. */
      .get('/request-logs/:id', async ({ params }) => {
        const [row] = await ctx.db
          .select({
            id: requestLogs.id,
            accountId: requestLogs.accountId,
            method: requestLogs.method,
            path: requestLogs.path,
            query: requestLogs.query,
            status: requestLogs.status,
            apiKeyName: apiKeys.name,
            requestBody: requestLogs.requestBody,
            responseBody: requestLogs.responseBody,
            dateCreated: requestLogs.dateCreated,
          })
          .from(requestLogs)
          .leftJoin(apiKeys, eq(requestLogs.apiKeyId, apiKeys.id))
          .where(eq(requestLogs.id, Number(params.id)))
          .limit(1)
        if (!row) throw notFound('Log de requisição')
        return row
      })

      /**
       * Congela o dispatcher. Necessário ao viajar no tempo por outro motivo:
       * um advance de 40 dias, sem isto, esgotaria as 15 tentativas de backoff de
       * qualquer entrega pendente e marcaria o webhook como `interrupted`.
       */
      .post('/webhooks/pause', () => {
        scheduler.paused = true
        return { paused: true }
      })
      .post('/webhooks/resume', () => {
        scheduler.paused = false
        return { paused: false }
      })

      /** Cobertura computada do manifesto — nunca mantida à mão. */
      .get('/coverage', () => {
        const implemented = ctx.coverage?.implemented ?? []
        const stubbed = ctx.coverage?.stubbed ?? []
        const variants = ctx.coverage?.variants ?? []

        // O denominador são as ROTAS: 5 operações da spec dividem rota com a
        // canônica (a variante "com cartão"), então não contam à parte.
        const routable = OPERATION_COUNT - variants.length

        return {
          specOperations: OPERATION_COUNT,
          routable,
          implemented: implemented.length,
          stubbed: stubbed.length,
          variants: variants.length,
          percent: Math.round((implemented.length / routable) * 100),
          registered: OPERATION_IDS.length,
          notImplemented: stubbed,
        }
      })

      .get('/fees', () => ctx.config.fees)

      .get('/jobs', () => ({ order: scheduler.jobNames, paused: scheduler.paused }))

      /**
       * Os cartões de teste e os erros que cada um força.
       *
       * A tabela vem do DOMÍNIO, não de uma cópia — é a MESMA constante que o
       * motor consulta para decidir o desfecho. Se a tela e o servidor pudessem
       * discordar, a tela mentiria com botão de copiar e tudo.
       *
       * `real: false` marca as extensões nossas: números que o Asaas de verdade
       * APROVARIA. Sem essa marca, alguém escreve um teste contra um comportamento
       * que só existe aqui e descobre em produção.
       */
      .get('/test-cards', async () => {
        const [custom, policy] = await Promise.all([customCards(ctx.db), cardPolicy(ctx.db)])
        return {
          // `acceptAny`: a number outside the table approves (on) or is refused (off).
          acceptAny: policy.acceptAny,
          cards: [...TEST_CARDS, ...custom].map((c) => ({
            ...c,
            custom: 'custom' in c,
            brand: detectBrand(c.number),
            error: c.outcome === 'APPROVE' ? null : CARD_ERRORS[c.outcome],
          })),
          outcomes: CUSTOM_CARD_OUTCOMES.map((o) => ({ outcome: o, label: OUTCOME_LABEL[o] })),
          brands: Object.keys(GENERATED_BRANDS),
          // Três dos seis erros do Asaas não se disparam por número — são
          // propriedades de outros campos. Aqui vai como produzi-los.
          triggers: TRIGGERS.map((t) => ({ ...t, error: CARD_ERRORS[t.outcome] })),
        }
      })

      /** Accept any well-formed card (on) or only the listed ones (off). */
      .put('/test-cards/policy', async ({ body }) => setCardPolicy(ctx, body), {
        body: t.Object({ acceptAny: t.Boolean() }),
      })

      /** Adds a card: a typed number, or one generated for `brand` when `number` is empty. */
      .post(
        '/test-cards',
        async ({ body }) => {
          const card = await addTestCard(ctx, body)
          return {
            ...card,
            brand: detectBrand(card.number),
            error: card.outcome === 'APPROVE' ? null : CARD_ERRORS[card.outcome],
          }
        },
        {
          body: t.Object({
            number: t.Optional(t.String()),
            brand: t.Optional(t.String()),
            outcome: t.String(),
            label: t.Optional(t.String()),
          }),
        },
      )

      /**
       * The payer notifications (e-mail to Mailpit, WhatsApp template to the WhatsApp
       * mock, SMS to the SMS mock): which channels are on, and what was sent for a charge.
       */
      .get('/notifications', async ({ query }) => {
        const where = query.paymentId
          ? eq(notificationDeliveries.paymentId, String(query.paymentId))
          : query.accountId
            ? eq(notificationDeliveries.accountId, String(query.accountId))
            : undefined
        const rows = await ctx.db
          .select()
          .from(notificationDeliveries)
          .where(where)
          .orderBy(desc(notificationDeliveries.createdAtMs))
          .limit(100)
        return {
          channels: {
            email: Boolean(ctx.config.notify.mailpitUrl),
            whatsapp: Boolean(ctx.config.notify.whatsappUrl),
            sms: Boolean(ctx.config.notify.smsUrl),
          },
          events: NOTIFIABLE_EVENTS.map((e) => ({ event: e, label: NOTIFICATION_LABEL[e] })),
          data: rows.map(({ html: _html, ...r }) => r),
        }
      })

      /** Integrações › WhatsApp / E-mail: whether each channel is on and answering. */
      .get('/notify/status', async () => ({
        ...(await channelStatus(ctx)),
        replies: inboundWhatsapp(),
      }))

      /** What actually arrived at the channel from this server, read back from it. */
      .get('/notify/arrivals', async ({ query }) => {
        const channel = query.channel === 'WHATSAPP' ? 'WHATSAPP' : query.channel === 'SMS' ? 'SMS' : 'EMAIL'
        try {
          return { channel, data: await arrivals(ctx, channel), error: null }
        } catch (err) {
          return { channel, data: [], error: err instanceof Error ? err.message : String(err) }
        }
      })

      /** "Enviar teste": a sample e-mail or template straight to the channel. */
      .post(
        '/notify/test',
        async ({ body }) => {
          const n = ctx.config.notify
          const on = body.channel === 'EMAIL' ? n.mailpitUrl : body.channel === 'SMS' ? n.smsUrl : n.whatsappUrl
          if (!on) {
            const name = body.channel === 'EMAIL' ? 'de e-mail' : body.channel === 'SMS' ? 'de SMS' : 'de WhatsApp'
            throw badRequest('notify_not_configured', `Canal ${name} desligado.`)
          }
          try {
            await sendTestNotification(ctx, body.channel, body.to)
          } catch (err) {
            throw badRequest('notify_failed', err instanceof Error ? err.message : String(err))
          }
          return { sent: true }
        },
        {
          body: t.Object({
            channel: t.Union([t.Literal('EMAIL'), t.Literal('WHATSAPP'), t.Literal('SMS')]),
            to: t.String({ minLength: 3 }),
          }),
        },
      )

      /** "Enviar agora": queues the notification of `event` for a charge on the given channels. */
      .post(
        '/notifications',
        async ({ body }) => {
          const [row] = await ctx.db
            .select()
            .from(payments)
            .where(eq(payments.id, body.paymentId))
            .limit(1)
          if (!row) throw notFound('Cobrança')
          const payment = (await serializePayment(ctx.db, row as PaymentRow)) as unknown as PaymentFacts
          const queued = await enqueuePaymentNotifications(
            ctx.db,
            { clock: ctx.clock, rng: ctx.rng, config: ctx.config },
            {
              accountId: row.accountId,
              event: body.event as NotifiableEvent,
              payment,
              forced: body.channels,
            },
          )
          // Delivered before the answer, so the panel reads the outcome right away.
          const sent = await dispatchNotifications(ctx)
          return { queued, sent }
        },
        {
          body: t.Object({
            paymentId: t.String(),
            event: t.Union(NOTIFIABLE_EVENTS.map((e) => t.Literal(e))),
            channels: t.Array(t.Union([t.Literal('EMAIL'), t.Literal('WHATSAPP'), t.Literal('SMS')]), { minItems: 1 }),
          }),
        },
      )

      /**
       * The generator of fake data: whether it answers, and where the browser
       * opens it. Off it does not show in the panel.
       */
      .get('/generator/status', () => generatorStatus(ctx))

      /**
       * "Popular esta conta": the generator fills the account with customers and
       * charges, through that account's own API key — the answer is the
       * generator's, status and all.
       */
      .post(
        '/generator/populate',
        async ({ body, set }) => {
          const result = await populateThroughGenerator(ctx, body)
          set.status = result.status
          return result.body
        },
        {
          body: t.Object({
            accountId: t.String(),
            people: t.Optional(t.Number()),
            companies: t.Optional(t.Number()),
            chargesPerCustomer: t.Optional(t.Number()),
            billingTypes: t.Optional(
              t.Array(t.Union([t.Literal('PIX'), t.Literal('BOLETO'), t.Literal('CREDIT_CARD')])),
            ),
            confirm: t.Optional(t.Number()),
            seed: t.Optional(t.String()),
          }),
        },
      )

      /** Removes a card added in the panel. */
      .delete('/test-cards/:number', async ({ params }) => {
        await removeTestCard(ctx, params.number)
        return { deleted: true, number: params.number }
      })

      /** The saved (tokenized) cards, with how each answers its next charge. */
      .get('/credit-cards', async () => ({ data: await listSavedCards(ctx) }))

      /**
       * How a saved card answers from now on: `outcome` for every charge, and
       * `approvalsLeft` to approve that many more charges and then decline.
       */
      .put(
        '/credit-cards/:token',
        async ({ params, body }) => setSavedCardBehavior(ctx, params.token, body),
        {
          body: t.Object({
            outcome: t.Optional(t.Union([t.Literal('APPROVE'), t.Literal('DECLINE')])),
            approvalsLeft: t.Optional(t.Union([t.Integer({ minimum: 0 }), t.Null()])),
          }),
        },
      )

      /** When recurring card charges are tried: Asaas's schedule unless changed here. */
      .get('/card-capture/schedule', async () => describeSchedule(await captureSchedule(ctx)))

      /** Sets the schedule, "0@08:00,0@14:00,0@20:00,1@08:00"; "" goes back to the default. */
      .put(
        '/card-capture/schedule',
        async ({ body }) => describeSchedule(await setCaptureSchedule(ctx, body.schedule)),
        { body: t.Object({ schedule: t.String() }) },
      )

      /**
       * Todas as contas do simulador, com SALDO e CHAVE DE API.
       *
       * Deliberadamente NÃO existe na API do Asaas, e não poderia existir: lá, uma
       * conta não enxerga a chave da outra, e a chave de uma subconta só aparece
       * uma vez, na criação. Aqui isso é justamente o ponto — é como o painel
       * mostra o dinheiro andando entre as contas num split, e como você entra
       * numa subconta sem ter guardado a chave dela.
       *
       * É introspecção de simulador. Vive atrás de `ADMIN_ENABLED`, fora de /v3, e
       * é a razão de esse flag existir.
       */
      .get('/accounts', async () => {
        const rows = await ctx.db
          .select()
          .from(accounts)
          .orderBy(accounts.parentAccountId, accounts.dateCreated)

        // The key the panel acts with: one that authenticates NOW. With several,
        // the newest — after a rotation that is the one the app was given.
        const now = ctx.clock.timestamp()
        const keys = await ctx.db
          .select()
          .from(apiKeys)
          .where(
            and(
              eq(apiKeys.active, true),
              or(isNull(apiKeys.expirationDate), gt(apiKeys.expirationDate, now)),
            ),
          )
          .orderBy(asc(apiKeys.dateCreated))
        const keyOf = new Map(keys.map((k) => [k.accountId, k.key]))
        const seeded = seededDocuments(ctx)

        return {
          accounts: rows.map((a) => ({
            id: a.id,
            name: a.name,
            email: a.email,
            cpfCnpj: a.cpfCnpj,
            walletId: a.walletId,
            parentAccountId: a.parentAccountId,
            status: a.status,
            // Em reais, como toda fronteira de saída deste projeto.
            balance: a.balanceCents / 100,
            apiKey: keyOf.get(a.id) ?? null,
            /** A root account the environment seeds: deleted, it returns on the next boot. */
            seeded: a.parentAccountId === null && seeded.has(a.cpfCnpj),
            dateCreated: a.dateCreated,
          })),
        }
      })

      /** A new profile (root account) with its first key. Not an Asaas operation. */
      .post('/accounts', async ({ body }) => createProfile(ctx, body), {
        body: t.Object({
          name: t.String(),
          cpfCnpj: t.Optional(t.String()),
          email: t.Optional(t.String()),
          apiKey: t.Optional(t.String()),
        }),
      })

      /** Deletes a profile and everything it owns, subaccounts included. */
      .delete('/accounts/:id', async ({ params }) => deleteProfile(ctx, params.id))

      /**
       * Empties a profile and keeps it: the chosen groups go, the account and its
       * keys stay. `cancelCharges` sends PAYMENT_DELETED / SUBSCRIPTION_DELETED
       * through the API path first. See reset.ts.
       */
      .post(
        '/accounts/:id/reset',
        async ({ params, body }) =>
          resetProfile(ctx, params.id, body ?? {}, () => scheduler.dispatchNow()),
        {
          body: t.Optional(
            t.Object({
              cancelCharges: t.Optional(t.Boolean()),
              remove: t.Optional(
                t.Partial(t.Object(Object.fromEntries(RESET_GROUPS.map((g) => [g, t.Boolean()])))),
              ),
            }),
          ),
        },
      )

      // ── API keys of an account (the "Chaves de API" tab) ─────────────────
      .get('/accounts/:id/keys', async ({ params }) => ({
        keys: await listKeys(ctx, params.id),
      }))
      .post('/accounts/:id/keys', async ({ params, body }) => createKey(ctx, params.id, body), {
        body: keyBody,
      })
      .post(
        '/accounts/:id/keys/:keyId/rotate',
        async ({ params, body }) => rotateKey(ctx, params.id, params.keyId, body ?? {}),
        { body: t.Optional(keyBody) },
      )
      .put(
        '/accounts/:id/keys/:keyId',
        async ({ params, body }) => updateKey(ctx, params.id, params.keyId, body),
        { body: keyBody },
      )
      .delete('/accounts/:id/keys/:keyId', async ({ params }) =>
        deleteKey(ctx, params.id, params.keyId),
      )
  )
}
