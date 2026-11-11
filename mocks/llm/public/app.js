/**
 * LLM mock operator panel application
 * Pure browser ES module, no external dependencies.
 */

// Central state
const state = {
  version: '',
  settings: {},
  rules: [],
  catalog: [],
  requests: [],
  selectedRequestId: null,
  activeTab: 'requests',
  autoRefreshTimer: null,
  lastFetchedSettings: {},
}

const EXAMPLE_RULE = {
  match: {
    lastUser: "faturamento",
  },
  reply: {
    kind: "tool_calls",
    calls: [
      {
        name: "query_metrics",
        arguments: {},
      },
    ],
  },
  times: 1,
}

const EXAMPLE_MODEL = {
  id: "custom/llama-3.3-70b",
  name: "Meta: Llama 3.3 70B Instruct",
  contextWindow: 131072,
  maxOutputTokens: 8192,
  inputPrice: "0.00000035",
  outputPrice: "0.0000004",
  tools: true,
}

// Single fetch helper
async function api(method, path, body = undefined) {
  const options = {
    method,
    headers: {
      Accept: 'application/json',
    },
  }
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json'
    options.body = JSON.stringify(body)
  }

  let res
  try {
    res = await fetch(path, options)
  } catch (err) {
    showToast(`Network error: ${err.message}`, true)
    throw err
  }

  if (res.status === 204) {
    return null
  }

  let data
  try {
    data = await res.json()
  } catch (err) {
    data = null
  }

  if (!res.ok) {
    const errorMsg = data && data.errors ? data.errors.join(', ') : `HTTP ${res.status}`
    showToast(errorMsg, true)
    const error = new Error(errorMsg)
    error.status = res.status
    error.data = data
    throw error
  }

  return data
}

// Toast notification
let toastTimeout = null
function showToast(message, isError = false) {
  const toast = document.getElementById('toast')
  if (!toast) return
  toast.textContent = message
  toast.className = `toast ${isError ? 'toast-error' : ''}`
  toast.hidden = false

  clearTimeout(toastTimeout)
  toastTimeout = setTimeout(() => {
    toast.hidden = true
  }, 3500)
}

// Copy to clipboard
async function copyText(text, btnElement = null, successLabel = 'Copied!') {
  try {
    await navigator.clipboard.writeText(text)
    if (btnElement) {
      const original = btnElement.textContent
      btnElement.textContent = successLabel
      setTimeout(() => {
        btnElement.textContent = original
      }, 1500)
    } else {
      showToast('Copied to clipboard')
    }
  } catch (err) {
    showToast('Failed to copy to clipboard', true)
  }
}

