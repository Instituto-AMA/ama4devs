// Copy buttons on code blocks, and the table of contents that follows the reading.
;(() => {
  const lang = document.documentElement.lang.startsWith('pt') ? 'pt' : 'en'
  const words = {
    en: { copy: 'Copy', copied: 'Copied' },
    pt: { copy: 'Copiar', copied: 'Copiado' },
  }[lang]

  for (const block of document.querySelectorAll('.code')) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'copy'
    button.textContent = words.copy
    button.addEventListener('click', async () => {
      const text = block.querySelector('pre').innerText.replace(/\n$/, '')
      try {
        await navigator.clipboard.writeText(text)
        button.textContent = words.copied
        setTimeout(() => { button.textContent = words.copy }, 1600)
      } catch {
        button.remove()
      }
    })
    block.appendChild(button)
  }

  const links = [...document.querySelectorAll('.toc a[href^="#"]')]
  if (!links.length || !('IntersectionObserver' in window)) return
  const byId = new Map(links.map((a) => [a.getAttribute('href').slice(1), a]))
  const visible = new Set()
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.add(entry.target.id)
        else visible.delete(entry.target.id)
      }
      const first = [...byId.keys()].find((id) => visible.has(id))
      if (!first) return
      for (const a of links) a.classList.toggle('active', a === byId.get(first))
    },
    { rootMargin: '-80px 0px -55% 0px' },
  )
  for (const id of byId.keys()) {
    const section = document.getElementById(id)
    if (section) observer.observe(section)
  }
})()
