/**
 * One of the four cards of "Situação das cobranças".
 *
 * The segmented bar shows the composition by PAYMENT METHOD, and it is not
 * decoration: it is what answers "why did my balance not go up?" without
 * opening the list. The card credits in D+32, the bank slip in 1 business day,
 * Pix on the spot — a "Confirmed" card that is 90% card tells a very different
 * story from one that is 90% Pix.
 *
 * The segments add up EXACTLY to the total: the last one absorbs the remainder
 * of the division, otherwise a leftover of 0,3% would leave a gap in the bar
 * that nobody can explain.
 */
import type { GroupSummary, SummaryGroup } from '../api.ts'
import * as I from '../icons.ts'
import { Icon } from './Icon.tsx'
import { money, plural, type Tone } from './ui.tsx'
import './StatusCard.css'

const TITLE: Record<SummaryGroup, string> = {
  RECEIVED: 'Recebidas',
  CONFIRMED: 'Confirmadas',
  AWAITING: 'Aguardando pagamento',
  OVERDUE: 'Vencidas',
}

const TONE: Record<SummaryGroup, Tone> = {
  RECEIVED: 'success',
  CONFIRMED: 'primary',
  AWAITING: 'warn',
  OVERDUE: 'danger',
}

const BILLING_LABEL: Record<string, string> = {
  PIX: 'Pix',
  BOLETO: 'Boleto',
  CREDIT_CARD: 'Cartão de crédito',
  DEBIT_CARD: 'Cartão de débito',
  UNDEFINED: 'Não definido',
  TRANSFER: 'Transferência',
  DEPOSIT: 'Depósito',
}

export function StatusCard({ s, onDrill }: { s: GroupSummary; onDrill: () => void }) {
  const tone = TONE[s.group]
  const total = s.byBillingType.reduce((a, b) => a + b.value, 0)

  return (
    <div class={`stat ${tone}`}>
      <div class="stat-hdr">
        <h3>{TITLE[s.group]}</h3>
      </div>

      <div class="stat-value">{money(s.value)}</div>
      <div class="stat-net">{money(s.netValue)} líquido</div>

      <div class="stat-bar" role="img" aria-label={`Composição por meio de pagamento`}>
        {total === 0 ? (
          <div class="seg empty-seg" />
        ) : (
          s.byBillingType.map((b, i) => (
            <div
              key={b.billingType}
              class={`seg shade-${Math.min(i, 3)}`}
              style={{ width: `${(b.value / total) * 100}%` }}
              title={`${BILLING_LABEL[b.billingType] ?? b.billingType}: ${money(b.value)} (${plural(b.count, 'cobrança', 'cobranças')})`}
            />
          ))
        )}
      </div>

      <div class="stat-links">
        <button onClick={onDrill}>
          <Icon icon={I.CUSTOMER} size={14} />
          <span class="grow">{plural(s.customers, 'cliente', 'clientes')}</span>
          <Icon icon={I.CHEVRON} size={14} />
        </button>
        <button onClick={onDrill}>
          <Icon icon={I.PAYMENT} size={14} />
          <span class="grow">{plural(s.count, 'cobrança', 'cobranças')}</span>
          <Icon icon={I.CHEVRON} size={14} />
        </button>
      </div>
    </div>
  )
}
