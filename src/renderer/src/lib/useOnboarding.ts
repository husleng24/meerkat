import { useCallback, useEffect, useState } from 'react'
import type { OnboardingStatusPayload, RunNowPayload } from './ipc-types'

export interface OnboardingApi {
  /** 首启状态是否还在加载；App 用它决定是否先显示启动画面 */
  loading: boolean
  /** 是否显示首启引导 */
  shouldShow: boolean
  /** 主进程返回的完整状态，便于诊断与测试 */
  status: OnboardingStatusPayload | null
  /** 首启 CTA：创建主题由组件先做，这里只负责开始运行并写完成标记 */
  start: (topicId: string) => Promise<RunNowPayload>
  /** 跳过：写完成标记；即使 IPC 失败也按 fail-open 放行 */
  complete: (input?: { skipped?: boolean }) => Promise<boolean>
  /** 本地收起引导（成功生成后由「去读简报」调用） */
  hide: () => void
}

/**
 * 首启状态。
 *
 * 刻意不在 `brief:updated` 时刷新：引导的“运行 / 完成 / 失败”由组件自己控制，
 * 否则第一份简报一落库，整页会被替换成今日页，用户看不到结果确认。
 * 重新打开应用时 `onboarding:get` 会读到完成标记，直接进今日页。
 */
export function useOnboarding(): OnboardingApi {
  const [loading, setLoading] = useState(true)
  const [shouldShow, setShouldShow] = useState(false)
  const [status, setStatus] = useState<OnboardingStatusPayload | null>(null)

  useEffect(() => {
    const api = window.meerkat?.onboarding
    if (!api) {
      setLoading(false)
      return
    }
    let cancelled = false
    void api
      .get()
      .then((res) => {
        if (cancelled) return
        setStatus(res)
        setShouldShow(res.shouldShow)
        setLoading(false)
      })
      .catch(() => {
        // 读不到就放行，不能让一个引导把整个应用卡在启动画面
        if (!cancelled) {
          setShouldShow(false)
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  const start = useCallback(async (topicId: string): Promise<RunNowPayload> => {
    const api = window.meerkat?.onboarding
    if (!api) return { ok: false, error: '预览模式下不可用' }
    try {
      const res = await api.start({ topicId })
      return res ?? { ok: false, error: '没有拿到运行结果' }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }, [])

  const complete = useCallback(async (input: { skipped?: boolean } = {}): Promise<boolean> => {
    // 不在这里收起：组件在 await 之后统一走 onDone，避免它在卸载后才更新 busy 状态。
    // 跳过是用户的明确意图，IPC 失败也由 onDone 的 fail-open 放行。
    const api = window.meerkat?.onboarding
    if (!api) return true
    try {
      const r = await api.complete(input)
      return r.ok
    } catch {
      return false
    }
  }, [])

  const hide = useCallback(() => setShouldShow(false), [])

  return { loading, shouldShow, status, start, complete, hide }
}
