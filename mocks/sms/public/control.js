// @ts-check
/**
 * The control panel of the SMS mock: the full-screen console with the tabs
 * Entrega, Webhook, Eventos, Números mágicos and API.
 *
 * The script is a browser ES module: no build step, no bundler, no npm.
 * Every text a person reads goes through `t()`, and the strings of the panel
 * live here, in Portuguese and English.
 */

import { onLangChange, registerStrings, t } from './i18n.js'
import { renderApiTab } from './api-tab.js'
import { formatPhone } from './core/phone.js'

/**
 * @typedef {import('../src/types.ts').Settings} Settings
 * @typedef {import('../src/types.ts').Delivery} Delivery
 */

/**
 * The longest delay a timer holds: beyond it the runtime fires at once.
 */
const MAX_DELAY_MS = 2147483647

/**
 * How long the danger button waits for the second click.
 */
const CONFIRM_MS = 3000

registerStrings({
  pt: {
    'ctl.delivery.title': 'Como as mensagens avançam',
    'ctl.delivery.sub':
      'Automática: cada mensagem entra na fila, é enviada e chega entregue depois do atraso. Manual: a mensagem fica na fila até você marcar como entregue, com falha ou não entregue no menu da mensagem.',
    'ctl.delivery.auto': 'Automática',
    'ctl.delivery.manual': 'Manual',
    'ctl.delivery.delay': 'Atraso até a entrega (ms)',
    'ctl.delivery.delay.hint': 'Zero entrega na hora.',
    'ctl.delivery.save': 'Salvar',
    'ctl.delivery.saved': 'Ajustes salvos.',
    'ctl.delivery.invalid': 'O atraso tem de ser um número inteiro de 0 a 2147483647.',
    'ctl.delivery.server': 'Servidor',
    'ctl.delivery.live': 'Tempo real',
    'ctl.delivery.messages': 'Mensagens',
    'ctl.delivery.online': 'no ar',
    'ctl.conn.open': 'ao vivo',
    'ctl.conn.connecting': 'conectando…',
    'ctl.conn.closed': 'reconectando…',
    'ctl.reset.title': 'Começar do zero',
    'ctl.reset.sub': 'Apaga todas as conversas e todos os eventos de webhook do mock.',
    'ctl.reset.button': 'Apagar todas as conversas',
    'ctl.reset.confirm': 'Confirmar?',
    'ctl.reset.done': 'Tudo apagado.',
    'ctl.webhook.title': 'Para onde o mock avisa',
    'ctl.webhook.sub': 'O mock posta os eventos de status e de entrada nesta URL.',
    'ctl.webhook.url': 'URL dos webhooks',
    'ctl.webhook.url.hint': 'Vazio desliga o webhook.',
    'ctl.webhook.secret': 'Segredo (HMAC-SHA256)',
    'ctl.webhook.secret.hint': 'Com o segredo, cada corpo vai assinado no cabeçalho x-sms-signature.',
    'ctl.webhook.from': 'Remetente padrão',
    'ctl.webhook.from.hint': 'O remetente usado quando a requisição não nomeia um.',
    'ctl.webhook.save': 'Salvar',
    'ctl.webhook.saved': 'Webhook salvo.',
    'ctl.webhook.how.title': 'Como o webhook chega',
    'ctl.webhook.how.sub':
      'O corpo acompanha a API que a mensagem usou: JSON por padrão, formulário quando a mensagem passou pela API do Twilio.',
    'ctl.webhook.how.status': 'Evento de status, em JSON:',
    'ctl.webhook.how.inbound': 'Evento de entrada, em JSON:',
    'ctl.webhook.how.twilio': 'Mensagem enviada pela API do Twilio, em formulário:',
    'ctl.webhook.how.signature': 'Cabeçalho da assinatura:',
    'ctl.webhook.how.verify': 'Verificação em Node:',
    'ctl.events.title': 'Eventos enviados',
    'ctl.events.sub': 'Cada tentativa de webhook que o mock fez, da mais nova para a mais antiga.',
    'ctl.events.empty': 'Configure uma URL na aba Webhook.',
    'ctl.events.clear': 'Limpar',
    'ctl.events.cleared': 'Eventos apagados.',
    'ctl.events.signed': 'assinado',
    'ctl.events.error': 'erro',
    'ctl.events.kind.status': 'message.status',
    'ctl.events.kind.inbound': 'message.inbound',
    'ctl.events.count': '{count} tentativas',
    'ctl.events.reply': 'Resposta do celular',
    'ctl.events.st.queued': 'Na fila',
    'ctl.events.st.sent': 'Enviada',
    'ctl.events.st.delivered': 'Entregue',
    'ctl.events.st.undelivered': 'Não entregue',
    'ctl.events.st.failed': 'Falhou',
    'ctl.events.st.received': 'Recebida',
    'ctl.events.url': 'URL',
    'ctl.events.type': 'Tipo do corpo',
    'ctl.events.signature': 'Assinatura',
    'ctl.events.signedYes': 'HMAC-SHA256 no cabeçalho x-sms-signature',
    'ctl.events.signedNo': 'sem segredo: corpo sem assinatura',
    'ctl.events.body': 'Corpo enviado',
    'ctl.magic.title': 'Números mágicos',
    'ctl.magic.sub': 'Os quatro últimos dígitos do destino escolhem o desfecho da mensagem.',
    'ctl.magic.col.number': 'Número',
    'ctl.magic.col.outcome': 'Desfecho',
    'ctl.magic.0001': 'falha na entrega (erro 30003)',
    'ctl.magic.0002': 'não entregue (erro 30005)',
    'ctl.magic.0003': 'recusado pela API (HTTP 400)',
    'ctl.magic.0004': 'fica em "enviada"',
    'ctl.magic.0005': 'filtrado pela operadora (falha, erro 30007)',
    'ctl.magic.otherNumber': 'qualquer outro',
    'ctl.magic.other': 'entregue',
    'ctl.segments.title': 'Segmentos e códigos',
    'ctl.segments.sub': 'Como o mock conta o custo da mensagem e reconhece um código de verificação.',
    'ctl.segments.gsmName': 'GSM-7',
    'ctl.segments.ucs2Name': 'UCS-2',
    'ctl.segments.otpName': 'OTP',
    'ctl.segments.gsm': '160 caracteres no primeiro segmento, 153 em cada um a mais.',
    'ctl.segments.ucs2': '70 caracteres no primeiro segmento, 67 em cada um a mais.',
    'ctl.segments.otp': 'Uma sequência de 4 a 8 dígitos vira um chip na mensagem:',
    'ctl.segments.copied': 'Código copiado.',
    'ctl.segments.copyFailed': 'Não deu para copiar o código.',
  },
  en: {
    'ctl.delivery.title': 'How messages advance',
    'ctl.delivery.sub':
      'Automatic: every message goes through the queue, is sent and arrives delivered after the delay. Manual: the message stays queued until you mark it as delivered, failed or undelivered in the message menu.',
    'ctl.delivery.auto': 'Automatic',
    'ctl.delivery.manual': 'Manual',
    'ctl.delivery.delay': 'Delay until delivery (ms)',
    'ctl.delivery.delay.hint': 'Zero delivers right away.',
    'ctl.delivery.save': 'Save',
    'ctl.delivery.saved': 'Settings saved.',
    'ctl.delivery.invalid': 'The delay must be an integer number from 0 to 2147483647.',
    'ctl.delivery.server': 'Server',
    'ctl.delivery.live': 'Realtime',
    'ctl.delivery.messages': 'Messages',
    'ctl.delivery.online': 'up',
    'ctl.conn.open': 'live',
    'ctl.conn.connecting': 'connecting…',
    'ctl.conn.closed': 'reconnecting…',
    'ctl.reset.title': 'Start from zero',
    'ctl.reset.sub': 'Removes every conversation and every webhook event of the mock.',
    'ctl.reset.button': 'Delete all conversations',
    'ctl.reset.confirm': 'Confirm?',
    'ctl.reset.done': 'Everything cleared.',
    'ctl.webhook.title': 'Where the mock notifies',
    'ctl.webhook.sub': 'The mock posts the status and inbound events to this URL.',
    'ctl.webhook.url': 'Webhook URL',
    'ctl.webhook.url.hint': 'An empty URL turns the webhook off.',
    'ctl.webhook.secret': 'Secret (HMAC-SHA256)',
    'ctl.webhook.secret.hint': 'With a secret, every body is signed in the x-sms-signature header.',
    'ctl.webhook.from': 'Default sender',
    'ctl.webhook.from.hint': 'The sender used when the request names none.',
    'ctl.webhook.save': 'Save',
    'ctl.webhook.saved': 'Webhook saved.',
    'ctl.webhook.how.title': 'How the webhook arrives',
    'ctl.webhook.how.sub':
      'The body follows the API the message came through: JSON by default, a form body when the message went through the Twilio API.',
    'ctl.webhook.how.status': 'Status event, as JSON:',
    'ctl.webhook.how.inbound': 'Inbound event, as JSON:',
    'ctl.webhook.how.twilio': 'Message sent through the Twilio API, as a form:',
    'ctl.webhook.how.signature': 'Signature header:',
    'ctl.webhook.how.verify': 'Verification in Node:',
    'ctl.events.title': 'Events sent',
    'ctl.events.sub': 'Every webhook attempt the mock made, newest first.',
    'ctl.events.empty': 'Set a URL in the Webhook tab.',
    'ctl.events.clear': 'Clear',
    'ctl.events.cleared': 'Events cleared.',
    'ctl.events.signed': 'signed',
    'ctl.events.error': 'error',
    'ctl.events.kind.status': 'message.status',
    'ctl.events.kind.inbound': 'message.inbound',
    'ctl.events.count': '{count} attempts',
    'ctl.events.reply': 'Reply from the handset',
    'ctl.events.st.queued': 'Queued',
    'ctl.events.st.sent': 'Sent',
    'ctl.events.st.delivered': 'Delivered',
    'ctl.events.st.undelivered': 'Undelivered',
    'ctl.events.st.failed': 'Failed',
    'ctl.events.st.received': 'Received',
    'ctl.events.url': 'URL',
    'ctl.events.type': 'Body type',
    'ctl.events.signature': 'Signature',
    'ctl.events.signedYes': 'HMAC-SHA256 in the x-sms-signature header',
    'ctl.events.signedNo': 'no secret: the body is not signed',
    'ctl.events.body': 'Body sent',
    'ctl.magic.title': 'Magic numbers',
    'ctl.magic.sub': 'The last four digits of the destination pick the outcome of the message.',
    'ctl.magic.col.number': 'Number',
    'ctl.magic.col.outcome': 'Outcome',
    'ctl.magic.0001': 'delivery failure (error 30003)',
    'ctl.magic.0002': 'not delivered (error 30005)',
    'ctl.magic.0003': 'rejected by the API (HTTP 400)',
    'ctl.magic.0004': 'stays "sent"',
    'ctl.magic.0005': 'filtered by the carrier (failure, error 30007)',
    'ctl.magic.otherNumber': 'any other',
    'ctl.magic.other': 'delivered',
    'ctl.segments.title': 'Segments and codes',
    'ctl.segments.sub': 'How the mock counts what a message costs and spots a verification code.',
    'ctl.segments.gsmName': 'GSM-7',
    'ctl.segments.ucs2Name': 'UCS-2',
    'ctl.segments.otpName': 'OTP',
    'ctl.segments.gsm': '160 characters in the first segment, 153 in each one after it.',
    'ctl.segments.ucs2': '70 characters in the first segment, 67 in each one after it.',
    'ctl.segments.otp': 'A run of 4 to 8 digits becomes a chip in the message:',
    'ctl.segments.copied': 'Code copied.',
    'ctl.segments.copyFailed': 'The code could not be copied.',
  },
})

