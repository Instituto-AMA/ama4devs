// @ts-check
/**
 * The generator's API playground: build a call to a /v1 route, run it, read the
 * answer.
 *
 * Two places answer. "This page" runs the route here, with the very core the
 * container runs (published at generator/app/core/ by scripts/build-site.sh),
 * so the same seed gives the same body byte for byte. "Your container" sends
 * the call to a running generator (CORS is open on /v1).
 *
 * `answer` mirrors `generationRoute` in mocks/generator/src/app.ts: a change to
 * the server's routes or to the options it reads changes this file too.
 *
 * The form lives in the page's query string, so a call can be shared as a link.
 */
import { GeneratorError, KINDS, STATES, generate, isValidCnh, isValidCnpj, isValidCpf, isValidPis } from '../app/core/index.js'
import { enhanceDate, enhanceSelect } from './controls.js'

/** The documents the validation route knows (app.ts, VALIDATORS). */
const VALIDATORS = { cpf: isValidCpf, cnpj: isValidCnpj, cnh: isValidCnh, pis: isValidPis }

/** The options each kind reads, beyond `count` and `seed`. */
const KIND_OPTIONS = {
  person: ['state', 'gender', 'formatted', 'now'],
  company: ['state', 'formatted', 'now'],
  address: ['state', 'formatted'],
  cpf: [],
  cnpj: [],
  cnh: [],
  pis: [],
  rg: [],
  'credit-card': ['outcome', 'gender', 'now'],
  'bank-account': [],
  'pix-key': ['type'],
  charge: ['billingType', 'now'],
}

/** The query parameters of a generation, in the order the URL shows them. */
const PARAMS = ['count', 'seed', 'formatted', 'state', 'gender', 'outcome', 'billingType', 'type', 'now']

const TEXT = {
  en: {
    browser: 'answered by this page',
    container: 'answered by',
    unreachable: (base) =>
      `No answer from ${base}. Is the generator running (docker run -p 45450:45450 ghcr.io/instituto-ama/generator-mock)? Some browsers block a public page from calling localhost: switch to "This page", which runs the same core.`,
    copied: 'Copied',
    copy: 'Copy',
    calendar: { today: 'Today', clear: 'Clear', open: 'Pick a day', prev: 'Previous month', next: 'Next month' },
  },
  pt: {
    browser: 'respondido por esta página',
    container: 'respondido por',
    unreachable: (base) =>
      `Sem resposta de ${base}. O gerador está rodando (docker run -p 45450:45450 ghcr.io/instituto-ama/generator-mock)? Alguns navegadores bloqueiam uma página pública chamando localhost: troque para "Esta página", que roda o mesmo core.`,
    copied: 'Copiado',
    copy: 'Copiar',
    calendar: { today: 'Hoje', clear: 'Limpar', open: 'Escolher um dia', prev: 'Mês anterior', next: 'Próximo mês' },
  },
}

/** Portuguese labels used only by the localized interface. */
const PRESENTATION_LABELS = {
  person: 'Pessoa',
  company: 'Empresa',
  address: 'Endereço',
  'credit-card': 'Cartão de crédito',
  'bank-account': 'Conta bancária',
  'pix-key': 'Chave Pix',
  charge: 'Cobrança',
}

/**
 * The answer of a /v1 route, as the server gives it.
 * @param {string} pathname
 * @param {URLSearchParams} params
 * @returns {{ status: number, body: any }}
 */
