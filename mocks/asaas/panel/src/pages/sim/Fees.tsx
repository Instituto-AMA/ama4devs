import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { admin } from '../../api.ts'
import { Banner, Button, Card, errorText } from '../../components/ui.tsx'
import {
  applyFees,
  feeDomId,
  feeGroups,
  feeKey,
  feeTexts,
  formatFee,
  parseFee,
  UNIT_SIGN,
  type FeeGroupSpec,
  type FeeSpec,
  type FeeTree,
} from './fees-model.ts'
import './Fees.css'

/**
 * The fees the mock charges, as a sheet the developer edits.
 *
 * The screen is a ledger: a group per kind of fee, a line per fee, the word on the
 * left and the number cut in the paper on the right. Every number is a slot that
 * takes a Brazilian decimal (`1,99`) and sends the table's own scale back — the
 * cents and the basis points the mock reasons in.
 */
export function Fees() {
  const [tree, setTree] = useState<FeeTree | null>(null)
  const [texts, setTexts] = useState<Record<string, string>>({})
  const [baseline, setBaseline] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [invalid, setInvalid] = useState<Record<string, string>>({})
  const slots = useRef<Record<string, HTMLInputElement | null>>({})

  const groups = useMemo<FeeGroupSpec[]>(() => (tree ? feeGroups(tree) : []), [tree])

  /**
   * The two columns of the sheet.
   *
   * The groups are split in half and each half keeps its own column: the order of
   * the fee table is the order of the reading — down the left, then down the
   * right — and a group that grows (a field reporting a mistake) never moves a
   * group of the other side.
   */
  const columns = useMemo(() => {
    const half = Math.ceil(groups.length / 2)
    return [groups.slice(0, half), groups.slice(half)]
  }, [groups])

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const loaded = (await admin('/fees')) as FeeTree
      const next = feeTexts(loaded, feeGroups(loaded))
      setTree(loaded)
      setTexts(next)
      setBaseline(next)
      setInvalid({})
    } catch (err) {
      setError(errorText(err))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    void load()
  }, [])

  /** The lines the developer changed since the table was loaded. */
  const changed = Object.keys(texts).filter((key) => texts[key] !== baseline[key]).length

  const edit = (key: string, value: string) => {
    setTexts((previous) => ({ ...previous, [key]: value }))
    setInvalid((previous) => {
      if (!previous[key]) return previous
      const next = { ...previous }
      delete next[key]
      return next
    })
    setSaved(false)
  }

  /**
   * The slot takes the number back to the shape the sheet prints — and says what
   * is wrong with it when it is not a number at all.
   */
  const normalize = (field: FeeSpec) => {
    const key = feeKey(field.path)
    const value = parseFee(texts[key] ?? '', field.unit)
    if (value === null) {
      setInvalid((previous) => ({ ...previous, [key]: 'Informe um número.' }))
      return
    }
    setTexts((previous) => ({ ...previous, [key]: formatFee(value, field.unit) }))
    setInvalid((previous) => {
      if (!previous[key]) return previous
      const next = { ...previous }
      delete next[key]
      return next
    })
  }

  const save = async (event: Event) => {
    event.preventDefault()
    const values: Record<string, number> = {}
    const problems: Record<string, string> = {}
    for (const group of groups) {
      for (const field of group.fields) {
        const key = feeKey(field.path)
        const parsed = parseFee(texts[key] ?? '', field.unit)
        if (parsed === null) problems[key] = 'Informe um número.'
        else values[key] = parsed
      }
    }
    setInvalid(problems)
    const first = Object.keys(problems)[0]
    if (first) {
      slots.current[first]?.focus()
      return
    }
    setBusy(true)
    setError('')
    setSaved(false)
    try {
      const next = (await admin('/fees', {
        method: 'PATCH',
        body: JSON.stringify(applyFees(tree as FeeTree, groups, values)),
      })) as FeeTree
      const reloaded = feeTexts(next, groups)
      setTree(next)
      setTexts(reloaded)
      setBaseline(reloaded)
      setSaved(true)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div class="stack">
      <Banner tone="primary">
        As taxas que o mock cobra. Valem para todos os perfis e sobrevivem ao reinício. A
        aplicação lê os valores em <code>GET /v3/myAccount/fees</code> — a alteração vale
        para os próximos cálculos.
      </Banner>
      {error && <Banner tone="danger">{error}</Banner>}
      {saved && <Banner tone="success">Taxas salvas.</Banner>}
      {loading && <p class="empty">Carregando taxas…</p>}
      {tree && !loading && (
        <form class="stack" onSubmit={save} noValidate>
          <div class="fees-groups">
            {columns.map((column, index) => (
              <div class="fees-column" key={index}>
                {column.map((group) => (
                  <Card
                    key={group.title}
                    title={group.title}
                    subtitle={group.note}
                    class="fees-group"
                  >
                    {group.fields.map((field) => {
                      const key = feeKey(field.path)
                      const id = feeDomId(field.path)
                      const sign = UNIT_SIGN[field.unit]
                      const describedBy = [
                        sign ? `${id}-unit` : '',
                        invalid[key] ? `${id}-error` : '',
                      ]
                        .filter(Boolean)
                        .join(' ')
                      return (
                        <div class="fee-row" key={key}>
                          <label class="fee-label" htmlFor={id}>
                            {field.label}
                          </label>
                          <span class={`fee-slot ${field.unit}`}>
                            {sign && (
                              <span class="fee-unit" id={`${id}-unit`}>
                                {sign}
                              </span>
                            )}
                            <input
                              id={id}
                              ref={(element) => {
                                slots.current[key] = element
                              }}
                              class="input fee-input"
                              type="text"
                              inputMode={
                                field.unit === 'count' || field.unit === 'raw'
                                  ? 'numeric'
                                  : 'decimal'
                              }
                              autoComplete="off"
                              spellcheck={false}
                              value={texts[key] ?? ''}
                              disabled={busy}
                              aria-invalid={invalid[key] ? 'true' : undefined}
                              aria-describedby={describedBy || undefined}
                              onInput={(event) => edit(key, event.currentTarget.value)}
                              onBlur={() => normalize(field)}
                            />
                          </span>
                          {invalid[key] && (
                            <span class="fee-error" id={`${id}-error`}>
                              {invalid[key]}
                            </span>
                          )}
                        </div>
                      )
                    })}
                  </Card>
                ))}
              </div>
            ))}
          </div>
          <div class="fees-actions">
            <span class="fees-state">
              {changed === 0
                ? 'Nenhuma alteração para salvar.'
                : `${changed} ${changed === 1 ? 'alteração' : 'alterações'} para salvar.`}
            </span>
            <div class="row">
              <Button
                type="button"
                variant="ghost"
                disabled={busy || changed === 0}
                onClick={() => {
                  setTexts({ ...baseline })
                  setInvalid({})
                  setSaved(false)
                }}
              >
                Descartar
              </Button>
              <Button type="submit" variant="primary" disabled={busy || changed === 0}>
                {busy ? 'Salvando…' : 'Salvar taxas'}
              </Button>
            </div>
          </div>
        </form>
      )}
    </div>
  )
}
