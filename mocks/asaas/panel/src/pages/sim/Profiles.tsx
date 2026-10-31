/**
 * Profiles: the ROOT accounts of the simulator — each one, a tenant of your
 * application, with its own key, wallet, customers and webhooks.
 *
 * It lives in the Simulador block because Asaas does not open a root account
 * through the API: there, each clinic creates its own account on the site. Here
 * you create and delete as many as you want, without restarting the container.
 *
 * The ENVIRONMENT profiles (`ASAAS_API_KEY`, `SEED_EXTRA_ACCOUNTS`) are deleted
 * too, but they come back on the next boot — zeroed and with the environment
 * key. The screen warns before that.
 *
 * Zerar is the other way out: the profile stays, with its id and keys, and the chosen
 * groups go (POST /_admin/accounts/:id/reset). The app's configuration does not change.
 */
import { useState } from 'preact/hooks'
import { admin, type Account } from '../../api.ts'
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
  money,
  plural,
  Table,
  Toggle,
} from '../../components/ui.tsx'
import * as I from '../../icons.ts'

/** The groups a reset empties, as the server names them (src/admin/reset.ts). */
type Group = 'customers' | 'subaccounts' | 'charges' | 'invoices' | 'webhooks' | 'logs'

const GROUPS: Array<{ id: Group; label: string; hint: string }> = [
  { id: 'customers', label: 'Clientes', hint: 'E os cartões salvos de cada um.' },
  { id: 'subaccounts', label: 'Subcontas', hint: 'Cada subconta some com tudo o que é dela, chaves incluídas.' },
  {
    id: 'charges',
    label: 'Cobranças e saldo',
    hint: 'Cobranças, parcelamentos, assinaturas, links de pagamento, extrato, transferências e antecipações. O saldo volta a zero.',
  },
  { id: 'invoices', label: 'Notas fiscais', hint: 'As NFS-e: agendadas, emitidas e canceladas.' },
  { id: 'webhooks', label: 'Webhooks', hint: 'As configurações e a fila de entregas de cada um.' },
  {
    id: 'logs',
    label: 'Logs',
    hint: 'Logs de requisições, eventos e entregas de webhook, notificações enviadas.',
  },
]

/** What a group drags along: a charge names its customer, an invoice its charge. */
const IMPLIES: Partial<Record<Group, Group[]>> = {
  customers: ['charges', 'invoices'],
  charges: ['invoices'],
}

const PRESETS: Array<{ label: string; groups: Group[] }> = [
  { label: 'Conta zerada', groups: GROUPS.map((g) => g.id) },
  { label: 'Manter clientes e subcontas', groups: ['charges', 'invoices', 'logs'] },
]

/** The groups a choice reaches once what it implies is added. */
const implied = (chosen: Set<Group>) => {
  const all = new Set(chosen)
  for (const g of chosen) for (const i of IMPLIES[g] ?? []) all.add(i)
  return all
}

interface ResetResult {
  removed: Group[]
  cancelled: {
    payments: number
    subscriptions: number
    installments: number
    invoices: number
    webhooks: { delivered: number; notDelivered: number }
  } | null
  subaccounts: number
  rows: number
}

interface Created {
  accountId: string
  apiKey: string
  name: string
}

