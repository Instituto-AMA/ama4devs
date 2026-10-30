/**
 * The primitives. Every screen is built with these — none invents its own
 * color, radius or padding.
 *
 * It is the same contract the rest of the project has with the domain: there is
 * one place where the rule lives. A screen that writes `background: #0038e5` on
 * its own is a screen that will diverge from the dark theme next week, and
 * nobody will notice until a screenshot becomes unreadable.
 */
import type { ComponentChildren, JSX } from 'preact'
import { useState } from 'preact/hooks'
import * as I from '../icons.ts'
import { Icon, type IconData } from './Icon.tsx'
import './ui.css'

// ── currency and formatting ──────────────────────────────────────────────────

/** Reais, always in the pt-BR locale. Never `toFixed(2)` with "R$" concatenated. */
export const money = (v: number | null | undefined) =>
  (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

/** "1 customer" / "3 customers" — the right plural is a detail the screen notices. */
export const plural = (n: number, um: string, muitos: string) =>
  `${n} ${n === 1 ? um : muitos}`

/** "2026-01-05 09:00:00" → "05/01/2026 09:00"; a date alone → "05/01/2026". */
export const dateTime = (v: string | null | undefined) => {
  if (!v) return '—'
  const [date = '', time] = v.split(' ')
  const [y, m, d] = date.split('-')
  return `${d}/${m}/${y}${time ? ` ${time.slice(0, 5)}` : ''}`
}

/** The message of a failed call, for an `alert` or a banner. */
export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

// ── Card ────────────────────────────────────────────────────────────────────

export function Card(props: {
  title?: ComponentChildren
  actions?: ComponentChildren
  subtitle?: ComponentChildren
  children: ComponentChildren
  /** No padding in the body — for cards that contain an end-to-end table. */
  flush?: boolean
  class?: string
}) {
  return (
    <section class={`card ${props.class ?? ''}`}>
      {(props.title || props.subtitle || props.actions) && (
        <header class="card-hdr">
          <div>
            {props.title && <h2>{props.title}</h2>}
            {props.subtitle && <p class="card-sub">{props.subtitle}</p>}
          </div>
          {props.actions && <div class="card-actions">{props.actions}</div>}
        </header>
      )}
      <div class={props.flush ? 'card-body flush' : 'card-body'}>{props.children}</div>
    </section>
  )
}

// ── Button ──────────────────────────────────────────────────────────────────

/**
 * `IntrinsicElements['button']`, not `HTMLAttributes<HTMLButtonElement>`: in Preact
 * it is there that the attributes of the element itself live (`disabled`, `type`,
 * `form`). The generic only brings the globals, and a `<Button disabled>` would
 * not compile.
 */
type ButtonProps = JSX.IntrinsicElements['button'] & {
  variant?: 'primary' | 'outline' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
}

export function Button({ variant = 'outline', size = 'md', ...rest }: ButtonProps) {
  return <button {...rest} class={`btn ${variant} ${size} ${rest.class ?? ''}`} />
}

// ── Badge ───────────────────────────────────────────────────────────────────

export type Tone = 'neutral' | 'primary' | 'success' | 'warn' | 'danger'

export function Badge(props: { tone?: Tone; solid?: boolean; children: ComponentChildren }) {
  const tone = props.tone ?? 'neutral'
  return <span class={`badge ${tone} ${props.solid ? 'solid' : ''}`}>{props.children}</span>
}

/**
 * The status of a charge always with the SAME color, on any screen.
 *
 * If the list painted OVERDUE in red and the card in orange, the developer
 * would lose time looking for a difference that does not exist.
 */
export const STATUS_TONE: Record<string, Tone> = {
  RECEIVED: 'success',
  RECEIVED_IN_CASH: 'success',
  DUNNING_RECEIVED: 'success',
  CONFIRMED: 'primary',
  AWAITING_CREDIT: 'primary',
  PENDING: 'warn',
  AUTHORIZED: 'warn',
  AWAITING_RISK_ANALYSIS: 'warn',
  OVERDUE: 'danger',
  DUNNING_REQUESTED: 'danger',
  REFUNDED: 'neutral',
  CHARGEBACK: 'danger',
  CHARGEBACK_REQUESTED: 'danger',
  CHARGEBACK_DISPUTE: 'danger',
  AWAITING_CHARGEBACK_REVERSAL: 'danger',
}

/** The words the Asaas dashboard uses for each status; an unknown one shows as it comes. */
export const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Aguardando pagamento',
  AUTHORIZED: 'Autorizada',
  AWAITING_RISK_ANALYSIS: 'Em análise de risco',
  CONFIRMED: 'Confirmada',
  AWAITING_CREDIT: 'Aguardando crédito',
  RECEIVED: 'Recebida',
  RECEIVED_IN_CASH: 'Recebida em dinheiro',
  OVERDUE: 'Vencida',
  DUNNING_REQUESTED: 'Em negativação',
  DUNNING_RECEIVED: 'Recuperada',
  REFUND_REQUESTED: 'Estorno solicitado',
  REFUND_IN_PROGRESS: 'Estorno em processamento',
  REFUNDED: 'Estornada',
  CHARGEBACK: 'Chargeback',
  CHARGEBACK_REQUESTED: 'Chargeback recebido',
  CHARGEBACK_DISPUTE: 'Em disputa de chargeback',
  AWAITING_CHARGEBACK_REVERSAL: 'Aguardando reversão do chargeback',
}

