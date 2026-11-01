import { useCallback, useEffect, useState } from 'react'
import type { TopicPayload } from './ipc-types'

export interface TopicsState {
  topics: TopicPayload[]
  /** 当前主题 id；主题列表为空时是空串 */
  activeId: string
  setActiveId: (id: string) => void
  /** 建一个新主题（引导页用），成功后返回 id */
  create: (input: { id: string; name: string; domainId?: string }) => Promise<string | null>
  reload: () => void
  /** 浏览器预览里没有 IPC，界面据此隐藏主题切换器 */
  available: boolean
}

/** 当前主题记在 localStorage：重启后还停在同一个主题上 */
const STORAGE_KEY = 'meerkat.topic'

/**
 * 主题列表。
 *
 * 预览模式（无 preload）下给一个假的「AI 综合」，让界面在浏览器里仍可截图——
 * 和简报数据的回退策略保持一致。
 */
export function useTopics(): TopicsState {
  const [topics, setTopics] = useState<TopicPayload[]>([])
  const [activeId, setActiveIdState] = useState<string>(() => {
    if (typeof localStorage === 'undefined') return ''
    return localStorage.getItem(STORAGE_KEY) ?? ''
  })
  const [tick, setTick] = useState(0)

  const reload = useCallback(() => setTick((n) => n + 1), [])

  useEffect(() => {
    const api = window.meerkat?.topics
    if (!api) {
      const fallback: TopicPayload = {
        id: 'ai',
        name: 'AI 综合',
        domainId: 'ai',
        enabled: true,
        hour: 8,
        minute: 30,
        sourceCount: 0,
        hasBrief: false,
        todayCount: 0,
        unreadCount: 0
      }
      setTopics([fallback])
      setActiveIdState((cur) => cur || fallback.id)
      return
    }
    let cancelled = false
    void api
      .list()
      .then((list) => {
        if (cancelled) return
        setTopics(list)
        setActiveIdState((cur) => (list.some((t) => t.id === cur) ? cur : (list[0]?.id ?? '')))
      })
      .catch(() => {
        if (!cancelled) setTopics([])
      })
    return () => {
      cancelled = true
    }
  }, [tick])

  const setActiveId = useCallback((id: string) => {
    setActiveIdState(id)
    try {
      localStorage.setItem(STORAGE_KEY, id)
    } catch {
      /* 隐私模式下写不进去，忽略 */
    }
  }, [])

  const create = useCallback(async (input: { id: string; name: string }) => {
    const api = window.meerkat?.topics
    if (!api) return null
    const res = await api.create(input)
    if (!res.ok) return null
    setTick((n) => n + 1)
    return res.id ?? input.id
  }, [])

  return {
    topics,
    activeId,
    setActiveId,
    create,
    reload,
    available: typeof window !== 'undefined' && window.meerkat?.topics !== undefined
  }
}
