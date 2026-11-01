// @ts-check
/**
 * Developer UI for the fake data generator.
 * Runs in the browser on both Docker container (port 45450) and GitHub Pages.
 */

import {
  KINDS,
  generate,
  randomSeed,
  STATES,
  isValidCpf,
  isValidCnpj,
  isValidCnh,
  isValidPis,
} from './core/index.js'
import { chipsFor } from './chips.js'

/** Portuguese labels used only by the Portuguese interface. */
const PRESENTATION_LABELS = {
  person: 'Pessoa',
  company: 'Empresa',
  address: 'Endereço',
  'credit-card': 'Cartão de crédito',
  'bank-account': 'Conta bancária',
  'pix-key': 'Chave Pix',
  charge: 'Cobrança',
}

/** @type {{ kind: string, seed: string, count: number, items: any[] } | null} */
let lastResult = null

// ───────── DOM Elements ─────────

const modeChip = /** @type {HTMLElement} */ (document.getElementById('mode-chip'))
const modeText = /** @type {HTMLElement} */ (document.getElementById('mode-text'))

const genKind = /** @type {HTMLSelectElement} */ (document.getElementById('gen-kind'))
const genCount = /** @type {HTMLInputElement} */ (document.getElementById('gen-count'))
const genSeed = /** @type {HTMLInputElement} */ (document.getElementById('gen-seed'))
const genState = /** @type {HTMLSelectElement} */ (document.getElementById('gen-state'))
const genFormatted = /** @type {HTMLInputElement} */ (document.getElementById('gen-formatted'))
const btnNewSeed = /** @type {HTMLButtonElement} */ (document.getElementById('btn-new-seed'))
const btnGenerate = /** @type {HTMLButtonElement} */ (document.getElementById('btn-generate'))
const genError = /** @type {HTMLElement} */ (document.getElementById('gen-error'))

/** The options read by some kinds only; `data-for` lists the kinds. */
const kindOptions = /** @type {HTMLElement[]} */ ([...document.querySelectorAll('.kind-opt')])

const tabBtnTable = /** @type {HTMLButtonElement} */ (document.getElementById('tab-btn-table'))
const tabBtnJson = /** @type {HTMLButtonElement} */ (document.getElementById('tab-btn-json'))
const paneTable = /** @type {HTMLElement} */ (document.getElementById('pane-table'))
const paneJson = /** @type {HTMLElement} */ (document.getElementById('pane-json'))

const resultThead = /** @type {HTMLElement} */ (document.getElementById('result-thead'))
const resultTbody = /** @type {HTMLElement} */ (document.getElementById('result-tbody'))
const resultJson = /** @type {HTMLElement} */ (document.getElementById('result-json'))

const btnCopyJson = /** @type {HTMLButtonElement} */ (document.getElementById('btn-copy-json'))
const btnCopyCsv = /** @type {HTMLButtonElement} */ (document.getElementById('btn-copy-csv'))
const btnDownloadJson = /** @type {HTMLButtonElement} */ (document.getElementById('btn-download-json'))
const btnDownloadCsv = /** @type {HTMLButtonElement} */ (document.getElementById('btn-download-csv'))

const metaSeed = /** @type {HTMLElement} */ (document.getElementById('meta-seed'))
const metaCurl = /** @type {HTMLElement} */ (document.getElementById('meta-curl'))
const btnCopyCurl = /** @type {HTMLButtonElement} */ (document.getElementById('btn-copy-curl'))

const valInput = /** @type {HTMLInputElement} */ (document.getElementById('val-input'))
const valOutput = /** @type {HTMLElement} */ (document.getElementById('val-output'))

const toast = /** @type {HTMLElement} */ (document.getElementById('toast'))

// ───────── Toast Feedback ─────────

/** @type {ReturnType<typeof setTimeout> | null} */
let toastTimer = null

/**
 * Shows accessible toast notification.
 * @param {string} msg
 */
