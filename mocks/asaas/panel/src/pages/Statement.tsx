/**
 * The statement — and the reason it exists here is to be AUDITABLE.
 *
 * Each line is an entry in the ledger, and the sum of them HAS to match the
 * balance shown in the topbar. It is the invariant the integration tests check
 * on every transaction (`balance_cents === SUM(financial_transactions.value_cents)`),
 * and it is what makes it possible to look at a split and see the money leave
 * one account and enter the other.
 *
 * The "Balance" column is an accumulated one: sorting by it or filtering the
 * list does NOT recalculate anything — the number keeps being the balance of
 * that instant, which is what it means.
 */
import { useEffect, useState } from 'preact/hooks'
import { v3 } from '../api.ts'
import type { PageProps } from '../app.tsx'
import { DataTable, type Column } from '../components/DataTable.tsx'
import { Badge, Card, Empty, money } from '../components/ui.tsx'

interface Tx {
  id: string
  value: number
  balance: number
  type: string
  date: string
  description: string | null
  paymentId: string | null
}

/** The types that take money out. Painting every one green would lie through color. */
const DEBIT = /FEE|REFUND|TRANSFER|CHARGEBACK|DEBIT|CANCEL/

export function Statement({ store }: PageProps) {
  const [rows, setRows] = useState<Tx[] | null>(null)
  const key = store.selected?.apiKey

  useEffect(() => {
    if (!key) return
    setRows(null)
    void v3('/financialTransactions?limit=100', key).then((r) => setRows(r.data))
  }, [key])

  if (!rows) return <Card><Empty>carregando…</Empty></Card>

  const columns: Column<Tx>[] = [
    { key: 'date', header: 'Data', render: (t) => t.date, value: (t) => t.date },
    {
      key: 'type',
      header: 'Tipo',
      render: (t) => <Badge tone={DEBIT.test(t.type) ? 'danger' : 'success'}>{t.type}</Badge>,
      value: (t) => t.type,
    },
    {
      key: 'description',
      header: 'Descrição',
      render: (t) => <span style={{ whiteSpace: 'normal' }}>{t.description ?? '—'}</span>,
      value: (t) => t.description,
    },
    {
      key: 'paymentId',
      header: 'Cobrança',
      render: (t) => <span class="mono hint">{t.paymentId ?? '—'}</span>,
      value: (t) => t.paymentId,
    },
    {
      key: 'value',
      header: 'Valor',
      align: 'right',
      render: (t) => <span class={t.value < 0 ? 'neg' : 'pos'}>{money(t.value)}</span>,
      value: (t) => t.value,
    },
    {
      key: 'balance',
      header: 'Saldo',
      align: 'right',
      render: (t) => <span class="hint">{money(t.balance)}</span>,
      value: (t) => t.balance,
    },
  ]

  return (
    <Card
      subtitle={`Saldo atual: ${money(store.selected?.balance)} — a soma dos lançamentos abaixo fecha com ele.`}
      flush
    >
      <DataTable
        rows={rows}
        columns={columns}
        initialSort={{ key: 'date', dir: 'desc' }}
        searchPlaceholder="Buscar por tipo, descrição, cobrança…"
        empty="nenhum lançamento nesta conta"
      />
    </Card>
  )
}