// Formatters
function formatTime(isoString) {
  if (!isoString) return ''
  const d = new Date(isoString)
  return d.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function formatPricePerMillion(priceStr) {
  if (!priceStr) return '$0.00'
  const num = parseFloat(priceStr)
  if (isNaN(num)) return '$0.00'
  const perMillion = num * 1000000
  return `$${perMillion.toFixed(2)}`
}

function formatCost(costUsd) {
  if (costUsd === null || costUsd === undefined) return '—'
  const num = parseFloat(costUsd)
  if (isNaN(num)) return '—'
  if (num === 0) return '$0.00'
  if (num < 0.0001) return `<$0.0001`
  return `$${num.toFixed(4)}`
}

// Tab Switching
function setupTabs() {
  const tabs = ['requests', 'rules', 'settings', 'models']
  tabs.forEach((tabName) => {
    const btn = document.getElementById(`tab-btn-${tabName}`)
    if (!btn) return
    btn.addEventListener('click', () => switchTab(tabName))
    btn.addEventListener('keydown', (e) => {
      let index = tabs.indexOf(tabName)
      if (e.key === 'ArrowRight') {
        const next = tabs[(index + 1) % tabs.length]
        document.getElementById(`tab-btn-${next}`).focus()
        switchTab(next)
      } else if (e.key === 'ArrowLeft') {
        const prev = tabs[(index - 1 + tabs.length) % tabs.length]
        document.getElementById(`tab-btn-${prev}`).focus()
        switchTab(prev)
      }
    })
  })
}

function switchTab(tabName) {
  state.activeTab = tabName
  const tabs = ['requests', 'rules', 'settings', 'models']

  tabs.forEach((name) => {
    const btn = document.getElementById(`tab-btn-${name}`)
    const panel = document.getElementById(`panel-${name}`)
    const isSelected = name === tabName

    if (btn) {
      btn.setAttribute('aria-selected', isSelected ? 'true' : 'false')
      btn.setAttribute('tabindex', isSelected ? '0' : '-1')
    }
    if (panel) {
      panel.hidden = !isSelected
    }
  })

  if (tabName === 'requests') {
    loadRequests()
  } else if (tabName === 'rules') {
    loadState()
  } else if (tabName === 'settings') {
    loadState()
  } else if (tabName === 'models') {
    loadState()
  }
}

// State Loading
async function loadState() {
  try {
    const data = await api('GET', '/_mock/llm/state')
    if (!data) return
    state.version = data.version || '0.1.0'
    state.settings = data.settings || {}
    state.lastFetchedSettings = { ...state.settings }
    state.rules = data.rules || []
    state.catalog = data.catalog || []

    renderHeader()
    renderRules()
    renderSettings()
    renderModels()
  } catch (err) {
    // handled by api toast
  }
}

function renderHeader() {
  const versionEl = document.getElementById('app-version')
  if (versionEl) {
    versionEl.textContent = `v${state.version}`
  }

  const origin = window.location.origin
  const vercelEl = document.getElementById('url-vercel')
  const openrouterEl = document.getElementById('url-openrouter')
  if (vercelEl) vercelEl.textContent = `${origin}/v1`
  if (openrouterEl) openrouterEl.textContent = `${origin}/api/v1`

  const countRules = document.getElementById('count-rules')
  if (countRules) countRules.textContent = state.rules.length

  const countModels = document.getElementById('count-models')
  if (countModels) countModels.textContent = state.catalog.length
}

// Tab 1: Requests
async function loadRequests() {
  try {
    const list = await api('GET', '/_mock/llm/requests?limit=100')
    state.requests = Array.isArray(list) ? list : []
    renderRequests()
  } catch (err) {
    // handled by api
  }
}

function renderRequests() {
  const tbody = document.getElementById('requests-tbody')
  const emptyState = document.getElementById('requests-empty')
  const countBadge = document.getElementById('count-requests')

  if (countBadge) {
    countBadge.textContent = state.requests.length
  }

  if (!tbody || !emptyState) return

  tbody.innerHTML = ''

  if (state.requests.length === 0) {
    emptyState.hidden = false
    document.getElementById('request-detail').hidden = true
    return
  }

  emptyState.hidden = true

  state.requests.forEach((req) => {
    const tr = document.createElement('tr')
    if (state.selectedRequestId === req.id) {
      tr.classList.add('selected')
    }

    const replyBadgeClass =
      req.replyKind === 'tool_calls' ? 'badge-tool' : req.replyKind === 'error' ? 'badge-error' : 'badge-text'

    const statusClass = req.status >= 200 && req.status < 300 ? 'status-ok' : 'status-err'
    const toolsText = req.calledTools && req.calledTools.length > 0 ? req.calledTools.join(', ') : '—'
    const tokensText = `${req.inputTokens || 0} / ${req.outputTokens || 0}`

    tr.innerHTML = `
      <td class="col-mono">${formatTime(req.at)}</td>
      <td class="col-mono">${escapeHtml(req.gateway || 'vercel')}</td>
      <td class="col-mono col-ellipsis" title="${escapeHtml(req.model || '')}">${escapeHtml(req.model || '')}</td>
      <td class="col-ellipsis" title="${escapeHtml(req.lastUser || '')}">${escapeHtml(req.lastUser || '—')}</td>
      <td><span class="badge-kind ${replyBadgeClass}">${escapeHtml(req.replyKind || 'text')}</span></td>
      <td class="col-ellipsis" title="${escapeHtml(toolsText)}">${escapeHtml(toolsText)}</td>
      <td class="${statusClass} col-mono">${req.status}</td>
      <td class="col-mono">${req.latencyMs ?? 0}ms</td>
      <td class="col-mono">${tokensText}</td>
      <td class="col-mono">${formatCost(req.costUsd)}</td>
    `

    tr.addEventListener('click', () => {
      selectRequest(req.id)
    })

    tbody.appendChild(tr)
  })
}

async function selectRequest(id) {
  state.selectedRequestId = id
  renderRequests()

  const detailSidebar = document.getElementById('request-detail')
  const detailTitle = document.getElementById('detail-title')
  const detailJson = document.getElementById('detail-json')

  try {
    const req = await api('GET', `/_mock/llm/requests/${encodeURIComponent(id)}`)
    detailTitle.textContent = `Request ${req.id}`
    detailJson.textContent = JSON.stringify(req, null, 2)
    detailSidebar.hidden = false
  } catch (err) {
    detailSidebar.hidden = true
  }
}

function setupAutoRefresh() {
  const toggle = document.getElementById('toggle-autorefresh')
  if (!toggle) return

  const checkRefresh = () => {
    if (toggle.checked && document.visibilityState === 'visible' && state.activeTab === 'requests') {
      loadRequests()
    }
  }

  toggle.addEventListener('change', () => {
    if (toggle.checked) {
      loadRequests()
    }
  })

  setInterval(checkRefresh, 2000)

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && toggle.checked && state.activeTab === 'requests') {
      loadRequests()
    }
  })
}

