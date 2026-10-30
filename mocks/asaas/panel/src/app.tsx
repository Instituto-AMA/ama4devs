/**
 * The shell. Sidebar + topbar + the page, and — the most important part — the
 * two warning banners that appear on ANY screen.
 *
 * They are here, and not inside the Simulator screens, because the two bugs
 * that cost the most time in this project were invisible exactly for that
 * reason: the clock stayed 105 days in the future and every new charge was
 * born OVERDUE; the webhook queue froze behind a poisoned delivery and the
 * user's order stayed pending forever. In neither case did the symptom look
 * like it had anything to do with the cause — and nothing on the screen linked
 * one thing to the other.
 */
import { useEffect, useState } from 'preact/hooks'
import { admin } from './api.ts'
import * as I from './icons.ts'
import { Icon } from './components/Icon.tsx'
import { Sidebar } from './components/Sidebar.tsx'
import { Topbar } from './components/Topbar.tsx'
import { Banner, Button, plural } from './components/ui.tsx'
import { Charges, chargeTab } from './pages/Charges.tsx'
import { Customers } from './pages/Customers.tsx'
import { Home } from './pages/Home.tsx'
import { integrationTab, Integrations } from './pages/Integrations.tsx'
import { Invoices } from './pages/Invoices.tsx'
import { ChargeForm } from './components/ChargeForm.tsx'
import { Splits } from './pages/Splits.tsx'
import { Statement } from './pages/Statement.tsx'
import { Subaccounts } from './pages/Subaccounts.tsx'
import { Clock } from './pages/sim/Clock.tsx'
import { Profiles } from './pages/sim/Profiles.tsx'
import { TestCards } from './pages/sim/TestCards.tsx'
import { useStore, type Store } from './store.ts'
import './app.css'

/** What every page receives. `navigate` because a card leads to the list it summarizes. */
export interface PageProps {
  store: Store
  navigate: (page: string) => void
}

const TITLES: Record<string, string> = {
  home: 'Início',
  customers: 'Meus Clientes',
  payments: 'Cobranças',
  statement: 'Extrato da Conta',
  invoices: 'Notas fiscais',
  splits: 'Split de pagamentos',
  subaccounts: 'Subcontas',
  integrations: 'Integrações',
  'sim-profiles': 'Perfis',
  'sim-clock': 'Relógio virtual',
  'sim-cards': 'Cartões de teste',
}

/** Old links that moved: `#webhooks` now lives under Integrações. */
const ALIASES: Record<string, string> = { webhooks: 'integrations/webhooks' }

/**
 * The page lives in the hash. Thirty lines less than a router, and it settles
 * what matters: reloading does not throw you back to the home, the browser back
 * button works, and you can send `#webhooks` to someone whose queue is stuck
 * instead of describing where to click.
 */
