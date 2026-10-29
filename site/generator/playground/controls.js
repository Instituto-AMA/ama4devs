// @ts-check
/**
 * The playground's own controls, drawn in the site's receipt language: a
 * picker for a long list and a calendar for a day, each printing down from its
 * field like a slip of thermal paper.
 *
 * Both enhance a native control that stays in the form as the value's owner:
 * the picker a hidden `<select>`, the calendar a text input that still takes a
 * typed `YYYY-MM-DD`. A change made here is announced as the native control's
 * own `change`/`input` event, so the form logic never knows the difference.
 */

let uid = 0
const nextId = (/** @type {string} */ prefix) => `${prefix}-${++uid}`

/** Every open slip closes when another opens or the page is clicked elsewhere. */
/** @type {Set<() => void>} */
const openSlips = new Set()
/** The open slips and the fields they hang from, kept in place on scroll and resize. */
/** @type {Map<HTMLElement, { anchor: HTMLElement, align: 'left' | 'right', width?: number }>} */
const placed = new Map()
if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', (event) => {
    for (const close of openSlips) close.call(event.target)
  })
  const replace = () => {
    for (const [slip, how] of placed) place(slip, how)
  }
  window.addEventListener('scroll', replace, { passive: true, capture: true })
  window.addEventListener('resize', replace)
}

/**
 * Hangs a slip from its field. Slips live on <body>, outside the paper sheet:
 * the sheet's torn-edge mask would cut off anything that leaves it. Below the
 * field when it fits on screen, above it otherwise.
 * @param {HTMLElement} slip
 * @param {{ anchor: HTMLElement, align: 'left' | 'right', width?: number }} how
 */
function place(slip, { anchor, align, width }) {
  const box = anchor.getBoundingClientRect()
  const w = Math.min(width ?? box.width, window.innerWidth - 16)
  slip.style.width = `${w}px`
  const left = align === 'right' ? box.right - w : box.left
  slip.style.left = `${Math.max(8, Math.min(left, window.innerWidth - w - 8))}px`
  const tall = slip.offsetHeight
  const below = window.innerHeight - box.bottom
  const up = below < tall + 12 && box.top > below
  slip.classList.toggle('is-up', up)
  slip.style.top = up ? `${box.top - tall - 6}px` : `${box.bottom + 6}px`
}

/** Shows a slip hung from `anchor`. */
function show(/** @type {HTMLElement} */ slip, /** @type {{ anchor: HTMLElement, align: 'left' | 'right', width?: number }} */ how) {
  slip.hidden = false
  placed.set(slip, how)
  place(slip, how)
}

/** Hides a slip. */
function hide(/** @type {HTMLElement} */ slip) {
  slip.hidden = true
  placed.delete(slip)
}

/**
 * Turns a `<select>` into a button that opens a listbox slip.
 * @param {HTMLSelectElement} select
 * @returns {{ refresh(): void }}
 */
