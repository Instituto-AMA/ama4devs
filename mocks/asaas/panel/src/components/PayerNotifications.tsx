/**
 * What the payer was told about a charge: the e-mails (delivered to Mailpit), the
 * WhatsApp templates (delivered to the WhatsApp mock) and the SMS (delivered to the SMS
 * mock), and "Enviar agora" to force one.
 *
 * Simulator-only (`/_admin/notifications`): Asaas sends these by itself and shows no
 * such list. A channel whose service is not found (or turned off by an empty
 * MAILPIT_URL, WHATSAPP_MOCK_URL or SMS_MOCK_URL) is shown off and cannot be forced.
 */
import { useEffect, useState } from 'preact/hooks'
import { admin, type NotificationList } from '../api.ts'
import { Picker } from './Picker.tsx'
import { Badge, Banner, Button, dateTime, errorText, type Tone } from './ui.tsx'

const STATUS: Record<string, { label: string; tone: Tone }> = {
  SENT: { label: 'enviada', tone: 'success' },
  PENDING: { label: 'na fila', tone: 'warn' },
  FAILED: { label: 'falhou', tone: 'danger' },
}

export function PayerNotifications(props: { paymentId: string; refreshKey?: unknown }) {
  const [list, setList] = useState<NotificationList | null>(null)
  const [event, setEvent] = useState('PAYMENT_CREATED')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = async () => setList(await admin(`/notifications?paymentId=${encodeURIComponent(props.paymentId)}`))

  useEffect(() => {
    void load().catch((e) => setError(errorText(e)))
  }, [props.paymentId, props.refreshKey])

  const force = async (channel: 'EMAIL' | 'WHATSAPP' | 'SMS') => {
    setBusy(true)
    setError(null)
    try {
      await admin('/notifications', {
        method: 'POST',
        body: JSON.stringify({ paymentId: props.paymentId, event, channels: [channel] }),
      })
      // The route delivers before it answers: the list already shows the outcome.
      await load()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  if (!list) return null
  const { email, whatsapp, sms } = list.channels

  return (
    <div class="notify">
      <div class="row notify-hdr">
        <h3 class="section-title">Notificações ao pagador</h3>
        <Badge tone={email ? 'success' : 'neutral'}>e-mail {email ? '→ Mailpit' : 'desligado'}</Badge>
        <Badge tone={whatsapp ? 'success' : 'neutral'}>WhatsApp {whatsapp ? '→ mock' : 'desligado'}</Badge>
        <Badge tone={sms ? 'success' : 'neutral'}>SMS {sms ? '→ mock' : 'desligado'}</Badge>
      </div>
      {!email && !whatsapp && !sms && (
        <p class="hint">
          Suba o Mailpit, o WhatsApp mock e o mock de SMS ao lado: o simulador acha os três sozinho, em até
          10 s, e o pagador passa a receber e-mail, WhatsApp e SMS a cada evento da cobrança.
        </p>
      )}
      {error && <Banner tone="danger">{error}</Banner>}

      {(email || whatsapp || sms) && (
        <div class="row">
          <Picker
            ariaLabel="Notificação"
            value={event}
            onChange={setEvent}
            options={list.events.map((e) => ({ value: e.event, label: e.label }))}
          />
          <Button size="sm" disabled={busy || !email} onClick={() => void force('EMAIL')}>
            Enviar e-mail agora
          </Button>
          <Button size="sm" disabled={busy || !whatsapp} onClick={() => void force('WHATSAPP')}>
            Enviar WhatsApp agora
          </Button>
          <Button size="sm" disabled={busy || !sms} onClick={() => void force('SMS')}>
            Enviar SMS agora
          </Button>
        </div>
      )}

      {list.data.length === 0 ? (
        <p class="hint">Nenhuma notificação para esta cobrança ainda.</p>
      ) : (
        <ul class="notify-list">
          {list.data.map((n) => {
            const s = STATUS[n.status] ?? { label: n.status, tone: 'neutral' as Tone }
            const label = list.events.find((e) => e.event === n.event)?.label ?? n.event
            return (
              <li key={n.id} class="notify-item">
                <div class="row">
                  <Badge tone="neutral">{n.channel === 'EMAIL' ? 'e-mail' : n.channel === 'SMS' ? 'SMS' : 'WhatsApp'}</Badge>
                  <b>{label}</b>
                  <Badge tone={s.tone}>{s.label}</Badge>
                  {n.forced && <Badge tone="primary">forçada</Badge>}
                  <span class="hint">
                    para <span class="mono">{n.recipient}</span> · {dateTime(n.sentAt ?? n.dateCreated)}
                  </span>
                </div>
                <div class="hint notify-body">
                  {n.channel === 'EMAIL' ? n.subject : n.channel === 'SMS' ? n.body : `template ${n.template?.name}: ${n.body}`}
                </div>
                {n.lastError && <div class="notify-error">{n.lastError}</div>}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
