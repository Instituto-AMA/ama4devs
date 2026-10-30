// @ts-check
/**
 * The API tab of the panel: the whole catalog of the mock as a reference, read
 * from the same source the site and the tests read, with a button that sends
 * each call for real and shows the answer the mock gave.
 */
import { getLang, registerStrings, t } from './i18n.js'
import { OPERATIONS, buildRequest, curlOf, groupOperations, withOverride } from './core/operations.js'

registerStrings({
  pt: {
    'api.title': 'A API do SMS, aqui',
    'api.lead': 'Aponte a sua aplicação para este endereço: nenhuma chave é preciso e um cliente Twilio funciona trocando a URL base.',
    'api.base': 'Base',
    'api.legendApi': 'API: o que a sua aplicação chama',
    'api.legendMock': 'Só do mock: o que só um teste ou o painel chama',
    'api.filter': 'Filtrar {count} chamadas',
    'api.params': 'Parâmetros',
    'api.body': 'Corpo',
    'api.example': 'Exemplo',
    'api.responses': 'Respostas',
    'api.name': 'Nome',
    'api.where': 'Onde',
    'api.type': 'Tipo',
    'api.description': 'Descrição',
    'api.required': 'obrigatório',
    'api.inPath': 'caminho',
    'api.inQuery': 'consulta',
    'api.inHeader': 'cabeçalho',
    'api.copy': 'Copiar',
    'api.copied': 'Copiado',
    'api.try': 'Testar',
    'api.tryHint': 'Esta chamada é real: a mensagem aparece na caixa de entrada.',
    'api.sending': 'Enviando…',
    'api.confirmLive': 'Esta chamada muda o mock que está rodando (mensagens, log ou configurações). Enviar mesmo assim?',
    'api.noBody': 'sem corpo',
    'api.toc': 'Nesta página',
    'api.empty': 'O catálogo de operações está vazio.',
    'api.testBody': 'Mensagem de teste da API do mock',
  },
  en: {
    'api.title': 'The SMS API, here',
    'api.lead': 'Point your application at this address: no key is needed, and a Twilio client works by changing its base URL.',
    'api.base': 'Base',
    'api.legendApi': 'API: what your application calls',
    'api.legendMock': 'Mock only: what only a test or the panel calls',
    'api.filter': 'Filter {count} calls',
    'api.params': 'Parameters',
    'api.body': 'Body',
    'api.example': 'Example',
    'api.responses': 'Responses',
    'api.name': 'Name',
    'api.where': 'Where',
    'api.type': 'Type',
    'api.description': 'Description',
    'api.required': 'required',
    'api.inPath': 'path',
    'api.inQuery': 'query',
    'api.inHeader': 'header',
    'api.copy': 'Copy',
    'api.copied': 'Copied',
    'api.try': 'Try it',
    'api.tryHint': 'This call is real: the message shows up in the inbox.',
    'api.sending': 'Sending…',
    'api.confirmLive': 'This call changes the running mock (messages, log or settings). Send it anyway?',
    'api.noBody': 'no body',
    'api.toc': 'On this page',
    'api.empty': 'The catalog of operations is empty.',
    'api.testBody': 'API mock test message',
  },
})

/** The number the test messages go to: a plain one, so the call succeeds. */
const TEST_TO = '+5511912345678'

/** The sender the test messages carry. */
const TEST_FROM = 'AMA4DEVS'

/** How long the copy button says it copied. */
const COPY_FEEDBACK_MS = 1500

/** The reason phrases of the statuses the mock answers with. */
const STATUS_TEXT = {
  200: 'OK',
  201: 'Created',
  202: 'Accepted',
  204: 'No Content',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  409: 'Conflict',
  415: 'Unsupported Media Type',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
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
    else if (key.startsWith('on') && typeof value === 'function') {
      element.addEventListener(key.slice(2), /** @type {EventListener} */ (value))
    } else if (value === true) element.setAttribute(key, '')
    else element.setAttribute(key, String(value))
  }
  for (const child of children.flat()) {
    if (child === undefined || child === null || child === false) continue
    if (typeof child === 'string' || typeof child === 'number') {
      element.append(document.createTextNode(String(child)))
    } else {
      element.append(/** @type {Node} */ (child))
    }
  }
  return element
}

/** The operations whose Testar changes or drops what the mock holds: they ask first. */
const CONFIRM_FIRST = new Set(['mock-reset', 'mock-deliveries-clear', 'mock-settings-put'])