export function enhanceSelect(select) {
  const wrap = document.createElement('div')
  wrap.className = 'pg-pick'
  select.before(wrap)
  wrap.append(select)
  select.classList.add('pg-native')
  select.tabIndex = -1
  select.setAttribute('aria-hidden', 'true')

  const listId = nextId('pg-list')
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'pg-pick-button'
  button.setAttribute('aria-haspopup', 'listbox')
  button.setAttribute('aria-expanded', 'false')
  button.setAttribute('aria-controls', listId)
  // The field is a <div>, not a <label>: a label would forward a click on the
  // list back to the button and reopen it.
  const label = select.closest('.pg-field')?.querySelector('.pg-name')
  if (label) {
    label.id ||= nextId('pg-name')
    button.setAttribute('aria-labelledby', `${label.id} ${(button.id = nextId('pg-btn'))}`)
  }
  const shown = document.createElement('span')
  shown.className = 'pg-pick-value'
  button.append(shown, chevron())
  wrap.prepend(button)

  // The slip casts the shadow; the paper inside carries the torn edge (a mask
  // would clip a shadow on the same element).
  const slip = document.createElement('div')
  slip.className = 'pg-slip'
  slip.hidden = true
  const list = document.createElement('ul')
  list.className = 'pg-paper pg-list'
  list.id = listId
  list.setAttribute('role', 'listbox')
  list.tabIndex = -1
  slip.append(list)
  document.body.append(slip)

  let active = 0
  let typed = ''
  let typedAt = 0

  function options() {
    return [...select.options]
  }

  function render() {
    list.replaceChildren(
      ...options().map((option, i) => {
        const item = document.createElement('li')
        item.id = `${listId}-${i}`
        item.setAttribute('role', 'option')
        item.setAttribute('aria-selected', String(option.selected))
        const [code, ...rest] = option.text.split(' · ')
        const main = document.createElement('span')
        main.className = 'pg-opt-code'
        main.textContent = code
        item.append(main)
        if (rest.length) {
          const aside = document.createElement('span')
          aside.className = 'pg-opt-name'
          aside.textContent = rest.join(' · ')
          item.append(aside)
        }
        item.addEventListener('pointerdown', (event) => event.preventDefault())
        item.addEventListener('click', () => choose(i))
        return item
      }),
    )
  }

  function refresh() {
    const option = select.selectedOptions[0]
    const [code, ...rest] = (option?.text ?? '').split(' · ')
    const name = document.createElement('span')
    name.className = 'pg-opt-name'
    name.textContent = rest.join(' · ')
    const main = document.createElement('span')
    main.className = 'pg-opt-code'
    main.textContent = code
    shown.replaceChildren(main, ...(rest.length ? [' ', name] : []))
  }

  function highlight(/** @type {number} */ i) {
    const items = /** @type {HTMLElement[]} */ ([...list.children])
    if (!items.length) return
    active = Math.max(0, Math.min(items.length - 1, i))
    items.forEach((item, n) => item.classList.toggle('is-active', n === active))
    list.setAttribute('aria-activedescendant', items[active].id)
    items[active].scrollIntoView({ block: 'nearest' })
  }

  function open() {
    if (!slip.hidden) return
    for (const other of openSlips) other()
    render()
    show(slip, { anchor: button, align: 'left' })
    button.setAttribute('aria-expanded', 'true')
    highlight(Math.max(0, select.selectedIndex))
    list.focus({ preventScroll: true })
    openSlips.add(closeFromOutside)
  }

  function close(/** @type {boolean} */ refocus = true) {
    if (slip.hidden) return
    hide(slip)
    button.setAttribute('aria-expanded', 'false')
    openSlips.delete(closeFromOutside)
    if (refocus) button.focus({ preventScroll: true })
  }

  /** @this {EventTarget | undefined} */
  function closeFromOutside() {
    if (this instanceof Node && (wrap.contains(this) || slip.contains(this))) return
    close(false)
  }

  function choose(/** @type {number} */ i) {
    if (select.selectedIndex !== i) {
      select.selectedIndex = i
      select.dispatchEvent(new Event('change', { bubbles: true }))
    }
    refresh()
    close()
  }

  button.addEventListener('click', () => (slip.hidden ? open() : close()))
  button.addEventListener('keydown', (event) => {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
      event.preventDefault()
      open()
    }
  })
  list.addEventListener('keydown', (event) => {
    const last = options().length - 1
    switch (event.key) {
      case 'ArrowDown': highlight(active + 1); break
      case 'ArrowUp': highlight(active - 1); break
      case 'PageDown': highlight(active + 8); break
      case 'PageUp': highlight(active - 8); break
      case 'Home': highlight(0); break
      case 'End': highlight(last); break
      case 'Enter':
      case ' ': choose(active); break
      case 'Escape': close(); break
      case 'Tab': close(false); return
      default: {
        if (event.key.length !== 1) return
        // Typing jumps to the first option that starts with what was typed.
        typed = event.timeStamp - typedAt > 700 ? event.key : typed + event.key
        typedAt = event.timeStamp
        const hit = options().findIndex((o) => o.text.toLowerCase().startsWith(typed.toLowerCase()))
        if (hit >= 0) highlight(hit)
        return
      }
    }
    event.preventDefault()
  })
  select.addEventListener('change', refresh)

  refresh()
  return { refresh }
}

