/**
 * Notas fiscais: as NFS-e da conta, do agendamento à autorização da prefeitura.
 *
 * "Emitir" and "Cancelar" are the Asaas API (`v3`), the same calls the user's code
 * makes. The city hall's answer is the simulator's (`mock`): on the next tick by
 * itself, or now with the buttons under "Prefeitura" — marked as the simulator's,
 * because Asaas has no such button.
 */
import { useEffect, useState } from 'preact/hooks'
import { ApiError, mock, v3, type Payment } from '../api.ts'
import type { PageProps } from '../app.tsx'
import { Icon } from '../components/Icon.tsx'
import {
  Badge,
  Banner,
  Button,
  Card,
  dateTime,
  Empty,
  errorText,
  Field,
  money,
  Table,
  Toggle,
  type Tone,
} from '../components/ui.tsx'
import * as I from '../icons.ts'

interface Invoice {
  id: string
  status: string
  statusDescription: string | null
  payment: string | null
  customer: string | null
  serviceDescription: string | null
  municipalServiceName: string | null
  value: number
  effectiveDate: string
  number: string | null
  validationCode: string | null
  pdfUrl: string | null
  xmlUrl: string | null
}

interface FiscalInfo {
  email: string | null
  simplesNacional: boolean
  municipalInscription: string | null
  rpsSerie: string | null
}

interface Service {
  id: string
  description: string
  issTax: number
}

const STATUS: Record<string, { label: string; tone: Tone }> = {
  SCHEDULED: { label: 'Agendada', tone: 'neutral' },
  SYNCHRONIZED: { label: 'Na prefeitura', tone: 'warn' },
  AUTHORIZED: { label: 'Autorizada', tone: 'success' },
  PROCESSING_CANCELLATION: { label: 'Cancelando', tone: 'warn' },
  CANCELED: { label: 'Cancelada', tone: 'neutral' },
  CANCELLATION_DENIED: { label: 'Cancelamento negado', tone: 'danger' },
  ERROR: { label: 'Erro', tone: 'danger' },
}

const CANCELLABLE = ['SCHEDULED', 'ERROR', 'AUTHORIZED', 'CANCELLATION_DENIED']

