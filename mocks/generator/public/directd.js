// @ts-check
/**
 * The Direct Data sheet of the generator UI: the credit consultation by CPF
 * the Hub does, the table of the test CPFs and — in the container — the
 * counters, the async queries and the request log of the simulation.
 *
 * The container answers through its own routes (`./api/*` and
 * `./_mock/directd/*`); on GitHub Pages the very same core answers in the
 * browser, so both modes show the same thing.
 */

import {
  DEFAULT_TEST_CPFS,
  DIRECTD_TOKEN,
  OUTCOMES,
  ROUTE_ASYNC_READ,
  ROUTE_BOA_VISTA,
  ROUTE_SCORE,
  answerFor,
  asyncCreated,
  asyncProcessing,
  asyncSettled,
  formatCpf,
  generate,
  isValidCpf,
  onlyDigits,
} from './core/index.js'

// ───────── Helpers ─────────

/**
 * Text that came from the server or from the input, escaped before it lands in markup.
 * @param {unknown} value
 */
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c)
}

/** @type {HTMLElement | null} */
const toast = document.getElementById('toast')

/** @type {ReturnType<typeof setTimeout> | null} */
let toastTimer = null

/**
 * Shows the toast of the page.
 * @param {string} [msg]
 */
function showToast(msg = 'Copiado') {
  if (!toast) return
  if (toastTimer) clearTimeout(toastTimer)
  toast.textContent = msg
  toast.classList.add('is-shown')
  toastTimer = setTimeout(() => {
    toast.classList.remove('is-shown')
    toastTimer = null
  }, 1800)
}

/**
 * Copies text to the clipboard and says it in the toast.
 * @param {string} text
 * @param {string} [label]
 */
async function copyToClipboard(text, label = 'Copiado') {
  try {
    await navigator.clipboard.writeText(text)
    showToast(label)
  } catch {
    const el = document.createElement('textarea')
    el.value = text
    document.body.appendChild(el)
    el.select()
    document.execCommand('copy')
    document.body.removeChild(el)
    showToast(label)
  }
}

/**
 * Money the way the sheet shows it: `R$ 1,98`.
 * @param {number} value
 */
function money(value) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

// ───────── State ─────────

/** The mode of the page: the container answers the routes, the browser the core. */
/** @type {'container' | 'pages'} */
let mode = 'pages'

/** The test CPF table the browser computes with. */
/** @type {any[]} */
let testCpfs = DEFAULT_TEST_CPFS.map((row) => ({ ...row }))

/**
 * The async consultations of the tab on Pages, by `consultaUid`: the browser
 * keeps them the way the container does, so the reads answer 202, then 200.
 * @type {Map<string, { route: string, cpf: string, outcome: any, reads: number, final: { status: number, body: any } }>}
 */
const pagesQueries = new Map()

/** What a CPF that is not in the table answers. */
/** @type {'lowRisk' | 'derived' | 'notFound'} */
let unlistedPolicy = 'lowRisk'

/** The policies of the CPFs that are not in the table, as the sheet names them. */
const POLICIES = [
  { id: 'lowRisk', label: 'Baixo risco' },
  { id: 'derived', label: 'Perfil derivado do CPF' },
  { id: 'notFound', label: 'Não encontrado (404)' },
]

/** The estimated cost of one consultation, per product. */
const COST_BY_ROUTE = {
  [ROUTE_SCORE]: 1.98,
  [ROUTE_BOA_VISTA]: 11.18,
}

// ───────── DOM Elements ─────────

const tokenValue = /** @type {HTMLElement} */ (document.getElementById('directd-token-value'))
const btnCopyToken = /** @type {HTMLButtonElement} */ (document.getElementById('btn-directd-copy-token'))

const cpfInput = /** @type {HTMLInputElement} */ (document.getElementById('directd-cpf'))
const btnGenerateCpf = /** @type {HTMLButtonElement} */ (document.getElementById('btn-directd-generate-cpf'))
const productSelect = /** @type {HTMLSelectElement} */ (document.getElementById('directd-product'))
const asyncCheck = /** @type {HTMLInputElement} */ (document.getElementById('directd-async'))
const btnConsult = /** @type {HTMLButtonElement} */ (document.getElementById('btn-directd-consult'))