function showToast(msg = 'Copiado') {
  if (toastTimer) clearTimeout(toastTimer)
  toast.textContent = msg
  toast.classList.add('is-shown')
  toastTimer = setTimeout(() => {
    toast.classList.remove('is-shown')
    toastTimer = null
  }, 1800)
}

/**
 * Copies text to clipboard with toast notification.
 * @param {string} text
 * @param {string} [label]
 */
async function copyToClipboard(text, label = 'Copiado') {
  try {
    await navigator.clipboard.writeText(text)
    showToast(label)
  } catch {
    // Fallback if clipboard API is restricted
    const el = document.createElement('textarea')
    el.value = text
    document.body.appendChild(el)
    el.select()
    document.execCommand('copy')
    document.body.removeChild(el)
    showToast(label)
  }
}

// ───────── Mode Detection ─────────

/**
 * Checks whether the app is served from the Docker container or GitHub Pages.
 * @returns {Promise<'container' | 'pages'>}
 */
async function detectMode() {
  try {
    const res = await fetch('./health', { cache: 'no-store' })
    if (res.ok) {
      const data = await res.json()
      if (data && data.service === 'generator') {
        return 'container'
      }
    }
  } catch {
    // network error or static pages
  }
  return 'pages'
}

// ───────── Table Column Definitions ─────────

/**
 * @typedef {object} ColumnDef
 * @property {string} header
 * @property {(item: any) => string} get
 */

/** @type {Record<string, ColumnDef[]>} */
const KIND_COLUMNS = {
  person: [
    { header: 'Nome', get: (item) => item.name || '' },
    { header: 'CPF', get: (item) => item.cpf || '' },
    { header: 'Nascimento', get: (item) => item.birthDate || '' },
    { header: 'E-mail', get: (item) => item.email || '' },
    { header: 'Celular', get: (item) => item.mobilePhone || '' },
    { header: 'Cidade/UF', get: (item) => (item.address ? `${item.address.city}/${item.address.state}` : '') },
  ],
  company: [
    { header: 'Nome Fantasia', get: (item) => item.tradeName || '' },
    { header: 'CNPJ', get: (item) => item.cnpj || '' },
    { header: 'Atividade', get: (item) => item.activity?.description || '' },
    { header: 'E-mail', get: (item) => item.email || '' },
    { header: 'Telefone', get: (item) => item.phone || '' },
    { header: 'Cidade/UF', get: (item) => (item.address ? `${item.address.city}/${item.address.state}` : '') },
  ],
  address: [
    { header: 'CEP', get: (item) => item.postalCode || '' },
    { header: 'Logradouro', get: (item) => item.street || '' },
    { header: 'Número', get: (item) => item.number || '' },
    { header: 'Bairro', get: (item) => item.district || '' },
    { header: 'Cidade', get: (item) => item.city || '' },
    { header: 'UF', get: (item) => item.state || '' },
  ],
  cpf: [
    { header: 'Valor', get: (item) => item.value || '' },
    { header: 'Formatado', get: (item) => item.formatted || '' },
  ],
  cnpj: [
    { header: 'Valor', get: (item) => item.value || '' },
    { header: 'Formatado', get: (item) => item.formatted || '' },
  ],
  cnh: [
    { header: 'Valor', get: (item) => item.value || '' },
    { header: 'Formatado', get: (item) => item.formatted || '' },
  ],
  pis: [
    { header: 'Valor', get: (item) => item.value || '' },
    { header: 'Formatado', get: (item) => item.formatted || '' },
  ],
  rg: [
    { header: 'Valor', get: (item) => item.value || '' },
    { header: 'Formatado', get: (item) => item.formatted || '' },
  ],
  'credit-card': [
    { header: 'Número', get: (item) => item.number || '' },
    { header: 'Bandeira', get: (item) => item.brand || '' },
    { header: 'Titular', get: (item) => item.holderName || '' },
    { header: 'Validade', get: (item) => `${item.expiryMonth}/${item.expiryYear}` },
    { header: 'CCV', get: (item) => item.ccv || '' },
    { header: 'Resultado', get: (item) => item.outcome || '' },
  ],
  'bank-account': [
    { header: 'Banco', get: (item) => (item.bank ? `${item.bank.code} - ${item.bank.name}` : '') },
    { header: 'Agência', get: (item) => (item.agencyDigit ? `${item.agency}-${item.agencyDigit}` : item.agency || '') },
    { header: 'Conta', get: (item) => `${item.account}-${item.accountDigit}` },
    { header: 'Tipo', get: (item) => item.type || '' },
  ],
  'pix-key': [
    { header: 'Tipo', get: (item) => item.type || '' },
    { header: 'Chave', get: (item) => item.key || '' },
  ],
  charge: [
    { header: 'Forma', get: (item) => item.billingType || '' },
    {
      header: 'Valor',
      get: (item) =>
        typeof item.value === 'number'
          ? item.value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
          : String(item.value || ''),
    },
    { header: 'Vencimento', get: (item) => item.dueDate || '' },
    { header: 'Descrição', get: (item) => item.description || '' },
  ],
}

