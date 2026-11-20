import { useEffect, useMemo, useState } from 'react'
import type { EntityEvent, EventDetailPayload } from '../lib/ipc-types'

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

function day(ts: number): string {
  return new Date(ts).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })
}

/** 独立事件页：一组同实体、同类型、时间相邻的覆盖 + 事件级判断 + 条目级判断。 */
export function EventPage({
  entityId,
  eventKey,
  topicId,
  onBack
}: {
  entityId: string
  eventKey: string
  topicId?: string
  onBack: () => void
}): React.JSX.Element {
  const [detail, setDetail] = useState<EventDetailPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [selectedItems, setSelectedItems] = useState<string[]>([])
  const [splitting, setSplitting] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void window.meerkat?.events
      ?.get({ entityId, key: eventKey })
      .then((r) => {
        if (!cancelled) setDetail(r)
      })
      .catch(() => setDetail(null))
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [entityId, eventKey])

  const decisions = useMemo(() => {
    const map = new Map<string, string>()
    for (const d of detail?.decisions ?? []) map.set(d.itemId, d.note)
    return map
  }, [detail])

  const groups = useMemo(() => {
    const map = new Map<string, NonNullable<typeof detail>['items']>()
    for (const item of detail?.items ?? []) map.set(day(item.at), [...(map.get(day(item.at)) ?? []), item])
    return [...map.entries()]
  }, [detail])

  const saveNote = async (): Promise<void> => {
    const note = draft.trim()
    if (!note) {
      setError('写一句判断')
      return
    }
    const r = await window.meerkat?.events?.noteSave({ eventKey, note })
    if (!r?.ok) {
      setError(r?.error ?? '保存失败')
      return
    }
    setDetail((prev) => (prev ? { ...prev, note: r.note ?? null } : prev))
    setEditing(false)
    setError('')
  }

  const split = async (): Promise<void> => {
    if (selectedItems.length === 0) return
    const r = await window.meerkat?.events?.split({ entityId, key: eventKey, itemIds: selectedItems })
    if (!r?.ok) {
      setMsg(r?.error ?? '拆分失败')
      return
    }
    onBack()
  }

  const toStory = async (): Promise<void> => {
    const r = await window.meerkat?.events?.toStory({ entityId, key: eventKey, ...(topicId ? { topicId } : {}) })
    setMsg(r?.ok ? '已转为跟踪，可在「跟踪」页查看' : (r?.error ?? '转换失败'))
  }

  const deleteManual = async (): Promise<void> => {
    const r = await window.meerkat?.events?.deleteManual(eventKey)
    if (r?.ok) onBack()
    else setMsg(r?.error ?? '操作失败')
  }

  if (loading) return <div className="px-10 py-16 text-[13px] text-ink-3">加载中…</div>
  if (!detail) {
    return (
      <div className="px-10 py-10">
        <button onClick={onBack} className="text-[11px] text-ink-3 hover:text-accent">
          ← 返回实体
        </button>
        <p className="mt-6 text-[13px] text-ink-3">这个事件已经不在当前索引里了。回到实体页重建索引即可。</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[860px] px-8 pb-24 pt-7">
      <button onClick={onBack} className="mb-4 text-[11px] text-ink-3 hover:text-accent">
        ← 返回实体
      </button>
      <header className="border-b border-rule pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded px-2 py-0.5 text-[10px] ${EVENT_STYLE[detail.event]}`}>{EVENT_LABEL[detail.event]}</span>
          <span className="text-[11px] text-ink-3">
            {day(detail.earliestAt)} – {day(detail.latestAt)} · {detail.items.length} 条 · {detail.sourceCount} 个来源
          </span>
        </div>
        <h1 className="mt-2 text-[24px] font-bold leading-tight tracking-[-0.03em] text-ink">{detail.title}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button onClick={() => void toStory()} className="rounded-full border border-cream px-2.5 py-1 text-[10.5px] text-ink-2 hover:border-accent">
            转为跟踪
          </button>
          <button
            onClick={() => {
              setSplitting((v) => !v)
              setSelectedItems([])
            }}
            className={`rounded-full border px-2.5 py-1 text-[10.5px] ${splitting ? 'border-accent bg-accent-soft text-accent' : 'border-cream text-ink-2 hover:border-accent'}`}
          >
            {splitting ? '取消拆分' : '拆分事件'}
          </button>
          {detail.manual && (
            <button onClick={() => void deleteManual()} className="rounded-full border border-cream px-2.5 py-1 text-[10.5px] text-ink-3 hover:border-alert hover:text-alert">
              恢复自动事件
            </button>
          )}
          {msg && <span className="text-[10.5px] text-ink-3">{msg}</span>}
        </div>
      </header>

      {splitting && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-accent/25 bg-accent-soft px-3 py-2 text-[11px] text-ink-2">
          <span>勾选要拆出去的内容（{selectedItems.length} 条）</span>
          <button
            onClick={() => void split()}
            disabled={selectedItems.length === 0}
            className="rounded bg-ink px-2.5 py-1 text-[10.5px] text-paper disabled:opacity-40"
          >
            拆分为新事件
          </button>
        </div>
      )}

      <section className="card mt-4 px-5 py-4">
        <div className="flex items-center justify-between">
          <h2 className="text-[12px] font-semibold text-ink">这件事的判断</h2>
          {!editing && (
            <button
              onClick={() => {
                setDraft(detail.note?.note ?? '')
                setEditing(true)
              }}
              className="text-[10.5px] text-ink-3 hover:text-accent"
            >
              {detail.note ? '编辑' : '写判断'}
            </button>
          )}
        </div>
        {editing ? (
          <div className="mt-2">
            <textarea
              autoFocus
              rows={3}
              maxLength={2000}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="这件事会改变什么？我准备做什么？什么信号说明我判断错了？"
              className="w-full resize-y rounded-lg border border-accent/40 bg-white px-3 py-2 text-[12px] leading-relaxed outline-none"
            />
            <div className="mt-1.5 flex items-center gap-2">
              <button onClick={() => void saveNote()} className="rounded bg-ink px-2.5 py-1 text-[10.5px] text-paper">
                保存
              </button>
              <button onClick={() => setEditing(false)} className="text-[10.5px] text-ink-3 hover:text-ink">
                取消
              </button>
              {detail.note && (
                <button
                  onClick={() => {
                    void window.meerkat?.events?.noteRemove(eventKey).then(() => {
                      setDetail((prev) => (prev ? { ...prev, note: null } : prev))
                      setEditing(false)
                    })
                  }}
                  className="ml-auto text-[10.5px] text-ink-3 hover:text-alert"
                >
                  删除
                </button>
              )}
              {error && <span className="text-[10.5px] text-alert">{error}</span>}
            </div>
          </div>
        ) : detail.note ? (
          <p className="mt-2 whitespace-pre-wrap border-l-2 border-accent/30 pl-3 text-[12.5px] leading-6 text-ink-2">
            {detail.note.note}
          </p>
        ) : (
          <p className="mt-2 text-[11px] text-ink-3">还没有判断。把“这件事对我的影响”写下来，周回顾里也能看到。</p>
        )}
      </section>

      <div className="mt-5 space-y-5">
        {groups.map(([date, list]) => (
          <section key={date}>
            <h3 className="mb-2 text-[11px] font-semibold text-ink-3">{date}</h3>
            <div className="space-y-2">
              {list.map((item) => (
                <article key={item.id} className="card px-4 py-3">
                  <div className="flex items-start gap-2">
                    {splitting && (
                      <input
                        type="checkbox"
                        checked={selectedItems.includes(item.id)}
                        onChange={(e) =>
                          setSelectedItems((prev) => (e.target.checked ? [...prev, item.id] : prev.filter((id) => id !== item.id)))
                        }
                        aria-label="选择要拆出的内容"
                        className="mt-1"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[13px] font-semibold leading-5 text-ink hover:text-accent hover:underline"
                      >
                        {item.title}
                      </a>
                      <p className="mt-1 text-[10.5px] text-ink-3">{item.sourceName}</p>
                      {item.summary && <p className="mt-1.5 line-clamp-2 text-[11.5px] leading-5 text-ink-2">{item.summary}</p>}
                      {decisions.has(item.id) && (
                        <p className="mt-2 whitespace-pre-wrap border-l-2 border-accent/30 pl-3 text-[11px] leading-5 text-ink-2">
                          <span className="mr-1 font-medium text-accent">我的判断</span>
                          {decisions.get(item.id)}
                        </p>
                      )}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