const resultArea = /** @type {HTMLElement} */ (document.getElementById('directd-result'))
const statusChip = /** @type {HTMLElement} */ (document.getElementById('directd-status-chip'))
const summaryBox = /** @type {HTMLElement} */ (document.getElementById('directd-summary'))
const actionsBox = /** @type {HTMLElement} */ (document.getElementById('directd-actions'))
const jsonBox = /** @type {HTMLElement} */ (document.getElementById('directd-json'))
const pagesNote = /** @type {HTMLElement} */ (document.getElementById('directd-pages-note'))
const curlLine = /** @type {HTMLElement} */ (document.getElementById('directd-curl'))
const btnCopyCurl = /** @type {HTMLButtonElement} */ (document.getElementById('btn-directd-copy-curl'))

const policySelect = /** @type {HTMLSelectElement} */ (document.getElementById('directd-policy'))
const newCpfInput = /** @type {HTMLInputElement} */ (document.getElementById('directd-new-cpf'))
const newOutcomeSelect = /** @type {HTMLSelectElement} */ (document.getElementById('directd-new-outcome'))
const btnAdd = /** @type {HTMLButtonElement} */ (document.getElementById('btn-directd-add'))
const btnRestore = /** @type {HTMLButtonElement} */ (document.getElementById('btn-directd-restore'))
const testCpfsBody = /** @type {HTMLElement} */ (document.getElementById('directd-test-cpfs'))
const pagesListNote = /** @type {HTMLElement} */ (document.getElementById('directd-pages-list-note'))

const containerPanel = /** @type {HTMLElement} */ (document.getElementById('directd-container-panel'))
const pagesPanel = /** @type {HTMLElement} */ (document.getElementById('directd-pages-panel'))
const dockerCmd = /** @type {HTMLElement} */ (document.getElementById('directd-docker-cmd'))
const btnCopyDocker = /** @type {HTMLButtonElement} */ (document.getElementById('btn-directd-copy-docker'))
const countersBox = /** @type {HTMLElement} */ (document.getElementById('directd-counters'))
const queriesBody = /** @type {HTMLElement} */ (document.getElementById('directd-queries'))
const requestsBody = /** @type {HTMLElement} */ (document.getElementById('directd-requests'))
const btnReset = /** @type {HTMLButtonElement} */ (document.getElementById('btn-directd-reset'))

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

// ───────── Consultation ─────────

/**
 * Runs the consultation of the CPF of the form, in the mode of the page.
 */
async function consult() {
  const cpf = onlyDigits(cpfInput.value)
  const route = productSelect.value
  const wantsAsync = asyncCheck.checked

  if (!cpf) {
    showConsultError('Informe o CPF.')
    return
  }

  if (mode === 'container') {
    const params = new URLSearchParams()
    params.set('CPF', cpf)
    params.set('TOKEN', DIRECTD_TOKEN)
    if (wantsAsync) params.set('Async', 'habilitar')

    // The key stays pressed while the container answers (the slow CPFs take seconds).
    setBusy(btnConsult, true, 'Consultando')
    try {
      const res = await fetch(`./api/${route}?${params.toString()}`)
      const body = await res.json()
      renderConsult(res.status, body)
    } catch (err) {
      showConsultError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(btnConsult, false)
    }
    await refreshState()
    return
  }

  // The browser runs the very same core the container runs.
  const now = new Date()
  const answer = answerFor(
    route,
    { CPF: cpf, Async: wantsAsync ? 'habilitar' : '' },
    {
      testCpfs,
      unlisted: unlistedPolicy,
      now,
      uid: crypto.randomUUID(),
      ip: '127.0.0.1',
      startedAt: now,
    },
  )

  const uid = answer.body?.metaDados?.consultaUid
  if (wantsAsync && answer.status === 200 && uid) {
    // Like the container: the consultation is created (201) and read afterwards.
    pagesQueries.set(uid, { route, cpf, outcome: answer.outcome, reads: 0, final: { status: answer.status, body: answer.body } })
    renderConsult(201, asyncCreated({ route, uid, cpf, ip: '127.0.0.1', now, startedAt: now }))
  } else {
    renderConsult(answer.status, answer.body)
  }
  renderCurl(route, cpf, wantsAsync)
}

/**
 * Reads an async consultation of the tab: 202 on the first read, the final
 * answer from the second on. Pages has no release, so `neverSettles` stays 202.
 * @param {string} uid
 */