/** Billing types as the dashboard names them. */
export const BILLING_LABEL: Record<string, string> = {
  BOLETO: 'Boleto',
  PIX: 'Pix',
  CREDIT_CARD: 'Cartão de crédito',
  DEBIT_CARD: 'Cartão de débito',
  UNDEFINED: 'Pergunte ao cliente',
}

export const StatusBadge = ({ status }: { status: string }) => (
  <Badge tone={STATUS_TONE[status] ?? 'neutral'}>{STATUS_LABEL[status] ?? status}</Badge>
)

// ── Copy ────────────────────────────────────────────────────────────────────

/** A value that exists to be pasted into the user's code. */
export function Copy({ value, children }: { value: string; children?: ComponentChildren }) {
  const [copied, setCopied] = useState(false)

  return (
    <span class="copy">
      <span class="mono">{children ?? value}</span>
      <button
        class="copy-btn"
        onClick={() => {
          navigator.clipboard.writeText(value)
          setCopied(true)
          setTimeout(() => setCopied(false), 1200)
        }}
      >
        <Icon icon={I.COPY} size={12} />
        {copied ? 'copiado' : 'copiar'}
      </button>
    </span>
  )
}

// ── Banner ──────────────────────────────────────────────────────────────────

/** The icon follows the TONE by default: a warning alerts, information informs. */
const BANNER_ICON = { warn: I.ALERT, danger: I.ALERT, primary: I.INFO }

export function Banner(props: {
  tone?: 'warn' | 'danger' | 'primary'
  /** Overrides the icon of the tone — for when the cause is more specific than the severity. */
  icon?: IconData
  children: ComponentChildren
  action?: ComponentChildren
}) {
  const tone = props.tone ?? 'warn'
  return (
    <div class={`banner ${tone}`}>
      <Icon icon={props.icon ?? BANNER_ICON[tone]} size={18} class="banner-icon" />
      <div class="banner-text">{props.children}</div>
      {props.action}
    </div>
  )
}

// ── Table ───────────────────────────────────────────────────────────────────

/**
 * A wide table scrolls INSIDE the card. Without this, the whole page gains a
 * horizontal scrollbar and the layout breaks at the first column with a 32
 * character id.
 */
export const Table = ({ children }: { children: ComponentChildren }) => (
  <div class="scroll">
    <table>{children}</table>
  </div>
)

export const Empty = ({ children }: { children: ComponentChildren }) => (
  <div class="empty">{children}</div>
)

// ── Modal ───────────────────────────────────────────────────────────────────

/** A dialog over a scrim; a click outside or on the ✕ closes it. */
export function Modal(props: {
  title: ComponentChildren
  onClose: () => void
  children: ComponentChildren
  wide?: boolean
}) {
  return (
    <>
      <div class="modal-scrim" onClick={props.onClose} />
      <div class={`modal ${props.wide ? 'wide' : ''}`} role="dialog">
        <header>
          <h2>{props.title}</h2>
          <button class="modal-x" onClick={props.onClose} aria-label="Fechar">
            <Icon icon={I.CLOSE} size={18} />
          </button>
        </header>
        <div class="modal-body">{props.children}</div>
      </div>
    </>
  )
}

// ── Form ────────────────────────────────────────────────────────────────────

/** A labelled field: the label above, an optional hint below. */
export function Field(props: {
  label: ComponentChildren
  hint?: ComponentChildren
  children: ComponentChildren
}) {
  return (
    <label class="field">
      <span class="field-label">{props.label}</span>
      {props.children}
      {props.hint && <span class="hint">{props.hint}</span>}
    </label>
  )
}

/** An on/off switch with its label beside it. */
export function Toggle(props: {
  checked: boolean
  onChange: (checked: boolean) => void
  children: ComponentChildren
  hint?: ComponentChildren
  disabled?: boolean
}) {
  return (
    <label class={`toggle ${props.disabled ? 'disabled' : ''}`}>
      <input
        type="checkbox"
        checked={props.checked}
        disabled={props.disabled}
        onChange={(e) => props.onChange((e.target as HTMLInputElement).checked)}
      />
      <span class="toggle-track" aria-hidden="true" />
      <span class="toggle-text">
        <span>{props.children}</span>
        {props.hint && <span class="hint">{props.hint}</span>}
      </span>
    </label>
  )
}

// ── KeyValue ────────────────────────────────────────────────────────────────

export const Row = ({ label, children }: { label: string; children: ComponentChildren }) => (
  <div class="kv-row">
    <span class="kv-label">{label}</span>
    <span class="kv-value">{children}</span>
  </div>
)