/**
 * @typedef {object} PanelContext
 * @property {() => any} view The state of the panel, as it stands right now: the
 *   container gives the current view, a plain object is the view itself.
 * @property {any} api The client of the mock.
 * @property {(message: string, isError?: boolean) => void} toast The toast of the panel.
 */

/**
 * @typedef {object} Panel
 * @property {HTMLElement} node The node the panel draws into.
 * @property {() => void} [live] Refreshes only the parts that show live data.
 * @property {() => void} [fill] Fills the forms with the settings of the mock.
 * @property {() => void} [dispose] Frees what the panel holds (timers, listeners).
 * @property {{ update: () => void }} [api] The handle of the API tab.
 */

/**
 * Mounts the control panel on the overlay of the page: the nav, the tabs, the
 * close button, the Escape key and the count of the webhook events.
 * @param {{
 *   root: HTMLElement,
 *   state: any,
 *   api: any,
 *   toast: (message: string, isError?: boolean) => void,
 * }} parts The parts the panel needs.
 * @returns {{ open: (tab?: string) => void, close: () => void, refresh: () => void }}
 */
export function mountTools({ root, state, api, toast }) {
  const content = /** @type {HTMLElement} */ (root.querySelector('#tools-content'))
  const nav = Array.from(root.querySelectorAll('.tools-nav [data-tool]'))
  const counter = /** @type {HTMLElement | null} */ (root.querySelector('#count-events'))
  const closeButton = /** @type {HTMLElement | null} */ (root.querySelector('#tools-close'))

  /** The tab on screen. */
  let current = 'delivery'
  /** The panel on screen. */
  /** @type {Panel | null} */
  let panel = null
  /** The handle of the API tab, kept to redraw it when the language changes. */
  /** @type {{ update: () => void } | null} */
  let apiTab = null
  /** Whether the console is open. */
  let isOpen = false
  /** The control that opened the panel: it gets the focus back on close. @type {HTMLElement | null} */
  let opener = null

  /** @type {PanelContext} */
  const ctx = {
    view: () => (typeof state.get === 'function' ? state.get() : state),
    api,
    toast,
  }

  /**
   * Draws the panel of the tab on screen.
   */
  function draw() {
    panel?.dispose?.()
    panel = null
    apiTab = null
    const built = buildPanel(current, ctx)
    panel = built
    if (built.api) apiTab = built.api
    content.replaceChildren(built.node)
    built.fill?.()
    built.live?.()
  }

  /**
   * Redraws the panel on screen: the API tab updates itself, the other tabs are
   * drawn again so the texts follow the language.
   */
  function refresh() {
    if (!isOpen) return
    if (current === 'api' && apiTab) {
      apiTab.update()
      return
    }
    draw()
  }

  /**
   * Counts the webhook events on the nav.
   */
  function updateCounter() {
    if (!counter) return
    counter.textContent = String(deliveriesOf(ctx.view()).length)
  }

  /**
   * Marks the tab on screen.
   * @param {string} tab The name of the tab.
   */
  function select(tab) {
    for (const button of nav) {
      button.setAttribute('aria-selected', button.getAttribute('data-tool') === tab ? 'true' : 'false')
    }
  }

  /**
   * Opens the console on a tab.
   * @param {string} [tab] The name of the tab.
   */
  function openPanel(tab = 'delivery') {
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    isOpen = true
    root.hidden = false
    current = tab
    select(tab)
    draw()
    updateCounter()
    document.addEventListener('keydown', onKey)
    // The overlay covers the inbox: the inbox leaves the tab order and the focus moves in.
    document.getElementById('app')?.setAttribute('inert', '')
    const selected = root.querySelector('.tools-nav [aria-selected="true"]')
    if (selected instanceof HTMLElement) selected.focus()
  }

  /**
   * Closes the console.
   */
  function closePanel() {
    isOpen = false
    root.hidden = true
    document.removeEventListener('keydown', onKey)
    document.getElementById('app')?.removeAttribute('inert')
    opener?.focus()
    opener = null
  }

  /**
   * The Escape key closes the console, but only while it is open.
   * @param {KeyboardEvent} event The key the user pressed.
   */
  function onKey(event) {
    if (event.key !== 'Escape') return
    event.preventDefault()
    closePanel()
  }

  for (const button of nav) {
    button.addEventListener('click', () => {
      const tab = button.getAttribute('data-tool')
      if (!tab || tab === current) return
      current = tab
      select(tab)
      draw()
    })
  }

  closeButton?.addEventListener('click', closePanel)

  const onState = () => {
    updateCounter()
    if (isOpen) panel?.live?.()
  }

  if (typeof state.subscribe === 'function') state.subscribe(onState)
  onLangChange(() => refresh())

  updateCounter()

  return { open: openPanel, close: closePanel, refresh }
}