// ───────── CSV & JSON Helpers ─────────

/**
 * Recursively flattens an object to dotted keys.
 * @param {Record<string, any>} obj
 * @param {string} [prefix]
 * @returns {Record<string, any>}
 */
function flattenObject(obj, prefix = '') {
  /** @type {Record<string, any>} */
  const res = {}
  for (const [key, val] of Object.entries(obj)) {
    const prop = prefix ? `${prefix}.${key}` : key
    if (val !== null && typeof val === 'object' && !Array.isArray(val) && !(val instanceof Date)) {
      Object.assign(res, flattenObject(val, prop))
    } else if (Array.isArray(val)) {
      res[prop] = JSON.stringify(val)
    } else {
      res[prop] = val
    }
  }
  return res
}

/**
 * Builds CSV content with dotted keys, header row, `;` separator and quoted values.
 * @param {any[]} items
 * @returns {string}
 */
function itemsToCsv(items) {
  if (!items || items.length === 0) return ''
  const flatItems = items.map((it) => flattenObject(it))

  // Collect all unique keys in order of appearance
  const keySet = new Set()
  for (const flat of flatItems) {
    for (const k of Object.keys(flat)) {
      keySet.add(k)
    }
  }
  const keys = Array.from(keySet)

  const headerRow = keys.map((k) => `"${String(k).replace(/"/g, '""')}"`).join(';')
  const rows = flatItems.map((flat) =>
    keys
      .map((k) => {
        const val = flat[k] !== undefined && flat[k] !== null ? String(flat[k]) : ''
        return `"${val.replace(/"/g, '""')}"`
      })
      .join(';')
  )

  return [headerRow, ...rows].join('\r\n')
}

/**
 * Downloads a string as a file using Blob.
 * @param {string} content
 * @param {string} filename
 * @param {string} mimeType
 */
function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ───────── Generator Execution ─────────

/**
 * Updates visibility of kind-specific option fields.
 */
function updateKindOptions() {
  const kind = genKind.value
  for (const option of kindOptions) option.hidden = !(option.dataset.for ?? '').split(' ').includes(kind)
}

/**
 * Whether the chosen kind reads an option.
 * @param {string} id the id of the option's field
 */
function kindReads(id) {
  return !(/** @type {HTMLElement} */ (document.getElementById(id)).hidden)
}

/**
 * Reads form, executes generator, updates UI views and cURL meta line.
 */
