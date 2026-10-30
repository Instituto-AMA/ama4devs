/**
 * The search and the sorting of the panel's tables.
 *
 * They test the PURE logic (`panel/src/components/table-logic.ts`), without a browser. It is the only
 * part of the screen that can be wrong in a silent way: a bad sort does not break
 * anything, does not show up in the console, and does not become a ticket. It becomes "the table is a bit messy",
 * and the person learns not to trust it.
 */
import { describe, expect, it } from 'bun:test'
import {
  compareValues,
  filterRows,
  nextSort,
  sortRows,
  type Sortable,
} from '../../panel/src/components/table-logic.ts'

interface Row {
  id: string
  customer: string
  status: string
  value: number
  paidAt: string | null
}

const ROWS: Row[] = [
  { id: 'pay_1', customer: 'Ana Souza', status: 'PENDING', value: 90, paidAt: null },
  { id: 'pay_2', customer: 'Bruno Lima', status: 'RECEIVED', value: 1000, paidAt: '2026-07-02' },
  { id: 'pay_3', customer: 'Carla Dias', status: 'OVERDUE', value: 250, paidAt: null },
  { id: 'pay_4', customer: 'Ana Souza', status: 'RECEIVED', value: 90.5, paidAt: '2026-07-01' },
]

const COLUMNS: Sortable<Row>[] = [
  { key: 'id', value: (r) => r.id },
  { key: 'customer', value: (r) => r.customer },
  { key: 'status', value: (r) => r.status },
  { key: 'value', value: (r) => r.value },
  { key: 'paidAt', value: (r) => r.paidAt },
  { key: 'actions' }, // without `value`: it does not sort, it does not search
]

describe('sorting', () => {
  /**
   * THE BUG THIS TEST KEEPS FROM COMING BACK.
   *
   * If the column sorted by the TEXT that shows on the screen ("R$ 1.000,00"), R$ 90 would come
   * AFTER R$ 1,000 — because "9" > "1". It is why `value(row)` returns the raw number
   * and `render(row)` takes care of the "R$".
   */
  it('the amount sorts as a NUMBER, not as the text "R$ 1.000,00"', () => {
    const asc = sortRows(ROWS, COLUMNS, { key: 'value', dir: 'asc' })
    expect(asc.map((r) => r.value)).toEqual([90, 90.5, 250, 1000])

    const desc = sortRows(ROWS, COLUMNS, { key: 'value', dir: 'desc' })
    expect(desc.map((r) => r.value)).toEqual([1000, 250, 90.5, 90])
  })

  it('text sorts in pt-BR, with the accent in the right place', () => {
    const rows = [{ n: 'Zeca' }, { n: 'Ávila' }, { n: 'ana' }, { n: 'Bruno' }]
    const cols: Sortable<{ n: string }>[] = [{ key: 'n', value: (r) => r.n }]

    // A raw `a < b` would put 'Zeca' before 'ana' (uppercase comes first in ASCII) and
    // 'Ávila' after everything. The pt-BR Collator solves both.
    expect(sortRows(rows, cols, { key: 'n', dir: 'asc' }).map((r) => r.n)).toEqual([
      'ana',
      'Ávila',
      'Bruno',
      'Zeca',
    ])
  })

  /**
   * Empty goes to the END in ANY direction — it is not "less than everything".
   *
   * Sorting "Paid on" exists to see what was paid. If the nulls rose to the top in the
   * ascending order, the click would produce a screen of dashes: technically sorted, useless.
   */
  it('null goes to the end in both directions, not to the top', () => {
    const asc = sortRows(ROWS, COLUMNS, { key: 'paidAt', dir: 'asc' })
    expect(asc.map((r) => r.paidAt)).toEqual(['2026-07-01', '2026-07-02', null, null])

    const desc = sortRows(ROWS, COLUMNS, { key: 'paidAt', dir: 'desc' })
    expect(desc.map((r) => r.paidAt)).toEqual([null, null, '2026-07-02', '2026-07-01'])
  })

  it('does not mutate the parent array — otherwise the list flickers on every render', () => {
    const original = [...ROWS]
    sortRows(ROWS, COLUMNS, { key: 'value', dir: 'desc' })
    expect(ROWS).toEqual(original)
  })

  it('a column without `value` does not sort — it returns the list as it came', () => {
    expect(sortRows(ROWS, COLUMNS, { key: 'actions', dir: 'asc' })).toEqual(ROWS)
  })

  it('the third click has an exit: asc → desc → the server order', () => {
    const a = nextSort(null, 'value')
    expect(a).toEqual({ key: 'value', dir: 'asc' })

    const b = nextSort(a, 'value')
    expect(b).toEqual({ key: 'value', dir: 'desc' })

    // Without this, whoever clicked cannot undo it anymore.
    expect(nextSort(b, 'value')).toBeNull()

    // Switching columns starts over at the ascending one.
    expect(nextSort(b, 'customer')).toEqual({ key: 'customer', dir: 'asc' })
  })
})

describe('search', () => {
  it('searches in ALL the columns, not only the name', () => {
    expect(filterRows(ROWS, COLUMNS, 'ana').map((r) => r.id)).toEqual(['pay_1', 'pay_4'])
    expect(filterRows(ROWS, COLUMNS, 'overdue').map((r) => r.id)).toEqual(['pay_3'])
    expect(filterRows(ROWS, COLUMNS, 'pay_2').map((r) => r.id)).toEqual(['pay_2'])
  })

  it('ignores case and surrounding spaces', () => {
    expect(filterRows(ROWS, COLUMNS, '  BRUNO  ').map((r) => r.id)).toEqual(['pay_2'])
  })

  it('an empty search returns everything, without copying', () => {
    expect(filterRows(ROWS, COLUMNS, '   ')).toBe(ROWS)
  })

  it('nothing found returns an empty list, not the whole list', () => {
    expect(filterRows(ROWS, COLUMNS, 'zzz')).toEqual([])
  })

  it('the search by number works: 1000 finds the R$ 1,000 charge', () => {
    expect(filterRows(ROWS, COLUMNS, '1000').map((r) => r.id)).toEqual(['pay_2'])
  })
})

describe('compareValues', () => {
  it('a number before a string when both are numbers', () => {
    expect(compareValues(2, 10)).toBeLessThan(0)
    // As text, "10" < "2". It is exactly the mistake we cannot make.
    expect(compareValues('2', '10')).toBeLessThan(0) // the Collator is `numeric: true`
  })

  it('two empties tie', () => {
    expect(compareValues(null, undefined)).toBe(0)
    expect(compareValues('', null)).toBe(0)
  })
})
