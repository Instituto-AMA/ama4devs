/**
 * "Chaves de API" da conta selecionada: gerar, rotacionar, desativar e excluir.
 *
 * No Asaas, uma conta raiz só mexe nas próprias chaves pelo painel — a API v3 não tem
 * essas operações para ela. Por isso os botões daqui vão em `/_admin`, e não em `/v3`.
 *
 * O efeito é o de verdade: a chave rotacionada, desativada, expirada ou excluída
 * devolve 401 na PRÓXIMA requisição da sua aplicação. É assim que se testa o que a
 * aplicação faz quando a chave do tenant para de valer.
 */
import type { ComponentChildren } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { admin, type ApiKey } from '../../api.ts'
import type { PageProps } from '../../app.tsx'
import { Icon } from '../../components/Icon.tsx'
import {
  Badge,
  Banner,
  Button,
  Card,
  Copy,
  dateTime,
  Empty,
  errorText,
  Field,
  Modal,
  Table,
} from '../../components/ui.tsx'
import * as I from '../../icons.ts'
import './integrations.css'

type Dialog =
  | { kind: 'create' }
  | { kind: 'rotate'; key: ApiKey }
  | { kind: 'delete'; key: ApiKey }
  | { kind: 'reveal'; key: ApiKey; rotated: boolean }

const mask = (key: string) => `${key.slice(0, 14)}…${key.slice(-6)}`

function KeyState({ k }: { k: ApiKey }) {
  if (!k.enabled) return <Badge>Desativada</Badge>
  if (k.expired) return <Badge tone="danger">Expirada</Badge>
  return <Badge tone="success">Ativa</Badge>
}

export function ApiKeys({ store }: PageProps) {
  const account = store.selected
  const [keys, setKeys] = useState<ApiKey[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Dialog | null>(null)

  const load = async () => {
    if (!account) return
    try {
      setKeys((await admin(`/accounts/${account.id}/keys`)).keys)
      setError(null)
    } catch (e) {
      setError(errorText(e))
    }
  }

  useEffect(() => {
    setKeys(null)
    void load()
  }, [account?.id])

  /** Runs a change, then refreshes the list and the store (the panel's key may change). */
  const change = async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id)
    try {
      await fn()
      await Promise.all([load(), store.reload()])
    } catch (e) {
      alert(errorText(e))
    } finally {
      setBusy(null)
    }
  }

  if (!account) return null
  const base = `/accounts/${account.id}/keys`
  const usable = keys?.filter((k) => k.usable).length ?? 0

  return (
    <div class="stack">
      {error && <Banner tone="danger">{error}</Banner>}

      {keys && usable === 0 && (
        <Banner tone="danger">
          <b>{account.name}</b> não tem nenhuma chave que autentique agora. A sua aplicação
          recebe <b>401</b> em toda chamada — e o painel também não consegue agir como esta
          conta até você gerar ou reativar uma.
        </Banner>
      )}

      <Card
        title="Chaves de API"
        subtitle={
          <>
            A chave dá acesso total à conta. No Asaas ela aparece <b>uma vez</b>, na
            criação; aqui o simulador a mostra sempre, para você colar na sua aplicação.
          </>
        }
        actions={
          <Button variant="primary" onClick={() => setDialog({ kind: 'create' })}>
            <Icon icon={I.ADD} size={16} />
            Gerar chave de API
          </Button>
        }
        flush
      >
        {keys === null ? (
          <Empty>carregando…</Empty>
        ) : keys.length === 0 ? (
          <Empty>
            Suas chaves de API vão aparecer aqui. Sem nenhuma, a conta não aceita chamadas.
          </Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Nome</th>
                <th>Chave</th>
                <th>Criada em</th>
                <th>Expira em</th>
                <th>Situação</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id}>
                  <td>{k.name}</td>
                  <td>
                    <Copy value={k.apiKey}>{mask(k.apiKey)}</Copy>
                  </td>
                  <td>{dateTime(k.dateCreated)}</td>
                  <td>{k.expirationDate ? dateTime(k.expirationDate) : 'Não expira'}</td>
                  <td>
                    <KeyState k={k} />
                  </td>
                  <td>
                    <div class="row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                      <Button
                        size="sm"
                        disabled={busy === k.id}
                        title="Gera uma chave nova com o mesmo nome e exclui esta na hora."
                        onClick={() => setDialog({ kind: 'rotate', key: k })}
                      >
                        Rotacionar
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy === k.id}
                        onClick={() =>
                          void change(k.id, () =>
                            admin(`${base}/${k.id}`, {
                              method: 'PUT',
                              body: JSON.stringify({ enabled: !k.enabled }),
                            }),
                          )
                        }
                      >
                        {k.enabled ? 'Desativar' : 'Ativar'}
                      </Button>
                      <button
                        class="icon-btn danger"
                        disabled={busy === k.id}
                        aria-label={`Excluir a chave ${k.name}`}
                        onClick={() => setDialog({ kind: 'delete', key: k })}
                      >
                        <Icon icon={I.DELETE} size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {dialog?.kind === 'create' && (
        <KeyDialog
          title="Gerar chave de API"
          confirm="Gerar chave"
          today={store.clock?.today}
          withName
          onClose={() => setDialog(null)}
          onSubmit={async (input) => {
            const key: ApiKey = await admin(base, {
              method: 'POST',
              body: JSON.stringify(input),
            })
            await Promise.all([load(), store.reload()])
            setDialog({ kind: 'reveal', key, rotated: false })
          }}
        >
          <p class="hint">
            A chave nova funciona junto com as que já existem. Para trocar uma chave sem
            janela, use <b>Rotacionar</b>.
          </p>
        </KeyDialog>
      )}

      {dialog?.kind === 'rotate' && (
        <KeyDialog
          title={`Rotacionar "${dialog.key.name}"`}
          confirm="Rotacionar"
          today={store.clock?.today}
          onClose={() => setDialog(null)}
          onSubmit={async (input) => {
            const key: ApiKey = await admin(`${base}/${dialog.key.id}/rotate`, {
              method: 'POST',
              body: JSON.stringify(input),
            })
            await Promise.all([load(), store.reload()])
            setDialog({ kind: 'reveal', key, rotated: true })
          }}
        >
          <Banner>
            A chave <span class="mono">{mask(dialog.key.apiKey)}</span> é <b>excluída agora</b>:
            a próxima chamada da sua aplicação com ela recebe <b>401</b>. Uma chave nova, com
            o mesmo nome, fica no lugar.
          </Banner>
        </KeyDialog>
      )}

      {dialog?.kind === 'delete' && (
        <Modal title="Excluir chave de API" onClose={() => setDialog(null)}>
          <p>
            Excluir <b>{dialog.key.name}</b> (<span class="mono">{mask(dialog.key.apiKey)}</span>)?
            A sua aplicação recebe <b>401</b> na próxima chamada com ela.
          </p>
          {dialog.key.usable && usable === 1 && (
            <Banner tone="danger">
              É a única chave que autentica nesta conta. Sem ela, nenhuma chamada passa.
            </Banner>
          )}
          <div class="modal-actions">
            <Button variant="ghost" onClick={() => setDialog(null)}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                const k = dialog.key
                setDialog(null)
                void change(k.id, () => admin(`${base}/${k.id}`, { method: 'DELETE' }))
              }}
            >
              Excluir chave
            </Button>
          </div>
        </Modal>
      )}

      {dialog?.kind === 'reveal' && (
        <Modal
          title={dialog.rotated ? 'Chave rotacionada' : 'Chave gerada'}
          onClose={() => setDialog(null)}
        >
          <p>
            Cole esta chave na configuração da sua aplicação
            {dialog.rotated ? ' — a anterior já não funciona' : ''}.
          </p>
          <div class="reveal-key">
            <Copy value={dialog.key.apiKey} />
          </div>
          <p class="hint">
            {dialog.key.expirationDate
              ? `Expira em ${dateTime(dialog.key.expirationDate)} (no relógio do simulador).`
              : 'Não expira.'}
          </p>
          <div class="modal-actions">
            <Button variant="primary" onClick={() => setDialog(null)}>
              Pronto
            </Button>
          </div>
        </Modal>
      )}
    </div>
  )
}

