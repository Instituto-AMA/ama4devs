/**
 * The navigation. Two sections, and the boundary between them is deliberate.
 *
 * On top, what the Asaas panel has. Below, under the "Simulador" brand, what
 * exists ONLY here: time travel, the webhook queue, the test cards. If the two
 * blocks got mixed up, someone would end up writing code counting on a button
 * that does not exist in production — and would find out late.
 *
 * The items without a screen show up DISABLED instead of disappearing. Seeing
 * "Antecipações" greyed out answers "this is not here yet"; seeing nothing
 * makes you look for it.
 */
import * as I from '../icons.ts'
import { Icon, type IconData } from './Icon.tsx'
import { MockLogo } from './MockLogo.tsx'
import './Sidebar.css'

export interface NavItem {
  id: string
  label: string
  icon: IconData
  /** No screen yet. It stays visible and greyed out — disappearing would be worse. */
  disabled?: boolean
}

/** The screens of Asaas. The order is the one of the real panel. */
export const ASAAS_NAV: NavItem[] = [
  { id: 'home', label: 'Início', icon: I.HOME },
  { id: 'customers', label: 'Meus Clientes', icon: I.CUSTOMER },
  { id: 'payments', label: 'Cobranças', icon: I.PAYMENT },
  { id: 'physical', label: 'Vendas físicas', icon: I.STORE, disabled: true },
  { id: 'pix', label: 'Pix', icon: I.PIX, disabled: true },
  { id: 'statement', label: 'Extrato da Conta', icon: I.STATEMENT },
  { id: 'invoices', label: 'Notas fiscais', icon: I.NFSE },
  { id: 'anticipations', label: 'Antecipações', icon: I.ANTICIPATION, disabled: true },
  { id: 'dunning', label: 'Negativação', icon: I.ALERT, disabled: true },
  { id: 'splits', label: 'Split de pagamentos', icon: I.SPLIT },
  { id: 'subaccounts', label: 'Subcontas', icon: I.SUBACCOUNT },
  /**
   * API keys and webhooks are configuration OF THE ACCOUNT, and they exist in
   * the real Asaas panel, under "Integrações" — that is why they live up here,
   * and not in the Simulador block. Each account has its own, and an event of
   * account X is only delivered to the webhooks of X.
   *
   * (The DIAGNOSIS of the queue — why it froze, how many deliveries are stuck
   * behind — that one is our introspection. The screen says so.)
   */
  { id: 'integrations', label: 'Integrações', icon: I.INTEGRATION },
]

/** What does NOT exist in Asaas. That is why it stays in a separate block. */
export const SIM_NAV: NavItem[] = [
  /** In Asaas you do not open a root account through the API; here, a profile is a tenant of the app. */
  { id: 'sim-profiles', label: 'Perfis', icon: I.PROFILE },
  { id: 'sim-clock', label: 'Relógio virtual', icon: I.CLOCK },
  { id: 'sim-cards', label: 'Cartões de teste', icon: I.CARD },
]

export function Sidebar(props: {
  page: string
  onNavigate: (id: string) => void
  onSimulateSale: () => void
  /** How many webhook queues are stuck — the red badge of the navigation. */
  webhookAlerts: number
}) {
  const item = (i: NavItem, badge?: number) => (
    <button
      key={i.id}
      class={`nav-item ${props.page.split('/')[0] === i.id ? 'active' : ''}`}
      disabled={i.disabled}
      title={i.disabled ? 'Ainda não implementado no simulador' : undefined}
      onClick={() => props.onNavigate(i.id)}
    >
      <Icon icon={i.icon} size={20} class="nav-icon" />
      <span class="nav-label">{i.label}</span>
      {badge ? <span class="nav-badge">{badge}</span> : null}
    </button>
  )

  return (
    <aside class="sidebar">
      <div class="sidebar-top">
        <MockLogo />
        <button class="btn primary md simulate" onClick={props.onSimulateSale}>
          Simular Venda
        </button>
      </div>

      <nav>{ASAAS_NAV.map((i) => item(i, i.id === 'integrations' ? props.webhookAlerts : 0))}</nav>

      <div class="sim-section">
        <div class="sim-label">
          Simulador
          <Icon
            icon={I.HELP}
            size={13}
            class="sim-hint"
            title="Nada aqui existe na API do Asaas. São controles do mock."
          />
        </div>
        <nav>{SIM_NAV.map((i) => item(i))}</nav>
      </div>
    </aside>
  )
}
