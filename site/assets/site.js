// The site's behavior: the printer that replays a run of a mock, the copy keys on
// code blocks, the index that follows the reading, and the API reference.
;(() => {
  const lang = document.documentElement.lang.startsWith('pt') ? 'pt' : 'en'
  const words = {
    en: {
      copy: 'Copy',
      copied: 'Copied',
      again: 'Print again',
      ops: (shown, total, live) => `${shown} of ${total} operations, ${live} with real behavior`,
      routes: (shown, total) => `${shown} of ${total} routes, answers captured from a run of the image`,
      live: 'real behavior',
      spec: 'spec example',
      none: 'No operation matches.',
      params: 'Parameters',
      body: 'Request body',
      fields: 'Fields',
      example: 'Request example',
      responses: 'Responses',
      name: 'Name',
      where: 'In',
      type: 'Type',
      desc: 'Description',
      required: 'required',
      loading: 'Loading…',
      failed: 'The details did not load. Try again.',
      noBody: 'No body.',
    },
    pt: {
      copy: 'Copiar',
      copied: 'Copiado',
      again: 'Imprimir de novo',
      ops: (shown, total, live) => `${shown} de ${total} operações, ${live} com comportamento real`,
      routes: (shown, total) => `${shown} de ${total} rotas, respostas capturadas de uma execução da imagem`,
      live: 'comportamento real',
      spec: 'exemplo da spec',
      none: 'Nenhuma operação encontrada.',
      params: 'Parâmetros',
      body: 'Corpo da requisição',
      fields: 'Campos',
      example: 'Exemplo de requisição',
      responses: 'Respostas',
      name: 'Nome',
      where: 'Onde',
      type: 'Tipo',
      desc: 'Descrição',
      required: 'obrigatório',
      loading: 'Carregando…',
      failed: 'Os detalhes não carregaram. Tente de novo.',
      noBody: 'Sem corpo.',
    },
  }[lang]
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches

  // ── The printer ──
  // The lines are in the HTML (readable with no script). Each carries the step that
  // prints it; step 0 prints on its own, every later step waits for its key.
  for (const printer of document.querySelectorAll('[data-printer]')) {
    const tape = printer.querySelector('.tape')
    const lines = [...printer.querySelectorAll('.ln[data-step]')]
    const key = printer.querySelector('[data-next]')
    const again = printer.querySelector('[data-again]')
    const dots = printer.querySelector('.progress')
    const labels = JSON.parse(printer.dataset.printer || '[]')
    const last = Math.max(...lines.map((l) => Number(l.dataset.step)))
    let step = -1
    let busy = false

    tape.classList.add('is-printing')
    if (dots) dots.innerHTML = '<i></i>'.repeat(last + 1)

    const paint = () => {
      const done = step >= last
      key.disabled = done || busy
      key.querySelector('span').textContent = done ? labels[last] : labels[step + 1]
      if (dots) [...dots.children].forEach((d, i) => d.classList.toggle('on', i <= step))
    }

    const wait = (ms) => new Promise((r) => setTimeout(r, ms))

    const print = async (n) => {
      busy = true
      step = n
      paint()
      for (const line of lines.filter((l) => Number(l.dataset.step) === n)) {
        line.hidden = false
        if (still) continue
        line.classList.remove('printed')
        tape.classList.remove('fed')
        void tape.offsetWidth
        line.classList.add('printed')
        tape.classList.add('fed')
        await wait(line.classList.contains('day') ? 420 : 300)
      }
      busy = false
      paint()
    }

    const reset = () => {
      for (const line of lines) line.hidden = true
      step = -1
      print(0)
    }

    key.addEventListener('click', () => {
      if (!busy && step < last) print(step + 1)
    })
    again?.addEventListener('click', () => {
      if (!busy) reset()
    })

    // Print when the printer first comes into view, not before.
    for (const line of lines) line.hidden = true
    paint()
    if ('IntersectionObserver' in window) {
      const seen = new IntersectionObserver((entries) => {
        if (!entries.some((e) => e.isIntersecting)) return
        seen.disconnect()
        print(0)
      }, { threshold: 0.3 })
      seen.observe(printer)
    } else {
      print(0)
    }
  }

  // ── Copy keys on code ──
  const addCopy = (block) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'key small copy'
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
  for (const block of document.querySelectorAll('.code, .cmd')) addCopy(block)

  // ── The index follows the reading ──
  const links = [...document.querySelectorAll('.toc a[href^="#"]')]
  if (links.length && 'IntersectionObserver' in window) {
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
      { rootMargin: '-90px 0px -55% 0px' },
    )
    for (const id of byId.keys()) {
      const section = document.getElementById(id)
      if (section) observer.observe(section)
    }
  }

  // ── API reference ──
  // data-api names the list: [{ tag, ops: [{ id, method, path, summary, live }] }].
  // Its "-details" sibling holds what a row opens to, fetched on the first open.
  for (const api of document.querySelectorAll('[data-api]')) {
    const list = api.querySelector('.api-list')
    const search = api.querySelector('input[type="search"]')
    const onlyLive = api.querySelector('input[type="checkbox"]')
    const count = api.querySelector('.api-count')
    // A mock's own routes (data-kind="routes") have no "real behavior" badge: all are.
    const routes = api.dataset.kind === 'routes'
    let groups = []
    let details = null

    const el = (tag, cls, text) => {
      const e = document.createElement(tag)
      if (cls) e.className = cls
      if (text !== undefined) e.textContent = text
      return e
    }

    const loadDetails = () => {
      details ??= fetch(api.dataset.api.replace(/\.json$/, '-details.json')).then((r) => {
        if (!r.ok) throw new Error(String(r.status))
        return r.json()
      })
      details.catch(() => { details = null })
      return details
    }

    const json = (value) => {
      const block = el('div', 'code')
      const pre = el('pre')
      pre.append(el('code', null, typeof value === 'string' ? value : JSON.stringify(value, null, 2)))
      block.append(pre)
      addCopy(block)
      return block
    }

    const table = (head, rows) => {
      const wrap = el('div', 'table-wrap')
      const t = el('table')
      const tr = el('tr')
      for (const h of head) tr.append(el('th', null, h))
      const thead = el('thead')
      thead.append(tr)
      const tbody = el('tbody')
      for (const row of rows) {
        const r = el('tr')
        for (const cell of row) {
          const td = el('td')
          td.append(cell)
          r.append(td)
        }
        tbody.append(r)
      }
      t.append(thead, tbody)
      wrap.append(t)
      return wrap
    }

    const nameCell = (name, required) => {
      const span = el('span')
      span.append(el('code', null, name))
      if (required) span.append(' ', el('span', 'req', words.required))
      return span
    }

    // One panel per example or status: chips switch between them.
    const switcher = (items, labelOf, classOf, bodyOf) => {
      const box = el('div', 'switch')
      const chips = el('div', 'chips')
      const view = el('div')
      items.forEach((item, i) => {
        const chip = el('button', `chip ${classOf(item)}`, labelOf(item))
        chip.type = 'button'
        chip.setAttribute('aria-pressed', String(i === 0))
        chip.addEventListener('click', () => {
          for (const c of chips.children) c.setAttribute('aria-pressed', String(c === chip))
          view.replaceChildren(...bodyOf(item))
        })
        chips.append(chip)
      })
      view.replaceChildren(...bodyOf(items[0]))
      box.append(chips, view)
      return box
    }

    const renderDetails = (d) => {
      const parts = []
      if (d.description) parts.push(el('p', 'op-desc', d.description))
      if (d.params.length) {
        parts.push(el('h4', null, words.params))
        parts.push(table([words.name, words.where, words.type, words.desc],
          d.params.map((p) => [nameCell(p.name, p.required), p.in, p.type, p.description])))
      }
      if (d.fields.length || d.examples.length) {
        const h = el('h4', null, words.body)
        if (d.contentType) h.append(' ', el('small', null, d.contentType))
        parts.push(h)
        if (d.fields.length) {
          parts.push(table([words.name, words.type, words.desc],
            d.fields.map((f) => [nameCell(f.name, f.required), f.type, f.description])))
        }
        if (d.examples.length) {
          parts.push(el('h4', null, words.example))
          parts.push(d.examples.length === 1
            ? json(d.examples[0].value)
            : switcher(d.examples, (e) => e.name, () => '', (e) => [json(e.value)]))
        }
      }
      if (d.responses.length) {
        parts.push(el('h4', null, words.responses))
        parts.push(switcher(d.responses, (r) => r.status,
          (r) => (r.status.startsWith('2') ? 'ok' : 'err'),
          (r) => {
            const out = []
            if (r.description) out.push(el('p', 'op-desc', r.description))
            out.push(r.example === null || r.example === undefined ? el('p', 'op-desc', words.noBody) : json(r.example))
            return out
          }))
      }
      return parts
    }

    const openRow = async (row, op) => {
      const body = row.querySelector('.op-body')
      if (body.dataset.done) return
      body.replaceChildren(el('p', 'op-desc', words.loading))
      try {
        const all = await loadDetails()
        body.replaceChildren(...renderDetails(all[op.id]))
        body.dataset.done = '1'
      } catch {
        body.replaceChildren(el('p', 'op-desc', words.failed))
      }
    }

    const render = () => {
      const q = search.value.trim().toLowerCase()
      let shown = 0
      let total = 0
      let live = 0
      list.replaceChildren()
      for (const g of groups) {
        total += g.ops.length
        live += g.ops.filter((o) => o.live).length
        const ops = g.ops.filter((o) =>
          (!onlyLive?.checked || o.live) &&
          (!q || `${g.tag} ${o.method} ${o.path} ${o.summary}`.toLowerCase().includes(q)))
        if (!ops.length) continue
        shown += ops.length
        const section = el('section', 'api-group')
        const h = el('h3', null, g.tag)
        h.append(el('small', null, String(ops.length)))
        section.append(h)
        for (const o of ops) {
          const row = el('details', 'op-row')
          row.id = `op-${o.id}`
          const head = el('summary', 'op')
          head.append(el('span', 'm', o.method), el('span', 'p', o.path))
          if (!routes) head.append(el('span', `b ${o.live ? 'live' : 'spec'}`, o.live ? words.live : words.spec))
          head.append(el('span', 's', o.summary))
          row.append(head, el('div', 'op-body'))
          row.addEventListener('toggle', () => { if (row.open) openRow(row, o) })
          section.append(row)
        }
        list.append(section)
      }
      if (!shown) list.append(el('p', 'api-empty', words.none))
      count.textContent = routes ? words.routes(shown, total) : words.ops(shown, total, live)
    }

    fetch(api.dataset.api)
      .then((r) => r.json())
      .then((data) => {
        groups = data
        render()
        // A link to one operation (#op-<id>) opens it.
        const linked = location.hash.startsWith('#op-') && document.getElementById(location.hash.slice(1))
        if (linked) {
          linked.open = true
          linked.scrollIntoView()
        }
      })
      .catch(() => {})
    search.addEventListener('input', render)
    onlyLive?.addEventListener('change', render)
  }
})()
