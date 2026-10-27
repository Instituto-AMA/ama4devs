/**
 * Integrações › WhatsApp and E-mail: the payer channels as the simulator runs them.
 *
 * Both come up configured with the simulator (MAILPIT_URL, WHATSAPP_MOCK_URL, and the
 * sender number registered in the WhatsApp mock on boot). This page shows that it
 * works: whether the channel answers, what Asaas sent, what actually arrived at
 * Mailpit or the WhatsApp mock (read back from them), the WhatsApp statuses and
 * replies, a button to open Mailpit or the WhatsApp console, and "Enviar teste".
 */
import { useEffect, useState } from 'preact/hooks'
import { admin, type PayerNotification } from '../../api.ts'
import type { PageProps } from '../../app.tsx'
import { Icon } from '../../components/Icon.tsx'
import {
  Badge,
  Banner,
  Button,
  Card,
  dateTime,
  Empty,
  errorText,
  Field,
  Row,
  Table,
  type Tone,
} from '../../components/ui.tsx'
import * as I from '../../icons.ts'

type Channel = 'EMAIL' | 'WHATSAPP'

interface ChannelState {
  on: boolean
  reachable: boolean
  error: string | null
  uiUrl: string
}

interface Status {
  email: ChannelState & { from: string }
  whatsapp: ChannelState & { sender: string; registered: boolean; callbackUrl: string }
  replies: Array<{ kind: 'status' | 'message'; from: string; detail: string; at: string }>
}

interface Arrival {
  id: string
  to: string
  title: string
  text: string
  at: string
}

const SENT_TONE: Record<string, Tone> = { SENT: 'success', PENDING: 'warn', FAILED: 'danger' }
const SENT_LABEL: Record<string, string> = { SENT: 'enviada', PENDING: 'na fila', FAILED: 'falhou' }