/** The form behind "Gerar" and "Rotacionar": an optional name and expiration. */
function KeyDialog(props: {
  title: string
  confirm: string
  today: string | undefined
  withName?: boolean
  children?: ComponentChildren
  onClose: () => void
  onSubmit: (input: { name?: string; expirationDate?: string }) => Promise<void>
}) {
  const [name, setName] = useState('Chave de API')
  const [expiration, setExpiration] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await props.onSubmit({
        ...(props.withName ? { name: name.trim() } : {}),
        ...(expiration ? { expirationDate: expiration } : {}),
      })
    } catch (e) {
      setError(errorText(e))
      setBusy(false)
    }
  }

  return (
    <Modal title={props.title} onClose={props.onClose}>
      {props.children}
      {props.withName && (
        <Field label="Nome da chave">
          <input
            class="input"
            maxLength={50}
            value={name}
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
          />
        </Field>
      )}
      <Field
        label="Expira em (opcional)"
        hint="Conta no relógio do simulador: avançar o tempo além desta data faz a chave expirar."
      >
        <input
          class="input"
          type="date"
          min={props.today}
          value={expiration}
          onInput={(e) => setExpiration((e.target as HTMLInputElement).value)}
        />
      </Field>
      {error && <Banner tone="danger">{error}</Banner>}
      <div class="modal-actions">
        <Button variant="ghost" onClick={props.onClose}>
          Cancelar
        </Button>
        <Button
          variant="primary"
          disabled={busy || (props.withName && !name.trim())}
          onClick={() => void submit()}
        >
          {busy ? 'Aguarde…' : props.confirm}
        </Button>
      </div>
    </Modal>
  )
}
