import { useEffect, useMemo, useState } from 'react'

interface Props {
  current: string
  onOpen: (date: string) => void
  /** 只列这个主题的历史；不传就是全部 */
  topicId?: string
}

interface Row {
  date: string
  model: string
  noChange?: boolean
  linkCheck: string
  chars: number
  summary: string
  createdAt: number
}

/**
 * 历史简报：按日期回看每一期。
 * 只做一件事——让你翻得回前几天的简报。全文检索留到以后（数据层已支持 FTS5）。
 */
export function TimelinePage({ current, onOpen, topicId }: Props): React.JSX.Element {
  const [rows, setRows] = useState<Row[] | null>(null)

  useEffect(() => {
    let cancelled = false
    const api = window.meerkat?.briefList
    if (!api) {
      setRows([])
      return
    }
    void api(topicId)
      .then((list) => {
        if (!cancelled) setRows(list)
      })
      .catch(() => setRows([]))
    return () => {
      cancelled = true
    }
  }, [topicId])

  const weekday = useMemo(() => {
    const map = ['日', '一', '二', '三', '四', '五', '六']
    return (date: string): string => {
      const d = new Date(`${date}T12:00:00`)
      return Number.isNaN(d.getTime()) ? '' : `周${map[d.getDay()]}`
    }
  }, [])

  if (rows === null) {
    return <div className="px-10 py-16 text-[13px] text-ink-3">加载中…</div>
  }

  if (rows.length === 0) {
    return (
      <div className="grid place-items-center px-10 py-24 text-center">
        <div className="max-w-sm">
          <div className="mb-2 text-[13px] font-semibold text-ink">还没有历史简报</div>
          <p className="text-[12px] leading-6 text-ink-3">
            在「设置」页点一次「立即采集」，或在排程时间到点后自动生成。
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[760px] px-10 pb-24 pt-8">
      <p className="mb-4 text-[12px] text-ink-3">共 {rows.length} 期，点任意一期回看。</p>

      <div className="overflow-hidden card">
        {rows.map((r) => {
          const isCurrent = r.date === current
          const degraded = r.model === 'none'
          const [good, total] = (r.linkCheck || '').split('/').map((x) => Number(x))
          const broken = Number.isFinite(good) && Number.isFinite(total) ? total - good : 0
          return (
            <button
              key={r.date}
              onClick={() => onOpen(r.date)}
              className={[
                'block w-full border-b border-cream/70 px-4 py-3.5 text-left last:border-b-0 transition-colors',
                isCurrent ? 'bg-white' : 'hover:bg-white/70'
              ].join(' ')}
            >
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-semibold tabular-nums text-ink">{r.date}</span>
                <span className="text-[11px] text-ink-3">{weekday(r.date)}</span>
                {isCurrent && <span className="text-[10.5px] text-ink-3">当前</span>}
                <span className="ml-auto flex items-center gap-1.5">
                  {broken > 0 && (
                    <span className="rounded bg-alert/10 px-1.5 py-0.5 text-[10px] text-alert">{broken} 个链接失效</span>
                  )}
                  {r.noChange ? (
                    <span className="rounded bg-cream px-1.5 py-0.5 text-[10px] text-ink-3">无变化</span>
                  ) : degraded ? (
                    <span className="rounded bg-alert/10 px-1.5 py-0.5 text-[10px] text-alert">降级</span>
                  ) : (
                    <span className="rounded bg-cream px-1.5 py-0.5 text-[10px] text-ink/60">{r.model}</span>
                  )}
                </span>
              </div>
              <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-ink-2">
                {r.summary || '这一期没有可展示的摘要。'}
              </p>
            </button>
          )
        })}
      </div>
    </div>
  )
}
