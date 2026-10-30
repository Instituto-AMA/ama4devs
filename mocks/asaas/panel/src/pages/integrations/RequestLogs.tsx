/**
 * "Logs de Requisições" of the selected account: every call your application
 * made to the API (`/v3`), with what was sent and what came back — the success
 * and the refusal (400, 401 of a deactivated key, 404 of an endpoint that does
 * not exist).
 *
 * The list comes without the bodies; the detail fetches the opened call. The
 * last 1000 calls of the account are kept.
 */
import { useEffect, useState } from 'preact/hooks'
import { admin, type RequestLog } from '../../api.ts'
import type { PageProps } from '../../app.tsx'
import { Icon } from '../../components/Icon.tsx'
import { Badge, Banner, Button, Card, dateTime, Empty, errorText, Row, type Tone } from '../../components/ui.tsx'
import * as I from '../../icons.ts'
import './integrations.css'

const FILTERS = [
  { id: 'all', label: 'Todas' },
  { id: 'success', label: 'Sucesso' },
  { id: 'error', label: 'Com erro' },
] as const

const statusTone = (status: number): Tone =>
  status >= 200 && status < 300 ? 'success' : status >= 500 ? 'danger' : 'warn'

const body = (value: unknown) =>
  value === null || value === undefined ? (
    <Empty>Sem corpo.</Empty>
  ) : (
    <pre class="payload">{JSON.stringify(value, null, 2)}</pre>
  )

export function RequestLogs({ store }: PageProps) {
  const account = store.selected
  const [rows, setRows] = useState<RequestLog[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['id']>('all')
  const [current, setCurrent] = useState<RequestLog | null>(null)
  const [loading, setLoading] = useState(false)

  const load = async () => {
    if (!account) return
    setLoading(true)
    try {
      const status = filter === 'all' ? '' : `&status=${filter}`
      const r = await admin(`/request-logs?accountId=${account.id}&limit=200${status}`)
      setRows(r.data)
      setError(null)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setLoading(false)
    }
  }

  const open = async (id: number) => {
    try {
      setCurrent(await admin(`/request-logs/${id}`))
    } catch (e) {
      setError(errorText(e))
    }
  }

  useEffect(() => {
    setCurrent(null)
    void load()
  }, [account?.id, filter])

  if (!account) return null

  return (
    <div class="stack">
      {error && <Banner tone="danger">{error}</Banner>}

      <div class="logs-layout">
        <Card
          title="Logs"
          actions={
            <Button size="sm" disabled={loading} onClick={() => void load()}>
              <Icon icon={I.REFRESH} size={14} class={loading ? 'spin' : ''} />
              Atualizar
            </Button>
          }
          flush
        >
          <div class="row logs-filters">
            {FILTERS.map((f) => (
              <button key={f.id} class={`chip ${filter === f.id ? 'on' : ''}`} onClick={() => setFilter(f.id)}>
                {f.label}
              </button>
            ))}
          </div>

          {rows === null ? (
            <Empty>carregando…</Empty>
          ) : rows.length === 0 ? (
            <Empty>Nenhuma chamada à API com esses critérios. As chamadas com a chave desta conta aparecem aqui.</Empty>
          ) : (
            <ul class="log-list">
              {rows.map((r) => (
                <li key={r.id}>
                  <button class={`log-item ${r.id === current?.id ? 'active' : ''}`} onClick={() => void open(r.id)}>
                    <span class="log-item-main">
                      <span class="mono">
                        <span class="http-method">{r.method}</span> {r.path}
                      </span>
                      <span class="hint">
                        {r.apiKeyName ?? 'chave removida'} · {dateTime(r.dateCreated)}
                      </span>
                    </span>
                    <span class="log-item-side">
                      <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Detalhes">
          {current ? (
            <div class="stack">
              <div>
                <Row label="Endpoint">
                  <span class="mono">
                    {current.method} {current.path}
                    {current.query ? `?${current.query}` : ''}
                  </span>
                </Row>
                <Row label="Status">
                  <Badge tone={statusTone(current.status)}>HTTP {current.status}</Badge>
                </Row>
                <Row label="Chave de API">{current.apiKeyName ?? 'chave removida'}</Row>
                <Row label="Data">{dateTime(current.dateCreated)}</Row>
              </div>
              <h4 class="section-title">Requisição</h4>
              {body(current.requestBody)}
              <h4 class="section-title">Resposta</h4>
              {body(current.responseBody)}
            </div>
          ) : (
            <Empty>Selecione uma chamada ao lado para ver o que foi enviado e o que voltou.</Empty>
          )}
        </Card>
      </div>
    </div>
  )
}