function runGenerate() {
  genError.textContent = ''
  genError.classList.remove('is-visible')

  const kind = genKind.value
  const count = Math.min(1000, Math.max(1, parseInt(genCount.value, 10) || 10))
  const seed = genSeed.value.trim() || randomSeed()
  const formatted = genFormatted.checked
  const state = kindReads('opt-state') ? genState.value || undefined : undefined

  /** @type {Record<string, any>} */
  const opts = { count, seed, formatted }
  if (state) opts.state = state

  if (kind === 'person') {
    const gender = /** @type {HTMLSelectElement} */ (document.getElementById('gen-gender')).value
    if (gender) opts.gender = gender
  } else if (kind === 'credit-card') {
    const outcome = /** @type {HTMLSelectElement} */ (document.getElementById('gen-outcome')).value
    if (outcome) opts.outcome = outcome
  } else if (kind === 'charge') {
    const billingType = /** @type {HTMLSelectElement} */ (document.getElementById('gen-billing')).value
    if (billingType) opts.billingType = billingType
  } else if (kind === 'pix-key') {
    const type = /** @type {HTMLSelectElement} */ (document.getElementById('gen-pix-type')).value
    if (type) opts.type = type
  }

  try {
    const result = generate(kind, opts)
    lastResult = result

    // Render table
    const columns = KIND_COLUMNS[kind] || [{ header: 'Dados', get: (it) => JSON.stringify(it) }]
    resultThead.innerHTML = `<tr>${columns.map((c) => `<th>${c.header}</th>`).join('')}</tr>`

    resultTbody.innerHTML = ''
    for (const item of result.items) {
      const tr = document.createElement('tr')
      for (const col of columns) {
        const td = document.createElement('td')
        const val = col.get(item)
        td.textContent = val
        td.className = 'copyable'
        td.title = 'Clique para copiar'
        td.addEventListener('click', () => {
          copyToClipboard(val, `Copiado: ${val}`)
        })
        tr.appendChild(td)
      }
      resultTbody.appendChild(tr)
    }

    // Render JSON
    resultJson.textContent = JSON.stringify(result.items, null, 2)

    // Render meta & cURL line
    metaSeed.textContent = result.seed

    const queryParams = new URLSearchParams()
    queryParams.set('count', String(result.count))
    queryParams.set('seed', result.seed)
    if (formatted) queryParams.set('formatted', 'true')
    if (opts.state) queryParams.set('state', opts.state)
    if (opts.gender) queryParams.set('gender', opts.gender)
    if (opts.outcome) queryParams.set('outcome', opts.outcome)
    if (opts.billingType) queryParams.set('billingType', opts.billingType)
    if (opts.type) queryParams.set('type', opts.type)

    metaCurl.textContent = `curl 'http://localhost:45450/v1/${kind}?${queryParams.toString()}'`
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    genError.textContent = msg
    genError.classList.add('is-visible')
  }
}

// ───────── Validator Execution ─────────

/**
 * Validates document input as the user types.
 */
function runValidator() {
  const raw = valInput.value.trim()
  const digits = raw.replace(/\D/g, '')

  valOutput.innerHTML = ''

  if (digits.length === 0) {
    valOutput.innerHTML = '<span class="val-hint">Digite para validar</span>'
    return
  }

  if (digits.length === 11) {
    const validCpf = isValidCpf(digits)
    const validCnh = isValidCnh(digits)
    const validPis = isValidPis(digits)

    valOutput.innerHTML = `
      <span class="val-badge ${validCpf ? 'is-valid' : 'is-invalid'}">
        CPF: ${validCpf ? '✓ válido' : '✗ inválido'}
      </span>
      <span class="val-badge ${validCnh ? 'is-valid' : 'is-invalid'}">
        CNH: ${validCnh ? '✓ válido' : '✗ inválido'}
      </span>
      <span class="val-badge ${validPis ? 'is-valid' : 'is-invalid'}">
        PIS: ${validPis ? '✓ válido' : '✗ inválido'}
      </span>
    `
    return
  }

  if (digits.length === 14) {
    const validCnpj = isValidCnpj(digits)
    valOutput.innerHTML = `
      <span class="val-badge ${validCnpj ? 'is-valid' : 'is-invalid'}">
        CNPJ: ${validCnpj ? '✓ válido' : '✗ inválido'}
      </span>
    `
    return
  }

  valOutput.innerHTML = `
    <span class="val-hint">
      Aguardando dígitos: ${digits.length}/11 (CPF, CNH, PIS) ou ${digits.length}/14 (CNPJ)
    </span>
  `
}

