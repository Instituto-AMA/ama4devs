/**
 * One charge, opened from any list: its data, its invoice, and what can be done to it.
 *
 * The Asaas actions go through `/v3` with the account's key, as the integration
 * would call them: receive in cash (and undo it), remove, restore, and the sandbox
 * "confirm". The invoice link opens the payer's page, where the charge is paid the
 * way the payer would pay it. The simulator's outcome buttons (`/_mock`) stay apart,
 * under their own label.
 */
import { useEffect, useState } from 'preact/hooks'
import { mock, v3, type Customer, type Payment } from '../api.ts'
import type { Store } from '../store.ts'
import { formatDocument, parseMoney } from './forms.ts'
import { origin } from './PaymentTable.tsx'
import { PayerNotifications } from './PayerNotifications.tsx'
import {
  BILLING_LABEL,
  Badge,
  Banner,
  Button,
  Copy,
  Empty,
  errorText,
  Field,
  Modal,
  money,
  Row,
  StatusBadge,
} from './ui.tsx'

const PAYABLE = new Set(['PENDING', 'OVERDUE'])
const CAN_REFUND = new Set(['RECEIVED', 'CONFIRMED'])

type Pending = null | 'cash' | 'delete'

export function PaymentDetail(props: {
  store: Store
  paymentId: string
  onClose: () => void
  /** Something changed: the caller reloads its list. */
  onChanged: () => void
}) {
  const key = props.store.selected?.apiKey ?? ''
  const today = props.store.clock?.today ?? new Date().toISOString().slice(0, 10)
  const [p, setP] = useState<Payment | null>(null)
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending>(null)
  const [cashDate, setCashDate] = useState(today)
  const [cashValue, setCashValue] = useState('')

  const load = async () => {
    const payment: Payment = await v3(`/payments/${props.paymentId}`, key)
    setP(payment)
    setCashValue(payment.value.toFixed(2).replace('.', ','))
    v3(`/customers/${payment.customer}`, key)
      .then(setCustomer)
      .catch(() => setCustomer(null))
  }

  useEffect(() => {
    void load().catch((e) => setError(errorText(e)))
  }, [props.paymentId, key])

  const act = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await action()
      setPending(null)
      await load()
      props.onChanged()
      await props.store.reload()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const post = (path: string, body?: unknown) =>
    v3(path, key, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })

  if (!p) {
    return (
      <Modal title="Cobrança" onClose={props.onClose} wide>
        {error ? <Banner tone="danger">{error}</Banner> : <Empty>carregando…</Empty>}
      </Modal>
    )
  }

  const payable = PAYABLE.has(p.status) && !p.deleted

  return (
    <Modal
      title={
        <span class="row">
          Cobrança <span class="mono hint">{p.id}</span>
        </span>
      }
      onClose={props.onClose}
      wide
    >
      {error && <Banner tone="danger">{error}</Banner>}

      <div class="row">
        <StatusBadge status={p.status} />
        {p.deleted && <Badge tone="danger">removida</Badge>}
        <Badge tone="neutral">{origin(p)}</Badge>
      </div>

      <div class="detail-grid">
        <div>
          <Row label="Valor">{money(p.value)}</Row>
          <Row label="Valor líquido">{money(p.netValue)}</Row>
          <Row label="Forma de pagamento">{BILLING_LABEL[p.billingType] ?? p.billingType}</Row>
          <Row label="Vencimento">{p.dueDate}</Row>
          <Row label="Pago em">{p.paymentDate ?? p.clientPaymentDate ?? '—'}</Row>
          <Row label="Crédito em">{p.creditDate ?? '—'}</Row>
        </div>
        <div>
          <Row label="Cliente">
            {customer ? `${customer.name} · ${formatDocument(customer.cpfCnpj)}` : p.customer}
          </Row>
          <Row label="Fatura nº">{p.invoiceNumber ?? '—'}</Row>
          <Row label="Descrição">{p.description ?? '—'}</Row>
          <Row label="Referência externa">{p.externalReference ?? '—'}</Row>
          {p.installment && <Row label="Parcelamento">{p.installment}</Row>}
          {p.subscription && <Row label="Assinatura">{p.subscription}</Row>}
        </div>
      </div>

      <Field label="Link da fatura" hint="A página que o pagador abre. Pagar por ela segue o mesmo caminho de um pagamento real: status, extrato e webhooks.">
        <Copy value={p.invoiceUrl} />
      </Field>

      <div class="row">
        <a class="btn primary md" href={p.invoiceUrl} target="_blank" rel="noreferrer">
          Abrir fatura
        </a>
        {p.bankSlipUrl && (
          <a class="btn outline md" href={p.bankSlipUrl} target="_blank" rel="noreferrer">
            Boleto
          </a>
        )}
        {payable && (
          <Button
            disabled={busy}
            title="POST /v3/sandbox/payment/{id}/confirm — como se o pagador tivesse pago."
            onClick={() => void act(() => post(`/sandbox/payment/${p.id}/confirm`))}
          >
            Simular pagamento
          </Button>
        )}
        {payable && (
          <Button disabled={busy} onClick={() => setPending(pending === 'cash' ? null : 'cash')}>
            Confirmar recebimento em dinheiro
          </Button>
        )}
        {p.status === 'RECEIVED_IN_CASH' && (
          <Button disabled={busy} onClick={() => void act(() => post(`/payments/${p.id}/undoReceivedInCash`))}>
            Desfazer recebimento em dinheiro
          </Button>
        )}
        {p.deleted && (
          <Button disabled={busy} onClick={() => void act(() => post(`/payments/${p.id}/restore`))}>
            Restaurar
          </Button>
        )}
        {payable && (
          <Button variant="danger" disabled={busy} onClick={() => setPending(pending === 'delete' ? null : 'delete')}>
            Excluir
          </Button>
        )}
      </div>

      {pending === 'cash' && (
        <div class="inline-form">
          <p class="hint">
            A baixa manual registra um pagamento feito fora do Asaas (dinheiro, transferência).
            Não entra saldo nem extrato — o dinheiro não passou pela conta.
          </p>
          <div class="row">
            <Field label="Data do pagamento">
              <input class="input" type="date" value={cashDate} onInput={(e) => setCashDate((e.target as HTMLInputElement).value)} />
            </Field>
            <Field label="Valor recebido (R$)">
              <input class="input" value={cashValue} onInput={(e) => setCashValue((e.target as HTMLInputElement).value)} inputMode="decimal" />
            </Field>
          </div>
          <div class="row">
            <Button
              variant="primary"
              disabled={busy}
              onClick={() =>
                void act(() =>
                  post(`/payments/${p.id}/receiveInCash`, {
                    paymentDate: cashDate,
                    value: parseMoney(cashValue),
                    notifyCustomer: false,
                  }),
                )
              }
            >
              Confirmar recebimento
            </Button>
            <Button variant="ghost" onClick={() => setPending(null)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {pending === 'delete' && (
        <div class="inline-form">
          <p>
            Excluir a cobrança? Ela sai das listas e a sua aplicação recebe <b>PAYMENT_DELETED</b>.
            Dá para restaurar depois.
          </p>
          <div class="row">
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => void act(() => v3(`/payments/${p.id}`, key, { method: 'DELETE' }))}
            >
              Excluir cobrança
            </Button>
            <Button variant="ghost" onClick={() => setPending(null)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {/* Re-read after each action: an action (pay, overdue) sends its own notification. */}
      <PayerNotifications paymentId={p.id} refreshKey={p.status} />

      {(PAYABLE.has(p.status) || CAN_REFUND.has(p.status)) && !p.deleted && (
        <div class="row sim-actions">
          <Badge tone="neutral">Simulador</Badge>
          {PAYABLE.has(p.status) && (
            <Button size="sm" disabled={busy} title="PAYMENT_RECEIVED" onClick={() => void act(() => mock(`/payments/${p.id}/receive`, { method: 'POST' }))}>
              Receber
            </Button>
          )}
          {p.status === 'PENDING' && (
            <Button size="sm" disabled={busy} title="PAYMENT_OVERDUE" onClick={() => void act(() => mock(`/payments/${p.id}/overdue`, { method: 'POST' }))}>
              Vencer
            </Button>
          )}
          {CAN_REFUND.has(p.status) && (
            <Button size="sm" disabled={busy} title="PAYMENT_REFUNDED" onClick={() => void act(() => mock(`/payments/${p.id}/refund`, { method: 'POST' }))}>
              Estornar
            </Button>
          )}
        </div>
      )}
    </Modal>
  )
}
