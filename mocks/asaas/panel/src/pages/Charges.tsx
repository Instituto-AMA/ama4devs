/**
 * "Cobranças": the charges, subscriptions and installment plans of the selected
 * account, read from the real `/v3` with its key, so the screen shows exactly what
 * the integration receives.
 *
 * The tab lives in the hash (`#payments/subscriptions`), like Integrações. "Nova
 * cobrança" creates any of the three; a click on a row opens it.
 */
import { useEffect, useState } from 'preact/hooks'
import { v3, type Installment, type Payment, type Subscription } from '../api.ts'
import type { PageProps } from '../app.tsx'
import { ChargeForm } from '../components/ChargeForm.tsx'
import { DataTable, type Column } from '../components/DataTable.tsx'
import { CYCLE_LABEL, SUBSCRIPTION_STATUS_LABEL } from '../components/forms.ts'
import { Icon, type IconData } from '../components/Icon.tsx'
import { PaymentDetail } from '../components/PaymentDetail.tsx'
import { PaymentTable } from '../components/PaymentTable.tsx'
import { PlanDetail, type Plan } from '../components/PlanDetail.tsx'
import { BILLING_LABEL, Badge, Button, Card, Empty, errorText, money } from '../components/ui.tsx'
import { useCustomers, type CustomerIndex } from '../components/useCustomers.ts'
import * as I from '../icons.ts'

interface Tab {
  id: string
  label: string
  icon: IconData
}

export const CHARGE_TABS: Tab[] = [
  { id: 'list', label: 'Cobranças', icon: I.PAYMENT },
  { id: 'subscriptions', label: 'Assinaturas', icon: I.REFRESH },
  { id: 'installments', label: 'Parcelamentos', icon: I.STATEMENT },
]

/** The tab a hash names, or the first one. */
export const chargeTab = (id: string | undefined): Tab =>
  CHARGE_TABS.find((t) => t.id === id) ?? CHARGE_TABS[0]!

export function Charges(props: PageProps & { tab: string | undefined }) {
  const tab = chargeTab(props.tab)
  const key = props.store.selected?.apiKey
  const customers = useCustomers(key, props.store.selected?.id)
  const [creating, setCreating] = useState(false)
  // Bumped after a create, so the open tab reloads its list.
  const [version, setVersion] = useState(0)

  return (
    <div class="stack">
      <div class="row page-actions">
        <div class="tabs grow" role="tablist">
          {CHARGE_TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              class={`tab ${t.id === tab.id ? 'active' : ''}`}
              aria-selected={t.id === tab.id}
              onClick={() => props.navigate(`payments/${t.id}`)}
            >
              <Icon icon={t.icon} size={18} />
              {t.label}
            </button>
          ))}
        </div>
        <Button variant="primary" disabled={!key} onClick={() => setCreating(true)}>
          <Icon icon={I.ADD} size={16} />
          Nova cobrança
        </Button>
      </div>

      {tab.id === 'list' && <PaymentsTab {...props} customers={customers} version={version} />}
      {tab.id === 'subscriptions' && <SubscriptionsTab {...props} customers={customers} version={version} />}
      {tab.id === 'installments' && <InstallmentsTab {...props} customers={customers} version={version} />}

      {creating && (
        <ChargeForm
          store={props.store}
          onClose={() => {
            setCreating(false)
            void customers.reload()
          }}
          onCreated={() => setVersion((v) => v + 1)}
        />
      )}
    </div>
  )
}

type TabProps = PageProps & { customers: CustomerIndex; version: number }

