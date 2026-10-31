import { useCallback, useEffect, useMemo, useState } from 'react'
import sampleSources from '../assets/sources-sample.json'
import { summarizeHealth, sortByHealth } from '../../../app/source-health'
import type { Source } from '../../../core/domain/types'
import type {} from './ipc-types'


export interface SourcesState {
  sources: Source[]
  origin: 'ipc' | 'sample'
  probing: Set<string>
  progress: { done: number; total: number } | null
  toggle: (id: string, enabled: boolean) => Promise<void>
  testOne: (id: string) => Promise<void>
  testAll: () => Promise<void>
  add: (input: { name: string; url?: string; kind: string; tier: number; bucketHint: string }) => Promise<{
    ok: boolean
    error?: string
  }>
  remove: (id: string) => Promise<{ ok: boolean; error?: string }>
  update: (input: {
    id: string
    name: string
    url?: string
    tier: number
    bucketHint: string
  }) => Promise<{ ok: boolean; error?: string }>
  reload: () => Promise<void>
}

const asSources = (raw: unknown[]): Source[] => raw as Source[]

/** 与简报一样：有 IPC 走 IPC，没有就用内置样例，保证 UI 在浏览器里可验证 */
export function useSources(): SourcesState {
  const [sources, setSources] = useState<Source[]>([])
  const [origin, setOrigin] = useState<'ipc' | 'sample'>('sample')
  const [probing, setProbing] = useState<Set<string>>(new Set())
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      const api = window.meerkat?.sources
      if (api) {
        try {
          const list = await api.list()
          if (!cancelled && list.length > 0) {
            setSources(asSources(list))
            setOrigin('ipc')
            return
          }
        } catch {
          /* 落回样例 */
        }
      }
      if (!cancelled) {
        setSources(asSources(sampleSources as unknown[]))
        setOrigin('sample')
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  // 订阅全量自检进度
  useEffect(() => {
    const api = window.meerkat?.sources
    if (!api?.onProgress) return
    return api.onProgress((p) => {
      setProbing((prev) => {
        const next = new Set(prev)
        next.delete(p.id)
        return next
      })
      setProgress({ done: p.done, total: p.total })
      setSources((prev) =>
        prev.map((s) =>
          s.id === p.id
            ? {
                ...s,
                failStreak: p.ok ? 0 : s.failStreak + 1,
                ...(p.ok ? { lastOkAt: Date.now(), avgItems: p.n, avgMs: p.ms, lastError: undefined } : { lastError: p.error })
              }
            : s
        )
      )
    })
  }, [])

  const toggle = useCallback(async (id: string, enabled: boolean) => {
    const api = window.meerkat?.sources
    if (api) await api.toggle(id, enabled)
    setSources((prev) => prev.map((s) => (s.id === id ? { ...s, enabled } : s)))
  }, [])

  const testOne = useCallback(async (id: string) => {
    const api = window.meerkat?.sources
    setProbing((prev) => new Set(prev).add(id))
    try {
      if (api) {
        const r = await api.test(id)
        setSources((prev) =>
          prev.map((s) =>
            s.id === id
              ? r.ok
                ? { ...s, failStreak: 0, lastOkAt: Date.now(), avgItems: r.n ?? s.avgItems, avgMs: r.ms ?? s.avgMs }
                : { ...s, failStreak: s.failStreak + 1, lastError: r.error }
              : s
          )
        )
      } else {
        await new Promise((r) => setTimeout(r, 600))
      }
    } finally {
      setProbing((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }, [])

  const testAll = useCallback(async () => {
    const api = window.meerkat?.sources
    if (!api) return
    setProgress({ done: 0, total: sources.length })
    await api.testAll()
    const list = await api.list()
    setSources(asSources(list))
    setProgress(null)
  }, [sources.length])

  const reload = useCallback(async () => {
    const api = window.meerkat?.sources
    if (!api) return
    try {
      const list = await api.list()
      setSources(asSources(list))
      setOrigin('ipc')
    } catch {
      /* 保持现状 */
    }
  }, [])

  const add = useCallback(
    async (input: { name: string; url?: string; kind: string; tier: number; bucketHint: string }) => {
      const api = window.meerkat?.sources
      if (!api) return { ok: false, error: '预览模式下不可用' }
      const r = await api.add(input)
      if (r.ok) await reload()
      return { ok: r.ok, ...(r.error !== undefined ? { error: r.error } : {}) }
    },
    [reload]
  )

  const remove = useCallback(
    async (id: string) => {
      const api = window.meerkat?.sources
      if (!api) return { ok: false, error: '预览模式下不可用' }
      const r = await api.remove(id)
      if (r.ok) await reload()
      return { ok: r.ok, ...(r.error !== undefined ? { error: r.error } : {}) }
    },
    [reload]
  )

  const update = useCallback(
    async (input: { id: string; name: string; url?: string; tier: number; bucketHint: string }) => {
      const api = window.meerkat?.sources
      if (!api) return { ok: false, error: '预览模式下不可用' }
      const r = await api.update(input)
      if (r.ok) await reload()
      return { ok: r.ok, ...(r.error !== undefined ? { error: r.error } : {}) }
    },
    [reload]
  )

  return { sources, origin, probing, progress, toggle, testOne, testAll, add, remove, update, reload }
}

/** 供界面直接用：排序 + 汇总 */
export function useSortedSources(sources: Source[]): { sorted: Source[]; summary: ReturnType<typeof summarizeHealth> } {
  return useMemo(() => ({ sorted: sortByHealth(sources), summary: summarizeHealth(sources) }), [sources])
}
