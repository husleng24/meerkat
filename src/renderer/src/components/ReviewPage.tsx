import { useEffect, useMemo, useState } from 'react'
import type { DecisionRecentPayload } from '../lib/ipc-types'

interface BriefRow {
  date: string
  model: string
  noChange?: boolean
  linkCheck: string
  chars: number
  createdAt: number
}

/**
 * 周回顾：不是再生成一份摘要，而是把过去 7 天写过的判断摆出来。
 *
 * 这一页只做事实聚合，不调用模型；判断本身是用户写的，产品只负责提醒回看。
 */
export function ReviewPage({ onGoToday }: { onGoToday: () => void }): React.JSX.Element {
  const [decisions, setDecisions] = useState<DecisionRecentPayload[] | null>(null)
  const [briefs, setBriefs] = useState<BriefRow[]>([])

  useEffect(() => {
    const api = window.meerkat?.decisions
    const briefApi = window.meerkat?.briefList
    let cancelled = false
    if (!api) {
      setDecisions([])
      return
    }
    void api
      .recent(7)
      .then((rows) => {
        if (!cancelled) setDecisions(rows)
      })
      .catch(() => setDecisions([]))
    if (briefApi) {
      void briefApi().then((rows) => {
        if (!cancelled) {
          const since = new Date(Date.now() - 7 * 86_400_000).toLocaleDateString('sv-SE', {
            timeZone: 'Asia/Shanghai'
          })
          setBriefs(rows.filter((b) => b.date >= since))
        }
      })
    }
    return () => {
      cancelled = true
    }
  }, [])

  const stats = useMemo(() => {
    const dates = new Set((decisions ?? []).map((d) => new Date(d.updatedAt).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })))
    return {
      decisions: decisions?.length ?? 0,
      days: dates.size,
      briefs: briefs.length,
      noChange: briefs.filter((b) => b.noChange).length
    }
  }, [decisions, briefs])

  if (decisions === null) {
    return <div className="px-10 py-16 text-[13px] text-ink-3">加载中…</div>
  }

  return (
    <div className="mx-auto max-w-[860px] px-8 pb-24 pt-7">
      <header className="mb-5">
        <h1 className="text-[22px] font-bold tracking-[-0.03em] text-ink">周回顾</h1>
        <p className="mt-1 text-[12px] text-ink-3">
          过去 7 天你写下的判断，以及这周简报里真正发生了什么。不是再读一遍新闻，是回看自己的判断。
        </p>
      </header>

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ['判断', stats.decisions],
          ['有判断的天数', stats.days],
          ['简报', stats.briefs],
          ['无变化', stats.noChange]
        ].map(([label, value]) => (
          <div key={label} className="card px-4 py-3">
            <p className="text-[10.5px] text-ink-3">{label}</p>
            <p className="mt-1 text-[20px] font-semibold tabular-nums text-ink">{value}</p>
          </div>
        ))}
      </div>

      {decisions.length === 0 ? (
        <div className="card grid min-h-[240px] place-items-center px-6 py-10 text-center">
          <div>
            <p className="text-[13px] font-medium text-ink">这周还没有判断记录</p>
            <p className="mt-2 max-w-[44ch] text-[11.5px] leading-relaxed text-ink-3">
              在今天的内容下面点「＋ 记下我的判断」，写一句“这件事会改变什么”。下周这里就会出现可回看的东西。
            </p>
            <button onClick={onGoToday} className="mt-4 rounded-lg border border-cream px-3 py-1.5 text-[12px] text-ink-2 hover:border-accent">
              回到今日简报
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2.5">
          {decisions.map((d) => (
            <article key={d.itemId} className="card px-5 py-4">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                {d.url ? (
                  <a href={d.url} target="_blank" rel="noreferrer" className="text-[13px] font-semibold text-ink hover:text-accent hover:underline">
                    {d.title || '未命名内容'}
                  </a>
                ) : (
                  <span className="text-[13px] font-semibold text-ink">{d.title || '未命名内容'}</span>
                )}
                <span className="text-[10.5px] text-ink-3">
                  {d.sourceName ? `${d.sourceName} · ` : ''}
                  {new Date(d.updatedAt).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })}
                </span>
              </div>
              <p className="mt-2 whitespace-pre-wrap border-l-2 border-accent/30 pl-3 text-[13px] leading-6 text-ink-2">
                {d.note}
              </p>
            </article>
          ))}
        </div>
      )}

      <p className="mt-4 text-[10.5px] text-ink-3">只显示本机记录；不出设备。</p>
    </div>
  )
}
