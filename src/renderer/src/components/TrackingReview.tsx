import { useCallback, useEffect, useState } from 'react'
import type { StoryReviewPayload } from '../lib/ipc-types'

/**
 * 连续多次采集没有新进展时，主动问一句"还跟踪吗"。
 *
 * 关掉窗口不等于放弃：只有明确点「放弃跟踪」才归档；点「继续」会把计数清零，
 * 进入下一个观察周期。
 */
export function TrackingReview(): React.JSX.Element | null {
  const [queue, setQueue] = useState<StoryReviewPayload[]>([])
  const api = window.meerkat?.stories

  const load = useCallback(async (): Promise<void> => {
    if (!api) return
    const list = await api.needsReview().catch(() => [])
    if (!list.length) return
    setQueue((prev) => {
      const seen = new Set(prev.map((s) => s.id))
      return [...prev, ...list.filter((s) => !seen.has(s.id))]
    })
  }, [api])

  useEffect(() => {
    void load()
    const off = window.meerkat?.onBriefUpdated?.(() => void load())
    return () => off?.()
  }, [load])

  const story = queue[0]
  if (!story) return null

  const resolve = async (status: 'active' | 'archived'): Promise<void> => {
    await api?.setStatus({ id: story.id, status })
    setQueue((prev) => prev.slice(1))
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/20 px-5 backdrop-blur-[2px]">
      <div
        className="w-full max-w-[420px] rounded-2xl border border-rule bg-white p-5"
        style={{ boxShadow: '0 30px 80px -40px rgba(11,18,32,.45)' }}
        role="dialog"
        aria-label="跟踪确认"
      >
        <div className="text-[13px] font-bold text-ink">还在跟踪这件事吗？</div>
        <p className="mt-2 text-[12.5px] leading-relaxed text-ink-2">
          「{story.title}」已经连续 {story.missCount} 次采集没有新进展。继续跟踪会保留它，之后有新报道会追加到评论串。
        </p>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            onClick={() => void resolve('archived')}
            className="rounded-lg border border-rule px-3 py-1.5 text-[11.5px] text-ink-2 hover:border-alert hover:text-alert"
          >
            放弃跟踪
          </button>
          <button
            onClick={() => void resolve('active')}
            className="rounded-lg bg-ink px-3 py-1.5 text-[11.5px] font-medium text-paper hover:opacity-90"
          >
            继续跟踪
          </button>
        </div>
      </div>
    </div>
  )
}
