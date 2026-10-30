/**
 * The logic of the table — searching and sorting. PURE, and separated from the
 * component on purpose: it is the only part that can be wrong in a silent way,
 * and the only one that can be tested without a browser.
 *
 * The bug this separation exists to prevent: sorting "Value" by comparing the
 * STRING "R$ 1.000,00", where R$ 90,00 comes after R$ 1.000,00 because "9" >
 * "1". It does not look like a bug — it looks like "the table is a bit messy",
 * and nobody opens a ticket for that. That is why the column declares
 * `value(row)` (the raw data) apart from `render(row)` (how it shows up):
 * whoever sorts looks at the number.
 */
export interface SortSpec {
  key: string
  dir: 'asc' | 'desc'
}

export type Value = string | number | null | undefined

export interface Sortable<T> {
  key: string
  value?: (row: T) => Value
}

const collator = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' })

/**
 * Null goes to the END in any direction. A "Paid at" column with half of the
 * rows empty must not push the dashes to the top when you sort by it — what
 * you want to see is what HAS a date.
 */
export function compareValues(a: Value, b: Value): number {
  const an = a === null || a === undefined || a === ''
  const bn = b === null || b === undefined || b === ''
  if (an && bn) return 0
  if (an) return 1
  if (bn) return -1

  if (typeof a === 'number' && typeof b === 'number') return a - b
  return collator.compare(String(a), String(b))
}

/** Search in EVERYTHING the row shows — not only in the "name". */
export function filterRows<T>(rows: T[], columns: Sortable<T>[], query: string): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return rows

  const searchable = columns.filter((c) => c.value)
  return rows.filter((row) =>
    searchable.some((c) => String(c.value!(row) ?? '').toLowerCase().includes(q)),
  )
}

export function sortRows<T>(rows: T[], columns: Sortable<T>[], sort: SortSpec | null): T[] {
  if (!sort) return rows
  const col = columns.find((c) => c.key === sort.key)
  if (!col?.value) return rows

  // A copy: `Array.sort` mutates in place, and mutating the array of the parent
  // makes Preact lose the reference — the list blinks on every render.
  const out = [...rows]
  out.sort((a, b) => compareValues(col.value!(a), col.value!(b)))
  return sort.dir === 'desc' ? out.reverse() : out
}

/** asc → desc → no sorting (the server's one). The third click has to have an exit. */
export function nextSort(cur: SortSpec | null, key: string): SortSpec | null {
  if (cur?.key !== key) return { key, dir: 'asc' }
  if (cur.dir === 'asc') return { key, dir: 'desc' }
  return null
}