/**
 * Builds the panel of a tab.
 * @param {string} tab The name of the tab.
 * @param {PanelContext} ctx The parts the panel needs.
 * @returns {Panel}
 */
function buildPanel(tab, ctx) {
  switch (tab) {
    case 'webhook':
      return webhookPanel(ctx)
    case 'events':
      return eventsPanel(ctx)
    case 'magic':
      return magicPanel(ctx)
    case 'api':
      return apiPanel(ctx)
    default:
      return deliveryPanel(ctx)
  }
}

/**
 * The Entrega tab: how the messages advance, the settings that drive it and
 * the button that empties the mock.
 * @param {PanelContext} ctx The parts the panel needs.
 * @returns {Panel}
 */
function deliveryPanel(ctx) {
  const node = h('div', { class: 'cards' })

  const automatic = h('button', { type: 'button' }, t('ctl.delivery.auto'))
  const manual = h('button', { type: 'button' }, t('ctl.delivery.manual'))
  const seg = h('div', { class: 'seg' }, automatic, manual)

  const delayInput = h('input', {
    type: 'number',
    min: '0',
    max: String(MAX_DELAY_MS),
    step: '1',
    inputmode: 'numeric',
  })

  const saveDelay = h('button', { class: 'btn', type: 'button' }, t('ctl.delivery.save'))

  const liveValue = h('span', { class: 'pill' }, t('ctl.conn.connecting'))
  const messagesValue = h('span', {}, '0')

  const card = h(
    'div',
    { class: 'card' },
    h('h3', { class: 'card-title' }, t('ctl.delivery.title')),
    h('p', { class: 'card-sub' }, t('ctl.delivery.sub')),
    seg,
    h(
      'label',
      { class: 'field' },
      h('span', {}, t('ctl.delivery.delay')),
      delayInput,
      h('span', {}, t('ctl.delivery.delay.hint')),
    ),
    saveDelay,
    kvLine(t('ctl.delivery.server'), h('span', { class: 'pill ok' }, t('ctl.delivery.online'))),
    kvLine(t('ctl.delivery.live'), liveValue),
    kvLine(t('ctl.delivery.messages'), messagesValue),
  )

  const resetButton = h('button', { class: 'btn danger', type: 'button' }, t('ctl.reset.button'))
  const resetCard = h(
    'div',
    { class: 'card' },
    h('h3', { class: 'card-title' }, t('ctl.reset.title')),
    h('p', { class: 'card-sub' }, t('ctl.reset.sub')),
    resetButton,
  )

  node.append(card, resetCard)

  /** Whether the danger button waits for the second click. */
  let armed = false
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timer = null

  /**
   * Puts the danger button back to its first state.
   */
  function disarm() {
    armed = false
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    resetButton.textContent = t('ctl.reset.button')
  }

  /**
   * Fills the forms with the settings of the mock.
   * @param {Settings | null} [settings] The settings to show.
   */
  function fill(settings) {
    const values = settings ?? ctx.view().settings
    if (!values || typeof values !== 'object') return
    delayInput.value = String(values.deliveryDelayMs)
    automatic.setAttribute('aria-pressed', values.autoDeliver ? 'true' : 'false')
    manual.setAttribute('aria-pressed', values.autoDeliver ? 'false' : 'true')
  }

  /**
   * Refreshes the lines that show live data.
   */
  function live() {
    const connection = ctx.view().connection
    liveValue.className = `pill ${connection === 'open' ? 'ok' : connection === 'closed' ? 'err' : ''}`
    liveValue.textContent = t(
      connection === 'open' ? 'ctl.conn.open' : connection === 'closed' ? 'ctl.conn.closed' : 'ctl.conn.connecting',
    )
    messagesValue.textContent = String(messagesOf(ctx.view()).length)
  }

  /**
   * Saves a piece of the settings and fills the forms with the answer.
   * @param {Record<string, unknown>} patch The fields to change.
   */
  async function save(patch) {
    try {
      const saved = await ctx.api.putSettings(patch)
      fill(saved)
      ctx.toast(t('ctl.delivery.saved'))
    } catch (error) {
      ctx.toast(messageOf(error), true)
    }
  }

  automatic.addEventListener('click', () => {
    void save({ autoDeliver: true })
  })

  manual.addEventListener('click', () => {
    void save({ autoDeliver: false })
  })

  saveDelay.addEventListener('click', () => {
    const raw = delayInput.value.trim()
    const value = Number(raw)
    if (raw === '' || !Number.isInteger(value) || value < 0 || value > MAX_DELAY_MS) {
      ctx.toast(t('ctl.delivery.invalid'), true)
      return
    }
    void save({ deliveryDelayMs: value })
  })

  resetButton.addEventListener('click', () => {
    if (!armed) {
      armed = true
      resetButton.textContent = t('ctl.reset.confirm')
      timer = setTimeout(disarm, CONFIRM_MS)
      return
    }
    disarm()
    void ctx.api.reset().then(
      () => ctx.toast(t('ctl.reset.done')),
      (error) => ctx.toast(messageOf(error), true),
    )
  })

  return {
    node,
    live,
    fill,
    dispose: () => {
      if (timer !== null) clearTimeout(timer)
    },
  }
}

