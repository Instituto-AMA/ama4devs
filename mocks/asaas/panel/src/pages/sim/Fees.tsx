import { useEffect, useState } from 'preact/hooks'
import { admin } from '../../api.ts'
import { Banner, Button, Card, Field, errorText } from '../../components/ui.tsx'

type FeeValues = { [key: string]: number | FeeValues }
const LABELS: Record<string, string> = {
  boleto: 'Boleto', pix: 'Pix', creditCard: 'Cartão de crédito', debitCard: 'Cartão de débito',
  fixed: 'Por operação (R$)', oneInstallment: 'À vista (%)', upToSix: '2 a 6 parcelas (%)',
  upToTwelve: '7 a 12 parcelas (%)', upToTwentyOne: '13 a 21 parcelas (%)', pct: 'Percentual (%)',
  transfer: 'Transferências', ted: 'TED (R$)', monthlyWithoutFee: 'Transferências gratuitas por mês',
  creditBureauReport: 'Consulta de crédito', naturalPerson: 'Pessoa física (R$)', legalPerson: 'Pessoa jurídica (R$)',
  notification: 'Notificações', phoneCall: 'Ligação (R$)', whatsApp: 'WhatsApp (R$)', messaging: 'Mensagem (R$)',
  invoice: 'Nota fiscal', paymentDunning: 'Negativação', anticipation: 'Antecipação',
  creditCardDetached: 'Cartão à vista (% ao mês)', creditCardInstallment: 'Cartão parcelado (% ao mês)',
  bankSlip: 'Boleto (% ao mês)',
}

export function Fees() {
  const [fees, setFees] = useState<FeeValues | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const load = () => admin('/fees').then(setFees).catch((e) => setError(errorText(e)))
  useEffect(() => { void load() }, [])

  const fields = (values: FeeValues, path: string[] = []) => Object.entries(values).map(([key, value]) => {
    const next = [...path, key]
    if (typeof value === 'object') return <Card key={key} title={LABELS[key]}>{fields(value, next)}</Card>
    const count = key === 'monthlyWithoutFee'
    return <Field key={key} label={`${LABELS[key]}${path.length === 0 ? ' (R$)' : ''}`}>
      <input type="number" min="0" step={count ? '1' : '0.01'} required value={count ? value : value / 100}
        disabled={busy} onInput={(e) => {
          const draft = structuredClone(fees!)
          let target = draft
          for (const part of path) target = target[part] as FeeValues
          target[key] = Math.round(e.currentTarget.valueAsNumber * (count ? 1 : 100))
          setFees(draft)
          setSaved(false)
        }} />
    </Field>
  })

  return <div class="stack">
    <Banner>Taxas globais do mock: valem para todos os perfis e ficam salvas ao reiniciar.
      A aplicação consulta os valores em GET /v3/myAccount/fees. Alterações afetam os próximos cálculos.</Banner>
    {error && <Banner tone="danger">{error}</Banner>}
    {saved && <Banner tone="primary">Taxas salvas.</Banner>}
    {!fees ? <Button onClick={() => void load()}>Carregar taxas</Button> :
      <form class="stack" onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true); setError(''); setSaved(false)
        try {
          setFees(await admin('/fees', { method: 'PATCH', body: JSON.stringify(fees) }))
          setSaved(true)
        } catch (err) { setError(errorText(err)) }
        finally { setBusy(false) }
      }}>
        <Card title="Taxas por recebimento e serviço">{fields(fees)}</Card>
        <Button type="submit" variant="primary" disabled={busy}>{busy ? 'Salvando…' : 'Salvar taxas'}</Button>
      </form>}
  </div>
}
