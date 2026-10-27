/**
 * A list of charges, the same columns wherever it appears: the Cobranças tab, a
 * customer, a subscription, an installment plan. A click opens the charge.
 */
import type { Customer, Payment } from '../api.ts'
import { DataTable, type Column } from './DataTable.tsx'
import { BILLING_LABEL, Badge, money, StatusBadge } from './ui.tsx'

/** Where a charge comes from: "Parcela 2/12", "Assinatura" or "Avulsa". */
export function origin(p: Payment, installmentCounts?: Map<string, number>): string {
  if (p.installment) {
    const total = installmentCounts?.get(p.installment)
    return `Parcela ${p.installmentNumber ?? '?'}${total ? `/${total}` : ''}`
  }
  if (p.subscription) return 'Assinatura'
  return 'Avulsa'
}

export function PaymentTable(props: {
  rows: Payment[]
  customers?: Map<string, Customer>
  /** Hide the customer column (a customer's own page). */
  hideCustomer?: boolean
  onOpen: (p: Payment) => void
  empty?: string
  search?: boolean
}) {
  const columns: Column<Payment>[] = [
    { key: 'id', header: 'ID', render: (p) => <span class="mono">{p.id}</span>, value: (p) => p.id },
    {
      key: 'status',
      header: 'Situação',
      render: (p) => <StatusBadge status={p.status} />,
      value: (p) => p.status,
    },
    ...(props.hideCustomer
      ? []
      : [
          {
            key: 'customer',
            header: 'Cliente',
            render: (p: Payment) => {
              const c = props.customers?.get(p.customer)
              if (!c) return <span class="mono hint">{p.customer}</span>
              return (
                <span>
                  {c.name} {c.deleted && <Badge tone="neutral">removido</Badge>}
                </span>
              )
            },
            value: (p: Payment) => props.customers?.get(p.customer)?.name ?? p.customer,
          },
        ]),
    { key: 'origin', header: 'Tipo', render: (p) => origin(p), value: (p) => origin(p) },
    {
      key: 'billingType',
      header: 'Forma',
      render: (p) => BILLING_LABEL[p.billingType] ?? p.billingType,
      value: (p) => p.billingType,
    },
    { key: 'value', header: 'Valor', align: 'right', render: (p) => money(p.value), value: (p) => p.value },
    { key: 'dueDate', header: 'Vencimento', render: (p) => p.dueDate, value: (p) => p.dueDate },
    {
      key: 'paymentDate',
      header: 'Pago em',
      render: (p) => p.paymentDate ?? p.clientPaymentDate ?? '—',
      value: (p) => p.paymentDate ?? p.clientPaymentDate ?? null,
    },
  ]

  return (
    <DataTable
      rows={props.rows}
      columns={columns}
      initialSort={{ key: 'dueDate', dir: 'desc' }}
      searchPlaceholder={props.search === false ? undefined : 'Buscar por id, cliente, situação…'}
      empty={props.empty ?? 'nenhuma cobrança'}
      onRowClick={props.onOpen}
    />
  )
}
