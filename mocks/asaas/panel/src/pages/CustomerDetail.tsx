/**
 * One customer: its data and everything billed to it — charges, subscriptions and
 * installment plans — from the real `/v3` filtered by customer.
 *
 * `/v3/installments` has no customer filter, so the plans are the ones whose charges
 * name this customer. "New charge" opens the form with the customer chosen.
 */
import { useEffect, useState } from 'preact/hooks'
import { v3, type Customer, type Installment, type Payment, type Subscription } from '../api.ts'
import type { PageProps } from '../app.tsx'
import { ChargeForm } from '../components/ChargeForm.tsx'
import { CustomerForm } from '../components/CustomerForm.tsx'
import { CYCLE_LABEL, formatDocument, SUBSCRIPTION_STATUS_LABEL } from '../components/forms.ts'
import { Icon } from '../components/Icon.tsx'
import { PaymentDetail } from '../components/PaymentDetail.tsx'
import { PaymentTable } from '../components/PaymentTable.tsx'
import { PlanDetail, type Plan } from '../components/PlanDetail.tsx'
import {
  BILLING_LABEL,
  Badge,
  Banner,
  Button,
  Card,
  Empty,
  errorText,
  money,
  Row,
  Table,
} from '../components/ui.tsx'
import * as I from '../icons.ts'

type Dialog =
  | null
  | { kind: 'edit' }
  | { kind: 'charge' }
  | { kind: 'payment'; id: string }
  | { kind: 'plan'; plan: Plan }
  | { kind: 'remove' }