function readPagesQuery(uid) {
  const query = pagesQueries.get(uid)
  if (!query) return
  query.reads += 1
  if (asyncSettled(query.outcome, query.reads, false)) {
    renderConsult(query.final.status, query.final.body)
    return
  }
  const now = new Date()
  renderConsult(202, asyncProcessing({ route: query.route, uid, cpf: query.cpf, ip: '127.0.0.1', now, startedAt: now }))
}

/**
 * The cURL of the same call, against the container.
 * @param {string} route
 * @param {string} cpf
 * @param {boolean} wantsAsync
 */
function renderCurl(route, cpf, wantsAsync) {
  const params = new URLSearchParams()
  params.set('CPF', cpf)
  params.set('TOKEN', DIRECTD_TOKEN)
  if (wantsAsync) params.set('Async', 'habilitar')
  curlLine.textContent = `curl 'http://localhost:45450/api/${route}?${params.toString()}'`
}

/**
 * Shows the answer of a consultation: the chip, the summary and the JSON.
 * @param {number} status
 * @param {any} body
 */
function renderConsult(status, body) {
  statusChip.className = `directd-chip ${chipStateOf(status)}`
  const resultado = body?.metaDados?.resultado ?? body?.message ?? ''
  statusChip.textContent = resultado ? `${status} · ${resultado}` : String(status)
  jsonBox.textContent = JSON.stringify(body, null, 2)
  renderSummary(body)
  renderConsultActions(status, body)
  pagesNote.style.display = mode === 'pages' ? 'block' : 'none'
  printSlip()
}

/**
 * The look of the chip: 200 settled, 201/202 still running, anything else refused.
 * @param {number} status
 */
function chipStateOf(status) {
  if (status === 201 || status === 202) return 'is-pending'
  return status >= 200 && status < 300 ? '' : 'is-error'
}

/**
 * Shows the failure of a call in the chip of the result.
 * @param {string} message
 */
function showConsultError(message) {
  statusChip.className = 'directd-chip is-error'
  statusChip.textContent = `Erro · ${message}`
  summaryBox.innerHTML = ''
  actionsBox.innerHTML = ''
  jsonBox.textContent = ''
  printSlip()
}

/**
 * Feeds the result slip out of the printer again, so every answer reads as a new receipt.
 */
function printSlip() {
  resultArea.hidden = false
  resultArea.classList.remove('is-printing')
  // Reading the layout restarts the animation on the same element.
  void resultArea.offsetWidth
  resultArea.classList.add('is-printing')
}

/**
 * Holds a key pressed while its request runs.
 * @param {HTMLButtonElement} button
 * @param {boolean} busy
 * @param {string} [label]
 */
function setBusy(button, busy, label) {
  if (busy) {
    button.dataset.label = button.textContent ?? ''
    button.textContent = label ?? button.textContent
  } else if (button.dataset.label !== undefined) {
    button.textContent = button.dataset.label
    delete button.dataset.label
  }
  button.disabled = busy
  button.classList.toggle('is-busy', busy)
}

/**
 * The summary under the chip: what the JSON of the answer carries.
 * @param {any} body
 */
function renderSummary(body) {
  const retorno = body?.retorno
  if (!retorno || typeof retorno !== 'object') {
    summaryBox.innerHTML = ''
    return
  }

  const score = retorno.pessoaFisica?.score ?? retorno.scores?.ocorrencias?.[0]?.score
  const faixa = retorno.pessoaFisica?.faixaScore ?? retorno.scores?.ocorrencias?.[0]?.classificacaoABC
  const probabilidade = retorno.scores?.ocorrencias?.[0]?.probabilidadeInadimplencia
  const restricoes = retorno.restricoes?.quantidadeOcorrencias
  const obito = retorno.indicacaoObito
  const situacao = retorno.cpfSituacao

  const items = [
    ['Score', score],
    ['Faixa', faixa],
    ['Probabilidade', probabilidade],
    ['Restrições', restricoes],
    ['Óbito', obito],
    ['Situação do CPF', situacao],
  ]

  summaryBox.innerHTML = items
    .map(
      ([label, value], index) => `
        <div class="directd-summary-item" style="--line: ${index}">
          <span>${esc(label)}</span>
          <strong>${esc(value === undefined || value === null || value === '' ? '—' : value)}</strong>
        </div>
      `,
    )
    .join('')
}

/**
 * The actions of the answer: the uid of the consultation and the key that reads it.
 * @param {number} status
 * @param {any} body
 */
