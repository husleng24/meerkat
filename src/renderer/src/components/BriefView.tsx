import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ParsedBrief } from '../lib/parseBrief'
import type { FlagsApi } from '../lib/useFlags'
import { ItemCard } from './ItemCard'

interface Props {
  brief: ParsedBrief
  flags: FlagsApi
}

/** "2026-10-30" → { day: "10月30日", iso: "2026-10-30" } */
function splitDate(raw: string | undefined): { day: string; iso: string } {
  if (!raw) return { day: '', iso: '' }
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(raw)
  if (!m) return { day: raw, iso: raw }
  return { day: `${Number(m[2])}月${Number(m[3])}日`, iso: `${m[1]}-${m[2]}-${m[3]}` }
}

/** 从简报的元信息行里抠数字：覆盖最近 48 小时 · 34 个信息源 · 精选 24 条 */
function readMeta(meta: string): { windowHours?: number; sources?: number; picked?: number } {
  const out: { windowHours?: number; sources?: number; picked?: number } = {}
  const w = /(\d+)\s*小时/.exec(meta)
  const s = /(\d+)\s*个信息源/.exec(meta)
  const p = /精选\s*(\d+)\s*条/.exec(meta)
  if (w) out.windowHours = Number(w[1])
  if (s) out.sources = Number(s[1])
  if (p) out.picked = Number(p[1])
  return out
}

/**
 * 简报阅读视图。
 *
 * 结构是报纸，不是卡片墙：报头 → 三句话 → 板块 → 今日一句。
 * 节奏靠分隔线与留白，唯一的重色块留给"今日一句"，作为整页的落点。
 *
 * 键盘模型照旧：j/k 上下、s 收藏、o 打开、m 已读、h 隐藏、g/G 首尾。
 */
