import { useEffect, useMemo, useRef, useState } from 'react'
import { BUCKET_LABEL, type Bucket } from '../../../core/domain/types'
import type { SearchHit } from '../lib/ipc-types'

/**
 * 全文检索。
 *
 * 后端早就好了（SQLite FTS5 + trigram 分词，中文子串也能命中），
 * 缺的只是这个入口。所以这里刻意不做花哨的东西：
 * 一个输入框、一份结果、点开原文。
 */
export function SearchPage(): React.JSX.Element {
  // 支持 #search/<关键词> 深链，顺便让验收脚本能截到"有结果的搜索页"
  const initial = (() => {
    if (typeof location === 'undefined') return ''
    const part = location.hash.slice(1).split('/')[1]
    return part ? decodeURIComponent(part) : ''
  })()
  const [q, setQ] = useState(initial)
  const [hits, setHits] = useState<SearchHit[] | null>(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // 防抖 250ms：中文输入法组字期间不该每敲一下就查一次
  useEffect(() => {
    const term = q.trim()
    if (term.length === 0) {
      setHits(null)
      return
    }
    const api = window.meerkat?.items
    if (!api) {
      setHits([])
      return
    }
    setBusy(true)
    const timer = setTimeout(() => {
      void api
        .search(term)
        .then((r) => setHits(r))
        .catch(() => setHits([]))
        .finally(() => setBusy(false))
    }, 250)
    return () => {
      clearTimeout(timer)
      setBusy(false)
    }
  }, [q])

  const hint = useMemo(() => ['Gemini', '推理成本', 'agent', '开源权重'], [])

  return (
    <div className="mx-auto max-w-[760px] px-10 pb-24 pt-8">
      <div className="relative">
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜索抓到的所有条目（支持中文子串）"
          className="w-full card px-4 py-3 text-[14px] text-ink outline-none placeholder:text-ink-3/60 focus:border-accent"
        />
        {busy && <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[11px] text-ink-3">搜索中…</span>}
      </div>

      {hits === null && (
        <div className="mt-4 flex flex-wrap items-center gap-2 text-[11.5px] text-ink-3">
          <span>试试：</span>
          {hint.map((h) => (
            <button
              key={h}
              onClick={() => setQ(h)}
              className="rounded-full border border-cream px-2.5 py-1 transition-colors hover:border-accent hover:text-ink"
            >
              {h}
            </button>
          ))}
        </div>
      )}

      {hits !== null && (
        <div className="mt-5">
          <div className="mb-2 text-[11.5px] text-ink-3">
            {hits.length === 0 ? '没有匹配的条目' : `${hits.length} 条结果`}
          </div>
          <div className="space-y-2">
            {hits.map((h) => (
              <button
                key={h.id}
                onClick={() => window.open(h.url, '_blank', 'noopener,noreferrer')}
                className="block w-full card px-4 py-3 text-left transition-colors hover:border-accent hover:bg-white"
              >
                <div className="flex items-baseline gap-2">
                  <span className="flex-1 text-[13.5px] font-medium leading-6 text-ink">{h.title}</span>
                  <span className="shrink-0 text-[10.5px] text-ink-3">{fmtDate(h.publishedAt)}</span>
                </div>
                {h.summary && <p className="mt-1 line-clamp-2 text-[12px] leading-5 text-ink/60">{h.summary}</p>}
                <div className="mt-1.5 flex items-center gap-2 text-[10.5px] text-ink-3/80">
                  <span className="rounded bg-cream px-1.5 py-0.5">{BUCKET_LABEL[h.bucket as Bucket] ?? h.bucket}</span>
                  <span>{h.sourceName}</span>
                  <span className="ml-auto tabular-nums">{h.score.toFixed(1)}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {!window.meerkat?.items && (
        <p className="mt-6 text-[11px] text-ink-3/70">预览模式下不可用：需要在桌面应用内运行。</p>
      )}
    </div>
  )
}

function fmtDate(ts?: number): string {
  if (ts === undefined) return ''
  const d = new Date(ts)
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