// ───────── Initialization ─────────

async function init() {
  // Populate kinds select
  genKind.innerHTML = KINDS.map((k) => `<option value="${k.id}">${PRESENTATION_LABELS[k.id] ?? k.label}</option>`).join('')

  // Populate states select: the chip shows the code, the tooltip the name
  for (const [code, name] of Object.entries(STATES)) {
    const opt = document.createElement('option')
    opt.value = code
    opt.textContent = code
    opt.title = name
    genState.appendChild(opt)
  }

  // The choices are chips on the sheet; the selects keep the values
  chipsFor(genKind)
  chipsFor(genState, { compact: true })
  for (const id of ['gen-gender', 'gen-outcome', 'gen-billing', 'gen-pix-type']) {
    const select = /** @type {HTMLSelectElement} */ (document.getElementById(id))
    chipsFor(select)
    select.addEventListener('change', runGenerate)
  }
  genState.addEventListener('change', runGenerate)
  genFormatted.addEventListener('change', runGenerate)

  // Bind kind change
  genKind.addEventListener('change', () => {
    updateKindOptions()
    runGenerate()
  })
  updateKindOptions()

  // Bind new seed button
  btnNewSeed.addEventListener('click', () => {
    genSeed.value = randomSeed()
    runGenerate()
  })

  // Bind generate button
  btnGenerate.addEventListener('click', runGenerate)

  // Tabs
  tabBtnTable.addEventListener('click', () => {
    tabBtnTable.classList.add('is-active')
    tabBtnTable.setAttribute('aria-selected', 'true')
    tabBtnJson.classList.remove('is-active')
    tabBtnJson.setAttribute('aria-selected', 'false')
    paneTable.classList.add('is-active')
    paneJson.classList.remove('is-active')
  })
  tabBtnJson.addEventListener('click', () => {
    tabBtnJson.classList.add('is-active')
    tabBtnJson.setAttribute('aria-selected', 'true')
    tabBtnTable.classList.remove('is-active')
    tabBtnTable.setAttribute('aria-selected', 'false')
    paneJson.classList.add('is-active')
    paneTable.classList.remove('is-active')
  })

  // Copy / Download buttons
  btnCopyJson.addEventListener('click', () => {
    if (!lastResult) return
    copyToClipboard(JSON.stringify(lastResult.items, null, 2), 'JSON copiado')
  })

  btnCopyCsv.addEventListener('click', () => {
    if (!lastResult) return
    copyToClipboard(itemsToCsv(lastResult.items), 'CSV copiado')
  })

  btnDownloadJson.addEventListener('click', () => {
    if (!lastResult) return
    const content = JSON.stringify(lastResult.items, null, 2)
    downloadFile(content, `${lastResult.kind}-${lastResult.seed}.json`, 'application/json')
  })

  btnDownloadCsv.addEventListener('click', () => {
    if (!lastResult) return
    const content = itemsToCsv(lastResult.items)
    downloadFile(content, `${lastResult.kind}-${lastResult.seed}.csv`, 'text/csv;charset=utf-8;')
  })

  btnCopyCurl.addEventListener('click', () => {
    copyToClipboard(metaCurl.textContent || '', 'cURL copiado')
  })

  // Validator
  valInput.addEventListener('input', runValidator)

  // Generate initial data on load (person, 10)
  runGenerate()

  // Detect mode
  const mode = await detectMode()
  if (mode === 'container') {
    modeChip.className = 'mode-chip is-container'
    modeText.textContent = 'Rodando no container'
  } else {
    modeChip.className = 'mode-chip is-pages'
    modeText.textContent = 'Rodando no navegador'
  }
}

init()
