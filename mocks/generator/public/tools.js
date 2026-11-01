// @ts-check
/**
 * The four tools of the screen, one at a time: the tabs under the header show
 * the sheets of one tool (`data-tool` on each sheet) and hide the others.
 *
 * The address keeps the tool: `#gerar`, `#validar`, `#credito`, `#asaas`, and
 * the ids of the sheets still work as links (`#sheet-directd` opens the credit
 * check), so the links of the docs keep landing where they did.
 */

const tabs = /** @type {HTMLAnchorElement[]} */ ([...document.querySelectorAll('.tool-tabs a[data-tool]')])
const sheets = /** @type {HTMLElement[]} */ ([...document.querySelectorAll('main [data-tool]')])
const tools = tabs.map((tab) => tab.dataset.tool)

/**
 * The tool an address names: a tool's own hash, or the tool of the sheet whose
 * id it carries. The first tool otherwise.
 * @param {string} hash
 */
function toolOf(hash) {
  const id = decodeURIComponent(hash.replace(/^#/, ''))
  if (tools.includes(id)) return id
  const sheet = id ? document.getElementById(id) : null
  return sheet?.closest('[data-tool]')?.getAttribute('data-tool') ?? tools[0]
}

/**
 * Shows the sheets of one tool and marks its tab.
 * @param {string | undefined} tool
 */
function show(tool) {
  for (const sheet of sheets) sheet.hidden = sheet.dataset.tool !== tool
  for (const tab of tabs) {
    if (tab.dataset.tool === tool) tab.setAttribute('aria-current', 'page')
    else tab.removeAttribute('aria-current')
  }
}

window.addEventListener('hashchange', () => {
  show(toolOf(location.hash))
  window.scrollTo({ top: 0 })
})
show(toolOf(location.hash))