export function CustomerDetail(props: PageProps & { customerId: string; onChanged: () => void }) {
  const key = props.store.selected?.apiKey ?? ''
  const id = props.customerId
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [charges, setCharges] = useState<Payment[]>([])
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([])
  const [installments, setInstallments] = useState<Installment[]>([])
  const [dialog, setDialog] = useState<Dialog>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    const [c, pays, subs] = await Promise.all([
      v3(`/customers/${id}`, key),
      v3(`/payments?customer=${encodeURIComponent(id)}&limit=100`, key),
      v3(`/subscriptions?customer=${encodeURIComponent(id)}&limit=100`, key),
    ])
    setCustomer(c)
    setCharges(pays.data)
    setSubscriptions(subs.data)
    const planIds = [...new Set((pays.data as Payment[]).map((p) => p.installment).filter(Boolean))] as string[]
    setInstallments(await Promise.all(planIds.map((plan) => v3(`/installments/${plan}`, key))))
  }

  useEffect(() => {
    if (!key) return
    void load().catch((e) => setError(errorText(e)))
  }, [id, key])

  const reloadAll = () => {
    void load().catch((e) => setError(errorText(e)))
    props.onChanged()
  }

  const act = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await action()
      setDialog(null)
      reloadAll()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  if (error && !customer) return <Banner tone="danger">{error}</Banner>
  if (!customer) return <Card><Empty>carregando…</Empty></Card>

  const open = charges.filter((p) => p.status === 'PENDING' || p.status === 'OVERDUE')
  const received = charges.filter((p) => ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'].includes(p.status))

  return (
    <div class="stack">
      <div class="row">
        <Button size="sm" variant="ghost" onClick={() => props.navigate('customers')}>
          ← Meus Clientes
        </Button>
      </div>
      {error && <Banner tone="danger">{error}</Banner>}

      <Card
        title={
          <span class="row">
            {customer.name} {customer.deleted && <Badge tone="danger">removido</Badge>}
          </span>
        }
        subtitle={<span class="mono">{customer.id}</span>}
        actions={
          <>
            {!customer.deleted && (
              <Button variant="primary" onClick={() => setDialog({ kind: 'charge' })}>
                <Icon icon={I.ADD} size={16} />
                Nova cobrança
              </Button>
            )}
            {!customer.deleted && <Button onClick={() => setDialog({ kind: 'edit' })}>Editar</Button>}
            {customer.deleted ? (
              <Button disabled={busy} onClick={() => void act(() => v3(`/customers/${id}/restore`, key, { method: 'POST' }))}>
                Restaurar
              </Button>
            ) : (
              <Button variant="danger" onClick={() => setDialog({ kind: 'remove' })}>
                Remover
              </Button>
            )}
          </>
        }
      >
        {dialog?.kind === 'remove' && (
          <div class="inline-form" style={{ marginBottom: 'var(--pad-md)' }}>
            <p>
              Remover o cliente? As cobranças dele continuam existindo; dá para restaurar depois.
            </p>
            <div class="row">
              <Button variant="danger" disabled={busy} onClick={() => void act(() => v3(`/customers/${id}`, key, { method: 'DELETE' }))}>
                Remover cliente
              </Button>
              <Button variant="ghost" onClick={() => setDialog(null)}>
                Voltar
              </Button>
            </div>
          </div>
        )}
        <div class="detail-grid">
          <div>
            <Row label="CPF/CNPJ">{formatDocument(customer.cpfCnpj)}</Row>
            <Row label="E-mail">{customer.email ?? '—'}</Row>
            <Row label="Celular">{customer.mobilePhone ?? '—'}</Row>
            <Row label="Telefone">{customer.phone ?? '—'}</Row>
          </div>
          <div>
            <Row label="Endereço">
              {[customer.address, customer.addressNumber, customer.province].filter(Boolean).join(', ') || '—'}
            </Row>
            <Row label="CEP">{customer.postalCode ?? '—'}</Row>
            <Row label="Referência externa">{customer.externalReference ?? '—'}</Row>
            <Row label="Criado em">{customer.dateCreated}</Row>
          </div>
        </div>
      </Card>

      <div class="summary-tiles">
        <div class="tile">
          <span class="hint">Em aberto</span>
          <b>{money(open.reduce((s, p) => s + p.value, 0))}</b>
          <span class="hint">{open.length} cobrança(s)</span>
        </div>
        <div class="tile">
          <span class="hint">Recebido</span>
          <b>{money(received.reduce((s, p) => s + p.value, 0))}</b>
          <span class="hint">{received.length} cobrança(s)</span>
        </div>
        <div class="tile">
          <span class="hint">Assinaturas ativas</span>
          <b>{subscriptions.filter((s) => s.status === 'ACTIVE').length}</b>
          <span class="hint">{installments.length} parcelamento(s)</span>
        </div>
      </div>

      <Card title="Cobranças" flush>
        <PaymentTable
          rows={charges}
          hideCustomer
          onOpen={(p) => setDialog({ kind: 'payment', id: p.id })}
          empty='nenhuma cobrança para este cliente — use "Nova cobrança"'
        />
      </Card>

      {subscriptions.length > 0 && (
        <Card title="Assinaturas" flush>
          <Table>
            <thead>
              <tr>
                <th>Situação</th>
                <th>Valor</th>
                <th>Periodicidade</th>
                <th>Forma</th>
                <th>Próximo vencimento</th>
                <th>Descrição</th>
              </tr>
            </thead>
            <tbody>
              {subscriptions.map((s) => (
                <tr key={s.id} class="dt-clickable" onClick={() => setDialog({ kind: 'plan', plan: { kind: 'subscription', id: s.id } })}>
                  <td>
                    <Badge tone={s.status === 'ACTIVE' ? 'success' : 'neutral'}>
                      {SUBSCRIPTION_STATUS_LABEL[s.status] ?? s.status}
                    </Badge>
                  </td>
                  <td>{money(s.value)}</td>
                  <td>{CYCLE_LABEL[s.cycle] ?? s.cycle}</td>
                  <td>{BILLING_LABEL[s.billingType] ?? s.billingType}</td>
                  <td>{s.nextDueDate}</td>
                  <td>{s.description ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      {installments.length > 0 && (
        <Card title="Parcelamentos" flush>
          <Table>
            <thead>
              <tr>
                <th>Valor total</th>
                <th>Parcelas</th>
                <th>Forma</th>
                <th>Descrição</th>
                <th>Criado em</th>
              </tr>
            </thead>
            <tbody>
              {installments.map((i) => (
                <tr key={i.id} class="dt-clickable" onClick={() => setDialog({ kind: 'plan', plan: { kind: 'installment', id: i.id } })}>
                  <td>{money(i.value)}</td>
                  <td>{i.installmentCount}x</td>
                  <td>{BILLING_LABEL[i.billingType] ?? i.billingType}</td>
                  <td>{i.description ?? '—'}</td>
                  <td>{i.dateCreated}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      {dialog?.kind === 'edit' && (
        <CustomerForm
          apiKey={key}
          customer={customer}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null)
            reloadAll()
          }}
        />
      )}
      {dialog?.kind === 'charge' && (
        <ChargeForm store={props.store} customerId={id} onClose={() => setDialog(null)} onCreated={reloadAll} />
      )}
      {dialog?.kind === 'payment' && (
        <PaymentDetail store={props.store} paymentId={dialog.id} onClose={() => setDialog(null)} onChanged={reloadAll} />
      )}
      {dialog?.kind === 'plan' && (
        <PlanDetail store={props.store} plan={dialog.plan} onClose={() => setDialog(null)} onChanged={reloadAll} />
      )}
    </div>
  )
}
