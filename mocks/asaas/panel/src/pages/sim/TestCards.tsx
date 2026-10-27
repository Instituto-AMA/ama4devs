/**
 * Os cartões de teste e o erro que cada um força.
 *
 * A tabela vem do SERVIDOR (`/_admin/test-cards`), que a lê do DOMÍNIO — a MESMA
 * constante que o motor consulta para decidir o desfecho. Se a tela tivesse a sua
 * própria cópia, ela poderia anunciar, com botão de copiar e tudo, um cartão que o
 * motor não honra.
 *
 * `real: false` marca as nossas extensões: números que o Asaas de verdade APROVARIA.
 * Sem essa marca, alguém escreve um teste contra um comportamento que só existe aqui
 * e descobre em produção.
 */
import { useEffect, useState } from 'preact/hooks'
import { admin, type AsaasError, type TestCardTable } from '../../api.ts'
import { Icon } from '../../components/Icon.tsx'
import { Picker } from '../../components/Picker.tsx'
import {
  Badge,
  Banner,
  Button,
  Card,
  Copy,
  Empty,
  errorText,
  Field,
  Table,
  Toggle,
  type Tone,
} from '../../components/ui.tsx'
import * as I from '../../icons.ts'
import './TestCards.css'

interface Trigger {
  label: string
  how: string
  error: AsaasError
}

const TONE: Record<string, Tone> = {
  APPROVE: 'success',
  DECLINE: 'danger',
  DECLINE_ON_CHARGE: 'warn',
  EXPIRED: 'danger',
  INVALID_NUMBER: 'danger',
}

const group = (n: string) => n.replace(/(\d{4})(?=\d)/g, '$1 ')

/**
 * The test cards with their controls: "accept any card" (an unlisted number approves
 * when on, is refused when off) and "Novo cartão" (a typed or generated number with
 * the outcome it forces). Added cards can be removed; the built-in ones cannot.
 * Everything goes to `/_admin/test-cards`, the table the engine reads.
 */
export function TestCardList({ compact = false }: { compact?: boolean }) {
  const [data, setData] = useState<TestCardTable | null>(null)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = async () => setData(await admin('/test-cards'))

  useEffect(() => {
    void load()
  }, [])

  const run = async (action: () => Promise<unknown>) => {
    setError(null)
    try {
      await action()
      await load()
    } catch (e) {
      setError(errorText(e))
    }
  }

  if (!data) return <Empty>carregando…</Empty>

  return (
    <div class="stack">
      <div class="test-card-controls">
        <Toggle
          checked={data.acceptAny}
          onChange={(acceptAny) =>
            void run(() => admin('/test-cards/policy', { method: 'PUT', body: JSON.stringify({ acceptAny }) }))
          }
          hint={
            data.acceptAny
              ? 'Qualquer número bem-formado aprova; os cartões abaixo forçam o resultado deles.'
              : 'Só os cartões abaixo são aceitos; qualquer outro número é recusado pelo emissor.'
          }
        >
          Aceitar qualquer cartão como válido
        </Toggle>
        <Button size="sm" variant={adding ? 'ghost' : 'primary'} onClick={() => setAdding(!adding)}>
          {adding ? 'Fechar' : (
            <>
              <Icon icon={I.ADD} size={14} />
              Novo cartão
            </>
          )}
        </Button>
      </div>

      {error && <Banner tone="danger">{error}</Banner>}
      {adding && (
        <NewCardForm
          data={data}
          onAdd={(body) =>
            run(async () => {
              await admin('/test-cards', { method: 'POST', body: JSON.stringify(body) })
              setAdding(false)
            })
          }
        />
      )}

      <div class="card-grid">
      {data.cards.map((c) => (
        <div class="test-card" key={c.number}>
          <div class="test-card-hdr">
            <Badge solid tone="neutral">
              {c.brand}
            </Badge>
            <span class="row" style={{ gap: 'var(--pad-xs)' }}>
              <Badge solid tone={TONE[c.outcome] ?? 'neutral'}>
                {c.label}
              </Badge>
              {c.custom && (
                <button
                  class="icon-btn danger"
                  title="Remover este cartão"
                  aria-label={`Remover o cartão ${c.number}`}
                  onClick={() => void run(() => admin(`/test-cards/${c.number}`, { method: 'DELETE' }))}
                >
                  <Icon icon={I.DELETE} size={15} />
                </button>
              )}
            </span>
          </div>

          <div class="test-card-fields">
            <span class="f-label">Número</span>
            <Copy value={c.number}>{group(c.number)}</Copy>

            <span class="f-label">Nome</span>
            <Copy value="TESTE SANDBOX" />

            <span class="f-label">Validade</span>
            <Copy value="12/2030" />

            <span class="f-label">CVV</span>
            <Copy value="123" />
          </div>

          {!compact && c.error && (
            <div class="test-card-err">
              <code>{c.error.code}</code> — {c.error.description}
            </div>
          )}

          {!c.real && (
            <div class="test-card-warn" title="No Asaas de verdade este número seria APROVADO.">
              {c.custom ? 'criado no painel · só existe no simulador' : 'só existe no simulador'}
            </div>
          )}
        </div>
      ))}
      </div>
    </div>
  )
}

