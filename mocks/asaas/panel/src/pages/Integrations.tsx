/**
 * "Integrações" — as abas que o painel do Asaas tem sob este nome: chaves de API,
 * webhooks e os logs de entrega. Tudo da CONTA SELECIONADA na topbar.
 *
 * A aba vai no hash (`#integrations/keys`), como as páginas: recarregar mantém a aba,
 * e dá para mandar `#integrations/webhooks` para quem está com a fila travada.
 *
 * "Segurança" e "Logs de Requisições" existem no Asaas e ainda não aqui: aparecem
 * apagadas em vez de sumirem, pela mesma razão dos itens da sidebar.
 */
import type { PageProps } from '../app.tsx'
import { Icon, type IconData } from '../components/Icon.tsx'
import * as I from '../icons.ts'
import { ApiKeys } from './integrations/ApiKeys.tsx'
import { ChannelPage } from './integrations/Channels.tsx'
import { WebhookLogs } from './integrations/WebhookLogs.tsx'
import { Webhooks } from './integrations/Webhooks.tsx'

interface Tab {
  id: string
  label: string
  icon: IconData
  disabled?: boolean
}

export const INTEGRATION_TABS: Tab[] = [
  { id: 'keys', label: 'Chaves de API', icon: I.KEY },
  { id: 'security', label: 'Segurança', icon: I.LOCK, disabled: true },
  { id: 'webhooks', label: 'Webhooks', icon: I.WEBHOOK },
  { id: 'requests', label: 'Logs de Requisições', icon: I.LOG, disabled: true },
  { id: 'webhook-logs', label: 'Logs de Webhooks', icon: I.LOG },
  // The payer channels (simulator): where the e-mails and WhatsApp templates land.
  { id: 'whatsapp', label: 'WhatsApp', icon: I.WHATSAPP },
  { id: 'email', label: 'E-mail (Mailpit)', icon: I.MAIL },
]

/** The tab a hash names, or the first one. */
export const integrationTab = (id: string | undefined): Tab =>
  INTEGRATION_TABS.find((t) => t.id === id && !t.disabled) ?? INTEGRATION_TABS[0]!

export function Integrations(props: PageProps & { tab: string | undefined }) {
  const tab = integrationTab(props.tab)

  return (
    <div class="stack">
      <div class="tabs" role="tablist">
        {INTEGRATION_TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            class={`tab ${t.id === tab.id ? 'active' : ''}`}
            aria-selected={t.id === tab.id}
            disabled={t.disabled}
            title={t.disabled ? 'Ainda não implementado no simulador' : undefined}
            onClick={() => props.navigate(`integrations/${t.id}`)}
          >
            <Icon icon={t.icon} size={18} />
            {t.label}
          </button>
        ))}
      </div>

      {tab.id === 'keys' && <ApiKeys {...props} />}
      {tab.id === 'webhooks' && <Webhooks {...props} />}
      {tab.id === 'webhook-logs' && <WebhookLogs {...props} />}
      {tab.id === 'whatsapp' && <ChannelPage {...props} channel="WHATSAPP" />}
      {tab.id === 'email' && <ChannelPage {...props} channel="EMAIL" />}
    </div>
  )
}
