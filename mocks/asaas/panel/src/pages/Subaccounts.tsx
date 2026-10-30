/**
 * The subaccounts, with the API key of each one on the screen.
 *
 * In Asaas, the key of a subaccount appears ONE time, in the answer of the
 * creation, and never again. Whoever did not save it, recreates the account.
 * Here it stays visible — it is the reason the panel has value and
 * `ADMIN_ENABLED` exists.
 *
 * Clicking "Enter" switches the active account in the topbar: the whole panel
 * starts seeing the simulator through its eyes, and you confirm that a
 * subaccount does NOT see the charges of the parent — which is the real
 * behavior, and what a screen without isolation would hide.
 */
import { useState } from 'preact/hooks'
import { v3 } from '../api.ts'
import type { PageProps } from '../app.tsx'
import { DataTable, type Column } from '../components/DataTable.tsx'
import type { Account } from '../api.ts'
import { Button, Card, Copy, money } from '../components/ui.tsx'

export function Subaccounts({ store }: PageProps) {
  const subs = store.accounts.filter((a) => a.parentAccountId)
  const master = store.accounts.find((a) => !a.parentAccountId)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')

  const create = async () => {
    if (!master?.apiKey || !name.trim()) return
    setCreating(true)
    try {
      // A fixed valid CPF: the screen does not ask for what the simulator does not
      // use for anything.
      await v3('/accounts', master.apiKey, {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          email: `${name.trim().toLowerCase().replace(/\W+/g, '.')}@localhost`,
          cpfCnpj: '24971563792',
          mobilePhone: '11999999999',
          incomeValue: 5000,
          address: 'Rua Exemplo',
          addressNumber: '100',
          province: 'Centro',
          postalCode: '01310100',
        }),
      })
      setName('')
      await store.reload()
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
    } finally {
      setCreating(false)
    }
  }

  const columns: Column<Account>[] = [
    { key: 'name', header: 'Nome', render: (a) => a.name, value: (a) => a.name },
    {
      key: 'walletId',
      header: 'walletId',
      render: (a) => <Copy value={a.walletId}>{`${a.walletId.slice(0, 8)}…`}</Copy>,
      value: (a) => a.walletId,
    },
    {
      key: 'apiKey',
      header: 'Chave de API',
      render: (a) =>
        a.apiKey ? <Copy value={a.apiKey}>{`${a.apiKey.slice(0, 18)}…`}</Copy> : '—',
      value: (a) => a.apiKey,
    },
    {
      key: 'balance',
      header: 'Saldo',
      align: 'right',
      render: (a) => <span class={a.balance < 0 ? 'neg' : ''}>{money(a.balance)}</span>,
      value: (a) => a.balance,
    },
  ]

  return (
    <div class="stack">
      <Card title="Nova subconta">
        <div class="row">
          <input
            class="input"
            placeholder="Nome da subconta (ex: Produtora Alfa)"
            value={name}
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => e.key === 'Enter' && void create()}
          />
          <Button variant="primary" disabled={creating || !name.trim()} onClick={() => void create()}>
            {creating ? 'Criando…' : 'Criar'}
          </Button>
        </div>
        <p class="hint" style={{ marginTop: 'var(--pad-sm)', marginBottom: 0 }}>
          Criada pela API real (<code>POST /v3/accounts</code>), com a chave da conta
          principal. Ela nasce com walletId e chave próprios, e saldo zero.
        </p>
      </Card>

      <Card flush>
        <DataTable
          rows={subs}
          columns={columns}
          initialSort={{ key: 'name', dir: 'asc' }}
          searchPlaceholder="Buscar por nome, walletId, chave…"
          empty="nenhuma subconta ainda"
          actions={(a) => (
            <Button size="sm" onClick={() => store.select(a.id)}>
              Entrar
            </Button>
          )}
        />
      </Card>
    </div>
  )
}