/**
 * The Webhook tab: where the mock posts the events and how the body of a
 * request looks on the wire.
 * @param {PanelContext} ctx The parts the panel needs.
 * @returns {Panel}
 */
function webhookPanel(ctx) {
  const node = h('div', { class: 'cards' })

  const urlInput = h('input', { type: 'url', placeholder: 'https://example.test/webhook' })
  const secretInput = h('input', { type: 'text', placeholder: 'secret' })
  const fromInput = h('input', { type: 'text', placeholder: 'AMA4DEVS' })

  const save = h('button', { class: 'btn primary', type: 'button' }, t('ctl.webhook.save'))

  const card = h(
    'div',
    { class: 'card' },
    h('h3', { class: 'card-title' }, t('ctl.webhook.title')),
    h('p', { class: 'card-sub' }, t('ctl.webhook.sub')),
    h(
      'label',
      { class: 'field' },
      h('span', {}, t('ctl.webhook.url')),
      urlInput,
      h('span', {}, t('ctl.webhook.url.hint')),
    ),
    h(
      'label',
      { class: 'field' },
      h('span', {}, t('ctl.webhook.secret')),
      secretInput,
      h('span', {}, t('ctl.webhook.secret.hint')),
    ),
    h(
      'label',
      { class: 'field' },
      h('span', {}, t('ctl.webhook.from')),
      fromInput,
      h('span', {}, t('ctl.webhook.from.hint')),
    ),
    save,
  )

  const how = h(
    'div',
    { class: 'card' },
    h('h3', { class: 'card-title' }, t('ctl.webhook.how.title')),
    h('p', { class: 'card-sub' }, t('ctl.webhook.how.sub')),
    h('p', {}, t('ctl.webhook.how.status')),
    h('pre', { class: 'json' }, JSON.stringify(STATUS_BODY, null, 2)),
    h('p', {}, t('ctl.webhook.how.inbound')),
    h('pre', { class: 'json' }, JSON.stringify(INBOUND_BODY, null, 2)),
    h('p', {}, t('ctl.webhook.how.twilio')),
    h('pre', {}, TWILIO_BODY),
    h('p', {}, t('ctl.webhook.how.signature')),
    h('pre', {}, SIGNATURE_HEADER),
    h('p', {}, t('ctl.webhook.how.verify')),
    h('pre', {}, VERIFY_SNIPPET),
  )

  node.append(card, how)

  /**
   * Fills the forms with the settings of the mock.
   * @param {Settings | null} [settings] The settings to show.
   */
  function fill(settings) {
    const values = settings ?? ctx.view().settings
    if (!values || typeof values !== 'object') return
    urlInput.value = values.webhookUrl ?? ''
    secretInput.value = values.webhookSecret ?? ''
    fromInput.value = values.defaultFrom ?? ''
  }

  save.addEventListener('click', () => {
    void (async () => {
      try {
        const saved = await ctx.api.putSettings({
          webhookUrl: urlInput.value.trim(),
          webhookSecret: secretInput.value,
          defaultFrom: fromInput.value.trim(),
        })
        fill(saved)
        ctx.toast(t('ctl.webhook.saved'))
      } catch (error) {
        ctx.toast(messageOf(error), true)
      }
    })()
  })

  return { node, fill }
}