/**
 * Renders the API tab of the panel: every operation of the catalog, with its
 * parameters, its body, a ready `curl` and a button that sends the call.
 * @param {HTMLElement} container Where the tab is drawn.
 * @param {{ origin: string }} options The address of the mock.
 * @returns {{ update: () => void }} The handle that redraws the tab.
 */
export function renderApiTab(container, { origin }) {
  /** The text of the filter, kept between the redraws. */
  let filterText = ''
  /** The operations the reader opened, kept between the redraws. */
  const openIds = new Set()
  /** The answer each operation shows, by operation id. */
  const selectedCases = new Map()
  /** The column of the reference, rebuilt on every redraw. */
  let main = h('div', { class: 'api-main' })
  /** The list of the groups, on the side. */
  let toc = h('nav', { class: 'api-toc' })
  /** The group sections on the screen, swapped when the filter changes. */
  let sections = []

  /**
   * Draws the whole tab: the intro, the groups and the list on the side.
   */
  function renderAll() {
    container.replaceChildren()
    main = h('div', { class: 'api-main' })
    toc = h('nav', { class: 'api-toc', 'aria-label': t('api.toc') })
    const api = h('div', { class: 'api' })
    api.append(main, toc)
    container.append(api)

    if (!OPERATIONS.length) {
      main.append(h('p', { class: 'empty-hint' }, t('api.empty')))
      return
    }

    main.append(intro())
    renderGroups()
    scrollToHash()
  }

  /**
   * Draws the intro: the title, the address of the mock, the legend of the
   * kinds of call and the filter.
   * @returns {HTMLElement}
   */
  function intro() {
    const box = h('header', { class: 'api-intro' })
    box.append(h('h3', {}, t('api.title')))
    box.append(h('p', { class: 'lead' }, t('api.lead')))

    const pill = h('div', { class: 'base-pill' })
    pill.append(h('span', { class: 'base-label' }, t('api.base')))
    pill.append(h('code', {}, origin))
    box.append(pill)

    const legend = h('ul', { class: 'legend' })
    legend.append(legendItem('api', t('api.legendApi')))
    legend.append(legendItem('mock', t('api.legendMock')))
    box.append(legend)

    const filter = h('input', {
      class: 'api-filter',
      type: 'search',
      autocomplete: 'off',
      spellcheck: 'false',
      placeholder: t('api.filter', { count: String(OPERATIONS.length) }),
      'aria-label': t('api.filter', { count: String(OPERATIONS.length) }),
    })
    filter.value = filterText
    filter.addEventListener('input', () => {
      filterText = filter.value
      renderGroups()
    })
    box.append(filter)
    return box
  }

  /**
   * One item of the legend: the swatch of the kind and what it means.
   * @param {string} kind `api` or `mock`.
   * @param {string} label The text of the item.
   * @returns {HTMLElement}
   */
  function legendItem(kind, label) {
    return h('li', { class: 'legend-item' }, h('span', { class: `swatch ${kind}` }), label)
  }

  /**
   * Draws the groups of operations and the list on the side.
   */
  function renderGroups() {
    const lang = getLang()
    const query = filterText.trim().toLowerCase()
    for (const section of sections) section.remove()
    sections = []

    /** @type {{ id: string, label: string }[]} */
    const entries = []
    groupOperations(OPERATIONS).forEach((group, index) => {
      const ops = group.ops.filter((op) => matches(op, query))
      if (!ops.length) return
      const section = h('section', { class: 'api-group', id: `api-group-${index + 1}` })
      const title = h('div', { class: 'api-group-title' })
      title.append(h('span', { class: 'api-group-name' }, group.tag[lang]))
      title.append(h('span', { class: 'count' }, String(ops.length)))
      section.append(title)
      for (const op of ops) section.append(operation(op))
      sections.push(section)
      main.append(section)
      entries.push({ id: section.id, label: group.tag[lang] })
    })

    renderToc(entries)
  }

  /**
   * Draws the list of the groups on the side.
   * @param {{ id: string, label: string }[]} entries The groups on the screen.
   */
  function renderToc(entries) {
    toc.replaceChildren()
    toc.append(h('b', {}, t('api.toc')))
    for (const entry of entries) {
      const anchor = h('a', { class: 'toc-link', href: `#${entry.id}` }, entry.label)
      anchor.addEventListener('click', (event) => {
        event.preventDefault()
        const section = document.getElementById(entry.id)
        if (section) scrollTo(section)
        setHash(`#${entry.id}`)
      })
      toc.append(anchor)
    }
  }

  /**
   * Whether an operation answers the text of the filter.
   * @param {import('./core/operations.js').Operation} op The operation.
   * @param {string} query The text of the filter, already lowercased.
   * @returns {boolean}
   */
  function matches(op, query) {
    if (!query) return true
    const haystack = [op.tag?.pt, op.tag?.en, op.method, op.path, op.summary?.pt, op.summary?.en]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    return haystack.includes(query)
  }

  /**
   * One operation: the head that opens it and the body, drawn on the first
   * open.
   * @param {import('./core/operations.js').Operation} op The operation.
   * @returns {HTMLElement}
   */
  function operation(op) {
    const lang = getLang()
    const details = h('details', { class: op.kind === 'mock' ? 'op mock' : 'op', id: `op-${op.id}` })
    const head = h('summary', { class: 'op-head' })
    head.append(h('span', { class: `method ${op.method.toLowerCase()}` }, op.method.toUpperCase()))
    head.append(pathNode(op.path))
    head.append(h('span', { class: `op-badge ${op.kind}` }, op.kind === 'mock' ? 'mock' : 'API'))
    head.append(h('span', { class: 'op-summary' }, op.summary?.[lang].replaceAll('`', '') ?? ''))
    details.append(head)

    if (openIds.has(op.id) || location.hash === `#op-${op.id}`) {
      details.open = true
      paintBody(details, op)
    }
    details.addEventListener('toggle', () => {
      if (!details.open) {
        openIds.delete(op.id)
        return
      }
      openIds.add(op.id)
      if (!details.querySelector('.op-body')) paintBody(details, op)
    })
    return details
  }

  /**
   * The path of the operation, with the variable parts apart.
   * @param {string} path The path as the catalog writes it.
   * @returns {HTMLElement}
   */
  function pathNode(path) {
    const node = h('span', { class: 'op-path' })
    for (const part of path.split(/(\{[a-zA-Z0-9_]+\})/g)) {
      if (!part) continue
      if (part.startsWith('{') && part.endsWith('}')) node.append(h('span', { class: 'var' }, part))
      else node.append(document.createTextNode(part))
    }
    return node
  }

  /**
   * The body of an operation: the description, the parameters, the fields of
   * the body, the example, the answers and the button that sends the call.
   * @param {HTMLElement} details The operation open on the screen.
   * @param {import('./core/operations.js').Operation} op The operation.
   */
  function paintBody(details, op) {
    const lang = getLang()
    const old = details.querySelector('.op-body')
    if (old) old.remove()

    const body = h('div', { class: 'op-body' })
    body.append(h('p', { class: 'op-desc' }, op.description?.[lang].replaceAll('`', '') ?? ''))

    if (op.params && op.params.length) {
      body.append(h('h4', {}, t('api.params')))
      body.append(paramsTable(op.params, lang))
    }

    if (op.fields && op.fields.length) {
      const heading = h('h4', {}, t('api.body'))
      if (op.contentType) heading.append(' ', h('code', { class: 'op-content-type' }, op.contentType))
      body.append(heading)
      body.append(fieldsTable(op.fields, lang))
    }

    if (op.request) {
      body.append(h('h4', {}, t('api.example')))
      body.append(codeBlock(curlOf(op.method, op.request, { origin })))
    }

    body.append(h('h4', {}, t('api.responses')))
    body.append(responses(op))

    if (op.request) {
      body.append(h('p', { class: 'op-hint' }, t('api.tryHint')))
      body.append(tryBlock(op))
    }

    details.append(body)
  }

  /**
   * The table of the parameters of an operation.
   * @param {import('./core/operations.js').Param[]} params The parameters.
   * @param {'pt' | 'en'} lang The language of the texts.
   * @returns {HTMLElement}
   */
  function paramsTable(params, lang) {
    const head = h('tr', {}, h('th', {}, t('api.name')), h('th', {}, t('api.where')), h('th', {}, t('api.type')), h('th', {}, t('api.description')))
    const rows = h('tbody')
    for (const param of params) {
      const name = h('td', {}, h('code', {}, param.name))
      if (param.required) name.append(' ', h('span', { class: 'req' }, t('api.required')))
      rows.append(
        h('tr', {}, name, h('td', {}, where(param.in)), h('td', {}, h('code', {}, param.type)), h('td', {}, param.description?.[lang].replaceAll('`', '') ?? '')),
      )
    }
    const table = h('table', { class: 'params' })
    table.append(h('thead', {}, head), rows)
    return table
  }

  /**
   * The table of the fields of the body of an operation.
   * @param {import('./core/operations.js').Field[]} fields The fields.
   * @param {'pt' | 'en'} lang The language of the texts.
   * @returns {HTMLElement}
   */
  function fieldsTable(fields, lang) {
    const head = h('tr', {}, h('th', {}, t('api.name')), h('th', {}, t('api.type')), h('th', {}, t('api.description')))
    const rows = h('tbody')
    for (const field of fields) {
      const name = h('td', {}, h('code', {}, field.name))
      if (field.required) name.append(' ', h('span', { class: 'req' }, t('api.required')))
      rows.append(h('tr', {}, name, h('td', {}, h('code', {}, field.type)), h('td', {}, field.description?.[lang].replaceAll('`', '') ?? '')))
    }
    const table = h('table', { class: 'params' })
    table.append(h('thead', {}, head), rows)
    return table
  }

  /**
   * Where a parameter travels, in the language of the panel.
   * @param {'path' | 'query' | 'header'} place Where the parameter travels.
   * @returns {string}
   */
  function where(place) {
    if (place === 'path') return t('api.inPath')
    if (place === 'query') return t('api.inQuery')
    if (place === 'header') return t('api.inHeader')
    return place
  }

  /**
   * The answers of an operation: a chip per answer and the text of the chosen
   * one.
   * @param {import('./core/operations.js').Operation} op The operation.
   * @returns {HTMLElement}
   */
  function responses(op) {
    const lang = getLang()
    const wrap = h('div', { class: 'op-responses' })
    const entries = op.responses ?? []

    /** Draws the chips again, with the answer chosen on the screen. */
    function paint() {
      const selected = selectedCases.get(op.id) ?? 0
      wrap.replaceChildren()
      const chips = h('div', { class: 'resp-chips' })
      entries.forEach((entry, index) => {
        const chip = h('button', {
          class: `chip ${isOk(entry.status) ? 'ok' : 'err'}`,
          type: 'button',
          'aria-pressed': index === selected ? 'true' : 'false',
        }, entry.status)
        chip.addEventListener('click', () => {
          selectedCases.set(op.id, index)
          paint()
        })
        chips.append(chip)
      })
      wrap.append(chips)
      const entry = entries[selected]
      if (entry) wrap.append(h('p', { class: 'resp-desc' }, entry.description?.[lang].replaceAll('`', '') ?? ''))
    }

    paint()
    return wrap
  }

  /**
   * Whether a status is a success.
   * @param {string} status The status of the answer.
   * @returns {boolean}
   */
  function isOk(status) {
    const code = Number(status)
    return code >= 200 && code < 300
  }

  /**
   * The example of the operation: the command, ready to paste in a terminal,
   * and the button that copies it.
   * @param {string} command The `curl` of the operation.
   * @returns {HTMLElement}
   */
  function codeBlock(command) {
    const copy = h('button', { class: 'copy', type: 'button' }, t('api.copy'))
    copy.addEventListener('click', () => {
      void copyCommand(command, copy)
    })
    return h('div', { class: 'code' }, h('pre', {}, command), copy)
  }

  /**
   * Copies a command to the clipboard and says it did.
   * @param {string} command The command to copy.
   * @param {HTMLElement} button The button that says it.
   */
  async function copyCommand(command, button) {
    try {
      await navigator.clipboard.writeText(command)
      button.textContent = t('api.copied')
      setTimeout(() => {
        button.textContent = t('api.copy')
      }, COPY_FEEDBACK_MS)
    } catch {
      // The clipboard is blocked: the command stays on the screen to be copied
      // by hand.
    }
  }

  /**
   * The button that sends the call for real, and the box that shows the answer.
   * @param {import('./core/operations.js').Operation} op The operation.
   * @returns {HTMLElement}
   */
  function tryBlock(op) {
    const wrap = h('div', { class: 'try-wrap' })
    const button = h('button', { class: 'try', type: 'button' }, t('api.try'))
    button.addEventListener('click', () => {
      void runTry(op, button, wrap)
    })
    wrap.append(button)
    return wrap
  }

  /**
   * Sends the call of the operation and shows the answer the mock gave.
   * @param {import('./core/operations.js').Operation} op The operation.
   * @param {HTMLElement} button The button that sends the call.
   * @param {HTMLElement} wrap The box that receives the answer.
   */
  async function runTry(op, button, wrap) {
    if (CONFIRM_FIRST.has(op.id) && !window.confirm(t('api.confirmLive'))) return
    const old = wrap.querySelector('.try-result')
    if (old) old.remove()
    button.disabled = true
    button.textContent = t('api.sending')
    try {
      wrap.append(await call(op))
    } catch (error) {
      const result = h('div', { class: 'try-result' })
      result.append(h('div', { class: 'try-status err' }, error instanceof Error ? error.message : String(error)))
      wrap.append(result)
    } finally {
      button.disabled = false
      button.textContent = t('api.try')
    }
  }

  /**
   * The call of the operation, sent to the mock: the answer of the server
   * with the body it sent.
   * @param {import('./core/operations.js').Operation} op The operation.
   * @returns {Promise<HTMLElement>} The box with the answer.
   */
  async function call(op) {
    const base = op.request
    if (!base) throw new Error('This operation has no request.')
    const entry = (op.responses ?? [])[selectedCases.get(op.id) ?? 0]
    const request = withOverride(base, entry ? entry.request : undefined)

    /** @type {string | undefined} */
    let messageId
    if (op.setup === 'message') messageId = await createMessage()

    const built = buildRequest(op.method, request, { origin, messageId })
    const response = await fetch(built.url, {
      method: built.method,
      headers: built.headers,
      body: built.body,
    })
    const text = await response.text()

    const result = h('div', { class: 'try-result' })
    result.append(h('div', { class: `try-status ${response.ok ? 'ok' : 'err'}` }, statusLine(response)))
    result.append(h('pre', { class: 'json' }, response.status === 204 || !text ? t('api.noBody') : prettyJson(text)))
    return result
  }

  /**
   * Creates the message the call needs, and gives its id.
   * @returns {Promise<string | undefined>} The id of the message.
   */
  async function createMessage() {
    const response = await fetch(`${origin}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to: TEST_TO, from: TEST_FROM, body: t('api.testBody') }),
    })
    const text = await response.text()
    if (!response.ok) throw new Error(messageOf(text) ?? `HTTP ${response.status}`)
    try {
      const data = JSON.parse(text)
      return typeof data.id === 'string' ? data.id : undefined
    } catch {
      return undefined
    }
  }

  /**
   * The message of an error the mock answered with.
   * @param {string} text The body of the answer.
   * @returns {string | undefined} The message, when the body carries one.
   */
  function messageOf(text) {
    try {
      const data = JSON.parse(text)
      const detail = /** @type {any} */ (data)
      const message = detail?.error?.message ?? detail?.message
      return typeof message === 'string' ? message : undefined
    } catch {
      return undefined
    }
  }

  /**
   * A body of the answer, indented when it is JSON.
   * @param {string} text The body the server sent.
   * @returns {string}
   */
  function prettyJson(text) {
    try {
      return JSON.stringify(JSON.parse(text), null, 2)
    } catch {
      return text
    }
  }

  /**
   * The reason phrase of a status.
   * @param {Response} response The answer of the server.
   * @returns {string}
   */
  function statusText(response) {
    const known = STATUS_TEXT[/** @type {keyof typeof STATUS_TEXT} */ (response.status)]
    return known ?? response.statusText
  }

  /**
   * The line of the answer: the status and its reason phrase.
   * @param {Response} response The answer of the server.
   * @returns {string}
   */
  function statusLine(response) {
    return [String(response.status), statusText(response)].filter(Boolean).join(' ')
  }

  /**
   * Scrolls an element into view, inside the panel when it scrolls.
   * @param {HTMLElement} element The element to show.
   */
  function scrollTo(element) {
    const scroller = container.closest('.tools-content')
    if (!scroller) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' })
      return
    }
    const top = scroller.scrollTop + element.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 16
    scroller.scrollTo({ top, behavior: 'smooth' })
  }

  /**
   * Scrolls to the operation the address bar names.
   */
  function scrollToHash() {
    const hash = location.hash
    if (!hash.startsWith('#op-')) return
    const element = document.getElementById(hash.slice(1))
    if (element) scrollTo(element)
  }

  /**
   * Writes the anchor in the address bar, without jumping to it.
   * @param {string} hash The anchor.
   */
  function setHash(hash) {
    try {
      history.replaceState(null, '', hash)
    } catch {
      // The address bar stays as it was: the scroll already happened.
    }
  }

  renderAll()

  return {
    update() {
      renderAll()
    },
  }
}
