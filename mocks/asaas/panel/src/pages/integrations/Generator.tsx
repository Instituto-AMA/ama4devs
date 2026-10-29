/**
 * Integrações › Gerador: the fake data generator, as the simulator found it.
 *
 * The generator is a third service, next to Mailpit and the WhatsApp mock: it invents
 * people, companies and charges with valid CPF/CNPJ and pushes them into this account
 * through its own API key — the same path a real integration takes. This page shows
 * whether the service is there, opens its UI, and fills the account selected in the
 * topbar in one call.
 */
import { useEffect, useState } from 'preact/hooks'
import { admin } from '../../api.ts'
import type { PageProps } from '../../app.tsx'
import { Icon } from '../../components/Icon.tsx'
import { Picker } from '../../components/Picker.tsx'
import {
  Badge,
  Banner,
  BILLING_LABEL,
  Button,
  Card,
  dateTime,
  Empty,
  errorText,
  Field,
  money,
  plural,
  Row,
  StatusBadge,
  Table,
} from '../../components/ui.tsx'
import * as I from '../../icons.ts'
import './integrations.css'

type BillingType = 'PIX' | 'BOLETO' | 'CREDIT_CARD'

/** `GET /_admin/generator/status`. */
interface GeneratorStatus {
  on: boolean
  url: string | null
  uiUrl: string
  reachable: boolean
  version: string | null
  error: string | null
}

interface GeneratedCustomer {
  id: string
  name: string
  cpfCnpj: string
  personType: string
}

interface GeneratedPayment {
  id: string
  customer: string
  billingType: string
  value: number
  dueDate: string
  status: string
  invoiceUrl: string
}

/** `POST /_admin/generator/populate`. */
interface PopulateResult {
  seed: string
  panelUrl: string
  customers: GeneratedCustomer[]
  payments: GeneratedPayment[]
  errors: Array<{ step: string; status: number; message: string }>
}

const BILLING_TYPES: BillingType[] = ['PIX', 'BOLETO', 'CREDIT_CARD']

/** The share of the charges that come out paid (the sandbox confirmation). */
const PAY_SHARES = [
  { value: '0', label: '0%' },
  { value: '25', label: '25%' },
  { value: '50', label: '50%' },
  { value: '100', label: '100%' },
]