/**
 * The Eventos tab: every webhook attempt the mock made.
 * @param {PanelContext} ctx The parts the panel needs.
 * @returns {Panel}
 */
function eventsPanel(ctx) {
  const node = h('div', {})
  const list = h('div', {})

  const clear = h('button', { class: 'btn small', type: 'button' }, t('ctl.events.clear'))
  const count = h('span', { class: 'events-count' })

  const bar = h(
    'div',
    { class: 'events-bar' },
    h(
      'div',
      { class: 'events-bar-text' },
      h('h3', { class: 'card-title' }, t('ctl.events.title'), ' ', count),
      h('p', { class: 'card-sub' }, t('ctl.events.sub')),
    ),
    clear,
  )

  node.append(bar, list)

  /**
   * Draws the attempts of the log.
   */
  function live() {
    const deliveries = deliveriesOf(ctx.view())
    count.textContent = deliveries.length > 0 ? t('ctl.events.count', { count: deliveries.length }) : ''
    clear.disabled = deliveries.length === 0
    if (deliveries.length === 0) {
      list.replaceChildren(h('p', { class: 'empty-hint' }, t('ctl.events.empty')))
      return
    }
    // A row the person opened stays open, and a row with the focus keeps it, when a new attempt arrives.
    const open = new Set([...list.querySelectorAll('details.event[open]')].map((row) => row.id))
    const active = document.activeElement
    const focusedId =
      active instanceof HTMLElement && list.contains(active) ? active.closest('details.event')?.id : undefined
    list.replaceChildren(...deliveries.map((delivery) => eventRow(delivery, open.has(`ev-${delivery.id}`))))
    if (focusedId) {
      const summary = list.querySelector(`#${CSS.escape(focusedId)} > summary`)
      if (summary instanceof HTMLElement) summary.focus()
    }
  }

  clear.addEventListener('click', () => {
    void ctx.api.clearDeliveries().then(
      () => ctx.toast(t('ctl.events.cleared')),
      (error) => ctx.toast(messageOf(error), true),
    )
  })

  return { node, live }
}