export function Invoices({ store }: PageProps) {
  const key = store.selected?.apiKey ?? null
  const [rows, setRows] = useState<Invoice[] | null>(null)
  const [fiscal, setFiscal] = useState<FiscalInfo | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = async () => {
    if (!key) return
    const [list, info] = await Promise.all([
      v3('/invoices?limit=100', key),
      v3('/fiscalInfo', key).catch((e) => (e instanceof ApiError && e.status === 404 ? null : Promise.reject(e))),
    ])
    setRows([...list.data].reverse())
    setFiscal(info)
  }

  useEffect(() => {
    setRows(null)
    setFiscal(undefined)
    void load().catch((e) => setError(errorText(e)))
  }, [key])

  /** One action, then the list again: the note's new status is the answer. */
  const act = async (id: string, run: () => Promise<unknown>) => {
    setBusy(id)
    setError(null)
    try {
      await run()
      await load()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(null)
    }
  }

  if (!key) return <Card><Empty>Esta conta não tem chave de API ativa.</Empty></Card>

  return (
    <div class="stack">
      {fiscal === null && (
        <Banner tone="warn">
          Sem <b>informações fiscais</b>, a prefeitura devolve toda nota emitida com <b>Erro</b>.
          Cadastre abaixo — ou use “Prefeitura › autorizar”, que ignora o cadastro.
        </Banner>
      )}
      {error && <Banner tone="danger">{error}</Banner>}

      <ScheduleForm apiKey={key} today={store.clock?.today ?? ''} onDone={() => void load()} />

      <Card title="Notas fiscais" subtitle="Da mais nova para a mais antiga. Uma nota emitida fica “Na prefeitura” até o próximo tick do relógio." flush>
        {!rows ? (
          <Empty>carregando…</Empty>
        ) : rows.length === 0 ? (
          <Empty>Nenhuma nota fiscal nesta conta.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Nota</th>
                <th>Situação</th>
                <th>Cobrança</th>
                <th>Serviço</th>
                <th style={{ textAlign: 'right' }}>Valor</th>
                <th>Emissão</th>
                <th>Ações</th>
                <th>Prefeitura (simulador)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((n) => {
                const s = STATUS[n.status] ?? { label: n.status, tone: 'neutral' as Tone }
                const off = busy === n.id
                return (
                  <tr key={n.id}>
                    <td>
                      <span class="mono">{n.id}</span>
                      {n.number && <div class="hint">nº {n.number} · {n.validationCode}</div>}
                    </td>
                    <td>
                      <Badge tone={s.tone}>{s.label}</Badge>
                      {(n.status === 'ERROR' || n.status === 'CANCELLATION_DENIED') && n.statusDescription && (
                        <div class="hint" style={{ whiteSpace: 'normal', maxWidth: '260px' }}>{n.statusDescription}</div>
                      )}
                    </td>
                    <td class="mono hint">{n.payment ?? '—'}</td>
                    <td style={{ whiteSpace: 'normal' }}>
                      {n.municipalServiceName}
                      <div class="hint">{n.serviceDescription}</div>
                    </td>
                    <td style={{ textAlign: 'right' }}>{money(n.value)}</td>
                    <td>{dateTime(n.effectiveDate)}</td>
                    <td>
                      <div class="row" style={{ flexWrap: 'nowrap' }}>
                        {(n.status === 'SCHEDULED' || n.status === 'ERROR') && (
                          <Button size="sm" disabled={off} onClick={() => void act(n.id, () => v3(`/invoices/${n.id}/authorize`, key, { method: 'POST', body: '{}' }))}>
                            Emitir
                          </Button>
                        )}
                        {CANCELLABLE.includes(n.status) && (
                          <Button size="sm" variant="ghost" disabled={off} onClick={() => void act(n.id, () => v3(`/invoices/${n.id}/cancel`, key, { method: 'POST', body: '{}' }))}>
                            Cancelar
                          </Button>
                        )}
                        {n.pdfUrl && (
                          <a class="btn ghost sm" href={n.pdfUrl} target="_blank" rel="noreferrer">
                            Nota
                          </a>
                        )}
                        {n.xmlUrl && (
                          <a class="btn ghost sm" href={n.xmlUrl} target="_blank" rel="noreferrer">
                            XML
                          </a>
                        )}
                      </div>
                    </td>
                    <td>
                      <div class="row" style={{ flexWrap: 'nowrap' }}>
                        {['SCHEDULED', 'ERROR', 'SYNCHRONIZED'].includes(n.status) && (
                          <Button size="sm" disabled={off} onClick={() => void act(n.id, () => mock(`/invoices/${n.id}/authorize`, { method: 'POST', body: '{}' }))}>
                            Autorizar
                          </Button>
                        )}
                        {['SCHEDULED', 'SYNCHRONIZED'].includes(n.status) && (
                          <Button size="sm" variant="ghost" disabled={off} onClick={() => void act(n.id, () => mock(`/invoices/${n.id}/error`, { method: 'POST', body: '{}' }))}>
                            Recusar
                          </Button>
                        )}
                        {n.status === 'PROCESSING_CANCELLATION' && (
                          <>
                            <Button size="sm" disabled={off} onClick={() => void act(n.id, () => mock(`/invoices/${n.id}/confirm-cancellation`, { method: 'POST', body: '{}' }))}>
                              Confirmar cancelamento
                            </Button>
                            <Button size="sm" variant="ghost" disabled={off} onClick={() => void act(n.id, () => mock(`/invoices/${n.id}/deny-cancellation`, { method: 'POST', body: '{}' }))}>
                              Negar
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
        )}
      </Card>

      {fiscal !== undefined && <FiscalForm apiKey={key} current={fiscal} onDone={() => void load()} />}
    </div>
  )
}

/** "Agendar nota fiscal": a charge of the account, a service of the city's list, the ISS. */
function ScheduleForm(props: { apiKey: string; today: string; onDone: () => void }) {
  const [charges, setCharges] = useState<Payment[]>([])
  const [services, setServices] = useState<Service[]>([])
  const [payment, setPayment] = useState('')
  const [service, setService] = useState('')
  const [value, setValue] = useState('')
  const [date, setDate] = useState(props.today)
  const [description, setDescription] = useState('')
  const [iss, setIss] = useState('2')
  const [retainIss, setRetainIss] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void v3('/payments?limit=100', props.apiKey).then((r) => setCharges(r.data))
    void v3('/fiscalInfo/services?limit=100', props.apiKey).then((r) => setServices(r.data))
  }, [props.apiKey])
  useEffect(() => setDate(props.today), [props.today])

  const pick = (id: string) => {
    setPayment(id)
    const c = charges.find((x) => x.id === id)
    if (c) {
      setValue(String(c.value))
      if (!description) setDescription(c.description ?? '')
    }
  }
  const chosen = services.find((s) => s.id === service)

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await v3('/invoices', props.apiKey, {
        method: 'POST',
        body: JSON.stringify({
          payment,
          serviceDescription: description || chosen?.description || 'Serviço',
          observations: '',
          value: Number(value),
          deductions: 0,
          effectiveDate: date,
          municipalServiceId: chosen?.id,
          municipalServiceCode: chosen?.id,
          municipalServiceName: chosen?.description ?? 'Serviço',
          taxes: { retainIss, iss: Number(iss), pis: 0, cofins: 0, csll: 0, inss: 0, ir: 0 },
        }),
      })
      setPayment('')
      setValue('')
      setDescription('')
      props.onDone()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title="Agendar nota fiscal" subtitle="POST /v3/invoices. Com data de hoje, emita em seguida; com data futura, ela vai sozinha para a prefeitura no dia.">
      <div class="stack">
        <div class="form-grid">
          <Field label="Cobrança">
            <select class="input" value={payment} onChange={(e) => pick((e.target as HTMLSelectElement).value)}>
              <option value="">Escolha…</option>
              {charges.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.id} · {money(c.value)} · {c.status}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Serviço municipal">
            <select
              class="input"
              value={service}
              onChange={(e) => {
                const id = (e.target as HTMLSelectElement).value
                setService(id)
                const s = services.find((x) => x.id === id)
                if (s) setIss(String(s.issTax))
              }}
            >
              <option value="">Escolha…</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.description}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Valor (R$)">
            <input class="input" inputMode="decimal" value={value} onInput={(e) => setValue((e.target as HTMLInputElement).value)} />
          </Field>
          <Field label="Data de emissão">
            <input class="input" type="date" value={date} onInput={(e) => setDate((e.target as HTMLInputElement).value)} />
          </Field>
          <Field label="Descrição do serviço">
            <input class="input" value={description} onInput={(e) => setDescription((e.target as HTMLInputElement).value)} />
          </Field>
          <Field label="ISS (%)">
            <input class="input" inputMode="decimal" value={iss} onInput={(e) => setIss((e.target as HTMLInputElement).value)} />
          </Field>
        </div>
        <Toggle checked={retainIss} onChange={setRetainIss} hint="O tomador retém o ISS na fonte.">
          ISS retido
        </Toggle>
        {error && <Banner tone="danger">{error}</Banner>}
        <div class="row">
          <Button variant="primary" disabled={busy || !payment || !service || !value} onClick={() => void submit()}>
            <Icon icon={I.ADD} size={16} />
            {busy ? 'Agendando…' : 'Agendar nota'}
          </Button>
        </div>
      </div>
    </Card>
  )
}

/** "Informações fiscais" (POST /v3/fiscalInfo): what the city hall needs to authorize a note. */
function FiscalForm(props: { apiKey: string; current: FiscalInfo | null; onDone: () => void }) {
  const [email, setEmail] = useState(props.current?.email ?? '')
  const [simples, setSimples] = useState(props.current?.simplesNacional ?? true)
  const [inscription, setInscription] = useState(props.current?.municipalInscription ?? '')
  const [serie, setSerie] = useState(props.current?.rpsSerie ?? '1')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const save = async () => {
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      await v3('/fiscalInfo', props.apiKey, {
        method: 'POST',
        body: JSON.stringify({ email, simplesNacional: simples, municipalInscription: inscription, rpsSerie: serie }),
      })
      setSaved(true)
      props.onDone()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title="Informações fiscais" subtitle="POST /v3/fiscalInfo. Sem elas, a prefeitura recusa as notas emitidas.">
      <div class="stack">
        <div class="form-grid">
          <Field label="E-mail para as notas">
            <input class="input" type="email" value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} />
          </Field>
          <Field label="Inscrição municipal">
            <input class="input" value={inscription} onInput={(e) => setInscription((e.target as HTMLInputElement).value)} />
          </Field>
          <Field label="Série do RPS">
            <input class="input" value={serie} onInput={(e) => setSerie((e.target as HTMLInputElement).value)} />
          </Field>
        </div>
        <Toggle checked={simples} onChange={setSimples}>
          Optante pelo Simples Nacional
        </Toggle>
        {error && <Banner tone="danger">{error}</Banner>}
        <div class="row">
          <Button variant="primary" disabled={busy || !email} onClick={() => void save()}>
            {busy ? 'Salvando…' : props.current ? 'Atualizar' : 'Cadastrar'}
          </Button>
          {saved && <span class="hint">Salvo.</span>}
        </div>
      </div>
    </Card>
  )
}
