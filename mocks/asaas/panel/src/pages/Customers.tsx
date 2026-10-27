/**
 * "Meus Clientes": the account's customers, read from the real `/v3/customers` with
 * the account's key, created and edited through it too.
 *
 * Asaas lists only active customers and has no filter for removed ones, so those come
 * from the simulator (`/_admin/customers?removed=true`). Both are shown, because a
 * charge keeps pointing at its customer after the customer is removed (an
 * integration's cleanup does exactly that) and a panel that only shows the active
 * list looks empty while the charges still name someone.
 *
 * A click opens the customer (`#customers/<id>`) with its charges.
 */
import { useState } from 'preact/hooks'
import type { Customer } from '../api.ts'
import type { PageProps } from '../app.tsx'
import { CustomerForm } from '../components/CustomerForm.tsx'
import { DataTable, type Column } from '../components/DataTable.tsx'
import { formatDocument } from '../components/forms.ts'
import { Icon } from '../components/Icon.tsx'
import { Badge, Button, Card, Empty } from '../components/ui.tsx'
import { useCustomers } from '../components/useCustomers.ts'
import * as I from '../icons.ts'
import { CustomerDetail } from './CustomerDetail.tsx'

type View = 'active' | 'removed'

export function Customers(props: PageProps & { customerId?: string }) {
  const { store, navigate } = props
  const key = store.selected?.apiKey
  const customers = useCustomers(key, store.selected?.id)
  const [view, setView] = useState<View>('active')
  const [creating, setCreating] = useState(false)

  if (props.customerId) {
    return <CustomerDetail {...props} customerId={props.customerId} onChanged={() => void customers.reload()} />
  }

  if (customers.loading && customers.byId.size === 0) return <Card><Empty>carregando…</Empty></Card>

  const active = customers.list
  const removed = [...customers.byId.values()].filter((c) => c.deleted)
  const rows = view === 'active' ? active : removed

  const columns: Column<Customer>[] = [
    {
      key: 'name',
      header: 'Nome',
      render: (c) => (
        <span>
          {c.name} {c.deleted && <Badge tone="neutral">removido</Badge>}
        </span>
      ),
      value: (c) => c.name,
    },
    {
      key: 'cpfCnpj',
      header: 'CPF/CNPJ',
      render: (c) => <span class="mono">{formatDocument(c.cpfCnpj)}</span>,
      value: (c) => c.cpfCnpj,
    },
    { key: 'email', header: 'E-mail', render: (c) => c.email ?? '—', value: (c) => c.email },
    {
      key: 'mobilePhone',
      header: 'Celular',
      render: (c) => c.mobilePhone ?? c.phone ?? '—',
      value: (c) => c.mobilePhone ?? c.phone,
    },
    { key: 'id', header: 'ID', render: (c) => <span class="mono hint">{c.id}</span>, value: (c) => c.id },
    {
      key: 'dateCreated',
      header: 'Criado em',
      render: (c) => c.dateCreated,
      value: (c) => c.dateCreated,
    },
  ]

  const empty =
    view === 'active' && removed.length > 0
      ? `nenhum cliente ativo — ${removed.length} removido(s), veja em "Removidos"`
      : view === 'active'
        ? 'nenhum cliente nesta conta — use "Novo cliente"'
        : 'nenhum cliente removido'

  return (
    <>
      <div class="row page-actions" style={{ marginBottom: 'var(--pad-sm)' }}>
        <div class="row grow" style={{ gap: 'var(--pad-xs)' }}>
          <Button
            size="sm"
            variant={view === 'active' ? 'primary' : 'outline'}
            aria-pressed={view === 'active'}
            onClick={() => setView('active')}
          >
            Ativos ({active.length})
          </Button>
          <Button
            size="sm"
            variant={view === 'removed' ? 'primary' : 'outline'}
            aria-pressed={view === 'removed'}
            onClick={() => setView('removed')}
          >
            Removidos ({removed.length})
          </Button>
        </div>
        <Button variant="primary" disabled={!key} onClick={() => setCreating(true)}>
          <Icon icon={I.ADD} size={16} />
          Novo cliente
        </Button>
      </div>
      <Card flush>
        <DataTable
          rows={rows}
          columns={columns}
          initialSort={{ key: 'name', dir: 'asc' }}
          searchPlaceholder="Buscar por nome, CPF/CNPJ, e-mail…"
          empty={empty}
          onRowClick={(c) => navigate(`customers/${c.id}`)}
        />
      </Card>
      {creating && key && (
        <CustomerForm
          apiKey={key}
          onClose={() => setCreating(false)}
          onSaved={(c) => {
            setCreating(false)
            void customers.reload()
            navigate(`customers/${c.id}`)
          }}
        />
      )}
    </>
  )
}