/**
 * What a webhook body says, whichever API the message came through: the status,
 * the number the person sees and the text.
 * @param {Delivery} delivery The attempt to read.
 * @returns {{ status: string, number: string, text: string }}
 */
function factsOf(delivery) {
  /** @type {{ status: string, number: string, text: string }} */
  const facts = { status: '', number: '', text: '' }
  try {
    if (delivery.contentType.includes('json')) {
      const body = JSON.parse(delivery.requestBody)
      const message = body?.message ?? {}
      facts.status = String(message.status ?? '')
      facts.number = String(message.direction === 'inbound' ? (message.from ?? '') : (message.to ?? ''))
      facts.text = String(message.body ?? '')
    } else {
      const form = new URLSearchParams(delivery.requestBody)
      facts.status = form.get('MessageStatus') ?? ''
      facts.number = form.get('To') ?? ''
      facts.text = form.get('Body') ?? ''
    }
  } catch {
    // A body that is not what the mock sends: the row shows the event name only.
  }
  return facts
}

/**
 * One attempt of webhook as a row of the log: the answer, what happened and
 * when; it opens to the URL, the signature and the whole body.
 * @param {Delivery} delivery The attempt to draw.
 * @param {boolean} open Whether the row was open before this draw.
 * @returns {HTMLElement}
 */