/** "Novo cartão": the outcome it forces, a label, and a typed number or one generated for a brand. */
function NewCardForm(props: {
  data: TestCardTable
  onAdd: (body: { number?: string; brand?: string; outcome: string; label?: string }) => Promise<void>
}) {
  const [outcome, setOutcome] = useState('DECLINE')
  const [label, setLabel] = useState('')
  const [number, setNumber] = useState('')
  const [brand, setBrand] = useState(props.data.brands[0] ?? 'VISA')
  const [busy, setBusy] = useState(false)

  const submit = async (e: Event) => {
    e.preventDefault()
    setBusy(true)
    await props.onAdd({
      outcome,
      label: label.trim() || undefined,
      ...(number.trim() ? { number: number.trim() } : { brand }),
    })
    setBusy(false)
  }

  return (
    <form class="inline-form" onSubmit={submit}>
      <div class="form-grid">
        <Field label="Resultado">
          <Picker
            ariaLabel="Resultado do cartão"
            value={outcome}
            onChange={setOutcome}
            options={props.data.outcomes.map((o) => ({ value: o.outcome, label: o.label, hint: o.outcome }))}
          />
        </Field>
        <Field label="Motivo (rótulo)" hint="O que aparece no cartão. Vazio: o nome do resultado.">
          <input
            class="input"
            value={label}
            placeholder="ex.: Limite estourado"
            onInput={(e) => setLabel((e.target as HTMLInputElement).value)}
          />
        </Field>
        <Field label="Número" hint="Vazio: gera um número válido da bandeira escolhida.">
          <input
            class="input mono"
            value={number}
            inputMode="numeric"
            placeholder="gerar automaticamente"
            onInput={(e) => setNumber((e.target as HTMLInputElement).value)}
          />
        </Field>
        {!number.trim() && (
          <Field label="Bandeira">
            <Picker
              ariaLabel="Bandeira"
              value={brand}
              onChange={setBrand}
              options={props.data.brands.map((b) => ({ value: b, label: b }))}
            />
          </Field>
        )}
      </div>
      <div class="row">
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? 'Adicionando…' : number.trim() ? 'Adicionar cartão' : 'Gerar e adicionar'}
        </Button>
      </div>
    </form>
  )
}

export function TestCards() {
  const [triggers, setTriggers] = useState<Trigger[] | null>(null)

  useEffect(() => {
    void admin('/test-cards').then((r) => setTriggers(r.triggers))
  }, [])

  return (
    <div class="stack">
      <Banner tone="primary">
        Com <b>"Aceitar qualquer cartão"</b> ligado, qualquer número bem-formado aprova — o
        Asaas não valida Luhn, e nós também não. Os números abaixo forçam desfechos
        específicos; crie os seus com <b>Novo cartão</b> para tratar cada erro no seu código.
      </Banner>

      <Card title="Cartões de teste">
        <TestCardList />
      </Card>

      <Card
        title="Erros que não vêm do número"
        subtitle="Três dos erros do Asaas são propriedades de outros campos. Aqui vai como produzi-los."
        flush
      >
        {!triggers ? (
          <Empty>carregando…</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Erro</th>
                <th>Como disparar</th>
                <th>code</th>
                <th>Mensagem</th>
              </tr>
            </thead>
            <tbody>
              {triggers.map((t) => (
                <tr key={t.label}>
                  <td>{t.label}</td>
                  <td><code>{t.how}</code></td>
                  <td><code>{t.error.code}</code></td>
                  <td style={{ whiteSpace: 'normal' }}>{t.error.description}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  )
}
