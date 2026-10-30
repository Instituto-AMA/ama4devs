/**
 * Split — the two ends, side by side. It is the screen that justifies the
 * multi-account.
 *
 * "Recebidos" is money that COMES IN to this account because another one
 * included it in a split. "Pagos" is money that LEAVES it for another one.
 * Switching account in the selector of the topbar and seeing the same split show
 * up on the other side, with the sign inverted, is the only way to confirm that
 * the money really moved — and not only that the API answered 200.
 *
 * `BLOCKED_BY_VALUE_DIVERGENCE` is the state that bites: the sum of the splits
 * went over the netValue and Asaas BLOCKS instead of rejecting the charge,
 * giving 2 business days to adjust. A split that never credits, with no error
 * at all, is exactly this.
 */
import { useEffect, useState } from 'preact/hooks'
import { v3 } from '../api.ts'
import type { PageProps } from '../app.tsx'
import { DataTable, type Column } from '../components/DataTable.tsx'
import { Badge, Card, Empty, money, type Tone } from '../components/ui.tsx'

interface Split {
  id: string
  paymentId?: string
  walletId?: string
  status: string
  totalValue: number | null
  fixedValue: number | null
  percentualValue: number | null
  description: string | null
  refusalReason?: string | null
  cancellationReason?: string | null
}

const TONE: Record<string, Tone> = {
  DONE: 'success',
  AWAITING_CREDIT: 'primary',
  PENDING: 'warn',
  BLOCKED_BY_VALUE_DIVERGENCE: 'danger',
  REFUSED: 'danger',
  CANCELLED: 'neutral',
}

function SplitTable({ rows, empty }: { rows: Split[]; empty: string }) {
  const columns: Column<Split>[] = [
    {
      key: 'paymentId',
      header: 'Cobrança',
      render: (s) => <span class="mono">{s.paymentId ?? '—'}</span>,
      value: (s) => s.paymentId,
    },
    {
      key: 'walletId',
      header: 'Carteira',
      render: (s) => <span class="mono hint">{s.walletId?.slice(0, 8) ?? '—'}…</span>,
      value: (s) => s.walletId,
    },
    {
      key: 'status',
      header: 'Status',
      render: (s) => <Badge tone={TONE[s.status] ?? 'neutral'}>{s.status}</Badge>,
      value: (s) => s.status,
    },
    {
      key: 'rule',
      header: 'Regra',
      render: (s) => (
        <span class="hint">
          {s.percentualValue != null
            ? `${s.percentualValue}%`
            : s.fixedValue != null
              ? money(s.fixedValue)
              : '—'}
        </span>
      ),
      // A percentage and a fixed value are not comparable with each other.
      // Sorting by this column would mix "10%" with "R$ 50" and produce an order
      // without meaning.
    },
    {
      key: 'totalValue',
      header: 'Valor',
      align: 'right',
      render: (s) => money(s.totalValue),
      value: (s) => s.totalValue,
    },
  ]

  return (
    <DataTable
      rows={rows}
      columns={columns}
      initialSort={{ key: 'totalValue', dir: 'desc' }}
      searchPlaceholder="Buscar por cobrança, carteira, status…"
      empty={empty}
    />
  )
}

export function Splits({ store }: PageProps) {
  const [received, setReceived] = useState<Split[] | null>(null)
  const [paid, setPaid] = useState<Split[] | null>(null)
  const key = store.selected?.apiKey

  useEffect(() => {
    if (!key) return
    setReceived(null)
    setPaid(null)
    void v3('/payments/splits/received?limit=100', key).then((r) => setReceived(r.data))
    void v3('/payments/splits/paid?limit=100', key).then((r) => setPaid(r.data))
  }, [key])

  return (
    <div class="stack">
      <Card
        title="Splits recebidos"
        subtitle="Dinheiro que ENTRA nesta conta porque outra a incluiu num split."
        flush
      >
        {received ? (
          <SplitTable rows={received} empty="nenhum split recebido" />
        ) : (
          <Empty>carregando…</Empty>
        )}
      </Card>

      <Card
        title="Splits pagos"
        subtitle="Dinheiro que SAI desta conta para outra carteira."
        flush
      >
        {paid ? <SplitTable rows={paid} empty="nenhum split pago" /> : <Empty>carregando…</Empty>}
      </Card>
    </div>
  )
}
