/**
 * The panel's selector, in place of a native `<select>`: the browser's popup ignores
 * the theme (a blue system menu over a light dialog) and cannot search.
 *
 * A button shows the choice; it opens a list below it (above when there is no room),
 * fixed to the viewport so a dialog's scroll does not clip it. `searchable` adds a
 * filter over label and hint, accent- and case-insensitive. Keyboard: ↑ ↓ move,
 * Enter picks, Esc closes.
 */
import type { ComponentChildren } from 'preact'
import { createPortal } from 'preact/compat'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import * as I from '../icons.ts'
import { Icon } from './Icon.tsx'

export interface PickerOption {
  value: string
  label: string
  /** A second, quieter line: a document, an e-mail. */
  hint?: string
}

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

const LIST_MAX = 280

export function Picker(props: {
  value: string
  options: PickerOption[]
  onChange: (value: string) => void
  placeholder?: string
  searchable?: boolean
  /** What the open list says when nothing matches or there is nothing yet. */
  empty?: ComponentChildren
  ariaLabel?: string
  /** Width follows the content instead of the field (for a short choice beside an input). */
  compact?: boolean
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [place, setPlace] = useState<{ top: number; left: number; width: number; up: boolean } | null>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const popover = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)

  const selected = props.options.find((o) => o.value === props.value)

  const shown = useMemo(() => {
    const q = fold(query.trim())
    if (!q) return props.options
    return props.options.filter((o) => fold(`${o.label} ${o.hint ?? ''}`).includes(q))
  }, [props.options, query])

  const measure = () => {
    const r = trigger.current?.getBoundingClientRect()
    if (!r) return
    const below = window.innerHeight - r.bottom
    const up = below < LIST_MAX + 16 && r.top > below
    setPlace({ top: up ? r.top - 4 : r.bottom + 4, left: r.left, width: r.width, up })
  }

  useLayoutEffect(() => {
    if (!open) return
    measure()
    setActive(Math.max(0, shown.findIndex((o) => o.value === props.value)))
  }, [open])

  // The list exists only once it is placed: focus the search then.
  const placed = place !== null
  useEffect(() => {
    if (open && placed) search.current?.focus()
  }, [open, placed])

  useEffect(() => {
    if (!open) return
    const outside = (e: MouseEvent) => {
      const t = e.target as Node
      if (!trigger.current?.contains(t) && !popover.current?.contains(t)) setOpen(false)
    }
    // A scroll inside the dialog moves the trigger: follow it.
    const follow = () => measure()
    document.addEventListener('mousedown', outside)
    window.addEventListener('scroll', follow, true)
    window.addEventListener('resize', follow)
    return () => {
      document.removeEventListener('mousedown', outside)
      window.removeEventListener('scroll', follow, true)
      window.removeEventListener('resize', follow)
    }
  }, [open])

  const close = () => {
    setOpen(false)
    setPlace(null)
    setQuery('')
    trigger.current?.focus()
  }

  const pick = (o: PickerOption) => {
    props.onChange(o.value)
    close()
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(i + 1, shown.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const o = shown[active]
      if (o) pick(o)
    }
  }

  useEffect(() => {
    popover.current?.querySelector('.picker-option.active')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  return (
    <div class={`picker ${props.compact ? 'compact' : ''}`}>
      <button
        ref={trigger}
        type="button"
        class={`input picker-trigger ${open ? 'open' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={props.ariaLabel}
        disabled={props.disabled}
        onClick={() => (open ? close() : setOpen(true))}
        onKeyDown={(e) => {
          if (!open && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault()
            setOpen(true)
          } else if (open) onKey(e)
        }}
      >
        <span class={`picker-value ${selected ? '' : 'placeholder'}`}>
          {selected ? selected.label : (props.placeholder ?? 'Selecione…')}
          {selected?.hint && <span class="picker-hint"> · {selected.hint}</span>}
        </span>
        <Icon icon={I.CARET} size={16} class="picker-caret" />
      </button>

      {/* In <body>: a dialog's `transform` would make `position: fixed` relative to the
          dialog, and its overflow would clip the list. */}
      {open && place && createPortal(
        <div
          ref={popover}
          class={`picker-popover ${place.up ? 'up' : ''}`}
          style={{
            top: `${place.top}px`,
            left: `${place.left}px`,
            minWidth: `${place.width}px`,
          }}
          onKeyDown={onKey}
        >
          {props.searchable && (
            <div class="picker-search">
              <Icon icon={I.SEARCH} size={15} />
              <input
                ref={search}
                value={query}
                placeholder="Buscar…"
                onInput={(e) => {
                  setQuery((e.target as HTMLInputElement).value)
                  setActive(0)
                }}
              />
            </div>
          )}
          <ul class="picker-list" role="listbox" style={{ maxHeight: `${LIST_MAX}px` }}>
            {shown.map((o, i) => (
              <li
                key={o.value}
                role="option"
                aria-selected={o.value === props.value}
                class={`picker-option ${i === active ? 'active' : ''} ${o.value === props.value ? 'selected' : ''}`}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault()
                  pick(o)
                }}
              >
                <span class="picker-option-text">
                  <span>{o.label}</span>
                  {o.hint && <span class="picker-hint">{o.hint}</span>}
                </span>
                {o.value === props.value && <span class="picker-check">✓</span>}
              </li>
            ))}
          </ul>
          {shown.length === 0 && (
            <div class="picker-empty">{query ? `nada encontrado para "${query}"` : (props.empty ?? 'nenhuma opção')}</div>
          )}
        </div>,
        document.body,
      )}
    </div>
  )
}
