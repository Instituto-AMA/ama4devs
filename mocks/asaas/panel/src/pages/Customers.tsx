import { useEffect, useState } from 'preact/hooks'
import { admin, v3 } from '../api.ts'
import type { PageProps } from '../app.tsx'
import { DataTable, type Column } from '../components/DataTable.tsx'
import { Badge, Button, Card, Empty } from '../components/ui.tsx'

interface Customer {
  id: string
  name: string
  email: string | null
  cpfCnpj: string
  mobilePhone: string | null
  dateCreated: string
  deleted: boolean
}

type View = 'active' | 'removed'

/**
 * The account's customers, read from the real `/v3/customers` with the account's key.
 *
 * Asaas lists only active customers and has no filter for removed ones, so those come
 * from the simulator (`/_admin/customers?removed=true`). Both are shown here, because a charge keeps pointing at its customer after the
 * customer is removed (an integration's cleanup does exactly that) and a panel that
 * only shows the active list looks empty while the charges still name someone.
 */
export function Customers({ store }: PageProps) {
  const [active, setActive] = useState<Customer[] | null>(null)
  const [removed, setRemoved] = useState<Customer[] | null>(null)
  const [view, setView] = useState<View>('active')
  const key = store.selected?.apiKey
  const accountId = store.selected?.id

  useEffect(() => {
    if (!key || !accountId) return
    setActive(null)
    setRemoved(null)
    void v3('/customers?limit=100', key).then((r) => setActive(r.data))
    void admin(`/customers?accountId=${encodeURIComponent(accountId)}&removed=true`).then((r) =>
      setRemoved(r.data),
    )
  }, [key, accountId])

  if (!active || !removed) return <Card><Empty>carregando…</Empty></Card>

  const rows = view === 'active' ? active : removed

  const columns: Column<Customer>[] = [
    { key: 'id', header: 'ID', render: (c) => <span class="mono">{c.id}</span>, value: (c) => c.id },
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
      render: (c) => <span class="mono">{c.cpfCnpj}</span>,
      value: (c) => c.cpfCnpj,
    },
    { key: 'email', header: 'E-mail', render: (c) => c.email ?? '—', value: (c) => c.email },
    {
      key: 'mobilePhone',
      header: 'Telefone',
      render: (c) => c.mobilePhone ?? '—',
      value: (c) => c.mobilePhone,
    },
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
        ? 'nenhum cliente nesta conta'
        : 'nenhum cliente removido'

  return (
    <>
      <div class="row" style={{ gap: 'var(--pad-xs)', marginBottom: 'var(--pad-sm)' }}>
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
      <Card flush>
        <DataTable
          rows={rows}
          columns={columns}
          initialSort={{ key: 'name', dir: 'asc' }}
          searchPlaceholder="Buscar por nome, CPF/CNPJ, e-mail…"
          empty={empty}
        />
      </Card>
    </>
  )
}