function useHashPage(fallback: string) {
  const read = () => {
    const page = window.location.hash.slice(1) || fallback
    return ALIASES[page] ?? page
  }
  const [page, setPage] = useState(read)

  useEffect(() => {
    const onHash = () => setPage(read())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  return [page, (p: string) => (window.location.hash = p)] as const
}

export function App() {
  const store = useStore()
  const [page, setPage] = useHashPage('home')
  const [saleOpen, setSaleOpen] = useState(false)
  // Bumped when "Simular Venda" created something: the open page remounts and reloads its lists.
  const [pageKey, setPageKey] = useState(0)

  const drift = store.clock?.driftDays ?? 0

  // Only the queues of THIS account. The banner speaks about what you are
  // looking at: warning that the queue of another merchant froze while you are
  // debugging yours is noise that teaches you to ignore the warning — and the
  // day it is about you, it is not read anymore.
  const blocked = store.queues.filter((q) => q.blocked && q.accountId === store.selected?.id)

  const resetClock = async () => {
    const r = await admin('/clock/reset', { method: 'POST' })
    await store.reload()
    if (r.rescheduledDeliveries > 0) {
      alert(
        `Relógio de volta ao presente.\n\n` +
          `${plural(r.rescheduledDeliveries, 'entrega de webhook estava agendada', 'entregas de webhook estavam agendadas')} ` +
          `no futuro e ${r.rescheduledDeliveries === 1 ? 'voltou' : 'voltaram'} para a fila.`,
      )
    }
  }

  const props = { store, navigate: setPage }

  // `integrations/keys` → the section and its tab; the tab names the screen.
  const [section = page, sub] = page.split('/')
  const tabTitle =
    section === 'integrations'
      ? integrationTab(sub).label
      : section === 'payments' && sub
        ? chargeTab(sub).label
        : section === 'customers' && sub
          ? 'Cliente'
          : null

  return (
    <div class="shell">
      <Sidebar
        page={page}
        onNavigate={setPage}
        onSimulateSale={() => setSaleOpen(true)}
        webhookAlerts={blocked.length}
      />

      <main>
        <Topbar
          accounts={store.accounts}
          selected={store.selected}
          onSelect={store.select}
          onRefresh={() => void store.reload()}
          refreshing={store.loading}
          onManageProfiles={() => setPage('sim-profiles')}
        />

        <div class="content">
          <div class="crumbs">
            <Icon icon={I.HOME} size={15} />
            {tabTitle ? (
              <>
                <span>{TITLES[section]}</span>
                <Icon icon={I.CHEVRON} size={14} />
                <span class="crumb-current">{tabTitle}</span>
              </>
            ) : (
              <span class="crumb-current">{TITLES[page] ?? page}</span>
            )}
          </div>

          <h1>
            {page === 'home'
              ? `Olá, ${store.selected?.name ?? '…'}`
              : (tabTitle ?? TITLES[page] ?? page)}
          </h1>

          {store.error && <Banner tone="danger">{store.error}</Banner>}

          {/* The clock is GLOBAL to the container: a `+32` clicked here moves the
              time for the application integrating on the other side too. */}
          {drift > 0 && (
            <Banner
              icon={I.CLOCK}
              action={
                <Button variant="primary" size="sm" onClick={() => void resetClock()}>
                  Voltar ao presente
                </Button>
              }
            >
              O simulador está <b>{plural(drift, 'dia', 'dias')} no futuro</b> (
              {store.clock?.today}). Toda cobrança nova nasce <b>OVERDUE</b>, porque o
              vencimento de hoje já passou para ele.
            </Banner>
          )}

          {blocked.length > 0 && page !== 'integrations/webhooks' && (
            <Banner
              tone="danger"
              icon={I.WEBHOOK}
              action={
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => setPage('integrations/webhooks')}
                >
                  Ver fila
                </Button>
              }
            >
              {plural(blocked.length, 'fila de webhook está travada', 'filas de webhook estão travadas')} em{' '}
              <b>{store.selected?.name}</b>. Enquanto isso, <b>nenhum evento chega</b> na sua
              aplicação — e o pagamento parece pago aqui e pendente lá.
            </Banner>
          )}

          <Page key={pageKey} page={page} {...props} />
        </div>
      </main>

      {/* "Simular Venda" is the full charge form: single, installments or subscription,
          with split, and every invoice link it generated at the end. */}
      {saleOpen && (
        <ChargeForm
          store={store}
          title="Simular Venda"
          onClose={() => setSaleOpen(false)}
          onCreated={() => setPageKey((k) => k + 1)}
        />
      )}
    </div>
  )
}

function Page({ page, ...p }: PageProps & { page: string }) {
  const [section, tab] = page.split('/')
  switch (section) {
    case 'home':
      return <Home {...p} />
    case 'customers':
      return <Customers {...p} customerId={tab} />
    case 'payments':
      return <Charges {...p} tab={tab} />
    case 'statement':
      return <Statement {...p} />
    case 'invoices':
      return <Invoices {...p} />
    case 'splits':
      return <Splits {...p} />
    case 'subaccounts':
      return <Subaccounts {...p} />
    case 'integrations':
      return <Integrations {...p} tab={tab} />
    case 'sim-profiles':
      return <Profiles {...p} />
    case 'sim-clock':
      return <Clock {...p} />
    case 'sim-cards':
      return <TestCards /> // the table comes from the domain, not from the selected account
    default:
      return null
  }
}
