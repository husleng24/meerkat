import { useCallback, useEffect, useMemo, useState } from 'react'
import sampleMd from '../assets/brief-sample.md?raw'
import { parseBrief, type ParsedBrief } from '../lib/parseBrief'
import type {} from './ipc-types'

export interface BriefData {
  brief: ParsedBrief | null
  raw: string
  loading: boolean
  /** 数据来源：真实 IPC 还是内置样例（用于界面标注） */
  origin: 'ipc' | 'sample'
  /** preload 是否可用。区分"浏览器预览"和"真实应用但还没有简报" */
  bridgeAvailable: boolean
  /** URL → 条目 id；预览模式下为空，已读/收藏只在会话内有效 */
  urlToId: Record<string, string>
  /** 重新拉取（定时任务完成后调用） */
  reload: () => void
}

/**
 * 取简报数据。
 * 优先走 preload 暴露的 IPC；在没有 Electron 的浏览器预览里退回内置样例，
 * 这样同一份 UI 代码在开发和打包后都能跑，不需要维护两套。
 */
export function useBriefData(date?: string | null): BriefData {
  const [raw, setRaw] = useState('')
  const [urlToId, setUrlToId] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [origin, setOrigin] = useState<'ipc' | 'sample'>('sample')
  const [tick, setTick] = useState(0)

  const reload = useCallback(() => setTick((n) => n + 1), [])

  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      try {
        const api = window.meerkat
        // 指定日期时读历史；否则读最新一期
        const res = date
          ? await api?.briefByDate?.(date)
          : await api?.briefLatest?.()
        if (!cancelled && res?.markdown) {
          setRaw(res.markdown)
          setUrlToId(res.urlToId ?? {})
          setOrigin('ipc')
          setLoading(false)
          return
        }
        // 指定了日期但库里没有 → 显示空，不要拿样例冒充历史
        if (!cancelled && date) {
          setRaw('')
          setUrlToId({})
          setLoading(false)
          return
        }
      } catch {
        // 落回样例
      }
      if (!cancelled) {
        setRaw(sampleMd)
        setUrlToId({})
        setOrigin('sample')
        setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [tick, date])

  // 定时任务跑完后主进程会推事件，这里订阅一次
  useEffect(() => {
    const api = window.meerkat
    if (!api?.onBriefUpdated) return
    return api.onBriefUpdated(reload)
  }, [reload])

  const brief = useMemo(() => (raw ? parseBrief(raw) : null), [raw])
  const bridgeAvailable = typeof window !== 'undefined' && window.meerkat !== undefined
  return { brief, raw, loading, origin, bridgeAvailable, urlToId, reload }
}
