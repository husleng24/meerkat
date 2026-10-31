import { useEffect, useMemo, useRef, useState } from 'react'
import { BUCKETS, BUCKET_LABEL, type Bucket } from '../../../core/domain/types'
import type { SearchHit } from '../lib/ipc-types'

type SortKey = 'score' | 'time'

const DAY_OPTIONS: Array<{ days?: number; label: string }> = [
  { label: '全部时间' },
  { days: 7, label: '最近 7 天' },
  { days: 30, label: '最近 30 天' }
]

/**
 * 全文检索。
 *
 * 后端是 SQLite FTS5 + trigram（中文子串也能命中），这一层负责三件后端不该管的事：
 * 把筛选条件拼成查询、把命中词高亮出来、以及"搜不到时知道该改哪个条件"。
 *
 * 筛选刻意都放在服务端（SQL WHERE）而不是取回来再过滤：
 * limit 是 50，先截断再筛会得到"明明有却不显示"的假空结果。
 */
export function SearchPage(): React.JSX.Element {
  // 支持 #search/<关键词> 深链，顺便让验收脚本能截到"有结果的搜索页"
  const initial = (() => {
    if (typeof location === 'undefined') return ''
    const part = location.hash.slice(1).split('/')[1]
    return part ? decodeURIComponent(part) : ''
  })()
  const [q, setQ] = useState(initial)
  const [bucket, setBucket] = useState<'' | Bucket>('')
  const [sourceId, setSourceId] = useState('')
  const [days, setDays] = useState<number | undefined>(undefined)
  const [sort, setSort] = useState<SortKey>('score')
  const [hits, setHits] = useState<SearchHit[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [sources, setSources] = useState<Array<{ id: string; name: string }>>([])
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // 来源下拉：只在应用内有意义，浏览器预览里拿不到
  useEffect(() => {
    const api = window.meerkat?.sources
    if (!api) return
    void api.list().then((list) => {
      setSources(list.map((s) => ({ id: s.id, name: s.name })).sort((a, b) => a.name.localeCompare(b.name)))
    })
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
        .search({
          q: term,
          ...(bucket ? { bucket } : {}),
          ...(sourceId ? { sourceId } : {}),
          ...(days !== undefined ? { days } : {}),
          sort
        })
        .then((r) => setHits(r))
        .catch(() => setHits([]))
        .finally(() => setBusy(false))
    }, 250)
    return () => {
      clearTimeout(timer)
      setBusy(false)
    }
  }, [q, bucket, sourceId, days, sort])

  const hint = useMemo(() => ['Gemini', '推理成本', 'agent', '开源权重'], [])
  const filtered = bucket !== '' || sourceId !== '' || days !== undefined
  const reset = (): void => {
    setBucket('')
    setSourceId('')
    setDays(undefined)
  }

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

      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11.5px]">
        <Select
          value={bucket}
          onChange={(v) => setBucket(v as '' | Bucket)}
          options={[{ value: '', label: '全部板块' }, ...BUCKETS.map((b) => ({ value: b, label: BUCKET_LABEL[b] }))]}
        />
        <Select
          value={sourceId}
          onChange={setSourceId}
          options={[{ value: '', label: '全部来源' }, ...sources.map((s) => ({ value: s.id, label: s.name }))]}
        />
        {DAY_OPTIONS.map((o) => (
          <button
            key={o.label}
            onClick={() => setDays(o.days)}
            className={[
              'rounded-full border px-2.5 py-1 transition-colors',
              days === o.days ? 'border-accent bg-accent-soft text-accent' : 'border-rule text-ink-2 hover:border-accent'
            ].join(' ')}
          >
            {o.label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1 rounded-full border border-rule p-0.5">
          {(['score', 'time'] as const).map((k) => (
            <button
              key={k}
              onClick={() => setSort(k)}
              className={[
                'rounded-full px-2.5 py-0.5 transition-colors',
                sort === k ? 'bg-accent-soft font-semibold text-accent' : 'text-ink-2 hover:text-ink'
              ].join(' ')}
            >
              {k === 'score' ? '相关度' : '最新'}
            </button>
          ))}
        </div>
        {filtered && (
          <button onClick={reset} className="text-ink-3 underline-offset-2 hover:text-ink hover:underline">
            清除筛选
          </button>
        )}
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
          <div className="mb-2 flex items-baseline gap-2 text-[11.5px] text-ink-3">
            <span>{hits.length === 0 ? '没有匹配的条目' : `${hits.length} 条结果`}</span>
            {filtered && hits.length === 0 && (
              <button onClick={reset} className="text-accent hover:underline">
                放宽筛选试试
              </button>
            )}
            <span className="ml-auto">按{sort === 'score' ? '相关度' : '发布时间'}排序</span>
          </div>
          <div className="space-y-2">
            {hits.map((h) => (
              <button
                key={h.id}
                onClick={() => window.open(h.url, '_blank', 'noopener,noreferrer')}
                className="block w-full card px-4 py-3 text-left transition-colors hover:border-accent hover:bg-white"
              >
                <div className="flex items-baseline gap-2">
                  <span className="flex-1 text-[13.5px] font-medium leading-6 text-ink">
                    <Highlight text={h.title} term={q.trim()} />
                  </span>
                  <span className="shrink-0 text-[10.5px] text-ink-3">{fmtDate(h.publishedAt)}</span>
                </div>
                {h.summary && (
                  <p className="mt-1 line-clamp-2 text-[12px] leading-5 text-ink/60">
                    <Highlight text={h.summary} term={q.trim()} />
                  </p>
                )}
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

/** 命中词高亮。只做大小写无关的子串匹配，不做分词——查询串是什么就标什么 */
function Highlight({ text, term }: { text: string; term: string }): React.JSX.Element {
  if (!term) return <>{text}</>
  const lower = text.toLowerCase()
  const needle = term.toLowerCase()
  const parts: React.ReactNode[] = []
  let at = 0
  for (;;) {
    const i = lower.indexOf(needle, at)
    if (i < 0) break
    if (i > at) parts.push(text.slice(at, i))
    parts.push(
      <mark key={i} className="rounded-sm bg-accent-soft px-0.5 text-accent">
        {text.slice(i, i + term.length)}
      </mark>
    )
    at = i + term.length
  }
  if (at < text.length) parts.push(text.slice(at))
  return <>{parts}</>
}

function Select({
  value,
  onChange,
  options
}: {
  value: string
  onChange: (v: string) => void
  options: Array<{ value: string; label: string }>
}): React.JSX.Element {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-full border border-rule bg-white px-2.5 py-1 text-[11.5px] text-ink-2 outline-none focus:border-accent"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

function fmtDate(ts?: number): string {
  if (ts === undefined) return ''
  const d = new Date(ts)
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