export function GeneratorPage(props: PageProps) {
  const account = props.store.selected
  const [status, setStatus] = useState<GeneratorStatus | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [people, setPeople] = useState(5)
  const [companies, setCompanies] = useState(2)
  const [charges, setCharges] = useState(2)
  const [types, setTypes] = useState<BillingType[]>([...BILLING_TYPES])
  const [share, setShare] = useState('50')
  const [seed, setSeed] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<PopulateResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void admin('/generator/status')
      .then((s) => setStatus(s as GeneratorStatus))
      .catch((e) => setStatusError(errorText(e)))
  }, [])

  // The result belongs to the account it filled: another account starts empty.
  useEffect(() => {
    setResult(null)
    setError(null)
  }, [account?.id])

  const toggleType = (t: BillingType) =>
    setTypes((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]))

  const populate = async () => {
    if (!account) return
    setBusy(true)
    setError(null)
    try {
      const r = (await admin('/generator/populate', {
        method: 'POST',
        body: JSON.stringify({
          accountId: account.id,
          people,
          companies,
          chargesPerCustomer: charges,
          billingTypes: types,
          confirm: Number(share) / 100,
          ...(seed.trim() ? { seed: seed.trim() } : {}),
        }),
      })) as PopulateResult
      setResult(r)
      await props.store.reload()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  if (!status) {
    return (
      <div class="stack">
        {statusError && <Banner tone="danger">{statusError}</Banner>}
        {!statusError && (
          <Card>
            <Empty>carregando…</Empty>
          </Card>
        )}
      </div>
    )
  }

  const customerName = (id: string) =>
    result?.customers.find((c) => c.id === id)?.name ?? id

  return (
    <div class="stack">
      <Card
        title="Gerador de dados"
        subtitle="Um terceiro serviço, ao lado do Mailpit e do mock de WhatsApp: ele inventa dados brasileiros válidos — CPF/CNPJ conferidos, endereços, telefones."
        actions={
          <Button
            variant="primary"
            onClick={() => window.open(status.uiUrl, '_blank', 'noopener')}
          >
            <Icon icon={I.GENERATOR} size={16} />
            Abrir o gerador
          </Button>
        }
      >
        <div class="row" style={{ marginBottom: 'var(--pad-sm)' }}>
          <Badge tone={status.reachable ? 'success' : 'danger'}>
            {status.reachable ? 'conectado' : 'fora do ar'}
          </Badge>
        </div>
        {/* Off, the message says where the simulator looked for it: a hint, not a failure. */}
        {status.error && <Banner tone={status.on ? 'danger' : 'warn'}>{status.error}</Banner>}
        <div class="detail-grid">
          <div>
            <Row label="Endereço">{status.url ?? '—'}</Row>
            <Row label="Versão">{status.version ?? '—'}</Row>
          </div>
          <div>
            <Row label="Interface">{status.uiUrl}</Row>
          </div>
        </div>
        <p class="hint" style={{ marginTop: 'var(--pad-sm)' }}>
          Ele cria pessoas e empresas falsas (CPF/CNPJ válidos) como clientes desta conta e
          cobra delas, tudo pela chave de API desta conta.
        </p>
      </Card>

      <Card
        title={account ? `Popular esta conta — ${account.name}` : 'Popular esta conta'}
        subtitle="Clientes e cobranças falsos, criados em uma chamada e lançados por dentro da API desta conta — o mesmo caminho que a sua aplicação usaria."
      >
        {!account && (
          <Banner tone="warn">
            Escolha uma conta na topbar para popular: o populate usa a chave de API dela.
          </Banner>
        )}

        <div class="form-grid">
          <Field label="Pessoas" hint="Clientes pessoa física, com CPF válido.">
            <input
              class="input"
              type="number"
              min={0}
              max={100}
              value={people}
              onInput={(e) => setPeople(Math.max(0, Number((e.target as HTMLInputElement).value) || 0))}
            />
          </Field>
          <Field label="Empresas" hint="Clientes pessoa jurídica, com CNPJ válido.">
            <input
              class="input"
              type="number"
              min={0}
              max={100}
              value={companies}
              onInput={(e) => setCompanies(Math.max(0, Number((e.target as HTMLInputElement).value) || 0))}
            />
          </Field>
          <Field label="Cobranças por cliente" hint="Quantas cobranças cada cliente recebe.">
            <input
              class="input"
              type="number"
              min={1}
              max={20}
              value={charges}
              onInput={(e) => setCharges(Math.max(1, Number((e.target as HTMLInputElement).value) || 1))}
            />
          </Field>

          {/* Not a `Field`: a <label> around several checkboxes would toggle the first one. */}
          <div class="field">
            <span class="field-label">Formas de pagamento</span>
            <div class="row">
              {BILLING_TYPES.map((t) => (
                <label key={t} class="check">
                  <input
                    type="checkbox"
                    checked={types.includes(t)}
                    onChange={() => toggleType(t)}
                  />
                  <span>{BILLING_LABEL[t]}</span>
                </label>
              ))}
            </div>
            <span class="hint">As formas que as cobranças criadas podem ter.</span>
          </div>

          <Field
            label="Pagar automaticamente"
            hint="A fatia das cobranças que nasce paga (confirmação no sandbox)."
          >
            <Picker
              ariaLabel="Pagar automaticamente"
              value={share}
              onChange={setShare}
              options={PAY_SHARES}
              compact
            />
          </Field>

          <Field label="Seed (opcional)" hint="A mesma seed gera sempre os mesmos dados.">
            <input
              class="input"
              value={seed}
              placeholder="deixe vazio para sortear"
              onInput={(e) => setSeed((e.target as HTMLInputElement).value)}
            />
          </Field>
        </div>

        <div class="row" style={{ marginTop: 'var(--pad-md)' }}>
          <Button
            variant="primary"
            disabled={busy || !account || !status.reachable || types.length === 0}
            onClick={() => void populate()}
          >
            {busy ? 'Populando…' : 'Popular'}
          </Button>
        </div>

        {error && <Banner tone="danger">{error}</Banner>}
        {result && (
          <Banner tone="primary">
            {plural(result.customers.length, 'cliente', 'clientes')} e{' '}
            {plural(result.payments.length, 'cobrança', 'cobranças')} criados · seed {result.seed}
          </Banner>
        )}
        {result && result.errors.length > 0 && (
          <Banner tone="danger">
            {result.errors.map((e, i) => (
              <div key={i}>
                {e.step} ({e.status}): {e.message}
              </div>
            ))}
          </Banner>
        )}
      </Card>

      {result && (
        <Card title="Cobranças criadas" subtitle={`Nesta conta, com a seed ${result.seed}.`} flush>
          {result.payments.length === 0 ? (
            <Empty>nenhuma cobrança criada</Empty>
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Forma</th>
                  <th>Valor</th>
                  <th>Vencimento</th>
                  <th>Situação</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {result.payments.map((p) => (
                  <tr key={p.id}>
                    <td>{customerName(p.customer)}</td>
                    <td>{BILLING_LABEL[p.billingType] ?? p.billingType}</td>
                    <td>{money(p.value)}</td>
                    <td>{dateTime(p.dueDate)}</td>
                    <td>
                      <StatusBadge status={p.status} />
                    </td>
                    <td>
                      <a href={p.invoiceUrl} target="_blank" rel="noreferrer">
                        fatura
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}
    </div>
  )
}
