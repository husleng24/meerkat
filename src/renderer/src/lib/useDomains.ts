import { useCallback, useEffect, useState } from 'react'
import type { DomainPayload } from './ipc-types'

export interface DomainsState {
  domains: DomainPayload[]
  create: (input: { id?: string; name: string }) => Promise<string | null>
  rename: (id: string, name: string) => Promise<boolean>
  remove: (id: string) => Promise<boolean>
  reload: () => void
  /** 浏览器预览里没有 IPC */
  available: boolean
}

/**
 * 领域列表。
 *
 * 这里刻意不保存「当前领域」：领域由当前主题推导（见 App 的 activeDomain）。
 * 两个选择状态会互相打架——比如在汇总页换了主题、汇总却还停在旧领域。
 */
export function useDomains(): DomainsState {
  const [domains, setDomains] = useState<DomainPayload[]>([])
  const [tick, setTick] = useState(0)

  const reload = useCallback(() => setTick((n) => n + 1), [])

  useEffect(() => {
    const api = window.meerkat?.domains
    if (!api) {
      setDomains([{ id: 'ai', name: 'AI', createdAt: 0, topicCount: 0 }])
      return
    }
    let cancelled = false
    void api.list().then((list) => {
      if (!cancelled) setDomains(list)
    })
    return () => {
      cancelled = true
    }
  }, [tick])

  const create = useCallback(
    async (input: { id?: string; name: string }): Promise<string | null> => {
      const api = window.meerkat?.domains
      if (!api) return null
      const r = await api.create(input)
      if (!r.ok || !r.id) return null
      reload()
      return r.id
    },
    [reload]
  )

  const rename = useCallback(
    async (id: string, name: string): Promise<boolean> => {
      const api = window.meerkat?.domains
      if (!api) return false
      const r = await api.rename({ id, name })
      if (r.ok) reload()
      return r.ok
    },
    [reload]
  )

  const remove = useCallback(
    async (id: string): Promise<boolean> => {
      const api = window.meerkat?.domains
      if (!api) return false
      const r = await api.remove(id)
      if (r.ok) reload()
      return r.ok
    },
    [reload]
  )

  return {
    domains,
    create,
    rename,
    remove,
    reload,
    available: typeof window !== 'undefined' && !!window.meerkat?.domains
  }
}
