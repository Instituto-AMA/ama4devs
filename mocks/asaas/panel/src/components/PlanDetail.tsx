/**
 * A subscription or an installment plan, opened from a list: its data and its
 * charges, each of which opens the charge itself.
 *
 *   Assinatura     GET /v3/subscriptions/{id}/payments, DELETE /v3/subscriptions/{id}
 *   Parcelamento   GET /v3/installments/{id}/payments, DELETE /v3/installments/{id}/payments
 *                  (cancels the pending ones), DELETE /v3/installments/{id}
 */
import { useEffect, useState } from 'preact/hooks'
import { v3, type Customer, type Installment, type Payment, type Subscription } from '../api.ts'
import type { Store } from '../store.ts'
import { CYCLE_LABEL, formatDocument, SUBSCRIPTION_STATUS_LABEL } from './forms.ts'
import { PaymentDetail } from './PaymentDetail.tsx'
import { PaymentTable } from './PaymentTable.tsx'
import { BILLING_LABEL, Badge, Banner, Button, Empty, errorText, Modal, money, Row } from './ui.tsx'

export type Plan = { kind: 'subscription'; id: string } | { kind: 'installment'; id: string }

type Confirm = null | 'remove' | 'cancel-pending'

export function PlanDetail(props: {
  store: Store
  plan: Plan
  onClose: () => void
  onChanged: () => void
}) {
  const key = props.store.selected?.apiKey ?? ''
  const { kind, id } = props.plan
  const base = kind === 'subscription' ? `/subscriptions/${id}` : `/installments/${id}`

  const [plan, setPlan] = useState<Subscription | Installment | null>(null)
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [charges, setCharges] = useState<Payment[] | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    const [p, list] = await Promise.all([v3(base, key), v3(`${base}/payments?limit=100`, key)])
    setPlan(p)
    setCharges(list.data)
    v3(`/customers/${p.customer}`, key)
      .then(setCustomer)
      .catch(() => setCustomer(null))
  }

  useEffect(() => {
    void load().catch((e) => setError(errorText(e)))
  }, [base, key])

  const act = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await action()
      setConfirm(null)
      await load().catch(() => setPlan((cur) => (cur ? { ...cur, deleted: true } : cur)))
      props.onChanged()
      await props.store.reload()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const title = kind === 'subscription' ? 'Assinatura' : 'Parcelamento'

  if (open) {
    return (
      <PaymentDetail
        store={props.store}
        paymentId={open}
        onClose={() => setOpen(null)}
        onChanged={() => void load().then(props.onChanged)}
      />
    )
  }

  if (!plan || !charges) {
    return (
      <Modal title={title} onClose={props.onClose} wide>
        {error ? <Banner tone="danger">{error}</Banner> : <Empty>carregando…</Empty>}
      </Modal>
    )
  }

  const sub = kind === 'subscription' ? (plan as Subscription) : null
  const inst = kind === 'installment' ? (plan as Installment) : null
  const pending = charges.filter((c) => c.status === 'PENDING' || c.status === 'OVERDUE').length

  return (
    <Modal
      title={
        <span class="row">
          {title} <span class="mono hint">{plan.id}</span>
        </span>
      }
      onClose={props.onClose}
      wide
    >
      {error && <Banner tone="danger">{error}</Banner>}
      <div class="row">
        {sub && <Badge tone={sub.status === 'ACTIVE' ? 'success' : 'neutral'}>{SUBSCRIPTION_STATUS_LABEL[sub.status] ?? sub.status}</Badge>}
        {plan.deleted && <Badge tone="danger">removido</Badge>}
      </div>

      <div class="detail-grid">
        <div>
          <Row label="Cliente">
            {customer ? `${customer.name} · ${formatDocument(customer.cpfCnpj)}` : plan.customer}
          </Row>
          <Row label="Forma de pagamento">{BILLING_LABEL[plan.billingType] ?? plan.billingType}</Row>
          <Row label="Descrição">{plan.description ?? '—'}</Row>
        </div>
        <div>
          {sub && (
            <>
              <Row label="Valor">{money(sub.value)}</Row>
              <Row label="Periodicidade">{CYCLE_LABEL[sub.cycle] ?? sub.cycle}</Row>
              <Row label="Próximo vencimento">{sub.nextDueDate}</Row>
              <Row label="Termina">{sub.endDate ?? (sub.maxPayments ? `após ${sub.maxPayments} cobranças` : 'nunca')}</Row>
            </>
          )}
          {inst && (
            <>
              <Row label="Valor total">{money(inst.value)}</Row>
              <Row label="Parcelas">{inst.installmentCount}</Row>
              <Row label="Pendentes">{pending}</Row>
            </>
          )}
        </div>
      </div>

      {!plan.deleted && (
        <div class="row">
          {inst && pending > 0 && (
            <Button disabled={busy} onClick={() => setConfirm(confirm === 'cancel-pending' ? null : 'cancel-pending')}>
              Cancelar cobranças pendentes
            </Button>
          )}
          <Button variant="danger" disabled={busy} onClick={() => setConfirm(confirm === 'remove' ? null : 'remove')}>
            {sub ? 'Remover assinatura' : 'Remover parcelamento'}
          </Button>
        </div>
      )}

      {confirm && (
        <div class="inline-form">
          <p>
            {confirm === 'cancel-pending'
              ? `Cancelar as ${pending} cobranças ainda não pagas? As pagas ficam como estão.`
              : sub
                ? 'Remover a assinatura? Ela para de gerar cobranças, e as pendentes são removidas.'
                : 'Remover o parcelamento? As cobranças pendentes são removidas.'}
          </p>
          <div class="row">
            <Button
              variant="danger"
              disabled={busy}
              onClick={() =>
                void act(() =>
                  v3(confirm === 'cancel-pending' ? `${base}/payments` : base, key, { method: 'DELETE' }),
                )
              }
            >
              Confirmar
            </Button>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Voltar
            </Button>
          </div>
        </div>
      )}

      <h3 class="section-title">Cobranças</h3>
      <div class="card flush-card">
        <PaymentTable
          rows={charges}
          hideCustomer
          search={false}
          onOpen={(p) => setOpen(p.id)}
          empty={sub ? 'nenhuma cobrança gerada ainda' : 'nenhuma cobrança'}
        />
      </div>
    </Modal>
  )
}