function renderConsultActions(status, body) {
  actionsBox.innerHTML = ''
  const uid = body?.metaDados?.consultaUid
  if (!uid) return

  const label = document.createElement('span')
  label.className = 'directd-uid'
  label.innerHTML = `<span>consultaUid</span> <code>${esc(uid)}</code>`
  actionsBox.appendChild(label)

  const copy = document.createElement('button')
  copy.type = 'button'
  copy.className = 'key small'
  copy.textContent = 'Copiar'
  copy.addEventListener('click', () => copyToClipboard(String(uid), 'consultaUid copiado'))
  actionsBox.appendChild(copy)

  if (status !== 201 && status !== 202) return

  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'key confirm small'
  button.textContent = 'Ler resultado'
  button.addEventListener('click', () => readAsyncResult(String(uid), button))
  actionsBox.appendChild(button)
}

/**
 * Reads the result of an async consultation.
 * @param {string} uid
 * @param {HTMLButtonElement} button
 */
async function readAsyncResult(uid, button) {
  if (mode !== 'container') {
    readPagesQuery(uid)
    return
  }

  const params = new URLSearchParams()
  params.set('ConsultaUid', uid)
  params.set('TOKEN', DIRECTD_TOKEN)

  setBusy(button, true, 'Lendo')
  try {
    const res = await fetch(`./api/${ROUTE_ASYNC_READ}?${params.toString()}`)
    const body = await res.json()
    renderConsult(res.status, body)
  } catch (err) {
    showConsultError(err instanceof Error ? err.message : String(err))
  } finally {
    setBusy(button, false)
  }
  await refreshState()
}

// ───────── Test CPFs ─────────

/**
 * Loads the test CPF table: the server owns it in the container, the tab owns it on Pages.
 */
async function loadTestCpfs() {
  if (mode !== 'container') {
    renderTestCpfs(testCpfs)
    return
  }

  try {
    const res = await fetch('./_mock/directd/test-cpfs', { cache: 'no-store' })
    const data = await res.json()
    testCpfs = Array.isArray(data.testCpfs) ? data.testCpfs : []
    if (typeof data.unlisted === 'string') unlistedPolicy = data.unlisted
    policySelect.value = unlistedPolicy
    renderTestCpfs(testCpfs)
  } catch (err) {
    showToast(`Falha ao carregar os CPFs de teste: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/**
 * The table of the test CPFs.
 * @param {any[]} rows
 */
function renderTestCpfs(rows) {
  testCpfsBody.innerHTML = ''

  for (const row of rows) {
    const outcome = OUTCOMES.find((entry) => entry.id === row.outcome)
    const tr = document.createElement('tr')
    tr.innerHTML = `
      <td>
        <code>${esc(formatCpf(row.cpf))}</code>
        <button type="button" class="key small" data-copy-cpf="${esc(row.cpf)}">Copiar</button>
      </td>
      <td>${esc(outcome?.summary.pt ?? row.outcome)}</td>
      <td>${esc(outcome?.status ?? '—')}</td>
      <td><button type="button" class="key small" data-remove-cpf="${esc(row.cpf)}">Remover</button></td>
    `
    testCpfsBody.appendChild(tr)
  }
}

/**
 * Adds a CPF to the test table.
 */
async function addTestCpf() {
  const cpf = onlyDigits(newCpfInput.value)
  const outcome = newOutcomeSelect.value

  if (!cpf) {
    showToast('Informe o CPF.')
    return
  }

  if (mode === 'container') {
    try {
      const res = await fetch('./_mock/directd/test-cpfs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cpf, outcome }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error?.message ?? `HTTP ${res.status}`)
    } catch (err) {
      showToast(`Falha ao adicionar: ${err instanceof Error ? err.message : String(err)}`)
      return
    }
  } else {
    // The same refusals the container answers.
    if (cpf.length !== 11) {
      showToast('Falha ao adicionar: o CPF precisa de 11 dígitos.')
      return
    }
    if (outcome !== 'badDocument' && !isValidCpf(cpf)) {
      showToast('Falha ao adicionar: os dígitos verificadores do CPF não conferem.')
      return
    }
    const row = { cpf, outcome }
    const index = testCpfs.findIndex((entry) => onlyDigits(entry.cpf) === cpf)
    if (index >= 0) testCpfs[index] = row
    else testCpfs.push(row)
  }

  newCpfInput.value = ''
  await loadTestCpfs()
  await refreshState()
}

/**
 * Removes a CPF from the test table.
 * @param {string} cpf
 */
async function removeTestCpf(cpf) {
  const digits = onlyDigits(cpf)

  if (mode === 'container') {
    try {
      const res = await fetch(`./_mock/directd/test-cpfs/${digits}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data?.error?.message ?? `HTTP ${res.status}`)
      }
    } catch (err) {
      showToast(`Falha ao remover: ${err instanceof Error ? err.message : String(err)}`)
      return
    }
  } else {
    testCpfs = testCpfs.filter((row) => onlyDigits(row.cpf) !== digits)
  }

  await loadTestCpfs()
  await refreshState()
}