// Tab 2: Rules
function renderRules() {
  const container = document.getElementById('rules-list')
  const empty = document.getElementById('rules-empty')
  if (!container || !empty) return

  container.innerHTML = ''

  if (state.rules.length === 0) {
    empty.hidden = false
    return
  }

  empty.hidden = true

  state.rules.forEach((rule, index) => {
    const item = document.createElement('div')
    item.className = 'rule-item'

    const matchParts = []
    if (rule.match) {
      if (rule.match.model) matchParts.push(`model=${rule.match.model}`)
      if (rule.match.gateway) matchParts.push(`gateway=${rule.match.gateway}`)
      if (rule.match.lastUser) matchParts.push(`user~/${rule.match.lastUser}/i`)
      if (rule.match.system) matchParts.push(`system~/${rule.match.system}/i`)
      if (rule.match.hasTools !== undefined) matchParts.push(`hasTools=${rule.match.hasTools}`)
      if (rule.match.afterTool !== undefined) matchParts.push(`afterTool=${rule.match.afterTool}`)
      if (rule.match.toolOffered) matchParts.push(`toolOffered=${rule.match.toolOffered}`)
    }
    const matchSummary = matchParts.length > 0 ? matchParts.join(' & ') : 'match: * (any request)'

    let replySummary = `kind: ${rule.reply ? rule.reply.kind : 'auto'}`
    if (rule.reply) {
      if (rule.reply.kind === 'text') {
        replySummary += ` ("${(rule.reply.text || '').slice(0, 40)}...")`
      } else if (rule.reply.kind === 'tool_calls') {
        const calls = (rule.reply.calls || []).map((c) => c.name).join(', ')
        replySummary += ` (calls: ${calls})`
      } else if (rule.reply.kind === 'error') {
        replySummary += ` (${rule.reply.status}: ${rule.reply.message})`
      }
    }

    const timesText = rule.times !== undefined ? `${rule.times} remaining` : 'forever'
    const latencyText = rule.latencyMs ? `+${rule.latencyMs}ms` : null

    item.innerHTML = `
      <div class="rule-info">
        <div class="rule-summary">#${index + 1} — ${escapeHtml(matchSummary)}</div>
        <div class="rule-details">
          <span>${escapeHtml(replySummary)}</span>
          <span>Times: <strong>${timesText}</strong></span>
          ${latencyText ? `<span>Latency: ${latencyText}</span>` : ''}
          <span class="col-mono">ID: ${escapeHtml(rule.id)}</span>
        </div>
      </div>
      <button type="button" class="btn btn-danger btn-delete-rule" data-id="${escapeHtml(rule.id)}">Delete</button>
    `

    const delBtn = item.querySelector('.btn-delete-rule')
    delBtn.addEventListener('click', async () => {
      try {
        await api('DELETE', `/_mock/llm/rules/${encodeURIComponent(rule.id)}`)
        showToast('Rule deleted')
        await loadState()
      } catch (err) {
        // handled
      }
    })

    container.appendChild(item)
  })
}

async function postRule(ruleObject, position = 'last') {
  try {
    await api('POST', `/_mock/llm/rules?position=${encodeURIComponent(position)}`, ruleObject)
    showToast('Rule added successfully')
    await loadState()
  } catch (err) {
    throw err
  }
}