function eventRow(delivery, open) {
  const facts = factsOf(delivery)
  const inbound = delivery.event === 'inbound'
  const outcome = delivery.statusCode !== null ? String(delivery.statusCode) : t('ctl.events.error')

  const what = inbound
    ? t('ctl.events.reply')
    : facts.status
      ? t(`ctl.events.st.${facts.status}`)
      : t('ctl.events.kind.status')
  const number = facts.number ? formatPhone(facts.number) : ''

  const head = h(
    'summary',
    { class: 'event-head' },
    h('span', { class: `event-code ${delivery.ok ? 'ok' : 'err'}` }, outcome),
    h(
      'span',
      { class: 'event-main' },
      h('span', { class: 'event-title' }, number ? `${what} · ${number}` : what),
      facts.text ? h('span', { class: 'event-snippet' }, facts.text) : null,
    ),
    delivery.signed ? h('span', { class: 'event-signed' }, t('ctl.events.signed')) : null,
    h('time', { class: 'event-time', datetime: delivery.at }, timeLabel(delivery.at)),
  )

  const meta = h(
    'dl',
    { class: 'event-meta' },
    h('dt', {}, t('ctl.events.url')),
    h('dd', {}, delivery.url),
    h('dt', {}, t('ctl.events.type')),
    h('dd', {}, delivery.contentType),
    h('dt', {}, t('ctl.events.signature')),
    h('dd', {}, delivery.signed ? t('ctl.events.signedYes') : t('ctl.events.signedNo')),
  )

  const body = h('div', { class: 'event-body' }, meta)
  if (!delivery.ok && delivery.error) body.append(h('p', { class: 'event-error' }, delivery.error))
  body.append(h('pre', { class: 'json' }, prettyJson(delivery.requestBody)))

  const row = h('details', { class: `event ${delivery.ok ? 'ok' : 'err'}`, id: `ev-${delivery.id}` }, head, body)
  if (open) row.open = true
  return row
}

/**
 * The Números mágicos tab: the numbers that stage a failure and how a message
 * is counted.
 * @param {PanelContext} ctx The parts the panel needs.
 * @returns {Panel}
 */
function magicPanel(ctx) {
  const node = h('div', { class: 'cards' })

  const chip = h('button', { class: 'chip chip-otp', type: 'button' }, '482913')
  chip.addEventListener('click', () => {
    void copyCode('482913', ctx)
  })

  const rows = [
    ['…0001', t('ctl.magic.0001')],
    ['…0002', t('ctl.magic.0002')],
    ['…0003', t('ctl.magic.0003')],
    ['…0004', t('ctl.magic.0004')],
    ['…0005', t('ctl.magic.0005')],
    [t('ctl.magic.otherNumber'), t('ctl.magic.other')],
  ]

  const table = h(
    'table',
    {},
    h(
      'thead',
      {},
      h('tr', {}, h('th', {}, t('ctl.magic.col.number')), h('th', {}, t('ctl.magic.col.outcome'))),
    ),
    h(
      'tbody',
      {},
      ...rows.map(([number, outcome]) => h('tr', {}, h('td', {}, number), h('td', {}, outcome))),
    ),
  )

  const magicCard = h(
    'div',
    { class: 'card' },
    h('h3', { class: 'card-title' }, t('ctl.magic.title')),
    h('p', { class: 'card-sub' }, t('ctl.magic.sub')),
    h('div', { class: 'table-wrap' }, table),
  )

  const segmentsCard = h(
    'div',
    { class: 'card' },
    h('h3', { class: 'card-title' }, t('ctl.segments.title')),
    h('p', { class: 'card-sub' }, t('ctl.segments.sub')),
    kvLine(t('ctl.segments.gsmName'), t('ctl.segments.gsm')),
    kvLine(t('ctl.segments.ucs2Name'), t('ctl.segments.ucs2')),
    kvLine(t('ctl.segments.otpName'), h('span', {}, t('ctl.segments.otp'), ' ', chip)),
  )

  node.append(magicCard, segmentsCard)

  return { node }
}

/**
 * The API tab: the reference of the routes, drawn by the module that owns it.
 * @param {PanelContext} ctx The parts the panel needs.
 * @returns {Panel}
 */
function apiPanel(ctx) {
  const node = h('div', {})
  const api = renderApiTab(node, { origin: location.origin })
  return { node, api }
}

/**
 * The body of a status event, as the mock posts it.
 */