/**
 * Gives a text input of a `YYYY-MM-DD` day a calendar slip.
 * @param {HTMLInputElement} input
 * @param {{ today: string, clear: string, open: string, prev: string, next: string }} words
 * @returns {{ refresh(): void }}
 */
export function enhanceDate(input, words) {
  const lang = document.documentElement.lang || 'en'
  const wrap = document.createElement('div')
  wrap.className = 'pg-date'
  input.before(wrap)
  wrap.append(input)

  const toggle = document.createElement('button')
  toggle.type = 'button'
  toggle.className = 'pg-date-toggle'
  toggle.setAttribute('aria-label', words.open)
  toggle.setAttribute('aria-haspopup', 'dialog')
  toggle.setAttribute('aria-expanded', 'false')
  toggle.append(calendarIcon())
  wrap.append(toggle)

  const slip = document.createElement('div')
  slip.className = 'pg-slip'
  slip.setAttribute('role', 'dialog')
  slip.setAttribute('aria-modal', 'false')
  slip.hidden = true
  const paper = document.createElement('div')
  paper.className = 'pg-paper pg-cal'
  slip.append(paper)
  document.body.append(slip)

  const monthName = new Intl.DateTimeFormat(lang, { month: 'long', year: 'numeric', timeZone: 'UTC' })
  const dayName = new Intl.DateTimeFormat(lang, { weekday: 'narrow', timeZone: 'UTC' })
  const fullDay = new Intl.DateTimeFormat(lang, { dateStyle: 'full', timeZone: 'UTC' })
  // Sunday first, as Brazilian calendars print it.
  const weekdays = [...Array(7)].map((_, i) => dayName.format(Date.UTC(2023, 0, 1 + i)))

  /** The day the grid's keyboard cursor is on, and the month it shows. */
  let cursor = todayIso()
  slip.setAttribute('aria-label', words.open)

  function todayIso() {
    const now = new Date()
    return iso(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
  }

  function render() {
    const [y, m] = cursor.split('-').map(Number)
    const first = Date.UTC(y, m - 1, 1)
    const startsOn = new Date(first).getUTCDay()
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate()
    const picked = valid(input.value) ? input.value : ''
    const today = todayIso()

    const head = document.createElement('div')
    head.className = 'pg-cal-head'
    const title = document.createElement('p')
    title.className = 'pg-cal-title'
    title.textContent = monthName.format(first)
    title.setAttribute('aria-live', 'polite')
    head.append(navKey('‹', words.prev, () => move({ months: -1 })), title, navKey('›', words.next, () => move({ months: 1 })))

    const grid = document.createElement('div')
    grid.className = 'pg-cal-grid'
    grid.setAttribute('role', 'grid')
    for (const w of weekdays) {
      const cell = document.createElement('span')
      cell.className = 'pg-cal-dow'
      cell.setAttribute('aria-hidden', 'true')
      cell.textContent = w
      grid.append(cell)
    }
    for (let i = 0; i < startsOn; i++) grid.append(document.createElement('span'))
    for (let d = 1; d <= days; d++) {
      const day = iso(Date.UTC(y, m - 1, d))
      const key = document.createElement('button')
      key.type = 'button'
      key.className = 'pg-cal-day'
      key.textContent = String(d)
      key.dataset.day = day
      key.tabIndex = day === cursor ? 0 : -1
      key.setAttribute('aria-label', fullDay.format(Date.UTC(y, m - 1, d)))
      if (day === picked) key.setAttribute('aria-pressed', 'true')
      if (day === today) key.classList.add('is-today')
      key.addEventListener('click', () => pick(day))
      grid.append(key)
    }

    const foot = document.createElement('div')
    foot.className = 'pg-cal-foot'
    foot.append(plainKey(words.today, () => pick(today)), plainKey(words.clear, () => pick('')))

    paper.replaceChildren(head, grid, foot)
  }

  function focusCursor() {
    /** @type {HTMLElement | null} */ (slip.querySelector(`[data-day="${cursor}"]`))?.focus({ preventScroll: true })
  }

  function move(/** @type {{ days?: number, months?: number }} */ by) {
    const [y, m, d] = cursor.split('-').map(Number)
    if (by.months) {
      const last = new Date(Date.UTC(y, m - 1 + by.months + 1, 0)).getUTCDate()
      cursor = iso(Date.UTC(y, m - 1 + by.months, Math.min(d, last)))
    } else {
      cursor = iso(Date.UTC(y, m - 1, d + (by.days ?? 0)))
    }
    render()
    focusCursor()
  }

  function pick(/** @type {string} */ day) {
    input.value = day
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    close()
  }

  function open() {
    if (!slip.hidden) return
    for (const other of openSlips) other()
    cursor = valid(input.value) ? input.value : todayIso()
    render()
    show(slip, { anchor: wrap, align: 'right', width: 320 })
    toggle.setAttribute('aria-expanded', 'true')
    focusCursor()
    openSlips.add(closeFromOutside)
  }

  function close(/** @type {boolean} */ refocus = true) {
    if (slip.hidden) return
    hide(slip)
    toggle.setAttribute('aria-expanded', 'false')
    openSlips.delete(closeFromOutside)
    if (refocus) input.focus({ preventScroll: true })
  }

  /** @this {EventTarget | undefined} */
  function closeFromOutside() {
    if (this instanceof Node && (wrap.contains(this) || slip.contains(this))) return
    close(false)
  }

  toggle.addEventListener('click', () => (slip.hidden ? open() : close()))
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' && event.altKey) {
      event.preventDefault()
      open()
    }
  })
  input.addEventListener('input', () => input.setAttribute('aria-invalid', String(input.value !== '' && !valid(input.value))))
  slip.addEventListener('keydown', (event) => {
    const onDay = event.target instanceof HTMLElement && event.target.dataset.day
    switch (event.key) {
      case 'Escape': close(); break
      case 'ArrowLeft': if (onDay) move({ days: -1 }); else return; break
      case 'ArrowRight': if (onDay) move({ days: 1 }); else return; break
      case 'ArrowUp': if (onDay) move({ days: -7 }); else return; break
      case 'ArrowDown': if (onDay) move({ days: 7 }); else return; break
      case 'PageUp': move({ months: event.shiftKey ? -12 : -1 }); break
      case 'PageDown': move({ months: event.shiftKey ? 12 : 1 }); break
      default: return
    }
    event.preventDefault()
  })

  return { refresh: () => input.dispatchEvent(new Event('input')) }
}

