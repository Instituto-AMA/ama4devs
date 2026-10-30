/**
 * "Nova cobrança": the three kinds the Asaas form offers, through the real API with
 * the account's key.
 *
 *   Avulsa       POST /v3/payments        one charge
 *   Parcelada    POST /v3/installments    N charges created at once
 *   Assinatura   POST /v3/subscriptions   a charge per cycle, generated ahead
 *
 * The customer is picked from the account's customers or created right here. A card
 * charge needs no card: the payer types it on the invoice page, as in Asaas.
 */
import { useEffect, useState } from 'preact/hooks'
import { v3, type Customer, type Payment } from '../api.ts'
import type { Store } from '../store.ts'
import { CustomerForm } from './CustomerForm.tsx'
import { Picker } from './Picker.tsx'
import {
  addDays,
  BILLING_CHOICES,
  CYCLE_LABEL,
  formatDocument,
  parseMoney,
  randomChargeFields,
  randomCustomer,
  randomInt,
} from './forms.ts'
import { Banner, Button, Copy, errorText, Field, Modal, money, StatusBadge, Table } from './ui.tsx'

type Kind = 'payment' | 'installment' | 'subscription'

const KINDS: Array<{ id: Kind; label: string; hint: string }> = [
  { id: 'payment', label: 'Cobrança avulsa', hint: 'Uma cobrança única.' },
  { id: 'installment', label: 'Parcelada', hint: 'O valor dividido em parcelas, todas criadas agora.' },
  { id: 'subscription', label: 'Assinatura', hint: 'Uma cobrança a cada ciclo, até você encerrar.' },
]

interface Created {
  kind: Kind
  id: string
  /** Every charge it generated so far, by due date: one invoice link each. */
  payments: Payment[]
}

/** "2026-11-30" → "nov/2026". */
const monthOf = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }).replace('. de ', '/').replace(' de ', '/')