export function BriefView({ brief, flags }: Props): React.JSX.Element {
  const allItems = useMemo(() => brief.sections.flatMap((s) => s.items), [brief])
  const [cursor, setCursor] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const scrollTo = useCallback((key: string) => {
    document.getElementById(`item-${key}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [])

  const openFirstLink = useCallback(
    (key: string) => {
      const it = allItems.find((i) => i.key === key)
      const url = it?.links[0]?.url
      if (url) window.open(url, '_blank', 'noopener,noreferrer')
      flags.markRead(flags.idOf(key))
    },
    [allItems, flags]
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      const current = allItems[cursor]
      if (!current) return

      switch (e.key) {
        case 'j': {
          e.preventDefault()
          const n = Math.min(cursor + 1, allItems.length - 1)
          setCursor(n)
          scrollTo(allItems[n]!.key)
          break
        }
        case 'k': {
          e.preventDefault()
          const n = Math.max(cursor - 1, 0)
          setCursor(n)
          scrollTo(allItems[n]!.key)
          break
        }
        case 'g':
          setCursor(0)
          scrollTo(allItems[0]!.key)
          break
        case 'G':
          setCursor(allItems.length - 1)
          scrollTo(allItems[allItems.length - 1]!.key)
          break
        case 's':
          flags.toggle(flags.idOf(current.key), 'isSaved')
          break
        case 'o':
          openFirstLink(current.key)
          break
        case 'h':
          flags.toggle(flags.idOf(current.key), 'isHidden')
          break
        case 'm':
          flags.toggle(flags.idOf(current.key), 'isRead')
          break
        default:
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [allItems, cursor, scrollTo, flags, openFirstLink])

  const { day, iso } = splitDate(brief.title)
  const weekday = /[（(](周[一二三四五六日])[)）]/.exec(brief.title)?.[1] ?? ''
  const meta = readMeta(brief.meta)

  return (
    <div ref={listRef} className="relative mx-auto max-w-[780px] px-10 pb-24 pt-9">

      {/* 报头 */}
      <header className="relative">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-[34px] font-extrabold leading-none tracking-[-0.04em] text-ink">
              {day || '今日'}
              {weekday && (
                <span className="ml-2 align-baseline text-[15px] font-medium tracking-normal text-ink-3">
                  {weekday}
                </span>
              )}
            </h1>
            <p className="mt-2 text-[11px] tracking-[0.16em] text-ink-3">
              {iso || '—'}
              {meta.windowHours ? ` · 覆盖 ${meta.windowHours} 小时` : ''}
            </p>
          </div>
          <div className="pb-1 text-right text-[10.5px] leading-[1.9] tracking-[0.14em] text-ink-3">
            {meta.picked !== undefined && <div className="tabular-nums">{meta.picked} 条</div>}
            {meta.sources !== undefined && <div className="tabular-nums">{meta.sources} 源</div>}
          </div>
        </div>
        <div className="masthead-rule mt-3" />
      </header>

      {/* 三句话速览 */}
      {brief.highlights.length > 0 && (
        <section className="relative mt-7">
          <h2 className="text-[11px] font-bold tracking-[0.22em] text-accent">三句话速览</h2>
          <ol className="mt-2.5">
            {brief.highlights.map((h, i) => (
              <li
                key={i}
                className="flex gap-3.5 border-t border-rule py-3 text-[17px] leading-[1.68] tracking-[-0.012em] text-ink last:border-b"
              >
                <span className="pt-1.5 text-[11.5px] font-bold tabular-nums text-accent/80">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className="max-w-[62ch]">{h}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* 板块与条目 */}
      {brief.sections.map((section) => {
        const visible = section.items.filter((i) => !flags.of(flags.idOf(i.key)).isHidden).length
        return (
          <section key={section.heading} className="relative mt-9">
            <h2 className="flex items-baseline gap-2.5 border-t-2 border-ink pt-2 text-[14px] font-bold tracking-[-0.01em] text-ink">
              {section.heading.replace(/^[\u2460-\u2473]\s*/, '')}
              <span className="text-[11px] font-bold tabular-nums text-accent/80">{visible}</span>
              <span className="h-px flex-1 bg-rule" />
            </h2>
            <div>
              {section.items.map((item, idx) => {
                const globalIndex = allItems.findIndex((i) => i.key === item.key)
                const id = flags.idOf(item.key)
                const f = flags.of(id)
                return (
                  <div key={item.key} className="rise border-b border-rule" style={{ animationDelay: `${Math.min(globalIndex, 12) * 40}ms` }}>
                    <ItemCard
                      item={item}
                      selected={globalIndex === cursor}
                      saved={f.isSaved}
                      hidden={f.isHidden}
                      read={f.isRead}
                      lead={idx === 0}
                      onSelect={() => setCursor(globalIndex)}
                      onToggleSave={() => flags.toggle(id, 'isSaved')}
                      onToggleHide={() => flags.toggle(id, 'isHidden')}
                      onOpen={() => openFirstLink(item.key)}
                    />
                  </div>
                )
              })}
            </div>
          </section>
        )
      })}

      {/* 今日一句：整页唯一的重色块，作为落点 */}
      {brief.punchline && (
        <section className="relative mt-10 bg-ink px-7 py-6">
          <div className="mb-2.5 text-[10px] font-bold tracking-[0.24em] text-accent">今日一句</div>
          <p className="max-w-[56ch] text-[17px] font-semibold leading-[1.72] tracking-[-0.012em] text-paper">
            {brief.punchline}
          </p>
        </section>
      )}

      {/* 键盘提示 */}
      <div className="relative mt-6 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-3">
        <span>
          <Kbd>j</Kbd>
          <Kbd>k</Kbd> 上下
        </span>
        <span>
          <Kbd>s</Kbd> 收藏
        </span>
        <span>
          <Kbd>o</Kbd> 打开
        </span>
        <span>
          <Kbd>m</Kbd> 已读
        </span>
        <span>
          <Kbd>h</Kbd> 隐藏
        </span>
        <span className="ml-auto tabular-nums">
          已读 {flags.counts.read} / {allItems.length} · 收藏 {flags.counts.saved}
        </span>
      </div>
    </div>
  )
}

function Kbd({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <kbd className="mr-0.5 rounded border border-rule bg-white px-1.5 py-0.5 font-mono text-[10px] text-ink-2">
      {children}
    </kbd>
  )
}
