/**
 * Balance on the left, account selector on the right — the header of the Asaas
 * panel.
 *
 * The selector is the most useful thing of this screen and has no equivalent in
 * the real Asaas: there, entering a subaccount requires its key, saved at the
 * creation and never shown again. Here you switch on the dropdown and start
 * seeing the simulator THROUGH THE EYES of that account — it is the only way to
 * see, in a split, the money leave one and enter the other, with both
 * statements closing.
 */
import { useState } from 'preact/hooks'
import type { Account } from '../api.ts'
import * as I from '../icons.ts'
import { Icon } from './Icon.tsx'
import { useTheme } from '../theme.ts'
import { money } from './ui.tsx'
import './Topbar.css'

export function Topbar(props: {
  accounts: Account[]
  selected: Account | null
  onSelect: (id: string) => void
  onRefresh: () => void
  refreshing: boolean
  /** Opens the profiles screen — where a profile is created or deleted. */
  onManageProfiles: () => void
}) {
  const [open, setOpen] = useState(false)
  const [theme, toggleTheme] = useTheme()
  const { selected } = props

  const initial = (selected?.name ?? '?').charAt(0).toUpperCase()
  const master = props.accounts.filter((a) => !a.parentAccountId)
  const subs = props.accounts.filter((a) => a.parentAccountId)

  const option = (a: Account) => (
    <button
      key={a.id}
      class={`acct-option ${a.id === selected?.id ? 'active' : ''}`}
      onClick={() => {
        props.onSelect(a.id)
        setOpen(false)
      }}
    >
      <span class="acct-avatar">{a.name.charAt(0).toUpperCase()}</span>
      <span class="acct-option-name">{a.name}</span>
      <span class={`acct-option-bal ${a.balance < 0 ? 'neg' : ''}`}>{money(a.balance)}</span>
    </button>
  )

  return (
    <header class="topbar">
      <div class="balance">
        <span class="balance-label">Saldo em conta</span>
        <span class={`balance-value ${(selected?.balance ?? 0) < 0 ? 'neg' : ''}`}>
          {money(selected?.balance)}
        </span>
      </div>

      <button class="refresh" onClick={props.onRefresh} disabled={props.refreshing}>
        <Icon icon={I.REFRESH} size={16} class={props.refreshing ? 'spin' : ''} />
        {props.refreshing ? 'Atualizando' : 'Atualizado'}
      </button>

      <button
        class="theme-toggle"
        onClick={toggleTheme}
        title={theme === 'dark' ? 'Usar o tema claro (o do Asaas)' : 'Usar o tema escuro'}
        aria-label="Alternar tema"
      >
        <Icon icon={theme === 'dark' ? I.SUN : I.MOON} size={16} />
      </button>

      <div class="acct-picker">
        <button class="acct-trigger" onClick={() => setOpen(!open)}>
          <span class="acct-avatar">{initial}</span>
          <span class="acct-name">{selected?.name ?? 'Selecione'}</span>
          <Icon icon={I.CARET} size={16} class="acct-caret" />
        </button>

        {open && (
          <>
            <div class="acct-scrim" onClick={() => setOpen(false)} />
            <div class="acct-menu">
              <div class="acct-group">Conta principal</div>
              {master.map(option)}
              {subs.length > 0 && <div class="acct-group">Subcontas</div>}
              {subs.map(option)}
              <button
                class="acct-option acct-manage"
                onClick={() => {
                  props.onManageProfiles()
                  setOpen(false)
                }}
              >
                <Icon icon={I.PROFILE} size={16} />
                <span class="acct-option-name">Criar ou excluir perfis</span>
              </button>
            </div>
          </>
        )}
      </div>
    </header>
  )
}
