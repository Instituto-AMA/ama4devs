/**
 * Os primitivos. Toda tela é montada com estes — nenhuma inventa cor, raio ou
 * padding próprio.
 *
 * É o mesmo contrato que o resto do projeto tem com o domínio: existe um lugar só
 * onde a regra mora. Uma tela que escreve `background: #0038e5` na unha é uma tela
 * que vai divergir do tema escuro na semana que vem, e ninguém vai notar até um
 * screenshot ficar ilegível.
 */
import type { ComponentChildren, JSX } from 'preact'
import { useState } from 'preact/hooks'
import * as I from '../icons.ts'
import { Icon, type IconData } from './Icon.tsx'
import './ui.css'

// ── moeda e formatação ──────────────────────────────────────────────────────

/** Reais, sempre no locale pt-BR. Nunca `toFixed(2)` com "R$" concatenado. */
export const money = (v: number | null | undefined) =>
  (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

/** "1 cliente" / "3 clientes" — o plural certo é detalhe que a tela nota. */
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
  /** Sem padding no corpo — para cards que contêm uma tabela de ponta a ponta. */
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
 * `IntrinsicElements['button']`, não `HTMLAttributes<HTMLButtonElement>`: no Preact é
 * ali que vivem os atributos próprios do elemento (`disabled`, `type`, `form`). O
 * genérico só traz os globais, e um `<Button disabled>` não compilaria.
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
 * O status de uma cobrança sempre com a MESMA cor, em qualquer tela.
 *
 * Se a lista pintasse OVERDUE de vermelho e o card de laranja, o dev perderia
 * tempo procurando a diferença que não existe.
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

/** Um valor que existe para ser colado no código do usuário. */
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

/** O ícone segue o TOM por padrão: aviso alerta, informação informa. */
const BANNER_ICON = { warn: I.ALERT, danger: I.ALERT, primary: I.INFO }

export function Banner(props: {
  tone?: 'warn' | 'danger' | 'primary'
  /** Sobrescreve o ícone do tom — para quando a causa é mais específica que a gravidade. */
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
 * Tabela larga rola DENTRO do card. Sem isto, a página inteira ganha barra
 * horizontal e o layout quebra na primeira coluna com um id de 32 caracteres.
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
}) {
  return (
    <label class="toggle">
      <input
        type="checkbox"
        checked={props.checked}
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
