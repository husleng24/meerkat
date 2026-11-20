import { useCallback, useEffect, useState } from 'react'
import type { StoryPayload } from '../lib/ipc-types'

type TrackingTab = 'active' | 'paused' | 'archived'

interface Props {
  nav: string
}

const RECENT_KEY = 'meerkat.search.recent'

function recentSearches(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string').slice(0, 6) : []
  } catch {
    return []
  }
}

/**
 * 非今日页的上下文侧栏。
 *
 * 只在侧栏能提供主内容没有的操作时才出现：
 * - 跟踪：状态筛选（内容区不再重复放 tabs）；
 * - 搜索：最近搜索（内容区没有）。
 *
 * 事实源/历史/设置等页面的统计和动作已经在主内容区，侧栏直接消失，避免复读。
 */
export function ContextSidebar({ nav }: Props): React.JSX.Element | null {
  const [trackingTab, setTrackingTab] = useState<TrackingTab>('active')
  const [stories, setStories] = useState<StoryPayload[]>([])
  const [recent, setRecent] = useState<string[]>(() => recentSearches())
  const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)

  const loadStories = useCallback(async (): Promise<void> => {
    const api = window.meerkat?.stories
    if (!api) return
    const list = await api.list().catch(() => [])
    setStories(list)
  }, [])

  useEffect(() => {
    if (nav !== 'stories') return
    void loadStories()
    const reload = (): void => void loadStories()
    const sync = (e: Event): void => {
      const tab = (e as CustomEvent<{ tab?: TrackingTab }>).detail?.tab
      if (tab === 'active' || tab === 'paused' || tab === 'archived') setTrackingTab(tab)
    }
    window.addEventListener('meerkat:tracking-updated', reload)
    window.addEventListener('brief:updated', reload)
    window.addEventListener('meerkat:tracking-tab-sync', sync)
    return () => {
      window.removeEventListener('meerkat:tracking-updated', reload)
      window.removeEventListener('brief:updated', reload)
      window.removeEventListener('meerkat:tracking-tab-sync', sync)
    }
  }, [nav, loadStories])

  useEffect(() => {
    if (nav !== 'search') return
    const reload = (): void => setRecent(recentSearches())
    window.addEventListener('meerkat:search-recent', reload)
    return () => window.removeEventListener('meerkat:search-recent', reload)
  }, [nav])

  if (nav !== 'stories' && nav !== 'search') return null
  if (nav === 'search' && recent.length === 0) return null

  const active = stories.filter((s) => s.status === 'active')
  const paused = stories.filter((s) => s.status === 'paused')
  const archived = stories.filter((s) => s.status === 'archived')
  const quiet = active.filter((s) => s.missCount >= 3).length

  const chooseTracking = (tab: TrackingTab): void => {
    setTrackingTab(tab)
    window.dispatchEvent(new CustomEvent('meerkat:tracking-tab', { detail: { tab } }))
  }

  const chooseSearch = (q: string): void => {
    window.dispatchEvent(new CustomEvent('meerkat:search-query', { detail: { q } }))
  }

  return (
    <aside
      className={[
        'flex w-[216px] shrink-0 flex-col border-r border-rule bg-white px-4 pb-5 max-[900px]:hidden',
        isMac ? 'pt-10' : 'pt-3'
      ].join(' ')}
    >
      {nav === 'stories' ? (
        <>
          <h2 className="mb-1 px-2.5 text-[15px] font-bold tracking-[-0.02em] text-ink">跟踪</h2>
          <p className="mb-3 px-2.5 text-[10.5px] leading-4 text-ink-3">
            有新报道会追加到同一条评论串。
          </p>
          <div className="space-y-0.5">
            {[
              { id: 'active' as const, label: '进行中', count: active.length },
              { id: 'paused' as const, label: '已暂停', count: paused.length },
              { id: 'archived' as const, label: '已放弃', count: archived.length }
            ].map((row) => (
              <button
                key={row.id}
                onClick={() => chooseTracking(row.id)}
                aria-current={trackingTab === row.id ? 'page' : undefined}
                className={[
                  'flex w-full items-center gap-2 rounded-lg px-2.5 py-[7px] text-left text-[12.5px] transition-colors',
                  trackingTab === row.id ? 'bg-accent-soft text-accent' : 'text-ink-2 hover:bg-cream hover:text-ink'
                ].join(' ')}
              >
                <span className="flex-1">{row.label}</span>
                <span className="text-[10.5px] tabular-nums text-ink-3">{row.count}</span>
              </button>
            ))}
          </div>
          {quiet > 0 && (
            <p className="mt-3 rounded-lg bg-alert/5 px-2.5 py-2 text-[10.5px] leading-4 text-alert">
              {quiet} 个跟踪连续多次没有新进展
            </p>
          )}
        </>
      ) : (
        <>
          <h2 className="mb-1 px-2.5 text-[15px] font-bold tracking-[-0.02em] text-ink">搜索</h2>
          <p className="mb-2 px-2.5 text-[10.5px] text-ink-3">最近搜索</p>
          <div className="space-y-0.5">
            {recent.map((q) => (
              <button
                key={q}
                onClick={() => chooseSearch(q)}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-[6px] text-left text-[12px] text-ink-2 hover:bg-cream hover:text-ink"
              >
                <span className="truncate">{q}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </aside>
  )
}
