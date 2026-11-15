import { useEffect, useState } from 'react'

export interface StoriesSummary {
  active: number
  /** 连续 ≥3 次没有新进展、需要用户确认的跟踪数 */
  quiet: number
}

/** 侧栏「跟踪」入口用：数量在采集完成/弹窗事件后刷新 */
export function useStoriesSummary(): StoriesSummary {
  const [summary, setSummary] = useState<StoriesSummary>({ active: 0, quiet: 0 })

  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      const list = await window.meerkat?.stories?.list?.().catch(() => [])
      if (cancelled || !list) return
      setSummary({
        active: list.filter((s) => s.status === 'active').length,
        quiet: list.filter((s) => s.status === 'active' && s.missCount >= 3).length
      })
    }
    void load()
    const offBrief = window.meerkat?.onBriefUpdated?.(() => void load())
    const offReview = window.meerkat?.stories?.onReview?.(() => void load())
    return () => {
      cancelled = true
      offBrief?.()
      offReview?.()
    }
  }, [])

  return summary
}