function setupRulesForm() {
  const form = document.getElementById('form-add-rule')
  const textarea = document.getElementById('rule-json')
  const positionSelect = document.getElementById('rule-position')
  const errorBanner = document.getElementById('rule-error')

  if (textarea) {
    textarea.value = JSON.stringify(EXAMPLE_RULE, null, 2)
  }

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault()
      errorBanner.hidden = true
      errorBanner.textContent = ''

      let parsed
      try {
        parsed = JSON.parse(textarea.value)
      } catch (err) {
        errorBanner.textContent = `Invalid JSON: ${err.message}`
        errorBanner.hidden = false
        return
      }

      try {
        await postRule(parsed, positionSelect.value)
        showToast('Rule added')
      } catch (err) {
        if (err.data && err.data.errors) {
          errorBanner.textContent = err.data.errors.join('; ')
        } else {
          errorBanner.textContent = err.message
        }
        errorBanner.hidden = false
      }
    })
  }

  // Presets
  document.getElementById('preset-429')?.addEventListener('click', async () => {
    try {
      await postRule(
        {
          match: {},
          reply: { kind: 'error', status: 429, message: 'Rate limit exceeded: quota depleted', code: 'rate_limit_exceeded' },
          times: 1,
        },
        'first'
      )
    } catch (err) {}
  })

  document.getElementById('preset-fixed-text')?.addEventListener('click', async () => {
    try {
      await postRule(
        {
          match: {},
          reply: { kind: 'text', text: 'This is a scripted fixed response from LLM mock.' },
          times: 1,
        },
        'first'
      )
    } catch (err) {}
  })

  document.getElementById('preset-call-tool')?.addEventListener('click', async () => {
    try {
      await postRule(
        {
          match: { hasTools: true },
          reply: {
            kind: 'tool_calls',
            calls: [{ name: 'query_metrics', arguments: { limit: 5 } }],
          },
        },
        'first'
      )
    } catch (err) {}
  })

  document.getElementById('btn-clear-rules')?.addEventListener('click', async () => {
    if (!confirm('Clear all scripted rules?')) return
    try {
      await api('DELETE', '/_mock/llm/rules')
      showToast('All rules cleared')
      await loadState()
    } catch (err) {}
  })
}

// Tab 3: Settings
function renderSettings() {
  const s = state.settings || {}
  setVal('setting-latencyMs', s.latencyMs ?? 0)
  setVal('setting-streamChunkDelayMs', s.streamChunkDelayMs ?? 15)
  setVal('setting-streamChunkChars', s.streamChunkChars ?? 24)
  setVal('setting-maxToolRounds', s.maxToolRounds ?? 1)
  setVal('setting-unknownModels', s.unknownModels ?? 'accept')
  setVal('setting-toolStrategy', s.toolStrategy ?? 'match')
  setCheck('setting-requireAuth', s.requireAuth ?? true)
  setCheck('setting-reportCost', s.reportCost ?? true)
  setVal('setting-answerTemplate', s.answerTemplate ?? '')
}

function setVal(id, val) {
  const el = document.getElementById(id)
  if (el) el.value = val
}

function setCheck(id, checked) {
  const el = document.getElementById(id)
  if (el) el.checked = Boolean(checked)
}

function setupSettingsForm() {
  const btnSave = document.getElementById('btn-save-settings')
  const errorBanner = document.getElementById('settings-error')

  btnSave?.addEventListener('click', async () => {
    errorBanner.hidden = true
    errorBanner.textContent = ''

    // Compute changed fields only
    const patch = {}
    const cur = {
      latencyMs: Number(document.getElementById('setting-latencyMs').value),
      streamChunkDelayMs: Number(document.getElementById('setting-streamChunkDelayMs').value),
      streamChunkChars: Number(document.getElementById('setting-streamChunkChars').value),
      maxToolRounds: Number(document.getElementById('setting-maxToolRounds').value),
      unknownModels: document.getElementById('setting-unknownModels').value,
      toolStrategy: document.getElementById('setting-toolStrategy').value,
      requireAuth: document.getElementById('setting-requireAuth').checked,
      reportCost: document.getElementById('setting-reportCost').checked,
      answerTemplate: document.getElementById('setting-answerTemplate').value,
    }

    const prev = state.lastFetchedSettings || {}
    for (const [key, val] of Object.entries(cur)) {
      if (val !== prev[key]) {
        patch[key] = val
      }
    }

    if (Object.keys(patch).length === 0) {
      showToast('No settings changed')
      return
    }

    try {
      const updated = await api('PUT', '/_mock/llm/settings', patch)
      state.settings = updated
      state.lastFetchedSettings = { ...updated }
      showToast('Settings saved successfully')
    } catch (err) {
      if (err.data && err.data.errors) {
        errorBanner.textContent = err.data.errors.join('; ')
      } else {
        errorBanner.textContent = err.message
      }
      errorBanner.hidden = false
    }
  })
}