export function ChannelPage(props: PageProps & { channel: Channel }) {
  const { channel } = props
  const email = channel === 'EMAIL'
  const [status, setStatus] = useState<Status | null>(null)
  const [sent, setSent] = useState<PayerNotification[]>([])
  const [arrived, setArrived] = useState<{ data: Arrival[]; error: string | null } | null>(null)
  const [to, setTo] = useState(email ? 'teste@localhost' : '5511999999999')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'primary' | 'danger'; text: string } | null>(null)
  const accountId = props.store.selected?.id

  const load = async () => {
    const [s, list, a] = await Promise.all([
      admin('/notify/status'),
      admin(`/notifications${accountId ? `?accountId=${encodeURIComponent(accountId)}` : ''}`),
      admin(`/notify/arrivals?channel=${channel}`),
    ])
    setStatus(s)
    setSent((list.data as PayerNotification[]).filter((n) => n.channel === channel))
    setArrived(a)
  }

  useEffect(() => {
    void load().catch((e) => setNotice({ tone: 'danger', text: errorText(e) }))
  }, [channel, accountId])

  const test = async () => {
    setBusy(true)
    setNotice(null)
    try {
      await admin('/notify/test', { method: 'POST', body: JSON.stringify({ channel, to }) })
      setNotice({
        tone: 'primary',
        text: email ? `E-mail de teste enviado para ${to}. Confira no Mailpit.` : `Template de teste enviado para ${to}. Confira no console do WhatsApp.`,
      })
      await load()
    } catch (e) {
      setNotice({ tone: 'danger', text: errorText(e) })
    } finally {
      setBusy(false)
    }
  }

  if (!status) return <Card><Empty>carregando…</Empty></Card>
  const s = email ? status.email : status.whatsapp
  const wa = status.whatsapp

  return (
    <div class="stack">
      <Card
        title={email ? 'E-mail ao pagador (Mailpit)' : 'WhatsApp ao pagador (WhatsApp mock)'}
        subtitle={
          email
            ? 'Cada evento de cobrança manda um e-mail ao pagador. Ele cai no Mailpit, onde você confere a saída.'
            : 'Cada evento de cobrança manda um template de WhatsApp ao pagador. Ele cai no console do WhatsApp mock.'
        }
        actions={
          <>
            <Button size="sm" onClick={() => void load()}>
              <Icon icon={I.REFRESH} size={14} />
              Atualizar
            </Button>
            <a class="btn primary sm" href={s.uiUrl} target="_blank" rel="noreferrer">
              {email ? 'Abrir Mailpit' : 'Abrir console do WhatsApp'}
            </a>
          </>
        }
      >
        <div class="row" style={{ marginBottom: 'var(--pad-sm)' }}>
          <Badge tone={s.on ? 'success' : 'neutral'}>{s.on ? 'ligado' : 'desligado'}</Badge>
          {s.on && <Badge tone={s.reachable ? 'success' : 'danger'}>{s.reachable ? 'respondendo' : 'fora do ar'}</Badge>}
          {!email && s.on && (
            <Badge tone={wa.registered ? 'success' : 'warn'}>
              {wa.registered ? 'número cadastrado no mock' : 'cadastro pendente'}
            </Badge>
          )}
        </div>
        {s.error && <Banner tone="danger">{s.error}</Banner>}
        <div class="detail-grid">
          <div>
            {email ? (
              <Row label="Remetente">{status.email.from}</Row>
            ) : (
              <>
                <Row label="Número remetente">{wa.sender}</Row>
                <Row label="Webhook de retorno">{wa.callbackUrl}</Row>
              </>
            )}
          </div>
          <div>
            <Row label={email ? 'Caixa de entrada' : 'Console'}>{s.uiUrl}</Row>
          </div>
        </div>
      </Card>

      <Card title="Enviar teste" subtitle="Manda agora o mesmo conteúdo de uma cobrança nova, com dados de exemplo.">
        {notice && <Banner tone={notice.tone}>{notice.text}</Banner>}
        <div class="row" style={{ alignItems: 'flex-end' }}>
          <Field label={email ? 'Para (e-mail)' : 'Para (celular com DDI)'}>
            <input class="input" value={to} onInput={(e) => setTo((e.target as HTMLInputElement).value)} />
          </Field>
          <Button variant="primary" disabled={busy || !s.on} onClick={() => void test()}>
            {busy ? 'Enviando…' : email ? 'Enviar e-mail de teste' : 'Enviar WhatsApp de teste'}
          </Button>
        </div>
      </Card>

      <Card
        title={email ? 'Chegou no Mailpit' : 'Chegou no WhatsApp mock'}
        subtitle={email ? 'Lido da API do Mailpit: os e-mails deste remetente.' : 'Lido do WhatsApp mock: o que o número remetente enviou.'}
        flush
      >
        {arrived?.error && <Banner tone="danger">{arrived.error}</Banner>}
        {!arrived || arrived.data.length === 0 ? (
          <Empty>nada chegou ainda</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Quando</th>
                <th>Para</th>
                <th>{email ? 'Assunto' : 'Template'}</th>
                <th>Conteúdo</th>
              </tr>
            </thead>
            <tbody>
              {arrived.data.map((a) => (
                <tr key={a.id}>
                  {/* Mailpit and the WhatsApp mock answer in UTC: shown in the browser's time zone. */}
                  <td>{a.at ? new Date(a.at).toLocaleString('pt-BR') : '—'}</td>
                  <td class="mono">{a.to}</td>
                  <td>{a.title}</td>
                  <td style={{ whiteSpace: 'normal' }}>{a.text}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card title="Enviados pelo Asaas" subtitle="As notificações desta conta neste canal, com o resultado de cada entrega." flush>
        {sent.length === 0 ? (
          <Empty>nenhuma notificação neste canal ainda</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <th>Quando</th>
                <th>Evento</th>
                <th>Para</th>
                <th>Situação</th>
                <th>Erro</th>
              </tr>
            </thead>
            <tbody>
              {sent.map((n) => (
                <tr key={n.id}>
                  <td>{dateTime(n.sentAt ?? n.dateCreated)}</td>
                  <td>
                    {n.event} {n.forced && <Badge tone="primary">forçada</Badge>}
                  </td>
                  <td class="mono">{n.recipient}</td>
                  <td>
                    <Badge tone={SENT_TONE[n.status] ?? 'neutral'}>{SENT_LABEL[n.status] ?? n.status}</Badge>
                  </td>
                  <td style={{ whiteSpace: 'normal' }}>{n.lastError ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {!email && (
        <Card title="Retornos do WhatsApp" subtitle="O que o WhatsApp mock devolveu ao webhook do número: entregas, leituras e respostas do pagador." flush>
          {status.replies.length === 0 ? (
            <Empty>nenhum retorno ainda</Empty>
          ) : (
            <Table>
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>Tipo</th>
                  <th>De</th>
                  <th>Detalhe</th>
                </tr>
              </thead>
              <tbody>
                {status.replies.map((r, i) => (
                  <tr key={i}>
                    <td>{dateTime(r.at)}</td>
                    <td>{r.kind === 'status' ? 'status' : 'resposta'}</td>
                    <td class="mono">{r.from}</td>
                    <td style={{ whiteSpace: 'normal' }}>{r.detail}</td>
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