const STATUS_BODY = {
  event: 'message.status',
  message: {
    id: `SM${'0'.repeat(32)}`,
    from: 'AMA4DEVS',
    to: '+5511912345678',
    body: 'Seu código é 482913',
    status: 'delivered',
    encoding: 'GSM-7',
    segments: 1,
  },
}

/**
 * The body of an inbound event, as the mock posts it.
 */
const INBOUND_BODY = {
  event: 'message.inbound',
  message: {
    id: `SM${'0'.repeat(32)}`,
    from: '+5511912345678',
    to: 'AMA4DEVS',
    body: 'Recebi, obrigado!',
    status: 'received',
    encoding: 'GSM-7',
    segments: 1,
  },
}

/**
 * The body of a message that went through the Twilio API: a form.
 */
const TWILIO_BODY = [
  `MessageSid=SM${'0'.repeat(32)}`,
  `SmsSid=SM${'0'.repeat(32)}`,
  'AccountSid=ACmock00000000000000000000000000',
  'MessageStatus=delivered',
  'SmsStatus=delivered',
  'From=AMA4DEVS',
  'To=%2B5511912345678',
  'NumSegments=1',
].join('&')

/**
 * The header that carries the signature of the body.
 */
const SIGNATURE_HEADER = 'x-sms-signature: sha256=<hmac>'

/**
 * The snippet that checks the signature of a body in Node.
 */
const VERIFY_SNIPPET = [
  "import crypto from 'node:crypto'",
  '',
  'const signature = request.headers["x-sms-signature"] ?? ""',
  'const expected = crypto',
  "  .createHmac('sha256', process.env.SMS_WEBHOOK_SECRET)",
  '  .update(rawBody) // the body exactly as it arrived',
  "  .digest('hex')",
  '',
  'if (signature !== `sha256=${expected}`) throw new Error("invalid signature")',
].join('\n')

/**
 * Copies a code to the clipboard and tells the user what happened.
 * @param {string} code The code to copy.
 * @param {PanelContext} ctx The parts the panel needs.
 */
async function copyCode(code, ctx) {
  try {
    await navigator.clipboard.writeText(code)
    ctx.toast(t('ctl.segments.copied'))
  } catch {
    ctx.toast(t('ctl.segments.copyFailed'), true)
  }
}

/**
 * A line of the panel: the name of a value and the value itself.
 * @param {string} key The name of the value.
 * @param {unknown} value The value, as a node or as a text.
 * @returns {HTMLElement}
 */
function kvLine(key, value) {
  return h('div', { class: 'kv-line' }, h('span', { class: 'k' }, key), h('span', { class: 'v' }, value))
}

/**
 * The deliveries of the state.
 * @param {any} view The state of the panel.
 * @returns {Delivery[]}
 */
function deliveriesOf(view) {
  return Array.isArray(view?.deliveries) ? view.deliveries : []
}

/**
 * The messages of the state.
 * @param {any} view The state of the panel.
 * @returns {any[]}
 */
function messagesOf(view) {
  return Array.isArray(view?.messages) ? view.messages : []
}

/**
 * The message of a failed request.
 * @param {unknown} error The error the client threw.
 * @returns {string}
 */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * The hour and the minute of a moment.
 * @param {string} iso The moment.
 * @returns {string}
 */
function timeLabel(iso) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (/** @type {number} */ value) => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * A JSON body as the panel shows it: indented, or as it came when it is not
 * JSON at all.
 * @param {string} text The body of the request.
 * @returns {string}
 */
function prettyJson(text) {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return String(text)
  }
}

/**
 * Builds an element with its attributes and children, without ever touching
 * `innerHTML`: every text that reaches the page goes through a text node.
 * @param {string} tag The name of the tag.
 * @param {Record<string, unknown>} [attrs] The attributes of the element.
 * @param {...unknown} children The children of the element.
 * @returns {HTMLElement}
 */
function h(tag, attrs, ...children) {
  const element = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === undefined || value === null || value === false) continue
    if (key === 'class') element.className = String(value)
    else if (key === 'style') element.setAttribute('style', String(value))
    else if (key.startsWith('on') && typeof value === 'function') {
      element.addEventListener(key.slice(2), /** @type {EventListener} */ (value))
    } else if (value === true) element.setAttribute(key, '')
    else element.setAttribute(key, String(value))
  }
  append(element, children)
  return element
}

/**
 * Appends children to an element: strings and numbers become text nodes.
 * @param {HTMLElement} element The element that receives the children.
 * @param {unknown[]} children The children of the element.
 */
function append(element, children) {
  for (const child of children.flat()) {
    if (child === undefined || child === null || child === false) continue
    if (typeof child === 'string' || typeof child === 'number') {
      element.append(document.createTextNode(String(child)))
    } else {
      element.append(/** @type {Node} */ (child))
    }
  }
}
