/**
 * The account's customers, active and removed, by id.
 *
 * A charge, a subscription and an installment plan carry only the customer id; the
 * name comes from here. Removed customers come from the simulator because
 * `/v3/customers` lists only active ones, and a charge outlives its removed customer.
 */
import { useCallback, useEffect, useState } from 'preact/hooks'
import { admin, v3, type Customer } from '../api.ts'

export interface CustomerIndex {
  list: Customer[]
  byId: Map<string, Customer>
  loading: boolean
  reload(): Promise<void>
}

export function useCustomers(apiKey: string | null | undefined, accountId: string | undefined): CustomerIndex {
  const [active, setActive] = useState<Customer[]>([])
  const [removed, setRemoved] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    if (!apiKey || !accountId) return
    setLoading(true)
    try {
      const [a, r] = await Promise.all([
        v3('/customers?limit=100', apiKey),
        admin(`/customers?accountId=${encodeURIComponent(accountId)}&removed=true`),
      ])
      setActive(a.data)
      setRemoved(r.data.map((c: Customer) => ({ ...c, deleted: true })))
    } finally {
      setLoading(false)
    }
  }, [apiKey, accountId])

  useEffect(() => {
    void reload()
  }, [reload])

  const byId = new Map<string, Customer>()
  for (const c of [...removed, ...active]) byId.set(c.id, c)
  return { list: active, byId, loading, reload }
}
