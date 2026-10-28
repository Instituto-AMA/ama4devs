/**
 * The saved (tokenized) cards and how each answers its next charge, and the
 * schedule on which Asaas tries the card of a recurring charge.
 *
 * Both are the simulator's knobs over `/_admin/credit-cards` and
 * `/_admin/card-capture/schedule`: set a card to approve N more charges and then
 * decline, skip months on the clock, and watch the refused captures, the retries
 * and the OVERDUE charge reach your webhook.
 */
import { useEffect, useState } from 'preact/hooks'
import { admin } from '../../api.ts'
import { Badge, Banner, Button, Card, Copy, Empty, errorText, Field, Table } from '../../components/ui.tsx'

interface SavedCard {
  creditCardToken: string
  customerId: string | null
  customerName: string | null
  last4: string
  brand: string
  holderName: string
  outcome: 'APPROVE' | 'DECLINE'
  approvalsLeft: number | null
  approvesNext: boolean
}

interface Slot {
  dayOffset: number
  hour: number
  minute: number
}

const pad = (n: number) => String(n).padStart(2, '0')

function behavior(c: SavedCard): string {
  if (c.outcome === 'DECLINE') return 'Recusa toda cobrança'
  if (c.approvalsLeft === null) return 'Aprova sempre'
  if (c.approvalsLeft === 0) return 'Recusa (aprovações esgotadas)'
  return `Aprova mais ${c.approvalsLeft}, depois recusa`
}

export function SavedCards() {
  const [cards, setCards] = useState<SavedCard[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [counts, setCounts] = useState<Record<string, string>>({})

  const load = async () => setCards((await admin('/credit-cards')).data)
  useEffect(() => {
    void load()
  }, [])

  const set = async (token: string, body: Record<string, unknown>) => {
    setError(null)
    try {
      await admin(`/credit-cards/${token}`, { method: 'PUT', body: JSON.stringify(body) })
      await load()
    } catch (e) {
      setError(errorText(e))
    }
  }

  return (
    <Card
      title="Cartões salvos"
      subtitle="Cada token responde à próxima cobrança como você definir aqui. Use para simular o cartão que funcionou por meses e um dia recusa."
      flush
    >
      {error && <Banner tone="danger">{error}</Banner>}
      {!cards ? (
        <Empty>carregando…</Empty>
      ) : !cards.length ? (
        <Empty>Nenhum cartão salvo ainda. Tokenize um cartão ou crie uma assinatura no cartão.</Empty>
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Cartão</th>
              <th>Cliente</th>
              <th>Token</th>
              <th>Próxima cobrança</th>
              <th>Comportamento</th>
            </tr>
          </thead>
          <tbody>
            {cards.map((c) => (
              <tr key={c.creditCardToken}>
                <td>
                  {c.brand} •••• {c.last4}
                </td>
                <td>{c.customerName ?? '—'}</td>
                <td>
                  <Copy value={c.creditCardToken}>{c.creditCardToken.slice(0, 8)}…</Copy>
                </td>
                <td>
                  <Badge solid tone={c.approvesNext ? 'success' : 'danger'}>
                    {c.approvesNext ? 'Aprova' : 'Recusa'}
                  </Badge>
                </td>
                <td style={{ whiteSpace: 'normal' }}>
                  <div class="saved-card-actions">
                    <span class="muted">{behavior(c)}</span>
                    <Button size="sm" onClick={() => void set(c.creditCardToken, { outcome: 'APPROVE', approvalsLeft: null })}>
                      Aprovar sempre
                    </Button>
                    <Button size="sm" onClick={() => void set(c.creditCardToken, { outcome: 'DECLINE', approvalsLeft: null })}>
                      Recusar
                    </Button>
                    <span class="saved-card-after">
                      <input
                        class="input mono"
                        inputMode="numeric"
                        aria-label={`Aprovações antes de recusar, cartão final ${c.last4}`}
                        placeholder="3"
                        value={counts[c.creditCardToken] ?? ''}
                        onInput={(e) =>
                          setCounts({ ...counts, [c.creditCardToken]: (e.target as HTMLInputElement).value })
                        }
                      />
                      <Button
                        size="sm"
                        variant="primary"
                        disabled={!/^\d+$/.test(counts[c.creditCardToken] ?? '')}
                        onClick={() =>
                          void set(c.creditCardToken, {
                            outcome: 'APPROVE',
                            approvalsLeft: Number(counts[c.creditCardToken]),
                          })
                        }
                      >
                        Recusar depois de N
                      </Button>
                    </span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  )
}

export function CaptureSchedule() {
  const [attempts, setAttempts] = useState<Slot[] | null>(null)
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const apply = (r: { schedule: string; attempts: Slot[] }) => {
    setAttempts(r.attempts)
    setText(r.schedule)
  }
  useEffect(() => {
    void admin('/card-capture/schedule').then(apply)
  }, [])

  const save = async (schedule: string) => {
    setError(null)
    setSaved(false)
    try {
      apply(await admin('/card-capture/schedule', { method: 'PUT', body: JSON.stringify({ schedule }) }))
      setSaved(true)
    } catch (e) {
      setError(errorText(e))
    }
  }

  return (
    <Card
      title="Retentativa da cobrança recorrente no cartão"
      subtitle="No vencimento o Asaas cobra o cartão salvo da assinatura sozinho. Cada recusa vira PAYMENT_CREDIT_CARD_CAPTURE_REFUSED; esgotadas as tentativas, a cobrança vence e não é mais tentada."
    >
      <div class="stack">
        <Banner tone="primary">
          Padrão do Asaas: 3 tentativas no dia do vencimento (8h, 14h e 20h) e mais 3 no dia seguinte. O artigo do
          Asaas também menciona "mais 2, a cada 24h"; se a sua conta se comporta assim, troque aqui.
        </Banner>
        {error && <Banner tone="danger">{error}</Banner>}
        {!attempts ? (
          <Empty>carregando…</Empty>
        ) : (
          <ol class="capture-slots">
            {attempts.map((s, i) => (
              <li key={i}>
                <b>{i + 1}ª</b> {s.dayOffset === 0 ? 'no vencimento' : `D+${s.dayOffset}`} às {pad(s.hour)}:{pad(s.minute)}
              </li>
            ))}
          </ol>
        )}
        <form
          class="row"
          onSubmit={(e) => {
            e.preventDefault()
            void save(text)
          }}
        >
          <Field label="Cronograma" hint="dias@hora, separados por vírgula. Ex.: 0@08:00,0@14:00,1@08:00">
            <input class="input mono" value={text} onInput={(e) => setText((e.target as HTMLInputElement).value)} />
          </Field>
          <Button type="submit" variant="primary">
            Salvar
          </Button>
          <Button type="button" variant="ghost" onClick={() => void save('')}>
            Voltar ao padrão
          </Button>
          {saved && <span class="muted">Salvo.</span>}
        </form>
      </div>
    </Card>
  )
}
