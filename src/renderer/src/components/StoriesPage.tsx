import { useCallback, useEffect, useState } from 'react'
import type { StoryPayload } from '../lib/ipc-types'

interface Props {
  /** 打开发起跟踪的那条评论串 */
  onOpen: (story: StoryPayload) => void
}

const DAY = 86_400_000

function ago(ts: number | undefined): string {
  if (!ts) return '还没检查'
  const diff = Date.now() - ts
  if (diff < 3_600_000) return '刚刚'
  if (diff < DAY) return `${Math.floor(diff / 3_600_000)} 小时前`
  return `${Math.floor(diff / DAY)} 天前`
}

/**
 * 跟踪总览：所有被 agent 持续盯着的事件。
 *
 * 评论串是发起和看进展的地方；这里回答"我到底在跟哪些事、哪些已经很久没动静"。
 */
export function StoriesPage({ onOpen }: Props): React.JSX.Element {
  const [stories, setStories] = useState<StoryPayload[]>([])
  const [tab, setTab] = useState<'active' | 'paused' | 'archived'>('active')
  const [loading, setLoading] = useState(true)
  const api = window.meerkat?.stories

  const load = useCallback(async (): Promise<void> => {
    if (!api) return
    const list = await api.list().catch(() => [])
    setStories(list)
    setLoading(false)
  }, [api])

  useEffect(() => {
    void load()
    const offBrief = window.meerkat?.onBriefUpdated?.(() => void load())
    const offReview = api?.onReview?.(() => void load())
    return () => {
      offBrief?.()
      offReview?.()
    }
  }, [api, load])

  // 侧栏筛选和内容区标签共用一套状态
  useEffect(() => {
    const onTab = (e: Event): void => {
      const tab = (e as CustomEvent<{ tab?: 'active' | 'paused' | 'archived' }>).detail?.tab
      if (tab === 'active' || tab === 'paused' || tab === 'archived') setTab(tab)
    }
    const onUpdated = (): void => void load()
    window.addEventListener('meerkat:tracking-tab', onTab)
    window.addEventListener('brief:updated', onUpdated)
    return () => {
      window.removeEventListener('meerkat:tracking-tab', onTab)
      window.removeEventListener('brief:updated', onUpdated)
    }
  }, [load])

  const changeTab = (next: typeof tab): void => {
    setTab(next)
    window.dispatchEvent(new CustomEvent('meerkat:tracking-tab-sync', { detail: { tab: next } }))
  }

  const setStatus = async (id: string, status: StoryPayload['status']): Promise<void> => {
    await api?.setStatus({ id, status })
    await load()
    window.dispatchEvent(new CustomEvent('meerkat:tracking-updated'))
  }

  const openTimeline = async (story: StoryPayload): Promise<void> => {
    const data = await api?.timeline({ id: story.id }).catch(() => null)
    if (!data) {
      onOpen(story)
      return
    }
    window.dispatchEvent(new CustomEvent('meerkat:open-timeline', { detail: data }))
  }

  const active = stories.filter((s) => s.status === 'active')
  const paused = stories.filter((s) => s.status === 'paused')
  const archived = stories.filter((s) => s.status === 'archived')
  const shown = tab === 'active' ? active : tab === 'paused' ? paused : archived
  const quiet = active.filter((s) => s.missCount >= 3).length

  const tabs: Array<{ id: typeof tab; label: string; count: number }> = [
    { id: 'active', label: '跟踪中', count: active.length },
    { id: 'paused', label: '已暂停', count: paused.length },
    { id: 'archived', label: '已放弃', count: archived.length }
  ]

  return (
    <div className="mx-auto max-w-[820px] px-10 pb-24 pt-4">
      <div className="flex items-baseline gap-3">
        <h2 className="text-[15px] font-bold text-ink">事件跟踪</h2>
        <span className="text-[11px] text-ink-3">
          {active.length} 个跟踪中{quiet > 0 ? ` · ${quiet} 个很久没新进展` : ''}
        </span>
      </div>

      <div className="mt-4 flex gap-1.5">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => changeTab(t.id)}
            className={[
              'rounded-full border px-3 py-1 text-[11px] transition-colors',
              tab === t.id
                ? 'border-accent bg-accent-soft text-accent'
                : 'border-rule text-ink-3 hover:border-accent hover:text-ink'
            ].join(' ')}
          >
            {t.label} {t.count > 0 ? t.count : ''}
          </button>
        ))}
      </div>

      {loading && <div className="mt-8 text-[12px] text-ink-3">加载中…</div>}

      {!loading && shown.length === 0 && (
        <div className="mt-8 rounded-xl border border-dashed border-rule px-5 py-10 text-center">
          <p className="text-[12.5px] text-ink-2">
            {tab === 'active' ? '还没有在跟踪的事件。' : tab === 'paused' ? '没有暂停的跟踪。' : '没有放弃的跟踪。'}
          </p>
          <p className="mt-2 text-[11.5px] leading-relaxed text-ink-3">
            在任意新闻下点 💬 评论，输入 <code className="text-accent">@agent 帮我盯着这件事</code>，
            它就会出现在这里；有新报道会追加到同一条评论串。
          </p>
        </div>
      )}

      <ul className="mt-4 space-y-2">
        {shown.map((s) => {
          const latest = s.latest
          return (
          <li key={s.id} className="rounded-xl border border-rule bg-white px-4 py-3">
            <div className="flex items-start gap-2">
              <span
                className={[
                  'mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full',
                  s.status === 'active' ? 'bg-accent' : 'bg-ink-3/40'
                ].join(' ')}
              />
              <button
                onClick={() => (s.nodeCount > 0 ? void openTimeline(s) : onOpen(s))}
                className="min-w-0 flex-1 text-left"
                title={s.nodeCount > 0 ? '打开完整时间线' : '打开这条跟踪的评论串'}
              >
                <div className="truncate text-[12.5px] font-medium text-ink hover:text-accent">{s.title}</div>
                <div className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-ink-2">
                  {s.latestEvent ? (
                    <>
                      <span className="truncate">{s.latestEvent.title}</span>
                      <span className="shrink-0 text-ink-3">· {s.latestEvent.date.slice(5)}</span>
                    </>
                  ) : latest ? (
                    <>
                      <span className="truncate">{latest.title}</span>
                      <span className="shrink-0 text-ink-3">· {ago(latest.at)}</span>
                    </>
                  ) : (
                    <span className="text-ink-3">还没有新素材 · 上次检查 {ago(s.lastMatchAt)}</span>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-ink-3">
                  <span>{s.nodeCount} 个节点</span>
                  <span>·</span>
                  <span>{s.itemCount} 篇报道</span>
                  <span>·</span>
                  <span>{s.status === 'active' ? '跟踪中' : s.status === 'paused' ? '已暂停' : '已放弃'}</span>
                  {s.missCount > 0 && s.status === 'active' && (
                    <span className={s.missCount >= 3 ? 'text-alert/80' : 'text-amber-700/80'}>
                      · 连续 {s.missCount} 次无新进展
                    </span>
                  )}
                </div>
              </button>
              <div className="flex shrink-0 items-center gap-1">
                {s.nodeCount > 0 && (
                  <button
                    onClick={() => void openTimeline(s)}
                    className="rounded-md px-2 py-1 text-[10.5px] font-medium text-accent hover:bg-accent-soft"
                  >
                    时间线
                  </button>
                )}
                <button
                  onClick={() => onOpen(s)}
                  disabled={!s.itemId}
                  className="rounded-md px-2 py-1 text-[10.5px] text-ink-3 hover:bg-cream hover:text-ink disabled:opacity-40"
                >
                  评论
                </button>
                {s.status === 'active' ? (
                  <button
                    onClick={() => void setStatus(s.id, 'paused')}
                    className="rounded-md px-2 py-1 text-[10.5px] text-ink-3 hover:bg-cream hover:text-ink"
                  >
                    暂停
                  </button>
                ) : (
                  <button
                    onClick={() => void setStatus(s.id, 'active')}
                    className="rounded-md px-2 py-1 text-[10.5px] text-accent hover:bg-accent-soft"
                  >
                    继续
                  </button>
                )}
                {s.status !== 'archived' && (
                  <button
                    onClick={() => void setStatus(s.id, 'archived')}
                    className="rounded-md px-2 py-1 text-[10.5px] text-ink-3 hover:bg-alert/10 hover:text-alert"
                  >
                    放弃
                  </button>
                )}
              </div>
            </div>
          </li>
          )
        })}
      </ul>
    </div>
  )
}
