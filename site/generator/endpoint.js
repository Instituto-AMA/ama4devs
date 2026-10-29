// The endpoint switch of the generator's pages. Every example with an online
// equivalent carries both calls (`data-online`: the public endpoint on GitHub
// Pages, `data-local`: the container on localhost) and shows the one the reader
// picks; an example only the container answers is marked as such while online.
// The choice is remembered on this browser.
const KEY = 'ama4devs:generator-endpoint'

const remembered = () => {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

const remember = (/** @type {string} */ mode) => {
  try {
    localStorage.setItem(KEY, mode)
  } catch {
    // No storage (a private window): the choice lasts for this page.
  }
}

function show(/** @type {string} */ mode) {
  document.documentElement.dataset.endpoint = mode
  for (const code of /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('code[data-online]'))) {
    const text = (mode === 'online' ? code.dataset.online : code.dataset.local) ?? ''
    if (mode === 'online' && 'onlineLinks' in code.dataset) {
      // Online, a call the browser answers (the playground) is a link to open.
      code.replaceChildren(
        ...text.split('\n').flatMap((url, i) => {
          const link = document.createElement('a')
          link.href = url
          link.textContent = url
          return i === 0 ? [link] : ['\n', link]
        }),
      )
    } else {
      code.textContent = text
    }
  }
  for (const input of /** @type {NodeListOf<HTMLInputElement>} */ (document.querySelectorAll('[data-endpoint-switch] input'))) {
    input.checked = input.value === mode
  }
}

for (const toggle of document.querySelectorAll('[data-endpoint-switch]')) {
  toggle.addEventListener('change', (event) => {
    const mode = /** @type {HTMLInputElement} */ (event.target).value
    remember(mode)
    show(mode)
  })
}
show(remembered() === 'local' ? 'local' : 'online')
