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
import { GeneratorError, KINDS, STATES, createRng, generate, isValidCnh, isValidCnpj, isValidCpf, isValidPis } from '../app/core/index.js'
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

/**
 * The generator's public endpoint: static answers on GitHub Pages, written at
 * build time by scripts/build-generator-api.mjs (keep both in step). One file
 * per kind and seed, each the container's answer for COUNT items on NOW.
 */
const PUBLIC = { count: 10, now: '2026-01-01', seeds: 100, formatted: ['person', 'company', 'address'] }
const PUBLIC_BASE = new URL('../api/v1/', import.meta.url).href
/** The files of the public endpoint already read, by URL. */
/** @type {Map<string, Promise<any>>} */
const publicFiles = new Map()

/** A file of the public endpoint, read once. */
function readPublic(/** @type {string} */ url) {
  if (!publicFiles.has(url)) {
    const read = fetch(url, { signal: AbortSignal.timeout(8000) }).then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`)
      return res.json()
    })
    read.catch(() => publicFiles.delete(url))
    publicFiles.set(url, read)
  }
  return /** @type {Promise<any>} */ (publicFiles.get(url))
}

/**
 * Any seed and count from the public endpoint's files: the seed draws, for each
 * item, a file and a place in it, always the same ones for the same seed.
 * @param {string} kind
 * @param {string} seed
 * @param {number} count
 * @param {boolean} formatted
 */
export function publicMix(kind, seed, count, formatted) {
  const rng = createRng(`public:${kind}:${seed}`)
  const suffix = formatted ? '-formatted' : ''
  const picks = Array.from({ length: count }, () => ({ file: rng.int(1, PUBLIC.seeds), at: rng.int(0, PUBLIC.count - 1) }))
  const files = [...new Set(picks.map((p) => p.file))].map((n) => ({ n, path: `${kind}/${n}${suffix}.json` }))
  return { picks, files, suffix }
}

/** The options a static file cannot vary: hidden while the public endpoint answers. */
const NOT_PUBLIC = ['state', 'gender', 'outcome', 'billingType', 'type', 'now']

/** The query parameters of a generation, in the order the URL shows them. */
const PARAMS = ['count', 'seed', 'formatted', 'state', 'gender', 'outcome', 'billingType', 'type', 'now']

const TEXT = {
  en: {
    browser: 'answered by this page',
    container: 'answered by',
    public: 'answered by the public endpoint',
    mixed: (n) => `mixed by the seed from ${n} files of the public endpoint`,
    curlPublic: 'Call the public endpoint',
    notInFiles: 'not among the documents of the public files: validated in this page instead',
    curlContainer: 'The same call on your container',
    unreachable: (base) =>
      `No answer from ${base}. Is the generator running (docker run --rm -p 45450:45450 ghcr.io/instituto-ama/generator-mock:latest)? Some browsers block a public page from calling localhost: switch to "This page", which runs the same core.`,
    calendar: { today: 'Today', clear: 'Clear', open: 'Pick a day', prev: 'Previous month', next: 'Next month' },
  },
  pt: {
    browser: 'respondido por esta página',
    container: 'respondido por',
    public: 'respondido pelo endpoint público',
    mixed: (n) => `misturado pela seed a partir de ${n} arquivos do endpoint público`,
    curlPublic: 'Chame o endpoint público',
    notInFiles: 'fora dos documentos dos arquivos públicos: validado nesta página',
    curlContainer: 'A mesma chamada no seu container',
    unreachable: (base) =>
      `Sem resposta de ${base}. O gerador está rodando (docker run --rm -p 45450:45450 ghcr.io/instituto-ama/generator-mock:latest)? Alguns navegadores bloqueiam uma página pública chamando localhost: troque para "Esta página", que roda o mesmo core.`,
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
  const link = /** @type {HTMLElement} */ (out.querySelector('[data-link]'))
  const keep = /** @type {HTMLButtonElement} */ (out.querySelector('[data-keep-seed]'))
  const curlTitle = /** @type {HTMLElement} */ (out.querySelector('[data-curl-title]'))
  const curlHint = /** @type {HTMLElement} */ (out.querySelector('[data-curl-hint]'))

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

  /**
   * How the public endpoint answers the form's call: one file to curl (a seed
   * from 1 to PUBLIC.seeds with PUBLIC.count items), a mix of its files drawn by
   * any other seed or count, or why it cannot.
   * @param {string} seed
   * `url` is the file read, `address` the short one a person types (Pages
   * answers it from the file's .html twin): no seed is <kind>, a seed <kind>/<n>.
   * @returns {{ url: string, address: string, validate?: boolean } | { mix: ReturnType<typeof publicMix>, kind: string, seed: string, count: number } | { error: string }}
   */
  function publicPlan(seed) {
    const route = $('route').value
    if (route === 'kinds') return { url: `${PUBLIC_BASE}kinds.json`, address: `${PUBLIC_BASE}kinds` }
    if (route === 'validate') {
      const value = String($('value').value).replace(/\D/g, '')
      const file = `validate/${$('doc').value}/${value || '0'}`
      return { url: `${PUBLIC_BASE}${file}.json`, address: `${PUBLIC_BASE}${file}`, validate: true }
    }
    const kind = $('kind').value
    const count = Math.min(1000, Math.max(1, Math.trunc(Number($('count').value)) || 1))
    const formatted = $('formatted').checked && PUBLIC.formatted.includes(kind)
    const n = Number(seed || '1')
    if (/^\d*$/.test(seed) && n >= 1 && n <= PUBLIC.seeds && count === PUBLIC.count) {
      const file = `${kind}/${n}${formatted ? '-formatted' : ''}`
      return { url: `${PUBLIC_BASE}${file}.json`, address: !seed && !formatted ? `${PUBLIC_BASE}${kind}` : `${PUBLIC_BASE}${file}` }
    }
    return { mix: publicMix(kind, seed, count, formatted), kind, seed, count }
  }

  /** Shows only the fields the chosen route and kind read. */
  function shape() {
    const route = $('route').value
    const reads = KIND_OPTIONS[$('kind').value] ?? []
    const isPublic = $('target').value === 'public'
    for (const el of form.querySelectorAll('[data-for]')) {
      const field = /** @type {HTMLElement} */ (el)
      const [forRoute, option] = (field.dataset.for ?? '').split(':')
      field.hidden =
        forRoute !== route ||
        (option !== undefined && !reads.includes(option)) ||
        (isPublic && option !== undefined && NOT_PUBLIC.includes(option))
    }
    const note = /** @type {HTMLElement} */ (form.querySelector('[data-public-note]'))
    note.hidden = !isPublic || route !== 'kind'
    $('seed').placeholder = isPublic ? `1–${PUBLIC.seeds}` : $('seed').dataset.placeholder ?? ''
    const base = /** @type {HTMLElement} */ (form.querySelector('[data-base]'))
    base.hidden = $('target').value !== 'container'
    preview()
  }

  /** Prints the call the form will make, and keeps it in the page's URL. */
  function preview() {
    const { path, params } = request()
    const query = params.toString()
    const base = String($('base').value).replace(/\/+$/, '') || 'http://localhost:45450'
    const target = $('target').value
    if (target === 'public') {
      const seed = String($('seed').value).trim()
      const plan = publicPlan(seed)
      curlTitle.textContent = t.curlPublic
      curlHint.hidden = true
      if ('error' in plan) {
        line.textContent = `GET ${PUBLIC_BASE}`
        curl.textContent = plan.error
      } else if ('url' in plan) {
        line.textContent = `GET ${plan.address}`
        curl.textContent = `curl ${plan.address}`
      } else if ('mix' in plan) {
        const files = plan.mix.files
        line.textContent = `GET ${plan.count} × ${plan.kind} · ${t.mixed(files.length)}`
        curl.textContent = files
          .slice(0, 3)
          .map((f) => `curl '${PUBLIC_BASE}${f.path}'`)
          .concat(files.length > 3 ? [`# … +${files.length - 3}`] : [])
          .join('\n')
      }
    } else {
      line.textContent = `GET ${path}${query ? `?${query}` : ''}`
      curl.textContent = `curl '${base}${path}${query ? `?${query}` : ''}'`
      curlTitle.textContent = t.curlContainer
      curlHint.hidden = false
    }

    // The page's own address replays the call: only what the call is made of,
    // defaults left out (generate, the public endpoint, the usual base).
    const page = new URLSearchParams()
    const route = $('route').value
    if (route !== 'kind') page.set('route', route)
    if (route === 'kind') {
      page.set('kind', $('kind').value)
      if (target === 'public') {
        if (String($('seed').value).trim()) page.set('seed', String($('seed').value).trim())
        if (Number($('count').value) !== PUBLIC.count) page.set('count', String($('count').value))
        if ($('formatted').checked && PUBLIC.formatted.includes($('kind').value)) page.set('formatted', 'true')
      } else {
        for (const [key, value] of params) page.set(key, value)
      }
    }
    if (route === 'validate') {
      page.set('doc', $('doc').value)
      page.set('value', String($('value').value).trim())
    }
    if (target !== 'public') page.set('target', target)
    if (target === 'container' && base !== 'http://localhost:45450') page.set('base', base)
    const shared = page.toString()
    history.replaceState(null, '', `${location.pathname}${shared ? `?${shared}` : ''}`)
    link.textContent = location.href
  }

  /** Runs the call and prints its answer. */
  async function run() {
    const { path, params } = request()
    const base = String($('base').value).replace(/\/+$/, '') || 'http://localhost:45450'
    const target = $('target').value
    const remote = target === 'container'
    const began = performance.now()
    status.className = 'chip'
    status.textContent = '…'
    keep.hidden = true

    /** @type {{ status: number, body: any } | null} */
    let result = null
    /** Answered by this page even in the public endpoint's mode (validation). */
    let inPage = false
    if (target === 'public') {
      const plan = publicPlan(String($('seed').value).trim())
      if ('error' in plan) {
        status.className = 'chip err'
        status.textContent = t.public
        body.textContent = plan.error
        return
      }
      try {
        if ('url' in plan) {
          try {
            result = { status: 200, body: await readPublic(plan.url) }
          } catch (error) {
            // The static endpoint validates the documents its files hold; any
            // other one is checked here, by the same core.
            if (!plan.validate) throw error
            result = answer(path, params)
            inPage = true
            curl.textContent += `\n# ${t.notInFiles}`
          }
        } else {
          const { picks, files } = plan.mix
          const read = await Promise.all(files.map((f) => readPublic(`${PUBLIC_BASE}${f.path}`)))
          const byFile = new Map(files.map((f, i) => [f.n, read[i]]))
          result = {
            status: 200,
            body: {
              kind: plan.kind,
              seed: plan.seed,
              count: plan.count,
              items: picks.map((p) => byFile.get(p.file).items[p.at]),
              from: picks.map((p) => `${plan.kind}/${p.file}${plan.mix.suffix}.json#${p.at}`),
            },
          }
        }
      } catch (error) {
        status.className = 'chip err'
        status.textContent = 'network error'
        body.textContent = error instanceof Error ? error.message : String(error)
        return
      }
    } else if (remote) {
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
    status.textContent = `${result.status} · ${ms} ms · ${inPage ? t.browser : target === 'public' ? t.public : remote ? `${t.container} ${base}` : t.browser}`
    body.textContent = JSON.stringify(result.body, null, 2)

    // A random seed is the answer's: offer to keep it, so the call repeats.
    const seed = result.body?.seed
    if (seed && !$('seed').value.trim() && target !== 'public') {
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

  shape()
  void run()
}

// Outside a browser (a test importing `answer`) there is no form to start.
if (typeof document !== 'undefined') {
  const form = document.querySelector('form[data-playground]')
  if (form instanceof HTMLFormElement) start(form)
}