/** Loads a `/v3` list for the selected account; `reload` after a change. */
function useList<T>(path: string, key: string | null | undefined, version: number) {
  const [rows, setRows] = useState<T[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const reload = async () => {
    if (!key) return
    try {
      const r = await v3(path, key)
      setRows(r.data)
      setError(null)
    } catch (e) {
      setError(errorText(e))
    }
  }
  useEffect(() => {
    setRows(null)
    void reload()
  }, [path, key, version])
  return { rows, error, reload }
}

function customerName(index: CustomerIndex, id: string) {
  const c = index.byId.get(id)
  if (!c) return <span class="mono hint">{id}</span>
  return (
    <span>
      {c.name} {c.deleted && <Badge tone="neutral">removido</Badge>}
    </span>
  )
}

function PaymentsTab(props: TabProps) {
  const list = useList<Payment>('/payments?limit=100&order=desc', props.store.selected?.apiKey, props.version)
  const [open, setOpen] = useState<string | null>(null)

  if (list.error) return <Card><Empty>{list.error}</Empty></Card>
  if (!list.rows) return <Card><Empty>carregando…</Empty></Card>

  return (
    <>
      <Card flush>
        <PaymentTable
          rows={list.rows}
          customers={props.customers.byId}
          onOpen={(p) => setOpen(p.id)}
          empty='nenhuma cobrança nesta conta — use "Nova cobrança"'
        />
      </Card>
      {open && (
        <PaymentDetail
          store={props.store}
          paymentId={open}
          onClose={() => setOpen(null)}
          onChanged={() => void list.reload()}
        />
      )}
    </>
  )
}

function SubscriptionsTab(props: TabProps) {
  const list = useList<Subscription>('/subscriptions?limit=100', props.store.selected?.apiKey, props.version)
  const [open, setOpen] = useState<Plan | null>(null)

  if (list.error) return <Card><Empty>{list.error}</Empty></Card>
  if (!list.rows) return <Card><Empty>carregando…</Empty></Card>

  const columns: Column<Subscription>[] = [
    { key: 'id', header: 'ID', render: (s) => <span class="mono">{s.id}</span>, value: (s) => s.id },
    {
      key: 'status',
      header: 'Situação',
      render: (s) => (
        <Badge tone={s.status === 'ACTIVE' ? 'success' : 'neutral'}>
          {SUBSCRIPTION_STATUS_LABEL[s.status] ?? s.status}
        </Badge>
      ),
      value: (s) => s.status,
    },
    {
      key: 'customer',
      header: 'Cliente',
      render: (s) => customerName(props.customers, s.customer),
      value: (s) => props.customers.byId.get(s.customer)?.name ?? s.customer,
    },
    { key: 'value', header: 'Valor', align: 'right', render: (s) => money(s.value), value: (s) => s.value },
    { key: 'cycle', header: 'Periodicidade', render: (s) => CYCLE_LABEL[s.cycle] ?? s.cycle, value: (s) => s.cycle },
    { key: 'billingType', header: 'Forma', render: (s) => BILLING_LABEL[s.billingType] ?? s.billingType, value: (s) => s.billingType },
    { key: 'nextDueDate', header: 'Próximo vencimento', render: (s) => s.nextDueDate, value: (s) => s.nextDueDate },
    { key: 'description', header: 'Descrição', render: (s) => s.description ?? '—', value: (s) => s.description },
  ]

  return (
    <>
      <Card flush>
        <DataTable
          rows={list.rows}
          columns={columns}
          initialSort={{ key: 'nextDueDate', dir: 'asc' }}
          searchPlaceholder="Buscar por id, cliente, descrição…"
          empty='nenhuma assinatura nesta conta — use "Nova cobrança" › Assinatura'
          onRowClick={(s) => setOpen({ kind: 'subscription', id: s.id })}
        />
      </Card>
      {open && (
        <PlanDetail store={props.store} plan={open} onClose={() => setOpen(null)} onChanged={() => void list.reload()} />
      )}
    </>
  )
}

function InstallmentsTab(props: TabProps) {
  const list = useList<Installment>('/installments?limit=100', props.store.selected?.apiKey, props.version)
  const [open, setOpen] = useState<Plan | null>(null)

  if (list.error) return <Card><Empty>{list.error}</Empty></Card>
  if (!list.rows) return <Card><Empty>carregando…</Empty></Card>

  const columns: Column<Installment>[] = [
    { key: 'id', header: 'ID', render: (i) => <span class="mono">{i.id}</span>, value: (i) => i.id },
    {
      key: 'customer',
      header: 'Cliente',
      render: (i) => customerName(props.customers, i.customer),
      value: (i) => props.customers.byId.get(i.customer)?.name ?? i.customer,
    },
    { key: 'value', header: 'Valor total', align: 'right', render: (i) => money(i.value), value: (i) => i.value },
    { key: 'count', header: 'Parcelas', render: (i) => `${i.installmentCount}x`, value: (i) => i.installmentCount },
    { key: 'billingType', header: 'Forma', render: (i) => BILLING_LABEL[i.billingType] ?? i.billingType, value: (i) => i.billingType },
    { key: 'description', header: 'Descrição', render: (i) => i.description ?? '—', value: (i) => i.description },
    { key: 'dateCreated', header: 'Criado em', render: (i) => i.dateCreated, value: (i) => i.dateCreated },
  ]

  return (
    <>
      <Card flush>
        <DataTable
          rows={list.rows}
          columns={columns}
          initialSort={{ key: 'dateCreated', dir: 'desc' }}
          searchPlaceholder="Buscar por id, cliente, descrição…"
          empty='nenhum parcelamento nesta conta — use "Nova cobrança" › Parcelada'
          onRowClick={(i) => setOpen({ kind: 'installment', id: i.id })}
        />
      </Card>
      {open && (
        <PlanDetail store={props.store} plan={open} onClose={() => setOpen(null)} onChanged={() => void list.reload()} />
      )}
    </>
  )
}