export function answer(pathname, params) {
  if (pathname === '/v1/kinds') {
    return { status: 200, body: { kinds: KINDS.map(({ id, label }) => ({ id, label })) } }
  }

  const validate = /^\/v1\/validate\/([^/]+)\/([^/]+)$/.exec(pathname)
  if (validate) {
    const type = validate[1].toLowerCase()
    const value = validate[2]
    const validator = VALIDATORS[type]
    if (!validator) {
      return { status: 400, body: { error: { code: 'unknown_type', message: `Unknown document type: ${type}` } } }
    }
    return { status: 200, body: { type, value, valid: validator(value) } }
  }

  const kind = /^\/v1\/([^/]+)$/.exec(pathname)
  if (kind) {
    try {
      return { status: 200, body: generate(kind[1], optionsOf(params)) }
    } catch (error) {
      if (error instanceof GeneratorError) {
        return { status: 400, body: { error: { code: error.code, message: error.message } } }
      }
      const message = error instanceof Error ? error.message : String(error)
      return { status: 400, body: { error: { code: 'invalid_request', message } } }
    }
  }

  return { status: 404, body: { error: { code: 'not_found', message: 'Route not found.' } } }
}

/**
 * The options of a generation, read from the query string (app.ts, optionsOf).
 * @param {URLSearchParams} params
 */
function optionsOf(params) {
  /** @type {Record<string, any>} */
  const options = {}
  if (params.has('count')) options.count = params.get('count') ?? undefined
  if (params.has('seed')) options.seed = params.get('seed') ?? undefined
  if (params.has('formatted')) {
    const value = params.get('formatted')
    options.formatted = value === 'true' || value === '1'
  }
  if (params.has('state')) options.state = String(params.get('state')).toUpperCase()
  if (params.has('gender')) options.gender = params.get('gender')
  if (params.has('outcome')) options.outcome = params.get('outcome')
  if (params.has('billingType')) options.billingType = params.get('billingType')
  if (params.has('type')) options.type = params.get('type')
  if (params.has('now')) options.now = params.get('now')
  return options
}

/**
 * Starts the playground on a form marked `data-playground`.
 * @param {HTMLFormElement} form
 */