/**
 * Changes what a CPF that is not in the table answers.
 * @param {string} value
 */
async function setPolicy(value) {
  if (mode === 'container') {
    try {
      const res = await fetch('./_mock/directd/test-cpfs/policy', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unlisted: value }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error?.message ?? `HTTP ${res.status}`)
    } catch (err) {
      showToast(`Falha ao mudar a política: ${err instanceof Error ? err.message : String(err)}`)
      return
    }
  } else {
    unlistedPolicy = /** @type {'lowRisk' | 'derived' | 'notFound'} */ (value)
  }

  await loadTestCpfs()
  await refreshState()
}

/**
 * Puts the default table back.
 */
async function restoreDefaults() {
  if (mode === 'container') {
    try {
      const res = await fetch('./_mock/directd/test-cpfs', { method: 'DELETE' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
    } catch (err) {
      showToast(`Falha ao restaurar: ${err instanceof Error ? err.message : String(err)}`)
      return
    }
  } else {
    testCpfs = DEFAULT_TEST_CPFS.map((row) => ({ ...row }))
    unlistedPolicy = 'lowRisk'
    policySelect.value = unlistedPolicy
  }

  await loadTestCpfs()
  await refreshState()
}

// ───────── Container State ─────────

/**
 * Reads the state and the log of the container.
 */
async function refreshState() {
  if (mode !== 'container') return

  try {
    const [stateRes, requestsRes] = await Promise.all([
      fetch('./_mock/directd/state', { cache: 'no-store' }),
      fetch('./_mock/directd/requests', { cache: 'no-store' }),
    ])

    if (stateRes.ok) {
      const state = await stateRes.json()
      renderCounters(state.counters)
      renderQueries(state.asyncQueries ?? [])
    }

    if (requestsRes.ok) {
      const data = await requestsRes.json()
      renderRequests(data.requests ?? [])
    }
  } catch {
    // the container is busy: the next tick reads again
  }
}

/**
 * What each live panel last drew, so the 2 s refresh redraws only what changed
 * (a redraw would close the JSON a developer opened in the log).
 * @type {{ counters: string | null, queries: string | null, requests: string | null }}
 */
const drawn = { counters: null, queries: null, requests: null }

/** The totals the counters last showed, to mark the one that moved. */
const lastTotals = { charged: -1, notCharged: -1 }

/** The newest request id already on screen; rows above it arrive marked. */
let newestSeenRequest = -1

/**
 * Whether a panel's data changed since it was last drawn; remembers it when it did.
 * @param {keyof typeof drawn} panel
 * @param {unknown} data
 */
function changed(panel, data) {
  const signature = JSON.stringify(data)
  if (drawn[panel] === signature) return false
  drawn[panel] = signature
  return true
}

/**
 * The counters: what was charged and what was not.
 * @param {any} counters
 */
function renderCounters(counters) {
  if (!changed('counters', counters)) return
  const charged = counters?.charged ?? { total: 0, byRoute: {} }
  const notCharged = counters?.notCharged ?? { total: 0, byStatus: {} }
  const scoreCount = charged.byRoute?.[ROUTE_SCORE] ?? 0
  const boaVistaCount = charged.byRoute?.[ROUTE_BOA_VISTA] ?? 0
  const cost = scoreCount * COST_BY_ROUTE[ROUTE_SCORE] + boaVistaCount * COST_BY_ROUTE[ROUTE_BOA_VISTA]

  const statuses = Object.entries(notCharged.byStatus ?? {}).sort(([a], [b]) => a.localeCompare(b))

  const chargedTotal = Number(charged.total ?? 0)
  const notChargedTotal = Number(notCharged.total ?? 0)
  // The first draw marks nothing: only a total that moves under the developer's eyes.
  const bump = (/** @type {number} */ before, /** @type {number} */ now) => (before >= 0 && before !== now ? ' is-bumped' : '')
  const chargedBump = bump(lastTotals.charged, chargedTotal)
  const notChargedBump = bump(lastTotals.notCharged, notChargedTotal)
  lastTotals.charged = chargedTotal
  lastTotals.notCharged = notChargedTotal

  countersBox.innerHTML = `
    <div class="directd-counter is-charged">
      <h4>Cobradas</h4>
      <dl>
        <dt>Total</dt>
        <dd class="total${chargedBump}">${esc(chargedTotal)}</dd>
        <dt>Score</dt>
        <dd>${esc(scoreCount)} · ${esc(money(COST_BY_ROUTE[ROUTE_SCORE]))} cada</dd>
        <dt>Boa Vista</dt>
        <dd>${esc(boaVistaCount)} · ${esc(money(COST_BY_ROUTE[ROUTE_BOA_VISTA]))} cada</dd>
        <dt>Custo estimado</dt>
        <dd>${esc(money(cost))}</dd>
      </dl>
    </div>
    <div class="directd-counter">
      <h4>Não cobradas</h4>
      <dl>
        <dt>Total</dt>
        <dd class="total${notChargedBump}">${esc(notChargedTotal)}</dd>
        ${statuses.map(([status, count]) => `<dt>${esc(status)}</dt><dd>${esc(count)}</dd>`).join('')}
      </dl>
    </div>
  `
}

/**
 * The async consultations the container is holding.
 * @param {any[]} queries
 */
function renderQueries(queries) {
  if (!changed('queries', queries)) return
  queriesBody.innerHTML = queries.length
    ? ''
    : '<tr class="directd-empty"><td colspan="6">Nenhuma consulta assíncrona. Marque “Assíncrono” e consulte.</td></tr>'

  for (const query of queries) {
    const tr = document.createElement('tr')
    const state = stateOfQuery(query)
    // Only a query still processing has anything to release.
    const release = state === 'processando'
      ? `<button type="button" class="key small" data-release="${esc(query.uid)}">Liberar</button>`
      : ''
    tr.innerHTML = `
      <td><code>${esc(query.uid)}</code></td>
      <td>${esc(productLabel(query.route))}</td>
      <td>${esc(query.cpf ? formatCpf(query.cpf) : '—')}</td>
      <td>${esc(query.reads ?? 0)}</td>
      <td><span class="directd-state is-${esc(state)}">${esc(state)}</span></td>
      <td>${release}</td>
    `
    queriesBody.appendChild(tr)
  }
}

/**
 * The state of an async consultation: processando, liberada or entregue.
 * @param {any} query
 */
function stateOfQuery(query) {
  if (query.delivered) return 'entregue'
  return query.released ? 'liberada' : 'processando'
}

/**
 * The name of a product, as the sheet shows it.
 * @param {string} route
 */
function productLabel(route) {
  if (route === ROUTE_SCORE) return 'Score'
  if (route === ROUTE_BOA_VISTA) return 'Boa Vista'
  return String(route ?? '')
}

/**
 * The log of the requests, newest first.
 * @param {any[]} requests
 */
function renderRequests(requests) {
  if (!changed('requests', requests)) return

  // The JSON a developer opened stays open across redraws.
  const open = new Set(
    Array.from(requestsBody.querySelectorAll('details[open]'), (el) => el.getAttribute('data-id')),
  )
  const firstDraw = newestSeenRequest < 0
  const seen = newestSeenRequest

  requestsBody.innerHTML = requests.length
    ? ''
    : '<tr class="directd-empty"><td colspan="7">Nenhuma requisição ainda. Cada consulta aparece aqui, a mais nova no topo.</td></tr>'

  // An empty first draw still counts as seen, so the first request arrives marked.
  newestSeenRequest = Math.max(newestSeenRequest, 0)

  for (const entry of requests) {
    const id = Number(entry.id ?? 0)
    newestSeenRequest = Math.max(newestSeenRequest, id)
    const tr = document.createElement('tr')
    if (!firstDraw && id > seen) tr.className = 'is-new'
    const ok = Number(entry.status) >= 200 && Number(entry.status) < 300
    tr.innerHTML = `
      <td>${esc(timeOf(entry.at))}</td>
      <td>${esc(entry.route)}</td>
      <td>${esc(entry.cpf ? formatCpf(entry.cpf) : '—')}</td>
      <td><span class="directd-code${ok ? '' : ' is-error'}">${esc(entry.status)}</span></td>
      <td>${esc(entry.resultado ?? '—')}</td>
      <td>${entry.charged ? '<span class="directd-charged">sim</span>' : 'não'}</td>
      <td>
        <details class="directd-log" data-id="${esc(id)}"${open.has(String(id)) ? ' open' : ''}>
          <summary>JSON</summary>
          <pre class="json-pre"><code>${esc(JSON.stringify(entry.response, null, 2))}</code></pre>
        </details>
      </td>
    `
    requestsBody.appendChild(tr)
  }
}

/**
 * The hour of a request.
 * @param {string} at
 */
function timeOf(at) {
  const date = new Date(String(at ?? ''))
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleTimeString('pt-BR')
}

/**
 * Releases an async consultation, so the read answers with the final body.
 * @param {string} uid
 */
async function releaseQuery(uid) {
  try {
    const res = await fetch(`./_mock/directd/queries/${encodeURIComponent(uid)}/release`, { method: 'POST' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
  } catch (err) {
    showToast(`Falha ao liberar: ${err instanceof Error ? err.message : String(err)}`)
    return
  }
  await refreshState()
}

/**
 * Empties the log and the counters.
 */
async function resetState() {
  try {
    const res = await fetch('./_mock/directd/state', { method: 'DELETE' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
  } catch (err) {
    showToast(`Falha ao zerar: ${err instanceof Error ? err.message : String(err)}`)
    return
  }
  await refreshState()
}

// ───────── Initialization ─────────

async function init() {
  tokenValue.textContent = DIRECTD_TOKEN

  newOutcomeSelect.innerHTML = OUTCOMES.map(
    (entry) => `<option value="${esc(entry.id)}">${esc(entry.summary.pt)}</option>`,
  ).join('')

  policySelect.innerHTML = POLICIES.map(
    (entry) => `<option value="${esc(entry.id)}">${esc(entry.label)}</option>`,
  ).join('')

  btnCopyToken.addEventListener('click', () => copyToClipboard(DIRECTD_TOKEN, 'Token copiado'))
  btnCopyCurl.addEventListener('click', () => copyToClipboard(curlLine.textContent || '', 'cURL copiado'))
  btnCopyDocker.addEventListener('click', () => copyToClipboard(dockerCmd.textContent || '', 'Comando copiado'))

  btnGenerateCpf.addEventListener('click', () => {
    const result = generate('cpf', { count: 1 })
    cpfInput.value = String(result.items[0]?.value ?? '')
  })

  btnConsult.addEventListener('click', consult)
  btnAdd.addEventListener('click', addTestCpf)
  btnRestore.addEventListener('click', restoreDefaults)
  policySelect.addEventListener('change', () => setPolicy(policySelect.value))

  testCpfsBody.addEventListener('click', (event) => {
    const target = /** @type {HTMLElement} */ (event.target)

    const copy = target.closest('[data-copy-cpf]')
    if (copy) {
      copyToClipboard(onlyDigits(String(copy.getAttribute('data-copy-cpf'))), 'CPF copiado')
      return
    }

    const remove = target.closest('[data-remove-cpf]')
    if (remove) removeTestCpf(String(remove.getAttribute('data-remove-cpf')))
  })

  queriesBody.addEventListener('click', (event) => {
    const target = /** @type {HTMLElement} */ (event.target)
    const release = target.closest('[data-release]')
    if (release) releaseQuery(String(release.getAttribute('data-release')))
  })

  btnReset.addEventListener('click', resetState)

  // Enter in the CPF field consults, like the key.
  cpfInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !btnConsult.disabled) consult()
  })

  mode = await detectMode()

  if (mode === 'container') {
    containerPanel.style.display = 'block'
    pagesPanel.style.display = 'none'
    await loadTestCpfs()
    await refreshState()
    setInterval(() => {
      if (document.visibilityState === 'visible') refreshState()
    }, 2000)
  } else {
    containerPanel.style.display = 'none'
    pagesPanel.style.display = 'block'
    pagesListNote.style.display = 'block'
    renderTestCpfs(testCpfs)
  }
}

init()
