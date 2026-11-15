import { useEffect, useState } from 'react'
import { timelineNow, type EventTimeline } from '../../../app/event-timeline'

interface OpenDetail {
  timeline: EventTimeline
  storyId?: string
  tracking?: boolean
}

/**
 * 完整时间线页：评论面板里点「展开完整时间线」后覆盖整个窗口。
 *
 * 面板空间只够看结论和最近三条；这一页负责"从头读一遍"：
 * 左侧完整时间轴，右侧来源与事件信息，宽窗口两栏、窄窗口单栏。
 */
export function TimelineOverlay(): React.JSX.Element | null {
  const [data, setData] = useState<OpenDetail | null>(null)
  const [stopped, setStopped] = useState(false)

  useEffect(() => {
    const onOpen = (e: Event): void => {
      const detail = (e as CustomEvent<OpenDetail>).detail
      if (!detail?.timeline) return
      setStopped(false)
      setData(detail)
    }
    window.addEventListener('meerkat:open-timeline', onOpen)
    return () => window.removeEventListener('meerkat:open-timeline', onOpen)
  }, [])

  useEffect(() => {
    if (!data) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setData(null)
    }
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      document.removeEventListener('keydown', onKey)
    }
  }, [data])

  if (!data) return null

  const { timeline, storyId, tracking } = data
  const phases = timeline.phases
  const now = timelineNow(timeline)
  const citedIds = new Set(phases.flatMap((p) => p.sourceItemIds))
  const cited = (timeline.items ?? []).filter((i) => citedIds.has(i.id))
  const byId = new Map((timeline.items ?? []).map((i) => [i.id, i]))
  const reportCount = citedIds.size

  const outlets = new Map<string, { url: string; count: number }>()
  for (const item of cited) {
    const cur = outlets.get(item.sourceName)
    if (cur) cur.count += 1
    else outlets.set(item.sourceName, { url: item.url, count: 1 })
  }

  const stop = async (): Promise<void> => {
    if (!storyId) return
    await window.meerkat?.stories?.setStatus({ id: storyId, status: 'archived' })
    setStopped(true)
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-paper">
      <header className="sticky top-0 z-10 border-b border-rule bg-paper/95 px-6 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-[1100px] items-center gap-3">
          <button onClick={() => setData(null)} className="shrink-0 text-[11.5px] text-ink-2 hover:text-ink">
            ← 返回
          </button>
          <div className="min-w-0">
            <div className="truncate text-[15px] font-bold leading-tight text-ink">{timeline.title}</div>
            <div className="mt-0.5 text-[10.5px] tabular-nums text-ink-3">
              {timeline.range.from} → {timeline.range.to} · {phases.length} 个节点 · {reportCount} 篇报道
            </div>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {(tracking || stopped) && storyId && (
              <span className={['text-[10.5px]', stopped ? 'text-ink-3' : 'font-medium text-accent'].join(' ')}>
                {stopped ? '已停止跟踪' : '● 跟踪中'}
              </span>
            )}
            {tracking && !stopped && storyId && (
              <button onClick={() => void stop()} className="text-[10.5px] text-ink-3 hover:text-alert hover:underline">
                停止跟踪
              </button>
            )}
            <button
              onClick={() => setData(null)}
              aria-label="关闭时间线"
              className="ml-2 grid h-6 w-6 place-items-center rounded-md text-[12px] text-ink-3 hover:bg-cream hover:text-ink"
            >
              ✕
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1100px] gap-8 px-6 py-7 lg:grid-cols-[minmax(0,1fr)_280px]">
        <main className="min-w-0">
          {now && (
            <div className="rounded-xl bg-accent-soft px-4 py-3 text-[12.5px] leading-relaxed text-[#3730a3]">
              <span className="font-semibold">现在：</span>
              {now}
            </div>
          )}
          {timeline.summary && (
            <p className="mt-3 text-[12px] leading-7 text-ink-2">{timeline.summary}</p>
          )}
          {timeline.note && <p className="mt-1 text-[11px] text-ink-3">{timeline.note}</p>}

          <ol className="mt-5">
            {phases.map((p, i) => (
              <li key={`${p.date}-${i}`} className="relative pb-6 pl-6">
                <span className="absolute left-0 top-[7px] h-2 w-2 rounded-full bg-accent" />
                {i < phases.length - 1 && <span className="absolute bottom-0 left-[3.5px] top-[17px] w-px bg-rule" />}
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-[11px] tabular-nums text-ink-3">{p.date}</span>
                  <span className="text-[14px] font-semibold text-ink">{p.headline}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  {p.confidence === 'multi-source' && (
                    <span className="rounded bg-[#f5f3ff] px-1.5 py-0.5 text-[9.5px] text-[#6d28d9]">多来源</span>
                  )}
                  {p.status === 'rumor' && (
                    <span className="rounded bg-alert/10 px-1.5 py-0.5 text-[9.5px] text-alert">未证实</span>
                  )}
                  {p.status === 'confirmed' && (
                    <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[9.5px] text-emerald-700">已确认</span>
                  )}
                  <span className="text-[9.5px] text-ink-3">
                    {p.status === 'reported' ? '报道' : p.status === 'confirmed' ? '已确认' : '未证实'}
                  </span>
                </div>
                {p.detail && <p className="mt-1.5 text-[12.5px] leading-7 text-ink-2">{p.detail}</p>}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {[...new Map(
                    p.sourceItemIds
                      .map((id) => byId.get(id))
                      .filter((x): x is NonNullable<typeof x> => Boolean(x))
                      .map((src) => [src.sourceName, src] as const)
                  ).values()].map((src) => (
                    <a
                      key={src.id}
                      href={src.url}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-md border border-rule bg-white px-2 py-0.5 text-[10px] text-ink-3 hover:border-accent hover:text-accent"
                    >
                      {src.sourceName}
                    </a>
                  ))}
                </div>
              </li>
            ))}
          </ol>

          {timeline.gaps.length > 0 && (
            <div className="rounded-lg border border-dashed border-rule px-3 py-2 text-[11px] text-ink-3">
              <span className="font-medium text-ink-2">时间线缺口：</span>
              {timeline.gaps.join('；')}
            </div>
          )}

          {timeline.openQuestions.length > 0 && (
            <section className="mt-4 rounded-xl border border-rule bg-white px-4 py-3">
              <div className="text-[11.5px] font-semibold text-ink-2">待确认 {timeline.openQuestions.length} 项</div>
              <ul className="mt-2 space-y-1.5 text-[11.5px] leading-relaxed text-ink-2">
                {timeline.openQuestions.map((q, i) => (
                  <li key={i}>· {q}</li>
                ))}
              </ul>
            </section>
          )}
        </main>

        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <section className="rounded-xl border border-rule bg-white px-4 py-3">
            <div className="text-[10px] font-semibold tracking-[0.08em] text-ink-3">事件信息</div>
            <dl className="mt-2 space-y-1.5 text-[11px]">
              <div className="flex justify-between gap-2">
                <dt className="text-ink-3">范围</dt>
                <dd className="tabular-nums text-ink-2">
                  {timeline.range.from} → {timeline.range.to}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-ink-3">节点</dt>
                <dd className="text-ink-2">{phases.length}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-ink-3">报道</dt>
                <dd className="text-ink-2">{reportCount}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-ink-3">生成</dt>
                <dd className="text-ink-2">{timeline.mode === 'agent' ? 'Agent 整理' : '按日期整理'}</dd>
              </div>
            </dl>
          </section>

          <section className="rounded-xl border border-rule bg-white px-4 py-3">
            <div className="text-[10px] font-semibold tracking-[0.08em] text-ink-3">来源</div>
            <ul className="mt-2 space-y-1.5">
              {[...outlets.entries()].map(([name, o]) => (
                <li key={name} className="flex items-center gap-2 text-[11px]">
                  <a href={o.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-ink-2 hover:text-accent">
                    {name}
                  </a>
                  <span className="shrink-0 text-[10px] tabular-nums text-ink-3">×{o.count}</span>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  )
}