export function ChargeForm(props: {
  store: Store
  customerId?: string
  /** The dialog's title; the sidebar's "Simular Venda" opens this same form. */
  title?: string
  onClose: () => void
  /** A charge, plan or subscription was created: the caller reloads its lists. */
  onCreated: () => void
}) {
  const key = props.store.selected?.apiKey ?? ''
  const today = props.store.clock?.today ?? new Date().toISOString().slice(0, 10)

  const [customers, setCustomers] = useState<Customer[]>([])
  const [customer, setCustomer] = useState(props.customerId ?? '')
  const [newCustomer, setNewCustomer] = useState(false)

  const [kind, setKind] = useState<Kind>('payment')
  const [billingType, setBillingType] = useState<string>('UNDEFINED')
  const [value, setValue] = useState('100,00')
  const [dueDate, setDueDate] = useState(addDays(today, 3))
  const [description, setDescription] = useState('')
  const [externalReference, setExternalReference] = useState('')

  const [count, setCount] = useState(3)
  const [valueMode, setValueMode] = useState<'total' | 'each'>('total')

  const [cycle, setCycle] = useState('MONTHLY')
  const [endMode, setEndMode] = useState<'never' | 'date' | 'count'>('never')
  const [endDate, setEndDate] = useState(addDays(today, 365))
  const [maxPayments, setMaxPayments] = useState(12)

  const [extras, setExtras] = useState(false)
  const [interest, setInterest] = useState('')
  const [fine, setFine] = useState('')
  const [discount, setDiscount] = useState('')
  const [discountType, setDiscountType] = useState<'PERCENTAGE' | 'FIXED'>('PERCENTAGE')
  const [discountDays, setDiscountDays] = useState(0)

  // A split goes to the wallet of another account: the way to watch money leave this
  // account and land in the other one, both statements closing.
  const splitTargets = props.store.accounts.filter((a) => a.id !== props.store.selected?.id)
  const [splitTo, setSplitTo] = useState('')
  const [splitPct, setSplitPct] = useState('10')

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<Created | null>(null)

  useEffect(() => {
    if (!key) return
    void v3('/customers?limit=100', key).then((r) => setCustomers(r.data))
  }, [key])

  const amount = parseMoney(value)
  const perInstallment = valueMode === 'total' ? amount / Math.max(count, 1) : amount
  const totalInstallments = valueMode === 'total' ? amount : amount * count

  const extrasBody = () => {
    const out: Record<string, unknown> = {}
    if (parseMoney(interest) > 0) out.interest = { value: parseMoney(interest) }
    if (parseMoney(fine) > 0) out.fine = { value: parseMoney(fine) }
    if (parseMoney(discount) > 0) {
      out.discount = { value: parseMoney(discount), type: discountType, dueDateLimitDays: discountDays }
    }
    const target = splitTargets.find((a) => a.id === splitTo)
    if (target && parseMoney(splitPct) > 0) {
      out.split = [{ walletId: target.walletId, percentualValue: parseMoney(splitPct) }]
    }
    return out
  }

  /** A customer with a valid random CPF, created and chosen in one click. */
  const createTestCustomer = async (): Promise<Customer> => {
    const c: Customer = await v3('/customers', key, {
      method: 'POST',
      body: JSON.stringify(randomCustomer()),
    })
    setCustomers((list) => [c, ...list])
    setCustomer(c.id)
    return c
  }

  const testCustomer = async () => {
    setError(null)
    try {
      await createTestCustomer()
    } catch (err) {
      setError(errorText(err))
    }
  }

  /** Fills every field of the form; creates a test customer when none is chosen. */
  const generateCharge = async () => {
    setError(null)
    try {
      if (!customer) await createTestCustomer()
      const f = randomChargeFields()
      setBillingType(BILLING_CHOICES[randomInt(0, BILLING_CHOICES.length - 1)]!.id)
      setValue(f.value)
      setDueDate(addDays(today, f.dueInDays))
      setDescription(f.description)
      setExternalReference(f.externalReference)
      if (kind === 'installment') setCount(randomInt(2, 6))
      if (kind === 'subscription') {
        setCycle(Object.keys(CYCLE_LABEL)[randomInt(0, Object.keys(CYCLE_LABEL).length - 1)]!)
        setEndMode('count')
        setMaxPayments(randomInt(3, 12))
      }
    } catch (err) {
      setError(errorText(err))
    }
  }

  const byDueDate = (list: Payment[]) => [...list].sort((a, b) => a.dueDate.localeCompare(b.dueDate))

  const submit = async (e: Event) => {
    e.preventDefault()
    if (!customer) {
      setError('Escolha ou cadastre o cliente.')
      return
    }
    if (amount <= 0) {
      setError('Informe um valor maior que zero.')
      return
    }
    setBusy(true)
    setError(null)
    const common = {
      customer,
      billingType,
      description: description.trim() || undefined,
      externalReference: externalReference.trim() || undefined,
      ...extrasBody(),
    }
    const post = (path: string, body: unknown) =>
      v3(path, key, { method: 'POST', body: JSON.stringify(body) })
    try {
      if (kind === 'payment') {
        const p = await post('/payments', { ...common, value: amount, dueDate })
        setCreated({ kind, id: p.id, payments: [p] })
      } else if (kind === 'installment') {
        const inst = await post('/installments', {
          ...common,
          installmentCount: count,
          // `/v3/installments` names the per-installment amount `value` (`installmentValue` is `/v3/payments`').
          ...(valueMode === 'total' ? { totalValue: amount } : { value: amount }),
          dueDate,
        })
        const list = await v3(`/installments/${inst.id}/payments?limit=100`, key)
        setCreated({ kind, id: inst.id, payments: byDueDate(list.data) })
      } else {
        const sub = await post('/subscriptions', {
          ...common,
          value: amount,
          nextDueDate: dueDate,
          cycle,
          ...(endMode === 'date' ? { endDate } : {}),
          ...(endMode === 'count' ? { maxPayments } : {}),
        })
        const list = await v3(`/subscriptions/${sub.id}/payments?limit=100`, key)
        setCreated({ kind, id: sub.id, payments: byDueDate(list.data) })
      }
      props.onCreated()
      await props.store.reload()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  if (newCustomer) {
    return (
      <CustomerForm
        apiKey={key}
        onClose={() => setNewCustomer(false)}
        onSaved={(c) => {
          setCustomers([c, ...customers])
          setCustomer(c.id)
          setNewCustomer(false)
        }}
      />
    )
  }

  if (created) {
    const n = created.payments.length
    const what =
      created.kind === 'payment'
        ? 'Cobrança criada'
        : created.kind === 'installment'
          ? `Parcelamento criado: ${n} faturas`
          : `Assinatura criada: ${n} ${n === 1 ? 'fatura gerada' : 'faturas geradas'} até agora`
    return (
      <Modal title={what} onClose={props.onClose} wide>
        <p class="hint">
          {created.kind === 'payment' ? 'Cobrança' : created.kind === 'installment' ? 'Parcelamento' : 'Assinatura'}{' '}
          <span class="mono">{created.id}</span>. Cada fatura abre a página de pagamento do pagador: cartão, Pix
          ou boleto, simulados, pelo mesmo caminho de um pagamento real.
          {created.kind === 'subscription' &&
            ' As próximas faturas são geradas conforme o relógio avança (Relógio virtual).'}
        </p>
        <div class="card flush-card">
          <Table>
            <thead>
              <tr>
                <th>Mês</th>
                <th class="right">Valor</th>
                <th>Situação</th>
                <th>Fatura</th>
              </tr>
            </thead>
            <tbody>
              {created.payments.map((p) => (
                <tr key={p.id}>
                  <td>
                    <b>{monthOf(p.dueDate)}</b>
                    {p.installmentNumber ? <span class="hint"> · {p.installmentNumber}/{n}</span> : null}
                    <div class="hint">vence {p.dueDate}</div>
                  </td>
                  <td class="right">{money(p.value)}</td>
                  <td>
                    <StatusBadge status={p.status} />
                  </td>
                  <td>
                    <div class="row invoice-cell">
                      <a class="btn primary sm" href={p.invoiceUrl} target="_blank" rel="noreferrer">
                        Abrir fatura
                      </a>
                      <Copy value={p.invoiceUrl}>{`/i/${p.id.replace('pay_', '')}`}</Copy>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
        <div class="modal-actions">
          <Button variant="ghost" onClick={() => setCreated(null)}>
            Criar outra
          </Button>
          <Button variant="primary" onClick={props.onClose}>
            Concluir
          </Button>
        </div>
      </Modal>
    )
  }


  return (
    <Modal title={props.title ?? 'Nova cobrança'} onClose={props.onClose} wide>
      <form class="stack" onSubmit={submit}>
        {error && <Banner tone="danger">{error}</Banner>}

        <div class="tabs" role="tablist">
          {KINDS.map((k) => (
            <button
              key={k.id}
              type="button"
              role="tab"
              class={`tab ${kind === k.id ? 'active' : ''}`}
              aria-selected={kind === k.id}
              onClick={() => setKind(k.id)}
            >
              {k.label}
            </button>
          ))}
        </div>
        <p class="hint">{KINDS.find((k) => k.id === kind)!.hint}</p>
        <div class="row">
          <Button
            type="button"
            size="sm"
            variant="primary"
            title="Preenche todos os campos e cria um cliente de teste se nenhum estiver escolhido"
            onClick={() => void generateCharge()}
          >
            Gerar cobrança automaticamente
          </Button>
          <span class="hint">Cliente, forma de pagamento, valor, vencimento e descrição.</span>
        </div>

        <Field label="Cliente *">
          <div class="row">
            <Picker
              value={customer}
              onChange={setCustomer}
              searchable
              ariaLabel="Cliente"
              placeholder={customers.length ? 'Selecione o cliente…' : 'Nenhum cliente ainda'}
              options={customers.map((c) => ({
                value: c.id,
                label: c.name,
                hint: [formatDocument(c.cpfCnpj), c.email].filter(Boolean).join(' · '),
              }))}
              empty='Nenhum cliente nesta conta — use "Novo cliente" ou "Cliente de teste".'
            />
            <Button type="button" size="sm" onClick={() => setNewCustomer(true)}>
              Novo cliente
            </Button>
            <Button type="button" size="sm" title="Cria um cliente com CPF válido e já seleciona" onClick={() => void testCustomer()}>
              Cliente de teste
            </Button>
          </div>
        </Field>

        <Field label="Forma de pagamento" hint={billingType === 'CREDIT_CARD' ? 'O pagador informa o cartão na fatura.' : billingType === 'UNDEFINED' ? 'O pagador escolhe na fatura: Pix, boleto ou cartão.' : undefined}>
          <div class="row">
            {BILLING_CHOICES.map((b) => (
              <button
                key={b.id}
                type="button"
                class={`chip ${billingType === b.id ? 'on' : ''}`}
                aria-pressed={billingType === b.id}
                onClick={() => setBillingType(b.id)}
              >
                {b.label}
              </button>
            ))}
          </div>
        </Field>

        <div class="form-grid">
          {kind === 'installment' ? (
            <>
              <Field label="Número de parcelas">
                <input
                  class="input"
                  type="number"
                  min={2}
                  max={billingType === 'CREDIT_CARD' ? 21 : 60}
                  value={count}
                  onInput={(e) => setCount(Number((e.target as HTMLInputElement).value) || 2)}
                />
              </Field>
              <Field
                label={valueMode === 'total' ? 'Valor total (R$)' : 'Valor de cada parcela (R$)'}
                hint={
                  valueMode === 'total'
                    ? `${count}x de ${money(perInstallment)}`
                    : `Total ${money(totalInstallments)}`
                }
              >
                <div class="row">
                  <input class="input" value={value} onInput={(e) => setValue((e.target as HTMLInputElement).value)} inputMode="decimal" />
                  <Picker
                    compact
                    ariaLabel="O valor é"
                    value={valueMode}
                    onChange={(v) => setValueMode(v as 'total' | 'each')}
                    options={[
                      { value: 'total', label: 'total' },
                      { value: 'each', label: 'por parcela' },
                    ]}
                  />
                </div>
              </Field>
              <Field label="Vencimento da 1ª parcela">
                <input class="input" type="date" value={dueDate} onInput={(e) => setDueDate((e.target as HTMLInputElement).value)} />
              </Field>
            </>
          ) : (
            <>
              <Field label="Valor (R$)">
                <input class="input" value={value} onInput={(e) => setValue((e.target as HTMLInputElement).value)} inputMode="decimal" />
              </Field>
              <Field label={kind === 'subscription' ? 'Primeiro vencimento' : 'Vencimento'}>
                <input class="input" type="date" value={dueDate} onInput={(e) => setDueDate((e.target as HTMLInputElement).value)} />
              </Field>
            </>
          )}

          {kind === 'subscription' && (
            <>
              <Field label="Periodicidade">
                <Picker
                  ariaLabel="Periodicidade"
                  value={cycle}
                  onChange={setCycle}
                  options={Object.entries(CYCLE_LABEL).map(([value, label]) => ({ value, label }))}
                />
              </Field>
              <Field label="Termina">
                <div class="row">
                  <Picker
                    ariaLabel="Termina"
                    value={endMode}
                    onChange={(v) => setEndMode(v as 'never' | 'date' | 'count')}
                    options={[
                      { value: 'never', label: 'nunca' },
                      { value: 'date', label: 'em uma data' },
                      { value: 'count', label: 'após N cobranças' },
                    ]}
                  />
                  {endMode === 'date' && (
                    <input class="input" type="date" value={endDate} onInput={(e) => setEndDate((e.target as HTMLInputElement).value)} />
                  )}
                  {endMode === 'count' && (
                    <input class="input" type="number" min={1} value={maxPayments} onInput={(e) => setMaxPayments(Number((e.target as HTMLInputElement).value) || 1)} />
                  )}
                </div>
              </Field>
            </>
          )}

          <Field label="Descrição">
            <input class="input" value={description} onInput={(e) => setDescription((e.target as HTMLInputElement).value)} maxLength={500} />
          </Field>
          <Field label="Referência externa" hint="O id no seu sistema; volta em todo webhook.">
            <input class="input mono" value={externalReference} onInput={(e) => setExternalReference((e.target as HTMLInputElement).value)} />
          </Field>
        </div>

        {splitTargets.length > 0 && (
          <Field
            label="Split"
            hint="Parte de cada cobrança cai na carteira de outra conta — dá para ver o dinheiro sair desta e entrar na outra."
          >
            <div class="row">
              <Picker
                ariaLabel="Split para"
                value={splitTo}
                onChange={setSplitTo}
                options={[
                  { value: '', label: 'sem split' },
                  ...splitTargets.map((a) => ({
                    value: a.id,
                    label: a.name,
                    hint: a.parentAccountId ? 'subconta' : 'conta raiz',
                  })),
                ]}
              />
              {splitTo && (
                <>
                  <input
                    class="input pct-input"
                    value={splitPct}
                    onInput={(e) => setSplitPct((e.target as HTMLInputElement).value)}
                    inputMode="decimal"
                    aria-label="Percentual do split"
                  />
                  <span class="hint">%</span>
                </>
              )}
            </div>
          </Field>
        )}

        <button type="button" class="link-btn" onClick={() => setExtras(!extras)} aria-expanded={extras}>
          {extras ? '− ' : '+ '}Juros, multa e desconto
        </button>
        {extras && (
          <div class="form-grid">
            <Field label="Juros ao mês (%)" hint="Cobrados depois do vencimento.">
              <input class="input" value={interest} onInput={(e) => setInterest((e.target as HTMLInputElement).value)} inputMode="decimal" placeholder="0" />
            </Field>
            <Field label="Multa (%)" hint="Aplicada uma vez, no atraso.">
              <input class="input" value={fine} onInput={(e) => setFine((e.target as HTMLInputElement).value)} inputMode="decimal" placeholder="0" />
            </Field>
            <Field label="Desconto" hint="Para pagamento até N dias antes do vencimento.">
              <div class="row">
                <input class="input" value={discount} onInput={(e) => setDiscount((e.target as HTMLInputElement).value)} inputMode="decimal" placeholder="0" />
                <Picker
                  compact
                  ariaLabel="Tipo do desconto"
                  value={discountType}
                  onChange={(v) => setDiscountType(v as 'PERCENTAGE' | 'FIXED')}
                  options={[
                    { value: 'PERCENTAGE', label: '%' },
                    { value: 'FIXED', label: 'R$' },
                  ]}
                />
                <input class="input" type="number" min={0} value={discountDays} onInput={(e) => setDiscountDays(Number((e.target as HTMLInputElement).value) || 0)} title="dias antes do vencimento" />
              </div>
            </Field>
          </div>
        )}

        <div class="modal-actions">
          <Button type="button" variant="ghost" onClick={props.onClose}>
            Cancelar
          </Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy
              ? 'Criando…'
              : kind === 'payment'
                ? 'Criar cobrança'
                : kind === 'installment'
                  ? 'Criar parcelamento'
                  : 'Criar assinatura'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
