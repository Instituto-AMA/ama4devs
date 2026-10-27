/**
 * Os webhooks DA CONTA SELECIONADA: cadastrar, editar (URL, token, tipo de envio, fila
 * e QUAIS EVENTOS chegam), excluir — e por que a fila de cada um não está andando.
 *
 * Webhook é configuração da conta, não do simulador. Um evento da conta X só é
 * entregue aos webhooks de X, e a chave de X é a única que os enxerga (a de outra conta
 * devolve 404). Por isso toda AÇÃO aqui vai pela API v3 REAL, com a chave da conta:
 * o formulário monta o mesmo `POST`/`PUT /v3/webhooks` que a sua aplicação montaria, e
 * nada te ensina um truque que não existe no Asaas.
 *
 * O DIAGNÓSTICO da fila é introspecção nossa; o Asaas não te dá isso. Existe porque o
 * motor é fiel demais para ser opaco: em `SEQUENTIALLY` (o padrão do Asaas), UMA entrega
 * que falha trava TODAS as seguintes — head-of-line blocking de verdade. O sintoma na
 * ponta é "o Asaas diz RECEIVED, mas meu pedido continua pendente".
 */
import { useEffect, useMemo, useState } from 'preact/hooks'
import { admin, v3, type QueueHealth, type Webhook } from '../../api.ts'
import type { PageProps } from '../../app.tsx'
import { Icon } from '../../components/Icon.tsx'
import {
  Badge,
  Banner,
  Button,
  Card,
  Empty,
  errorText,
  Field,
  Modal,
  plural,
  Row,
  Toggle,
} from '../../components/ui.tsx'
import * as I from '../../icons.ts'
import { groupEvents, type EventGroup } from './events.ts'
import './integrations.css'

const WHY: Record<string, string> = {
  INTERRUPTED:
    'A fila foi INTERROMPIDA: a entrega esgotou as 15 tentativas do backoff. O Asaas para de tentar e não volta sozinho.',
  DISABLED: 'O webhook está desativado. Nada é entregue enquanto estiver assim.',
  HEAD_FAILING:
    'A entrega na cabeça da fila está falhando. Em SEQUENTIALLY isso trava todas as seguintes.',
  HEAD_IN_BACKOFF: 'A cabeça da fila está aguardando o backoff. As seguintes esperam com ela.',
}

const SEND_TYPE_LABEL = {
  SEQUENTIALLY: 'Sequencial',
  NON_SEQUENTIALLY: 'Não sequencial',
} as const

