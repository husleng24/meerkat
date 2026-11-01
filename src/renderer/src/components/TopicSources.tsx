import { useCallback, useEffect, useMemo, useState } from 'react'
import { BUCKETS, BUCKET_LABEL, type Bucket, type Source } from '../../../core/domain/types'
import type { SourceRecommendationPayload } from '../lib/ipc-types'

/**
 * 「本主题的源」。
 *
 * 源是全局的（健康度、失败计数都按源算），但**进不进这个主题**是按主题算的——
 * 同一个 OpenAI 博客可以同时出现在「AI 综合」和「开发者工具」里，
 * 而一个 GPU 资讯源可能只该进「芯片与算力」。
 *
 * 每次勾选立即落库：这里没有"保存"按钮，因为漏点保存导致的"我明明勾了"
 * 是这类界面最典型的投诉。
 */
export function TopicSources({ topicId, topicName }: { topicId: string; topicName: string }): React.JSX.Element {
  const [sources, setSources] = useState<Source[]>([])
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [note, setNote] = useState('')
  const [available, setAvailable] = useState(true)
  const [recs, setRecs] = useState<SourceRecommendationPayload[]>([])

  // 推荐只算"还没进这个主题"的源；加进去之后从列表里移除，避免重复点
  const loadRecs = useCallback(async (): Promise<void> => {
    const api = window.meerkat?.sources
    if (!api?.recommend) return
    const list = await api.recommend({ topicId, limit: 6 })
    setRecs(list)
  }, [topicId])

  useEffect(() => {
    void loadRecs()
  }, [loadRecs])

  useEffect(() => {
    const api = window.meerkat
    if (!api?.sources || !api.topics) {
      setAvailable(false)
      return
    }
    let cancelled = false
    void Promise.all([api.sources.list(), api.topics.sourceIds(topicId)])
      .then(([all, ids]) => {
        if (cancelled) return
        setSources(all as Source[])
        setPicked(new Set(ids))
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [topicId])

  const grouped = useMemo(() => {
    const byBucket = new Map<string, Source[]>()
    for (const s of sources) {
      const list = byBucket.get(s.bucketHint) ?? []
      list.push(s)
      byBucket.set(s.bucketHint, list)
    }
    // 按简报里的板块顺序排，而不是字典序——用户在简报里已经熟悉这个顺序
    const order = new Map(BUCKETS.map((b, i) => [b as string, i]))
    return [...byBucket.entries()].sort((a, b) => (order.get(a[0]) ?? 99) - (order.get(b[0]) ?? 99))
  }, [sources])

  const apply = useCallback(
    async (next: Set<string>) => {
      setPicked(next)
      const api = window.meerkat?.topics
      if (!api) return
      const res = await api.setSources({ topicId, sourceIds: [...next] })
      setNote(res.ok ? `已更新：本领域 ${next.size} 个源` : (res.error ?? '保存失败'))
    },
    [topicId]
  )

  const toggle = (id: string): void => {
    const next = new Set(picked)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    void apply(next)
  }

  const addRecommended = (id: string): void => {
    const next = new Set(picked)
    next.add(id)
    setRecs((cur) => cur.filter((r) => r.id !== id))
    void apply(next)
  }

  const addAllRecommended = (): void => {
    const next = new Set(picked)
    for (const r of recs) next.add(r.id)
    setRecs([])
    void apply(next)
  }

  if (!available) {
    return <p className="text-[12px] text-ink-3">预览模式下不可用：需要在桌面应用内运行。</p>
  }

  return (
    <div>
      <div className="mb-2.5 flex items-center gap-3 text-[11.5px] text-ink-3">
        <span>
          已选 <span className="font-semibold tabular-nums text-ink">{picked.size}</span> / {sources.length}
        </span>
        <button
          onClick={() => void apply(new Set(sources.map((s) => s.id)))}
          className="text-accent hover:underline"
        >
          全选
        </button>
        <button onClick={() => void apply(new Set())} className="text-accent hover:underline">
          全不选
        </button>
        {note && <span className="ml-auto text-ink-3">{note}</span>}
      </div>

      {sources.length > 0 && picked.size === sources.length && (
        <p className="mb-2.5 text-[11px] text-ink-3">
          已选全部 {sources.length} 个源。新主题默认全选；只想关注某几类时，取消勾选即可。
        </p>
      )}

      {recs.length > 0 && (
        <div className="mb-2.5 rounded-lg border border-accent/25 bg-accent-soft/40 px-3 py-2">
          <div className="mb-1 flex items-center gap-2 text-[11px] text-ink-3">
            <span>
              ✨ 按「{topicName}」推荐（{recs.length} 个还没加入）
            </span>
            <button onClick={addAllRecommended} className="ml-auto text-accent hover:underline">
              全部加入
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {recs.map((r) => (
              <button
                key={r.id}
                onClick={() => addRecommended(r.id)}
                title={r.reason}
                className="rounded-full border border-accent/30 bg-white px-2 py-0.5 text-[11px] text-accent transition-colors hover:bg-accent-soft"
              >
                ＋ {r.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="card max-h-[300px] overflow-y-auto px-4 py-3">
        {grouped.map(([bucket, list]) => (
          <div key={bucket} className="mb-3 last:mb-0">
            <div className="mb-1 text-[10.5px] font-semibold tracking-[0.06em] text-ink-3">
              {BUCKET_LABEL[bucket as Bucket] ?? bucket}
            </div>
            <div className="grid grid-cols-2 gap-x-4">
              {list.map((s) => (
                <label
                  key={s.id}
                  className="flex cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 text-[12px] text-ink-2 hover:bg-cream"
                >
                  <input
                    type="checkbox"
                    checked={picked.has(s.id)}
                    onChange={() => toggle(s.id)}
                    className="accent-[#4f46e5]"
                  />
                  <span className="truncate">{s.name}</span>
                </label>
              ))}
            </div>
          </div>
        ))}
        {sources.length === 0 && <p className="text-[12px] text-ink-3">还没有源</p>}
      </div>
    </div>
  )
}
