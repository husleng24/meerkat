import { useCallback, useEffect, useState } from 'react'
import type { DomainPayload } from './ipc-types'

export interface DomainsState {
  domains: DomainPayload[]
  activeId: string
  setActiveId: (id: string) => void
  create: (input: { id?: string; name: string }) => Promise<string | null>
  rename: (id: string, name: string) => Promise<boolean>
  remove: (id: string) => Promise<boolean>
  reload: () => void
  /** 浏览器预览里没有 IPC */
  available: boolean
}

const STORAGE_KEY = 'meerkat.domain'

/** 领域列表：当前领域记在 localStorage，重启后停在同一个领域 */
export function useDomains(): DomainsState {
  const [domains, setDomains] = useState<DomainPayload[]>([])
  const [activeId, setActiveIdState] = useState<string>(() => {
    if (typeof localStorage === 'undefined') return ''
    return localStorage.getItem(STORAGE_KEY) ?? ''
  })
  const [tick, setTick] = useState(0)

  const reload = useCallback(() => setTick((n) => n + 1), [])

  const setActiveId = useCallback((id: string) => {
    setActiveIdState(id)
    try {
      localStorage.setItem(STORAGE_KEY, id)
    } catch {
      /* 隐私模式忽略 */
    }
  }, [])

  useEffect(() => {
    const api = window.meerkat?.domains
    if (!api) {
      const fallback: DomainPayload = { id: 'ai', name: 'AI', createdAt: 0, topicCount: 0 }
      setDomains([fallback])
      setActiveIdState((cur) => cur || fallback.id)
      return
    }
    let cancelled = false
    void api.list().then((list) => {
      if (cancelled) return
      setDomains(list)
      setActiveIdState((cur) => {
        const next = list.some((d) => d.id === cur) ? cur : (list[0]?.id ?? '')
        if (next !== cur) {
          try {
            localStorage.setItem(STORAGE_KEY, next)
          } catch {
            /* 忽略 */
          }
        }
        return next
      })
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
    activeId,
    setActiveId,
    create,
    rename,
    remove,
    reload,
    available: typeof window !== 'undefined' && !!window.meerkat?.domains
  }
}