export function Webhooks({ store }: PageProps) {
  const account = store.selected
  const key = account?.apiKey ?? null
  const [list, setList] = useState<Webhook[] | null>(null)
  const [events, setEvents] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Webhook | 'new' | null>(null)
  const [removing, setRemoving] = useState<Webhook | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = async () => {
    if (!key) return
    try {
      setList((await v3('/webhooks?limit=100', key)).data)
      setError(null)
    } catch (e) {
      setError(errorText(e))
    }
  }

  useEffect(() => {
    void admin('/webhooks/events').then((r) => setEvents(r.events))
  }, [])

  useEffect(() => {
    setList(null)
    setEditing(null)
    void load()
  }, [account?.id, key])

  /** Runs a v3 call, lets the dispatcher release what it unblocked, refreshes everything. */
  const act = async (id: string, fn: (key: string) => Promise<unknown>) => {
    if (!key) return
    setBusy(id)
    try {
      await fn(key)
      await admin('/tick', { method: 'POST' })
      await Promise.all([load(), store.reload()])
    } catch (e) {
      alert(errorText(e))
    } finally {
      setBusy(null)
    }
  }

  if (!account) return null

  if (!key) {
    return (
      <Banner tone="danger">
        <b>{account.name}</b> não tem chave de API que autentique agora, e os webhooks só
        se gerenciam pela API com a chave da conta. Gere ou reative uma em{' '}
        <b>Chaves de API</b>.
      </Banner>
    )
  }

  if (editing) {
    return (
      <WebhookForm
        apiKey={key}
        accountEmail={account.email}
        webhook={editing === 'new' ? null : editing}
        groups={groupEvents(events)}
        onCancel={() => setEditing(null)}
        onSaved={async () => {
          setEditing(null)
          await admin('/tick', { method: 'POST' })
          await Promise.all([load(), store.reload()])
        }}
      />
    )
  }

  const queueOf = (id: string): QueueHealth | undefined =>
    store.queues.find((q) => q.webhookId === id)

  return (
    <div class="stack">
      {error && <Banner tone="danger">{error}</Banner>}

      <Card
        title="Meus Webhooks"
        subtitle={
          <>
            Os botões chamam a <b>API real do Asaas</b> (<code>/v3/webhooks</code>) com a
            chave de {account.name}. O diagnóstico da fila é do simulador.
          </>
        }
        actions={
          <Button variant="primary" onClick={() => setEditing('new')}>
            <Icon icon={I.ADD} size={16} />
            Adicionar Webhook
          </Button>
        }
      >
        {list === null ? (
          <Empty>carregando…</Empty>
        ) : list.length === 0 ? (
          <Empty>
            Nenhum webhook encontrado. Quando uma cobrança mudar de situação, o Asaas avisa a
            URL que você cadastrar aqui.
          </Empty>
        ) : (
          <div class="stack">
            {list.map((w) => (
              <WebhookCard
                key={w.id}
                webhook={w}
                queue={queueOf(w.id)}
                busy={busy === w.id}
                onEdit={() => setEditing(w)}
                onRemove={() => setRemoving(w)}
                onRelease={() =>
                  void act(w.id, (k) => v3(`/webhooks/${w.id}/removeBackoff`, k, { method: 'POST' }))
                }
                onToggle={() =>
                  void act(w.id, (k) =>
                    v3(`/webhooks/${w.id}`, k, {
                      method: 'PUT',
                      body: JSON.stringify({ enabled: !w.enabled }),
                    }),
                  )
                }
              />
            ))}
          </div>
        )}
      </Card>

      {removing && (
        <Modal title="Excluir webhook" onClose={() => setRemoving(null)}>
          <p>
            Excluir <b>{removing.name}</b>? Os eventos deixam de ir para{' '}
            <span class="mono">{removing.url}</span>, e as entregas pendentes dele são
            descartadas.
          </p>
          <div class="modal-actions">
            <Button variant="ghost" onClick={() => setRemoving(null)}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                const w = removing
                setRemoving(null)
                void act(w.id, (k) => v3(`/webhooks/${w.id}`, k, { method: 'DELETE' }))
              }}
            >
              Excluir webhook
            </Button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function WebhookCard(props: {
  webhook: Webhook
  queue: QueueHealth | undefined
  busy: boolean
  onEdit: () => void
  onRemove: () => void
  onRelease: () => void
  onToggle: () => void
}) {
  const w = props.webhook
  const b = props.queue?.blocked ?? null
  const pending = props.queue?.pending ?? 0

  return (
    <section class="webhook-card">
      <header class="webhook-card-hdr">
        <div class="webhook-card-title">
          <h3>{w.name}</h3>
          <span class="mono hint">{w.url}</span>
        </div>
        <div class="row">
          {w.interrupted ? (
            <Badge tone="danger">fila interrompida</Badge>
          ) : !w.enabled ? (
            <Badge>desativado</Badge>
          ) : b ? (
            <Badge tone="warn">fila travada</Badge>
          ) : (
            <Badge tone="success">entregando</Badge>
          )}
          <Badge tone={w.sendType === 'SEQUENTIALLY' ? 'primary' : 'neutral'}>
            {SEND_TYPE_LABEL[w.sendType]}
          </Badge>
          <Badge tone={pending > 0 ? 'warn' : 'neutral'}>{pending} na fila</Badge>
        </div>
      </header>

      {b && (
        <Banner tone="danger">
          {WHY[b.reason]}
          {b.lastStatusCode ? (
            <>
              <br />
              Último retorno do seu endpoint: <b>HTTP {b.lastStatusCode}</b> no evento{' '}
              <code>{b.event}</code>, tentativa {b.attempt}. <b>Só HTTP 200 é sucesso</b> para
              o Asaas.
            </>
          ) : b.lastError ? (
            <>
              <br />O endpoint <b>não respondeu</b> no evento <code>{b.event}</code> (tentativa{' '}
              {b.attempt}): <span class="mono">{b.lastError}</span>
            </>
          ) : null}
          {b.behind > 0 && (
            <>
              <br />
              <b>{b.behind}</b> entrega(s) parada(s) atrás dela.
            </>
          )}
        </Banner>
      )}

      <div>
        <Row label="Eventos">{plural(w.events.length, 'evento', 'eventos')}</Row>
        <Row label="Token de autenticação">{w.hasAuthToken ? 'definido' : 'nenhum'}</Row>
        <Row label="E-mail de falha">{w.email}</Row>
      </div>

      <div class="row">
        <Button size="sm" variant="primary" disabled={props.busy} onClick={props.onEdit}>
          <Icon icon={I.EDIT} size={14} />
          Editar
        </Button>
        {(w.interrupted || b) && (
          <Button
            size="sm"
            disabled={props.busy}
            title="removeBackoff: zera as tentativas, reagenda tudo para agora e solta a fila."
            onClick={props.onRelease}
          >
            Reativar fila
          </Button>
        )}
        <Button size="sm" variant="ghost" disabled={props.busy} onClick={props.onToggle}>
          {w.enabled ? 'Desativar' : 'Ativar'}
        </Button>
        <Button size="sm" variant="danger" disabled={props.busy} onClick={props.onRemove}>
          <Icon icon={I.DELETE} size={14} />
          Excluir
        </Button>
      </div>
    </section>
  )
}

/** A token the Asaas form would accept: 32–255 characters. */
function generateToken(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const bytes = crypto.getRandomValues(new Uint8Array(48))
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')
}

/**
 * "Adicionar Webhook" / editar — os campos do formulário do Asaas, um a um.
 *
 * Na edição, e-mail e versão da API ficam travados: o `PUT /v3/webhooks/{id}` do Asaas
 * não os aceita. Um campo editável aqui que a API ignora seria exatamente a mentira
 * útil que este painel não pode contar.
 */
function WebhookForm(props: {
  apiKey: string
  accountEmail: string
  webhook: Webhook | null
  groups: EventGroup[]
  onCancel: () => void
  onSaved: () => Promise<void>
}) {
  const w = props.webhook
  const [enabled, setEnabled] = useState(w?.enabled ?? true)
  const [name, setName] = useState(w?.name ?? '')
  const [url, setUrl] = useState(w?.url ?? '')
  const [email, setEmail] = useState(w?.email ?? props.accountEmail)
  const [apiVersion, setApiVersion] = useState(w?.apiVersion ?? 3)
  const [authToken, setAuthToken] = useState('')
  const [sendType, setSendType] = useState<Webhook['sendType']>(w?.sendType ?? 'SEQUENTIALLY')
  const [queueOn, setQueueOn] = useState(!(w?.interrupted ?? false))
  const [selected, setSelected] = useState<Set<string>>(new Set(w?.events ?? []))
  const [closed, setClosed] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const missing = useMemo(() => {
    const m: string[] = []
    if (!name.trim()) m.push('nome')
    if (!url.trim()) m.push('URL')
    if (!email.trim()) m.push('e-mail')
    if (selected.size === 0) m.push('ao menos um evento')
    return m
  }, [name, url, email, selected])

  const setGroup = (g: EventGroup, on: boolean) => {
    const next = new Set(selected)
    for (const e of g.events) on ? next.add(e) : next.delete(e)
    setSelected(next)
  }

  const toggleEvent = (event: string) => {
    const next = new Set(selected)
    next.has(event) ? next.delete(event) : next.add(event)
    setSelected(next)
  }

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      const common = {
        name: name.trim(),
        url: url.trim(),
        enabled,
        interrupted: !queueOn,
        sendType,
        events: [...selected],
        ...(authToken ? { authToken } : {}),
      }
      if (w) {
        await v3(`/webhooks/${w.id}`, props.apiKey, {
          method: 'PUT',
          body: JSON.stringify(common),
        })
      } else {
        await v3('/webhooks', props.apiKey, {
          method: 'POST',
          body: JSON.stringify({ ...common, email: email.trim(), apiVersion }),
        })
      }
      await props.onSaved()
    } catch (e) {
      setError(errorText(e))
      setBusy(false)
    }
  }

  return (
    <Card
      title={
        <span class="row">
          {w ? 'Editar Webhook' : 'Adicionar Webhook'}
          <Badge tone="primary">Em edição</Badge>
        </span>
      }
      actions={
        <>
          <Button onClick={props.onCancel}>Cancelar</Button>
          <Button
            variant="primary"
            disabled={busy || missing.length > 0}
            title={missing.length > 0 ? `Falta: ${missing.join(', ')}` : undefined}
            onClick={() => void save()}
          >
            {busy ? 'Salvando…' : 'Salvar'}
          </Button>
        </>
      }
    >
      <div class="stack webhook-form">
        {error && <Banner tone="danger">{error}</Banner>}

        <h3 class="form-section">Dados do Webhook</h3>

        <Toggle checked={enabled} onChange={setEnabled}>
          Este Webhook ficará ativo?
        </Toggle>

        <div class="form-grid">
          <Field label="Nome do Webhook" hint="No máximo 50 caracteres.">
            <input
              class="input"
              maxLength={50}
              placeholder="Informe o nome que terá o Webhook"
              value={name}
              onInput={(e) => setName((e.target as HTMLInputElement).value)}
            />
          </Field>
          <Field
            label="URL do Webhook"
            hint={
              <>
                <code>localhost</code> chega na sua máquina: o simulador reescreve para{' '}
                <code>host.docker.internal</code>.
              </>
            }
          >
            <input
              class="input"
              placeholder="https://sua-app/webhooks/asaas"
              value={url}
              onInput={(e) => setUrl((e.target as HTMLInputElement).value)}
            />
          </Field>
          <Field
            label="E-mail"
            hint={
              w
                ? 'A API do Asaas não altera o e-mail de um webhook: crie outro para trocar.'
                : 'Você seria notificado neste e-mail em caso de falha na sincronia.'
            }
          >
            <input
              class="input"
              type="email"
              disabled={Boolean(w)}
              value={email}
              onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
            />
          </Field>

          <Field
            label="Versão da API"
            hint={w ? 'Também não muda depois de criado.' : undefined}
          >
            <select
              class="input"
              disabled={Boolean(w)}
              value={String(apiVersion)}
              onChange={(e) => setApiVersion(Number((e.target as HTMLSelectElement).value))}
            >
              <option value="3">v3</option>
            </select>
          </Field>
          <Field
            label="Token de autenticação"
            hint={
              w?.hasAuthToken
                ? 'Já existe um token. Deixe vazio para mantê-lo; preencha para trocar.'
                : 'Vai no header asaas-access-token de cada entrega. De 32 a 255 caracteres.'
            }
          >
            <div class="row">
              <input
                class="input mono"
                placeholder={w?.hasAuthToken ? '•••••••• (mantido)' : 'Defina um token de autenticação'}
                value={authToken}
                onInput={(e) => setAuthToken((e.target as HTMLInputElement).value)}
              />
              <Button type="button" onClick={() => setAuthToken(generateToken())}>
                <Icon icon={I.REFRESH} size={14} />
                Gerar Token
              </Button>
            </div>
          </Field>
          <Field
            label="Tipo de envio"
            hint={
              sendType === 'SEQUENTIALLY'
                ? 'Em ordem: uma entrega que falha segura todas as seguintes.'
                : 'Independentes: uma falha não segura as outras, mas a ordem não é garantida.'
            }
          >
            <select
              class="input"
              value={sendType}
              onChange={(e) =>
                setSendType((e.target as HTMLSelectElement).value as Webhook['sendType'])
              }
            >
              <option value="SEQUENTIALLY">Sequencial</option>
              <option value="NON_SEQUENTIALLY">Não sequencial</option>
            </select>
          </Field>
        </div>

        <Toggle
          checked={queueOn}
          onChange={setQueueOn}
          hint="Atenção! Com a fila interrompida, novos eventos continuam sendo gerados, porém não são enviados para a sua aplicação até que a fila seja ativada novamente."
        >
          Fila de sincronização ativada?
        </Toggle>

        <div class="events-hdr">
          <h3 class="form-section">Eventos</h3>
          <span class="hint">
            {plural(selected.size, 'evento selecionado', 'eventos selecionados')}. Quanto menos
            eventos, mais eficiente o envio.
          </span>
        </div>

        {props.groups.map((g) => {
          const chosen = g.events.filter((e) => selected.has(e)).length
          const all = chosen === g.events.length
          const open = !closed.has(g.id)
          return (
            <section key={g.id} class="event-group">
              <header class="event-group-hdr">
                <button
                  type="button"
                  class="event-group-toggle"
                  aria-expanded={open}
                  onClick={() => {
                    const next = new Set(closed)
                    open ? next.add(g.id) : next.delete(g.id)
                    setClosed(next)
                  }}
                >
                  <Icon icon={I.CARET} size={16} class={open ? 'caret open' : 'caret'} />
                  <span class="event-group-label">{g.label}</span>
                  <Badge tone={chosen > 0 ? 'primary' : 'neutral'}>
                    {chosen}/{g.events.length}
                  </Badge>
                </button>
                <Button size="sm" type="button" onClick={() => setGroup(g, !all)}>
                  {all ? 'Desmarcar todos' : 'Selecionar todos'}
                </Button>
              </header>
              {open && (
                <>
                  <p class="hint">{g.description}</p>
                  <div class="event-grid">
                    {g.events.map((e) => (
                      <label key={e} class="check">
                        <input
                          type="checkbox"
                          checked={selected.has(e)}
                          onChange={() => toggleEvent(e)}
                        />
                        <span class="mono">{e}</span>
                      </label>
                    ))}
                  </div>
                </>
              )}
            </section>
          )
        })}
      </div>
    </Card>
  )
}
