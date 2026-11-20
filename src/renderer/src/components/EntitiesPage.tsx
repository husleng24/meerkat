import { useEffect, useMemo, useState } from 'react'
import type { EntityEvent, EntityInputPayload, EntityPayload, EntityTimelinePayload, EventClusterPayload } from '../lib/ipc-types'
import { EventPage } from './EventPage'

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

interface EditorState {
  id?: string
  name: string
  kind: EntityPayload['kind']
  aliases: string
}

function day(ts: number | undefined): string {
  return ts ? new Date(ts).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }) : '时间未知'
}

/** 实体页：公司/人物档案、事件卡、事件页入口、手动维护实体。 */
export function EntitiesPage({ topicId }: { topicId?: string }): React.JSX.Element {
  const [entities, setEntities] = useState<EntityPayload[] | null>(null)
  const [selected, setSelected] = useState('')
  const [timeline, setTimeline] = useState<EntityTimelinePayload | null>(null)
  const [events, setEvents] = useState<EventClusterPayload[]>([])
  const [eventKey, setEventKey] = useState('')
  const [selectedEvents, setSelectedEvents] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [eventFilter, setEventFilter] = useState<EntityEvent | 'all'>('all')
  const [loadingItems, setLoadingItems] = useState(false)
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [editorError, setEditorError] = useState('')

  const load = async (pick?: string): Promise<void> => {
    const api = window.meerkat?.entities
    if (!api) {
      setEntities([])
      return
    }
    const rows = await api.list()
    setEntities(rows)
    setSelected((prev) => pick ?? (prev && rows.some((r) => r.id === prev) ? prev : rows[0]?.id || ''))
  }

  useEffect(() => {
    void load()
  }, [])

  useEffect(() => {
    if (!selected) {
      setTimeline(null)
      setEvents([])
      return
    }
    let cancelled = false
    setLoadingItems(true)
    setEventFilter('all')
    setEventKey('')
    setSelectedEvents([])
    void Promise.all([
      window.meerkat?.entities?.timeline({ id: selected, limit: 150 }),
      window.meerkat?.events?.list({ entityId: selected })
    ])
      .then(([t, e]) => {
        if (cancelled) return
        setTimeline(t ?? null)
        setEvents(e ?? [])
      })
      .catch(() => {
        if (!cancelled) {
          setTimeline(null)
          setEvents([])
        }
      })
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

  const saveEntity = async (): Promise<void> => {
    const api = window.meerkat?.entities
    if (!api || !editor) return
    const input: EntityInputPayload = {
      name: editor.name,
      kind: editor.kind,
      aliases: editor.aliases
        .split(/[,，、\n]/)
        .map((a) => a.trim())
        .filter(Boolean)
    }
    const r = editor.id ? await api.update({ ...input, id: editor.id }) : await api.create(input)
    if (!r.ok || !r.entity) {
      setEditorError(r.error ?? '保存失败')
      return
    }
    const id = (r.entity as EntityPayload).id
    setEditor(null)
    setEditorError('')
    await load(id)
  }

  const removeEntity = async (): Promise<void> => {
    if (!current || !window.confirm(`删除实体「${current.name}」？相关判断仍会保留。`)) return
    const r = await window.meerkat?.entities?.remove(current.id)
    if (!r?.ok) return
    setSelected('')
    await load()
  }

  const mergeEvents = async (): Promise<void> => {
    if (selectedEvents.length < 2) return
    const r = await window.meerkat?.events?.merge({ entityId: selected, keys: selectedEvents })
    if (!r?.ok || !r.key) return
    setSelectedEvents([])
    setEventKey(r.key)
  }

  if (eventKey && selected) {
    return (
      <EventPage
        entityId={selected}
        eventKey={eventKey}
        topicId={topicId}
        onBack={() => {
          setEventKey('')
          void window.meerkat?.events?.list({ entityId: selected }).then((rows) => setEvents(rows ?? []))
        }}
      />
    )
  }
  if (entities === null) return <div className="px-10 py-16 text-[13px] text-ink-3">加载中…</div>

  const period = timeline?.period
  const delta = period ? period.current - period.previous : 0

  return (
    <div className="mx-auto flex max-w-[1100px] gap-5 px-8 pb-24 pt-7">
      <aside className="w-[250px] shrink-0">
        <div className="mb-3">
          <h1 className="text-[20px] font-bold tracking-[-0.03em] text-ink">实体</h1>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-3">
            公司、人物与内容的关系。基于本地词表匹配，不靠模型编造。
          </p>
        </div>
        <button
          onClick={() => {
            setEditorError('')
            setEditor({ name: '', kind: 'company', aliases: '' })
          }}
          className="mb-2 w-full rounded-lg border border-cream px-3 py-1.5 text-[11px] text-ink-2 hover:border-accent"
        >
          ＋ 新增实体
        </button>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索公司 / 人物"
          className="mb-2 w-full rounded-lg border border-cream bg-white px-3 py-1.5 text-[11.5px] outline-none focus:border-accent"
        />
        <div className="max-h-[calc(100vh-280px)] space-y-1 overflow-y-auto pr-1">
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
                <span className="ml-auto flex gap-2 text-[10.5px]">
                  <button
                    onClick={() => {
                      setEditorError('')
                      setEditor({ id: current.id, name: current.name, kind: current.kind, aliases: current.aliases.join('、') })
                    }}
                    className="text-ink-3 hover:text-accent"
                  >
                    编辑
                  </button>
                  <button onClick={() => void removeEntity()} className="text-ink-3 hover:text-alert">
                    删除
                  </button>
                </span>
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

            {events.length > 0 && (
              <section className="mb-4">
                <div className="mb-2 flex items-center gap-2">
                  <h3 className="text-[11px] font-semibold text-ink-3">事件</h3>
                  {selectedEvents.length >= 2 && (
                    <button
                      onClick={() => void mergeEvents()}
                      className="rounded-full bg-ink px-2.5 py-1 text-[10px] text-paper"
                    >
                      合并所选 {selectedEvents.length} 个
                    </button>
                  )}
                </div>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {events.slice(0, 8).map((e) => (
                    <div
                      key={e.key}
                      onClick={() => setEventKey(e.key)}
                      className={`card cursor-pointer px-3 py-2 text-left transition-colors hover:border-accent/40 ${
                        selectedEvents.includes(e.key) ? 'border-accent/60 bg-accent-soft/40' : ''
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={selectedEvents.includes(e.key)}
                          onClick={(ev) => ev.stopPropagation()}
                          onChange={(ev) =>
                            setSelectedEvents((prev) =>
                              ev.target.checked ? [...prev, e.key] : prev.filter((k) => k !== e.key)
                            )
                          }
                          aria-label="选择事件用于合并"
                        />
                        <span className={`rounded px-1.5 py-0.5 text-[9px] ${EVENT_STYLE[e.event]}`}>{EVENT_LABEL[e.event]}</span>
                        {e.manual && <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[9px] text-accent">手动</span>}
                        <span className="text-[9.5px] text-ink-3">
                          {day(e.earliestAt)} · {e.items.length} 条 · {e.sourceCount} 来源
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-[11.5px] font-medium leading-4 text-ink">{e.title}</p>
                    </div>
                  ))}
                </div>
              </section>
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

      {editor && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/20 px-4" onClick={() => setEditor(null)}>
          <div className="w-full max-w-[420px] rounded-2xl bg-paper p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-[15px] font-semibold text-ink">{editor.id ? '编辑实体' : '新增实体'}</h2>
            <label className="mt-3 block text-[10.5px] text-ink-3">
              名称
              <input
                autoFocus
                value={editor.name}
                onChange={(e) => setEditor({ ...editor, name: e.target.value })}
                className="mt-1 w-full rounded-lg border border-cream bg-white px-3 py-1.5 text-[12px] text-ink outline-none focus:border-accent"
              />
            </label>
            <label className="mt-2 block text-[10.5px] text-ink-3">
              类型
              <select
                value={editor.kind}
                onChange={(e) => setEditor({ ...editor, kind: e.target.value as EntityPayload['kind'] })}
                className="mt-1 w-full rounded-lg border border-cream bg-white px-3 py-1.5 text-[12px] text-ink outline-none focus:border-accent"
              >
                <option value="company">公司</option>
                <option value="person">人物</option>
                <option value="org">机构</option>
                <option value="technology">技术</option>
              </select>
            </label>
            <label className="mt-2 block text-[10.5px] text-ink-3">
              别名（用逗号分隔）
              <input
                value={editor.aliases}
                onChange={(e) => setEditor({ ...editor, aliases: e.target.value })}
                placeholder="例如 GPT-6.2、ChatGPT"
                className="mt-1 w-full rounded-lg border border-cream bg-white px-3 py-1.5 text-[12px] text-ink outline-none focus:border-accent"
              />
            </label>
            {editorError && <p className="mt-2 text-[10.5px] text-alert">{editorError}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setEditor(null)} className="rounded-lg border border-cream px-3 py-1.5 text-[11px] text-ink-2">
                取消
              </button>
              <button onClick={() => void saveEntity()} className="rounded-lg bg-ink px-3 py-1.5 text-[11px] text-paper">
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
