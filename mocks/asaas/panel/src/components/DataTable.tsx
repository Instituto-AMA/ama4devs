/**
 * The table with search and sorting. EVERY listing of the panel goes through
 * here.
 *
 * The temptation was to solve search and sort inside each page. Five pages
 * later, each one would sort in its own way — one comparing `String`, another
 * `localeCompare`, and the one of values comparing "R$ 1.000,00" as TEXT,
 * where R$ 90 comes after R$ 1.000. That bug does not look like a bug: it
 * looks like the table "is a bit messy".
 *
 * That is why the column declares `value(row)` — the RAW data (number or
 * string), apart from the `render(row)` that decides how it shows up. Whoever
 * sorts and whoever searches looks at the value; whoever draws looks at the
 * render. A column without `value` does not sort and does not enter the search,
 * and that is explicit instead of silent.
 */
import type { ComponentChildren } from 'preact'
import { useMemo, useState } from 'preact/hooks'
import * as I from '../icons.ts'
import { Icon } from './Icon.tsx'
import { filterRows, nextSort, sortRows, type SortSpec, type Value } from './table-logic.ts'
import { Empty } from './ui.tsx'
import './DataTable.css'

export interface Column<T> {
  key: string
  header: string
  /** How the cell shows up. */
  render: (row: T) => ComponentChildren
  /**
   * The RAW data, to sort and to search by. A number sorts as a number.
   * Without it, the column neither sorts nor enters the search — on purpose and
   * in plain sight.
   */
  value?: (row: T) => Value
  align?: 'right'
}

export function DataTable<T>(props: {
  rows: T[]
  columns: Column<T>[]
  /** Text of the search field. Without it, no search. */
  searchPlaceholder?: string
  /** Initial column and direction. */
  initialSort?: SortSpec
  empty?: ComponentChildren
  /** An actions column at the end, outside the search and the sorting. */
  actions?: (row: T) => ComponentChildren
  /** A click on a row (outside its actions) opens it. */
  onRowClick?: (row: T) => void
}) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortSpec | null>(props.initialSort ?? null)

  const sorted = useMemo(
    () => sortRows(filterRows(props.rows, props.columns, query), props.columns, sort),
    [props.rows, props.columns, query, sort],
  )

  const toggle = (key: string) => setSort((cur) => nextSort(cur, key))

  return (
    <div class="dt">
      {props.searchPlaceholder && (
        <div class="dt-bar">
          <div class="dt-search">
            <Icon icon={I.SEARCH} size={16} />
            <input
              type="search"
              placeholder={props.searchPlaceholder}
              value={query}
              onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
            />
          </div>
          <span class="dt-count">
            {query
              ? `${sorted.length} de ${props.rows.length}`
              : `${props.rows.length} ${props.rows.length === 1 ? 'registro' : 'registros'}`}
          </span>
        </div>
      )}

      <div class="scroll">
        <table>
          <thead>
            <tr>
              {props.columns.map((c) => {
                const active = sort?.key === c.key
                return (
                  <th key={c.key} class={c.align === 'right' ? 'right' : undefined}>
                    {c.value ? (
                      <button
                        class={`dt-sort ${active ? 'active' : ''}`}
                        onClick={() => toggle(c.key)}
                        title="Ordenar"
                      >
                        {c.header}
                        <Icon
                          icon={active && sort.dir === 'desc' ? I.SORT_DESC : I.SORT_ASC}
                          size={13}
                          class="dt-arrow"
                        />
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                )
              })}
              {props.actions && <th />}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, i) => (
              <tr
                key={i}
                class={props.onRowClick ? 'dt-clickable' : undefined}
                onClick={props.onRowClick ? () => props.onRowClick!(row) : undefined}
              >
                {props.columns.map((c) => (
                  <td key={c.key} class={c.align === 'right' ? 'right' : undefined}>
                    {c.render(row)}
                  </td>
                ))}
                {props.actions && (
                  <td onClick={(e) => e.stopPropagation()}>{props.actions(row)}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {sorted.length === 0 && (
        <Empty>
          {query ? `nada encontrado para "${query}"` : (props.empty ?? 'nenhum registro')}
        </Empty>
      )}
    </div>
  )
}
