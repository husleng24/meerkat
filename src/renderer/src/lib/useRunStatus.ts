import { useEffect, useState } from 'react'
import type { RunStatusPayload } from './ipc-types'

const IDLE: RunStatusPayload = { running: false }

/**
 * 今日页空状态用：有没有一轮采集正在跑。
 *
 * 轮询而不是只查一次，是因为运行可能由托盘/定时/设置页发起；
 * 运行结束又没有简报时，按钮必须能自己从「正在采集」回到「立即采集」。
 * 2 秒一次、只在空状态可见时轮询，开销可以忽略。
 */
export function useRunStatus(active: boolean): RunStatusPayload {
  const [status, setStatus] = useState<RunStatusPayload>(IDLE)

  useEffect(() => {
    if (!active) {
      setStatus(IDLE)
      return
    }
    const api = window.meerkat?.runStatus
    if (!api) return

    let cancelled = false
    const check = async (): Promise<void> => {
      try {
        const next = await api()
        if (!cancelled) setStatus(next)
      } catch {
        /* 状态查询失败不该影响今日页 */
      }
    }
    void check()
    const timer = setInterval(() => void check(), 2000)
    const offBrief = window.meerkat?.onBriefUpdated?.(() => void check())
    return () => {
      cancelled = true
      clearInterval(timer)
      offBrief?.()
    }
  }, [active])

  return status
}
