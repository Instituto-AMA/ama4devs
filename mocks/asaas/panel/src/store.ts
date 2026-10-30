/**
 * The state that EVERY screen needs: the accounts, which one is selected, the
 * clock and the health of the webhook queues.
 *
 * A hook, not a state framework. There are four fields and a `reload()` —
 * bringing a store here would be ceremony without gain, and the whole panel
 * fits in your head.
 *
 * The clock and the queues live HERE, and not inside the Simulator screens, for
 * one reason: the warnings they produce ("you are 105 days in the future", "the
 * queue is stuck") have to appear on ANY screen. The two bugs that cost the
 * most time in this project were invisible precisely because they only showed
 * up somewhere else in the system.
 */
import { useCallback, useEffect, useState } from 'preact/hooks'
import { admin, type Account, type Clock, type QueueHealth } from './api.ts'

export interface Store {
  accounts: Account[]
  selected: Account | null
  clock: Clock | null
  queues: QueueHealth[]
  loading: boolean
  error: string | null
  select(id: string): void
  reload(): Promise<void>
}

export function useStore(): Store {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [clock, setClock] = useState<Clock | null>(null)
  const [queues, setQueues] = useState<QueueHealth[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const [a, c, q] = await Promise.all([
        admin('/accounts'),
        admin('/clock'),
        admin('/webhooks/queue'),
      ])
      setAccounts(a.accounts)
      setClock(c)
      setQueues(q.webhooks)
      setError(null)

      // On the first load it enters the main account — it is where the key of the
      // user is and where most of the charges are born.
      setSelectedId((cur) => {
        if (cur && a.accounts.some((x: Account) => x.id === cur)) return cur
        return a.accounts.find((x: Account) => !x.parentAccountId)?.id ?? a.accounts[0]?.id ?? null
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  return {
    accounts,
    selected: accounts.find((a) => a.id === selectedId) ?? null,
    clock,
    queues,
    loading,
    error,
    select: setSelectedId,
    reload,
  }
}
