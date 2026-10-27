/**
 * Perfis: as contas RAIZ do simulador — cada uma, um tenant da sua aplicação, com chave,
 * carteira, clientes e webhooks próprios.
 *
 * Mora no bloco do Simulador porque o Asaas não abre conta raiz por API: lá, cada
 * clínica cria a própria conta no site. Aqui você cria e apaga quantas quiser, sem
 * reiniciar o container.
 *
 * Os perfis do AMBIENTE (`ASAAS_API_KEY`, `SEED_EXTRA_ACCOUNTS`) também se apagam, mas
 * voltam no próximo boot — zerados e com a chave do ambiente. A tela avisa antes.
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
} from '../../components/ui.tsx'
import * as I from '../../icons.ts'

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