// Tab 4: Models
function renderModels() {
  const tbody = document.getElementById('models-tbody')
  if (!tbody) return
  tbody.innerHTML = ''

  state.catalog.forEach((model) => {
    const tr = document.createElement('tr')
    tr.innerHTML = `
      <td class="col-mono"><strong>${escapeHtml(model.id)}</strong></td>
      <td>${escapeHtml(model.name)}</td>
      <td class="col-mono">${(model.contextWindow || 0).toLocaleString()}</td>
      <td class="col-mono">${(model.maxOutputTokens || 0).toLocaleString()}</td>
      <td class="col-mono">${formatPricePerMillion(model.inputPrice)}</td>
      <td class="col-mono">${formatPricePerMillion(model.outputPrice)}</td>
      <td>${model.tools ? '<span class="badge-kind badge-text">tools</span>' : '<span class="col-mono">no</span>'}</td>
      <td>
        <button type="button" class="btn btn-danger btn-delete-model" data-id="${escapeHtml(model.id)}">Delete</button>
      </td>
    `

    const delBtn = tr.querySelector('.btn-delete-model')
    delBtn.addEventListener('click', async (e) => {
      e.stopPropagation()
      if (!confirm(`Delete model ${model.id}?`)) return
      try {
        await api('DELETE', `/_mock/llm/catalog/${encodeURIComponent(model.id)}`)
        showToast(`Model ${model.id} deleted`)
        await loadState()
      } catch (err) {}
    })

    tbody.appendChild(tr)
  })
}

function setupModelsForm() {
  const form = document.getElementById('form-upsert-model')
  const textarea = document.getElementById('model-json')
  const errorBanner = document.getElementById('model-error')

  if (textarea) {
    textarea.value = JSON.stringify(EXAMPLE_MODEL, null, 2)
  }

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault()
      errorBanner.hidden = true
      errorBanner.textContent = ''

      let parsed
      try {
        parsed = JSON.parse(textarea.value)
      } catch (err) {
        errorBanner.textContent = `Invalid JSON: ${err.message}`
        errorBanner.hidden = false
        return
      }

      try {
        await api('POST', '/_mock/llm/catalog', parsed)
        showToast('Model saved')
        await loadState()
      } catch (err) {
        if (err.data && err.data.errors) {
          errorBanner.textContent = err.data.errors.join('; ')
        } else {
          errorBanner.textContent = err.message
        }
        errorBanner.hidden = false
      }
    })
  }
}

// Theme: the dark receipt is an explicit choice, kept per browser.
function setupTheme() {
  const button = document.getElementById('btn-theme')
  if (!button) return
  const label = () => {
    const dark = document.documentElement.dataset.theme === 'dark'
    button.setAttribute('aria-label', dark ? 'Switch to the light receipt' : 'Switch to the dark receipt')
  }
  label()
  button.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = next
    try {
      localStorage.setItem('llm-mock:theme', next)
    } catch {
      // storage blocked: the choice lasts for this page only
    }
    label()
  })
}

// Global actions
function setupGlobalActions() {
  // Reset button
  document.getElementById('btn-reset')?.addEventListener('click', async () => {
    if (!confirm('Reset mock to initial boot state and clear requests?')) return
    try {
      await api('POST', '/_mock/llm/reset')
      showToast('Mock reset to boot state')
      state.selectedRequestId = null
      await loadState()
      await loadRequests()
    } catch (err) {}
  })

  // Copy buttons in header
  document.getElementById('copy-vercel')?.addEventListener('click', function () {
    const origin = window.location.origin
    copyText(`${origin}/v1`, this)
  })

  document.getElementById('copy-openrouter')?.addEventListener('click', function () {
    const origin = window.location.origin
    copyText(`${origin}/api/v1`, this)
  })

  // Copy curl
  document.getElementById('btn-copy-curl')?.addEventListener('click', function () {
    const text = document.getElementById('curl-example')?.textContent || ''
    copyText(text, this, 'Curl copied!')
  })

  // Refresh requests button
  document.getElementById('btn-refresh-requests')?.addEventListener('click', () => {
    loadRequests()
  })

  // Clear requests button
  document.getElementById('btn-clear-requests')?.addEventListener('click', async () => {
    if (!confirm('Clear all recorded requests?')) return
    try {
      await api('DELETE', '/_mock/llm/requests')
      state.selectedRequestId = null
      showToast('Requests log cleared')
      await loadRequests()
    } catch (err) {}
  })

  // Close detail sidebar
  document.getElementById('btn-close-detail')?.addEventListener('click', () => {
    state.selectedRequestId = null
    const detail = document.getElementById('request-detail')
    if (detail) detail.hidden = true
    renderRequests()
  })
}

function escapeHtml(str) {
  if (typeof str !== 'string') return String(str ?? '')
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Bootstrap
window.addEventListener('DOMContentLoaded', () => {
  setupTabs()
  setupAutoRefresh()
  setupRulesForm()
  setupSettingsForm()
  setupModelsForm()
  setupGlobalActions()
  setupTheme()

  loadState()
  loadRequests()
})
