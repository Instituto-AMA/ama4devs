/**
 * "Integrações" — as abas que o painel do Asaas tem sob este nome: chaves de API,
 * webhooks e os logs de entrega. Tudo da CONTA SELECIONADA na topbar.
 *
 * A aba vai no hash (`#integrations/keys`), como as páginas: recarregar mantém a aba,
 * e dá para mandar `#integrations/webhooks` para quem está com a fila travada.
 *
 * "Segurança" existe no Asaas e ainda não aqui: aparece apagada em vez de sumir,
 * pela mesma razão dos itens da sidebar.
 */
import { useEffect, useState } from 'preact/hooks'
import { admin } from '../api.ts'
import type { PageProps } from '../app.tsx'
import { Icon, type IconData } from '../components/Icon.tsx'
import * as I from '../icons.ts'
import { ApiKeys } from './integrations/ApiKeys.tsx'
import { ChannelPage } from './integrations/Channels.tsx'
import { GeneratorPage } from './integrations/Generator.tsx'
import { RequestLogs } from './integrations/RequestLogs.tsx'
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
  { id: 'requests', label: 'Logs de Requisições', icon: I.LOG },
  { id: 'webhook-logs', label: 'Logs de Webhooks', icon: I.LOG },
  // The payer channels (simulator): where the e-mails and WhatsApp templates land.
  { id: 'whatsapp', label: 'WhatsApp', icon: I.WHATSAPP },
  { id: 'email', label: 'E-mail (Mailpit)', icon: I.MAIL },
]

/**
 * The generator tab: it exists only while the simulator found the generator.
 *
 * The Asaas mock looks for it on boot, like Mailpit and the WhatsApp mock: with
 * `GENERATOR_URL` set it uses that address, empty it is off, unset it looks for the
 * service around it every 10s. Off — or with `GENERATOR_ENABLED=0` in compose, which
 * keeps the container down — there is nothing behind the tab, so it does not appear.
 */
const GENERATOR_TAB: Tab = { id: 'generator', label: 'Gerador', icon: I.GENERATOR }

/**
 * Whether the simulator found the generator, remembered for `integrationTab`.
 *
 * The state lives in the page (the tab list needs it to draw), but the last answer is
 * kept in the module too: the shell asks `integrationTab` for the label of the page it
 * is about to draw, and it knows nothing about the generator.
 */
let generatorFound = false

/** The tabs the page shows: the fixed ones, plus the generator while it is on. */
const integrationTabs = (on: boolean): Tab[] =>
  on ? [...INTEGRATION_TABS, GENERATOR_TAB] : INTEGRATION_TABS

/** The tab a hash names, or the first one. The generator counts only while it is on. */
export const integrationTab = (id: string | undefined, on = generatorFound): Tab => {
  const tabs = integrationTabs(on)
  return tabs.find((t) => t.id === id && !t.disabled) ?? tabs[0]!
}

export function Integrations(props: PageProps & { tab: string | undefined }) {
  const [generatorOn, setGeneratorOn] = useState(false)
  const tabs = integrationTabs(generatorOn)
  const tab = integrationTab(props.tab, generatorOn)

  useEffect(() => {
    void admin('/generator/status')
      .then((s) => {
        const on = Boolean(s.on)
        const changed = on !== generatorFound
        generatorFound = on
        setGeneratorOn(on)
        // A deep link to `#integrations/generator` opened the shell BEFORE the answer
        // came, and the shell names the page from `integrationTab`: it needs one redraw
        // to say "Gerador" instead of the name of the first tab.
        if (changed && on && props.tab === 'generator') void props.store.reload()
      })
      .catch(() => {
        generatorFound = false
        setGeneratorOn(false)
      })
  }, [])

  return (
    <div class="stack">
      <div class="tabs" role="tablist">
        {tabs.map((t) => (
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
      {tab.id === 'requests' && <RequestLogs {...props} />}
      {tab.id === 'webhook-logs' && <WebhookLogs {...props} />}
      {tab.id === 'whatsapp' && <ChannelPage {...props} channel="WHATSAPP" />}
      {tab.id === 'email' && <ChannelPage {...props} channel="EMAIL" />}
      {tab.id === 'generator' && <GeneratorPage {...props} />}
    </div>
  )
}
