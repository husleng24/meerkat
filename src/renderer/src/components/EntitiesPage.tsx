import { useEffect, useMemo, useState } from 'react'
import type { EntityEvent, EntityPayload, EntityTimelinePayload } from '../lib/ipc-types'

const KIND_LABEL: Record<EntityPayload['kind'], string> = {
  company: '公司',
  person: '人物',
  org: '机构',
  technology: '技术'
}

const EVENT_LABEL: Record<EntityEvent, string> = {
  funding: '融资',
  product: '产品',
  layoff: '裁员',
  regulation: '监管',
  security: '安全',
  research: '研究',
  partnership: '合作',
  other: '其他'
}

const EVENT_STYLE: Record<EntityEvent, string> = {
  funding: 'bg-emerald-50 text-emerald-700',
  product: 'bg-blue-50 text-blue-700',
  layoff: 'bg-red-50 text-red-700',
  regulation: 'bg-amber-50 text-amber-700',
  security: 'bg-rose-50 text-rose-700',
  research: 'bg-violet-50 text-violet-700',
  partnership: 'bg-cyan-50 text-cyan-700',
  other: 'bg-cream text-ink-2'
}

function day(ts: number | undefined): string {
  return ts ? new Date(ts).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }) : '时间未知'
}

/** 实体页：把「一条条内容」按公司/人物重新聚合，再按事件类型切开。 */
export function EntitiesPage(): React.JSX.Element {
  const [entities, setEntities] = useState<EntityPayload[] | null>(null)
  const [selected, setSelected] = useState('')
  const [timeline, setTimeline] = useState<EntityTimelinePayload | null>(null)
  const [query, setQuery] = useState('')
  const [eventFilter, setEventFilter] = useState<EntityEvent | 'all'>('all')
  const [loadingItems, setLoadingItems] = useState(false)

  const load = async (): Promise<void> => {
    const api = window.meerkat?.entities
    if (!api) {
      setEntities([])
      return
    }
    const rows = await api.list()
    setEntities(rows)
    setSelected((prev) => prev || rows[0]?.id || '')
  }

  useEffect(() => {
    void load()
  }, [])

  useEffect(() => {
    if (!selected) {
      setTimeline(null)
      return
    }
    let cancelled = false
    setLoadingItems(true)
    setEventFilter('all')
    void window.meerkat?.entities
      ?.timeline({ id: selected, limit: 150 })
      .then((r) => {
        if (!cancelled) setTimeline(r)
      })
      .catch(() => setTimeline(null))
      .finally(() => {
        if (!cancelled) setLoadingItems(false)
      })
    return () => {
      cancelled = true
    }
  }, [selected])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return entities ?? []
    return (entities ?? []).filter(
      (e) => e.name.toLowerCase().includes(q) || e.aliases.some((a) => a.toLowerCase().includes(q))
    )
  }, [entities, query])

  const current = (entities ?? []).find((e) => e.id === selected)
  const items = useMemo(() => {
    const all = timeline?.items ?? []
    return eventFilter === 'all' ? all : all.filter((i) => i.event === eventFilter)
  }, [timeline, eventFilter])

  const grouped = useMemo(() => {
    const map = new Map<string, typeof items>()
    for (const item of items) {
      const key = day(item.at)
      map.set(key, [...(map.get(key) ?? []), item])
    }
    return [...map.entries()]
  }, [items])

  const period = timeline?.period
  const delta = period ? period.current - period.previous : 0

  if (entities === null) return <div className="px-10 py-16 text-[13px] text-ink-3">加载中…</div>

  return (
    <div className="mx-auto flex max-w-[1100px] gap-5 px-8 pb-24 pt-7">
      <aside className="w-[250px] shrink-0">
        <div className="mb-3">
          <h1 className="text-[20px] font-bold tracking-[-0.03em] text-ink">实体</h1>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-3">
            公司、人物与内容的关系。基于本地词表匹配，不靠模型编造。
          </p>
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索公司 / 人物"
          className="mb-2 w-full rounded-lg border border-cream bg-white px-3 py-1.5 text-[11.5px] outline-none focus:border-accent"
        />
        <div className="max-h-[calc(100vh-220px)] space-y-1 overflow-y-auto pr-1">
          {filtered.map((e) => (
            <button
              key={e.id}
              onClick={() => setSelected(e.id)}
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors ${
                e.id === selected ? 'bg-accent-soft text-ink' : 'text-ink-2 hover:bg-cream/60'
              }`}
            >
              <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">{e.name}</span>
              <span className="text-[10px] tabular-nums text-ink-3">{e.count}</span>
            </button>
          ))}
          {filtered.length === 0 && <p className="px-2 py-3 text-[11px] text-ink-3">没有匹配的实体</p>}
        </div>
        <button
          onClick={() => {
            void window.meerkat?.entities?.rebuild().then(() => void load())
          }}
          className="mt-2 text-[10.5px] text-ink-3 hover:text-accent"
        >
          重建索引
        </button>
      </aside>

      <main className="min-w-0 flex-1">
        {current ? (
          <>
            <header className="mb-3 border-b border-rule pb-4">
              <div className="flex flex-wrap items-baseline gap-2">
                <h2 className="text-[26px] font-bold tracking-[-0.03em] text-ink">{current.name}</h2>
                <span className="rounded-full bg-cream px-2 py-0.5 text-[10px] text-ink-2">{KIND_LABEL[current.kind]}</span>
                <span className="text-[11px] text-ink-3">{current.count} 条相关</span>
              </div>
              <p className="mt-1 text-[11px] text-ink-3">
                别名：{current.aliases.join('、')}
                {current.latestAt ? ` · 最近 ${day(current.latestAt)}` : ''}
              </p>
            </header>

            {period && (
              <div className="mb-4 grid grid-cols-3 gap-2">
                <div className="card px-3 py-2.5">
                  <p className="text-[10px] text-ink-3">本周</p>
                  <p className="mt-0.5 text-[19px] font-semibold tabular-nums text-ink">{period.current}</p>
                </div>
                <div className="card px-3 py-2.5">
                  <p className="text-[10px] text-ink-3">上周</p>
                  <p className="mt-0.5 text-[19px] font-semibold tabular-nums text-ink">{period.previous}</p>
                </div>
                <div className="card px-3 py-2.5">
                  <p className="text-[10px] text-ink-3">变化</p>
                  <p className={`mt-0.5 text-[19px] font-semibold tabular-nums ${delta > 0 ? 'text-accent' : delta < 0 ? 'text-ink-3' : 'text-ink'}`}>
                    {delta > 0 ? '+' : ''}
                    {delta}
                  </p>
                </div>
              </div>
            )}

            <div className="mb-4 flex flex-wrap gap-1.5">
              <button
                onClick={() => setEventFilter('all')}
                className={`rounded-full px-2.5 py-1 text-[10.5px] ${eventFilter === 'all' ? 'bg-ink text-paper' : 'bg-cream text-ink-2 hover:bg-cream/70'}`}
              >
                全部
              </button>
              {(Object.keys(EVENT_LABEL) as EntityEvent[]).map((event) => {
                const n = period?.currentByEvent[event] ?? 0
                return (
                  <button
                    key={event}
                    onClick={() => setEventFilter(event)}
                    className={`rounded-full px-2.5 py-1 text-[10.5px] ${eventFilter === event ? 'bg-ink text-paper' : 'bg-cream text-ink-2 hover:bg-cream/70'}`}
                  >
                    {EVENT_LABEL[event]}
                    {n > 0 ? ` ${n}` : ''}
                  </button>
                )
              })}
            </div>

            {loadingItems ? (
              <p className="py-10 text-[12px] text-ink-3">加载中…</p>
            ) : grouped.length === 0 ? (
              <div className="card px-5 py-8 text-center text-[12px] text-ink-3">
                这个筛选下还没有内容。换一个事件类型，或点「重建索引」。
              </div>
            ) : (
              <div className="space-y-5">
                {grouped.map(([date, list]) => (
                  <section key={date}>
                    <h3 className="mb-2 text-[11px] font-semibold text-ink-3">{date}</h3>
                    <div className="space-y-2">
                      {list.map((item) => (
                        <article key={item.id} className="card px-4 py-3">
                          <div className="flex items-start gap-2">
                            <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[9.5px] ${EVENT_STYLE[item.event]}`}>
                              {EVENT_LABEL[item.event]}
                            </span>
                            <a
                              href={item.url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[13px] font-semibold leading-5 text-ink hover:text-accent hover:underline"
                            >
                              {item.title}
                            </a>
                          </div>
                          <p className="mt-1 text-[10.5px] text-ink-3">{item.sourceName}</p>
                          {item.summary && <p className="mt-1.5 line-clamp-2 text-[11.5px] leading-5 text-ink-2">{item.summary}</p>}
                        </article>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="card px-5 py-10 text-center text-[12px] text-ink-3">选择一个实体查看它的内容时间线。</div>
        )}
      </main>
    </div>
  )
}
