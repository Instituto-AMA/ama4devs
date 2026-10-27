/**
 * "Logs de Webhooks" da conta selecionada: cada entrega de cada evento, com o retorno
 * do seu endpoint e o payload exato que saiu.
 *
 * O payload é o CONGELADO no momento do evento — uma retentativa reenvia este, não o
 * estado atual da cobrança. É o que ver aqui responde: "o que a minha aplicação
 * recebeu, e o que ela respondeu".
 */
import { useEffect, useState } from 'preact/hooks'
import { admin, type Delivery } from '../../api.ts'
import type { PageProps } from '../../app.tsx'
import { Icon } from '../../components/Icon.tsx'
import {
  Badge,
  Banner,
  Button,
  Card,
  dateTime,
  Empty,
  errorText,
  Row,
  type Tone,
} from '../../components/ui.tsx'
import * as I from '../../icons.ts'
import './integrations.css'

const STATUS: Record<Delivery['status'], { label: string; tone: Tone }> = {
  DELIVERED: { label: 'Entregue', tone: 'success' },
  PENDING: { label: 'Pendente', tone: 'warn' },
  FAILED: { label: 'Falhou', tone: 'danger' },
  INTERRUPTED: { label: 'Interrompida', tone: 'danger' },
  EXPIRED: { label: 'Expirada', tone: 'neutral' },
}

const FILTERS = [
  { id: 'all', label: 'Todas', match: () => true },
  { id: 'delivered', label: 'Entregues', match: (d: Delivery) => d.status === 'DELIVERED' },
  { id: 'pending', label: 'Pendentes', match: (d: Delivery) => d.status === 'PENDING' },
  {
    id: 'failed',
    label: 'Com falha',
    match: (d: Delivery) => d.status === 'FAILED' || d.status === 'INTERRUPTED',
  },
] as const

export function WebhookLogs({ store }: PageProps) {
  const account = store.selected
  const [rows, setRows] = useState<Delivery[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['id']>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = async () => {
    if (!account) return
    setLoading(true)
    try {
      const r = await admin(`/webhooks/deliveries?accountId=${account.id}&limit=200`)
      setRows(r.data)
      setError(null)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setRows(null)
    setSelectedId(null)
    void load()
  }, [account?.id])

  if (!account) return null

  const match = FILTERS.find((f) => f.id === filter)!.match
  const shown = (rows ?? []).filter(match)
  const current = shown.find((d) => d.id === selectedId) ?? null

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
              <button
                key={f.id}
                class={`chip ${filter === f.id ? 'on' : ''}`}
                onClick={() => setFilter(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>

          {rows === null ? (
            <Empty>carregando…</Empty>
          ) : shown.length === 0 ? (
            <Empty>Não encontramos nenhum log com esses critérios.</Empty>
          ) : (
            <ul class="log-list">
              {shown.map((d) => (
                <li key={d.id}>
                  <button
                    class={`log-item ${d.id === selectedId ? 'active' : ''}`}
                    onClick={() => setSelectedId(d.id)}
                  >
                    <span class="log-item-main">
                      <span class="mono">{d.event}</span>
                      <span class="hint">
                        {d.webhookName} · {dateTime(d.lastAttemptAt ?? d.dateCreated)}
                      </span>
                    </span>
                    <span class="log-item-side">
                      {d.lastStatusCode !== null && (
                        <span class="mono hint">HTTP {d.lastStatusCode}</span>
                      )}
                      <Badge tone={STATUS[d.status].tone}>{STATUS[d.status].label}</Badge>
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
                <Row label="Evento">
                  <span class="mono">{current.event}</span>
                </Row>
                <Row label="Situação">
                  <Badge tone={STATUS[current.status].tone}>{STATUS[current.status].label}</Badge>
                </Row>
                <Row label="Webhook">{current.webhookName}</Row>
                <Row label="URL">
                  <span class="mono">{current.url}</span>
                </Row>
                <Row label="Tentativas">{current.attempt}</Row>
                <Row label="Retorno do endpoint">
                  {current.lastStatusCode !== null ? `HTTP ${current.lastStatusCode}` : '—'}
                </Row>
                <Row label="Última tentativa">{dateTime(current.lastAttemptAt)}</Row>
                <Row label="Id do evento">
                  <span class="mono">{current.eventId}</span>
                </Row>
              </div>
              {current.lastError && <Banner tone="danger">{current.lastError}</Banner>}
              <pre class="payload">{JSON.stringify(current.payload, null, 2)}</pre>
            </div>
          ) : (
            <Empty>Selecione um log ao lado para ver o payload e o retorno do seu endpoint.</Empty>
          )}
        </Card>
      </div>
    </div>
  )
}