/** A `YYYY-MM-DD` that names a real day. */
function valid(/** @type {string} */ value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  return iso(Date.parse(`${value}T00:00:00Z`)) === value
}

/** The `YYYY-MM-DD` of a UTC epoch. */
function iso(/** @type {number} */ ms) {
  return Number.isNaN(ms) ? '' : new Date(ms).toISOString().slice(0, 10)
}

function navKey(/** @type {string} */ glyph, /** @type {string} */ name, /** @type {() => void} */ act) {
  const key = document.createElement('button')
  key.type = 'button'
  key.className = 'pg-cal-nav'
  key.textContent = glyph
  key.setAttribute('aria-label', name)
  key.addEventListener('click', act)
  return key
}

function plainKey(/** @type {string} */ text, /** @type {() => void} */ act) {
  const key = document.createElement('button')
  key.type = 'button'
  key.className = 'key small'
  key.textContent = text
  key.addEventListener('click', act)
  return key
}

function chevron() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('aria-hidden', 'true')
  svg.innerHTML = '<path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square"/>'
  return svg
}

function calendarIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 20 20')
  svg.setAttribute('aria-hidden', 'true')
  svg.innerHTML =
    '<rect x="3" y="4.5" width="14" height="12" fill="none" stroke="currentColor" stroke-width="1.6"/>' +
    '<path d="M3 8.5h14M7 2.5v4M13 2.5v4" stroke="currentColor" stroke-width="1.6"/>' +
    '<path d="M6 11h2v2H6zM9 11h2v2H9zM12 11h2v2h-2z" fill="currentColor"/>'
  return svg
}