export function Profiles({ store }: PageProps) {
  const roots = store.accounts.filter((a) => !a.parentAccountId)
  const subsOf = (a: Account) => store.accounts.filter((s) => s.parentAccountId === a.id)

  const [name, setName] = useState('')
  const [cpfCnpj, setCpfCnpj] = useState('')
  const [email, setEmail] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<Created | null>(null)
  const [removing, setRemoving] = useState<Account | null>(null)
  const [removeBusy, setRemoveBusy] = useState(false)
  const [resetting, setResetting] = useState<Account | null>(null)

  const create = async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await admin('/accounts', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          ...(cpfCnpj.trim() ? { cpfCnpj: cpfCnpj.trim() } : {}),
          ...(email.trim() ? { email: email.trim() } : {}),
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        }),
      })
      setCreated({ accountId: r.accountId, apiKey: r.apiKey, name: name.trim() })
      setName('')
      setCpfCnpj('')
      setEmail('')
      setApiKey('')
      await store.reload()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (a: Account) => {
    setRemoveBusy(true)
    try {
      await admin(`/accounts/${a.id}`, { method: 'DELETE' })
      setRemoving(null)
      await store.reload()
    } catch (e) {
      alert(errorText(e))
    } finally {
      setRemoveBusy(false)
    }
  }

  return (
    <div class="stack">
      <Card
        title="Criar perfil"
        subtitle="Uma conta raiz nova, com chave de API própria, KYC aprovado e saldo zero."
      >
        <div class="stack">
          <div class="form-grid">
            <Field label="Nome">
              <input
                class="input"
                placeholder="Ex.: Clínica Centro"
                value={name}
                onInput={(e) => setName((e.target as HTMLInputElement).value)}
                onKeyDown={(e) => e.key === 'Enter' && name.trim() && void create()}
              />
            </Field>
            <Field label="CPF/CNPJ (opcional)" hint="Vazio: o simulador gera um CNPJ válido.">
              <input
                class="input"
                inputMode="numeric"
                value={cpfCnpj}
                onInput={(e) => setCpfCnpj((e.target as HTMLInputElement).value)}
              />
            </Field>
            <Field label="E-mail (opcional)" hint="Vazio: nome-do-perfil@localhost.">
              <input
                class="input"
                type="email"
                value={email}
                onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
              />
            </Field>
            <Field
              label="Chave de API fixa (opcional)"
              hint="Para uma aplicação que já tem a chave configurada. Vazio: uma nova é gerada."
            >
              <input
                class="input mono"
                placeholder="$aact_hmlg_…"
                value={apiKey}
                onInput={(e) => setApiKey((e.target as HTMLInputElement).value)}
              />
            </Field>
          </div>
          {error && <Banner tone="danger">{error}</Banner>}
          <div class="row">
            <Button variant="primary" disabled={busy || !name.trim()} onClick={() => void create()}>
              <Icon icon={I.ADD} size={16} />
              {busy ? 'Criando…' : 'Criar perfil'}
            </Button>
          </div>
        </div>
      </Card>

      <Card title="Perfis" flush>
        {roots.length === 0 ? (
          <Empty>Nenhum perfil. Crie um acima — ou reinicie o mock para semear os do ambiente.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Nome</th>
                <th>CPF/CNPJ</th>
                <th>Chave de API</th>
                <th>Subcontas</th>
                <th style={{ textAlign: 'right' }}>Saldo</th>
                <th>Origem</th>
                <th>Criado em</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {roots.map((a) => (
                <tr key={a.id}>
                  <td>
                    <b>{a.name}</b>
                    {a.id === store.selected?.id && (
                      <>
                        {' '}
                        <Badge tone="primary">em uso</Badge>
                      </>
                    )}
                  </td>
                  <td class="mono">{a.cpfCnpj}</td>
                  <td>
                    {a.apiKey ? (
                      <Copy value={a.apiKey}>{`${a.apiKey.slice(0, 18)}…`}</Copy>
                    ) : (
                      <Badge tone="danger">nenhuma ativa</Badge>
                    )}
                  </td>
                  <td>{subsOf(a).length}</td>
                  <td style={{ textAlign: 'right' }}>{money(a.balance)}</td>
                  <td>
                    {a.seeded ? <Badge tone="primary">ambiente</Badge> : <Badge>painel</Badge>}
                  </td>
                  <td>{dateTime(a.dateCreated)}</td>
                  <td>
                    <div class="row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                      <Button
                        size="sm"
                        disabled={a.id === store.selected?.id}
                        onClick={() => store.select(a.id)}
                      >
                        Entrar
                      </Button>
                      <Button size="sm" onClick={() => setResetting(a)}>
                        <Icon icon={I.REFRESH} size={16} />
                        Zerar
                      </Button>
                      <button
                        class="icon-btn danger"
                        aria-label={`Excluir o perfil ${a.name}`}
                        onClick={() => setRemoving(a)}
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

      {created && (
        <Modal title="Perfil criado" onClose={() => setCreated(null)}>
          <p>
            <b>{created.name}</b> está pronto. Cole a chave abaixo na configuração do tenant
            na sua aplicação.
          </p>
          <div class="reveal-key">
            <Copy value={created.apiKey} />
          </div>
          <div class="modal-actions">
            <Button variant="ghost" onClick={() => setCreated(null)}>
              Fechar
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                store.select(created.accountId)
                setCreated(null)
              }}
            >
              Entrar no perfil
            </Button>
          </div>
        </Modal>
      )}

      {resetting && (
        <ResetModal
          account={resetting}
          subaccounts={subsOf(resetting).length}
          onClose={() => setResetting(null)}
          onDone={() => void store.reload()}
        />
      )}

      {removing && (
        <Modal title={`Excluir "${removing.name}"?`} onClose={() => setRemoving(null)}>
          <p>
            Some tudo deste perfil: chaves, clientes, cobranças, assinaturas, extrato, webhooks
            e a fila de entregas
            {subsOf(removing).length > 0 && (
              <>
                {' '}
                — e <b>{plural(subsOf(removing).length, 'subconta', 'subcontas')}</b> com tudo
                o que é delas
              </>
            )}
            . Não dá para desfazer.
          </p>
          <p class="hint">
            Outros perfis não mudam: um split que pagou este perfil continua no extrato de
            quem pagou.
          </p>
          {removing.seeded && (
            <Banner>
              Este perfil vem do <b>ambiente</b> do mock (<code>ASAAS_API_KEY</code> ou{' '}
              <code>SEED_EXTRA_ACCOUNTS</code>): no próximo boot ele volta, <b>zerado</b> e com
              a chave do ambiente.
            </Banner>
          )}
          <div class="modal-actions">
            <Button variant="ghost" onClick={() => setRemoving(null)}>
              Cancelar
            </Button>
            <Button variant="danger" disabled={removeBusy} onClick={() => void remove(removing)}>
              {removeBusy ? 'Excluindo…' : 'Excluir perfil'}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function ResetModal(props: {
  account: Account
  subaccounts: number
  onClose: () => void
  onDone: () => void
}) {
  const [chosen, setChosen] = useState<Set<Group>>(new Set(PRESETS[1]!.groups))
  const [cancel, setCancel] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ResetResult | null>(null)

  const reached = implied(chosen)
  const removesCharges = reached.has('charges')
  const nothing = reached.size === 0 && !cancel

  const toggle = (g: Group, on: boolean) => {
    const next = new Set(chosen)
    on ? next.add(g) : next.delete(g)
    setChosen(next)
  }

  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await admin(`/accounts/${props.account.id}/reset`, {
        method: 'POST',
        body: JSON.stringify({
          cancelCharges: cancel,
          remove: Object.fromEntries([...chosen].map((g) => [g, true])),
        }),
      })
      setResult(r)
      props.onDone()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  if (result) {
    const c = result.cancelled
    return (
      <Modal title={`"${props.account.name}" zerado`} onClose={props.onClose}>
        <p>
          {result.removed.length > 0
            ? `${plural(result.rows, 'registro apagado', 'registros apagados')}.`
            : 'Nada foi apagado.'}{' '}
          A conta, as chaves de API e as configurações continuam as mesmas.
          {result.subaccounts > 0 && (
            <>
              {' '}
              <b>{plural(result.subaccounts, 'subconta encerrada', 'subcontas encerradas')}</b>.
            </>
          )}
        </p>
        {result.removed.includes('logs') && (
          <p class="hint">
            Logs de requisições voltam a aparecer sozinhos: cada chamada que a sua aplicação fizer
            a partir de agora cria um log novo. O que aparecer na aba são chamadas novas, não os
            registros que acabaram de ser apagados.
          </p>
        )}
        {c && (
          <p>
            Cancelado pela API: {plural(c.payments, 'cobrança', 'cobranças')},{' '}
            {plural(c.subscriptions, 'assinatura', 'assinaturas')},{' '}
            {plural(c.installments, 'parcelamento', 'parcelamentos')} e{' '}
            {plural(c.invoices, 'nota fiscal', 'notas fiscais')}.{' '}
            {c.webhooks.delivered + c.webhooks.notDelivered === 0
              ? 'Nenhum webhook estava inscrito nesses eventos.'
              : `${plural(c.webhooks.delivered, 'entrega de webhook', 'entregas de webhook')} com sucesso.`}
          </p>
        )}
        {c && c.webhooks.notDelivered > 0 && (
          <Banner tone="danger">
            {plural(c.webhooks.notDelivered, 'entrega de cancelamento não chegou', 'entregas de cancelamento não chegaram')}{' '}
            ao destino (webhook fora do ar, desligado ou pausado)
            {result.removed.includes('webhooks') || result.removed.includes('logs')
              ? ' e foram apagadas com a fila.'
              : '. Elas continuam na fila de entregas.'}
          </Banner>
        )}
        <div class="modal-actions">
          <Button variant="primary" onClick={props.onClose}>
            Fechar
          </Button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title={`Zerar "${props.account.name}"?`} onClose={props.onClose} wide>
      <div class="stack">
        <p>
          O perfil continua com o mesmo id e as mesmas chaves de API: a sua aplicação não muda
          de configuração. Some o que você marcar abaixo, deste perfil
          {props.subaccounts > 0 && <> e das {plural(props.subaccounts, 'subconta', 'subcontas')}</>}.
        </p>

        <div class="row">
          {PRESETS.map((p) => (
            <Button key={p.label} size="sm" onClick={() => setChosen(new Set(p.groups))}>
              {p.label}
            </Button>
          ))}
        </div>

        <div class="form-grid">
          {GROUPS.map((g) => {
            const dragged = reached.has(g.id) && !chosen.has(g.id)
            return (
              <Toggle
                key={g.id}
                checked={reached.has(g.id)}
                disabled={dragged}
                onChange={(on) => toggle(g.id, on)}
                hint={dragged ? 'Vai junto: depende do que você marcou.' : g.hint}
              >
                {g.label}
              </Toggle>
            )
          })}
        </div>

        <Toggle
          checked={cancel}
          onChange={setCancel}
          hint={
            <>
              Remove as cobranças em aberto, os parcelamentos e as assinaturas e cancela as notas
              fiscais pelo caminho da API, entregando <code>PAYMENT_DELETED</code>,{' '}
              <code>SUBSCRIPTION_DELETED</code> e <code>INVOICE_CANCELED</code> aos webhooks {removesCharges ? 'antes de apagar' : '(os registros ficam, como removidos)'}.
              Cobrança já paga não se cancela.
            </>
          }
        >
          Cancelar antes{removesCharges ? ' de apagar' : ''}
        </Toggle>

        <p class="hint">
          Ficam sempre: a conta, as chaves de API, os documentos, as chaves Pix e as configurações.
          Não dá para desfazer.
        </p>
        {error && <Banner tone="danger">{error}</Banner>}
      </div>
      <div class="modal-actions">
        <Button variant="ghost" onClick={props.onClose}>
          Voltar
        </Button>
        <Button variant="danger" disabled={busy || nothing} onClick={() => void run()}>
          {busy ? 'Zerando…' : 'Zerar perfil'}
        </Button>
      </div>
    </Modal>
  )
}