function start(form) {
  const t = TEXT[document.documentElement.lang.startsWith('pt') ? 'pt' : 'en']
  const $ = (/** @type {string} */ name) => /** @type {any} */ (form.elements.namedItem(name))
  const out = /** @type {HTMLElement} */ (document.querySelector('[data-playground-out]'))
  const line = /** @type {HTMLElement} */ (out.querySelector('[data-line]'))
  const curl = /** @type {HTMLElement} */ (out.querySelector('[data-curl]'))
  const status = /** @type {HTMLElement} */ (out.querySelector('[data-status]'))
  const body = /** @type {HTMLElement} */ (out.querySelector('[data-body]'))
  const copy = /** @type {HTMLButtonElement} */ (out.querySelector('[data-copy]'))
  const keep = /** @type {HTMLButtonElement} */ (out.querySelector('[data-keep-seed]'))

  const kinds = $('kind')
  for (const { id, label } of KINDS) {
    const shown = document.documentElement.lang.startsWith('pt') ? PRESENTATION_LABELS[id] ?? label : label
    kinds.append(new Option(`${id} · ${shown}`, id))
  }
  const states = $('state')
  for (const [code, name] of Object.entries(STATES)) states.append(new Option(`${code} · ${name}`, code))

  // The page's own query string fills the form: a shared link replays its call.
  const shared = new URLSearchParams(location.search)
  for (const [key, value] of shared) {
    const field = $(key)
    if (!field) continue
    if (field.type === 'checkbox') field.checked = value === 'true' || value === '1'
    else if (field instanceof RadioNodeList) field.value = value
    else field.value = value
  }

  // The receipt-style controls take over once the values are in place.
  for (const select of form.querySelectorAll('select[data-picker]')) enhanceSelect(/** @type {HTMLSelectElement} */ (select))
  for (const input of form.querySelectorAll('input[data-date]')) enhanceDate(/** @type {HTMLInputElement} */ (input), t.calendar)

  /** The route the form describes, and its query string. */
  function request() {
    const route = $('route').value
    const params = new URLSearchParams()
    if (route === 'kinds') return { path: '/v1/kinds', params }
    if (route === 'validate') {
      const value = String($('value').value).trim()
      return { path: `/v1/validate/${encodeURIComponent($('doc').value)}/${encodeURIComponent(value || '-')}`, params }
    }
    const kind = $('kind').value
    const reads = KIND_OPTIONS[kind] ?? []
    if ($('count').value) params.set('count', $('count').value)
    if ($('seed').value.trim()) params.set('seed', $('seed').value.trim())
    for (const name of PARAMS.slice(2)) {
      if (!reads.includes(name)) continue
      const field = $(name)
      if (field.type === 'checkbox') {
        if (field.checked) params.set(name, 'true')
      } else if (field.value) params.set(name, field.value)
    }
    return { path: `/v1/${kind}`, params }
  }

  /** Shows only the fields the chosen route and kind read. */
  function shape() {
    const route = $('route').value
    const reads = KIND_OPTIONS[$('kind').value] ?? []
    for (const el of form.querySelectorAll('[data-for]')) {
      const field = /** @type {HTMLElement} */ (el)
      const [forRoute, option] = (field.dataset.for ?? '').split(':')
      field.hidden = forRoute !== route || (option !== undefined && !reads.includes(option))
    }
    const base = /** @type {HTMLElement} */ (form.querySelector('[data-base]'))
    base.hidden = $('target').value !== 'container'
    preview()
  }

  /** Prints the call the form will make, and keeps it in the page's URL. */
  function preview() {
    const { path, params } = request()
    const query = params.toString()
    const base = String($('base').value).replace(/\/+$/, '') || 'http://localhost:45450'
    line.textContent = `GET ${path}${query ? `?${query}` : ''}`
    curl.textContent = `curl '${base}${path}${query ? `?${query}` : ''}'`

    const page = new URLSearchParams()
    for (const name of ['route', 'kind', 'doc', 'value', 'target', 'base', ...PARAMS]) {
      const field = $(name)
      if (!field) continue
      if (field.type === 'checkbox') {
        if (field.checked) page.set(name, 'true')
      } else if (field.value && !(name === 'base' && field.value === 'http://localhost:45450')) page.set(name, field.value)
    }
    history.replaceState(null, '', `${location.pathname}?${page}`)
  }

  /** Runs the call and prints its answer. */
  async function run() {
    const { path, params } = request()
    const base = String($('base').value).replace(/\/+$/, '') || 'http://localhost:45450'
    const remote = $('target').value === 'container'
    const began = performance.now()
    status.className = 'chip'
    status.textContent = '…'
    keep.hidden = true

    /** @type {{ status: number, body: any } | null} */
    let result = null
    if (remote) {
      try {
        const query = params.toString()
        const res = await fetch(`${base}${path}${query ? `?${query}` : ''}`, { signal: AbortSignal.timeout(5000) })
        result = { status: res.status, body: await res.json() }
      } catch {
        status.className = 'chip err'
        status.textContent = 'network error'
        body.textContent = t.unreachable(base)
        return
      }
    } else {
      result = answer(path, params)
    }

    const ms = Math.max(1, Math.round(performance.now() - began))
    status.className = `chip ${result.status < 400 ? 'ok' : 'err'}`
    status.textContent = `${result.status} · ${ms} ms · ${remote ? `${t.container} ${base}` : t.browser}`
    body.textContent = JSON.stringify(result.body, null, 2)

    // A random seed is the answer's: offer to keep it, so the call repeats.
    const seed = result.body?.seed
    if (seed && !$('seed').value.trim()) {
      keep.hidden = false
      keep.dataset.seed = seed
    }
  }

  form.addEventListener('input', shape)
  form.addEventListener('change', shape)
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    void run()
  })
  keep.addEventListener('click', () => {
    $('seed').value = keep.dataset.seed ?? ''
    keep.hidden = true
    preview()
  })
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(curl.textContent ?? '')
      copy.textContent = t.copied
      setTimeout(() => (copy.textContent = t.copy), 1500)
    } catch {
      // No clipboard (an insecure context): the command stays on screen to select.
    }
  })

  shape()
  void run()
}

// Outside a browser (a test importing `answer`) there is no form to start.
if (typeof document !== 'undefined') {
  const form = document.querySelector('form[data-playground]')
  if (form instanceof HTMLFormElement) start(form)
}
