import { useState } from 'react'
import type { BriefComparison, CompareEntry } from '../lib/compareBriefs'

interface Props {
  comparison: BriefComparison
  /** 上一期的日期，形如 2026-10-29 */
  previousDate: string
  /** 点了今天这期里的条目就滚过去——对比的意义是"看完整的" */
  onJump: (key: string) => void
}

/** 每组最多铺这么多条；再多就折叠成一行，否则一条里塞 20 条没人看 */
const MAX_PER_GROUP = 8

/** 2026-10-29 → 10-29 */
function shortDate(date: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(date)
  return m ? `${m[1]}-${m[2]}` : date
}

/**
 * 「和昨天比」条。
 *
 * 默认收起：这条只是索引，展开才是内容。数字放在收起态，
 * 因为用户多数时候只需要知道"今天有没有新东西"，不需要看清单。
 */
export function CompareStrip({ comparison, previousDate, onJump }: Props): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  const { added, carried, dropped, todayTotal, yesterdayTotal } = comparison

  // 上一期是空的（首期或模型没选出内容）→ 没有可比对象，整条不出现
  if (yesterdayTotal === 0) return null

  return (
    <section className="card mb-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-[22px] py-3 text-left"
      >
        <span className="text-[11px] font-semibold tracking-[0.12em] text-ink-3">
          和 {shortDate(previousDate)} 比
        </span>
        <Chip label="新增" value={added.length} tone="accent" />
        <Chip label="有进展" value={carried.length} tone="plain" />
        <Chip label="没再提" value={dropped.length} tone="muted" />
        <span className="ml-auto shrink-0 text-[11px] text-ink-3">{open ? '收起' : '展开'}</span>
      </button>

      {open && (
        <div className="border-t border-rule px-[22px] py-3">
          <p className="mb-3 text-[11px] leading-relaxed text-ink-3">
            今天 {todayTotal} 条 · 上一期 {yesterdayTotal} 条。判定沿用跨天去重的口径：链接相同或标题高度相似即视为同一件事。
          </p>

          <Group title="今天新出现" entries={added} onJump={onJump} />
          <Group title="上一期提过，今天还在讲" entries={carried} onJump={onJump} previousOf={(e) => e.previousTitle} />
          <Group title="上一期提过，今天没再提" entries={dropped} tone="muted" />
        </div>
      )}
    </section>
  )
}

function Chip({
  label,
  value,
  tone
}: {
  label: string
  value: number
  tone: 'accent' | 'plain' | 'muted'
}): React.JSX.Element {
  const cls =
    tone === 'accent' && value > 0
      ? 'bg-accent-soft text-accent'
      : tone === 'muted'
        ? 'bg-cream text-ink-3'
        : 'bg-cream text-ink-2'
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${cls}`}>
      {label} {value}
    </span>
  )
}

function Group<T extends CompareEntry>({
  title,
  entries,
  onJump,
  previousOf,
  tone
}: {
  title: string
  entries: T[]
  onJump?: (key: string) => void
  previousOf?: (e: T) => string
  tone?: 'muted'
}): React.JSX.Element | null {
  if (entries.length === 0) return null
  return (
    <div className="mb-3 last:mb-0">
      <h3 className="mb-1 pl-2.5 text-[11px] font-semibold tracking-[0.08em] text-ink-3">{title}</h3>
      <ul>
        {entries.slice(0, MAX_PER_GROUP).map((e) => {
          const prevTitle = previousOf ? previousOf(e) : ''
          const body = (
            <>
              <span className={`block text-[12.5px] leading-[1.6] ${tone === 'muted' ? 'text-ink-3' : 'text-ink'}`}>
                {e.title}
              </span>
              {prevTitle && prevTitle !== e.title && (
                <span className="mt-0.5 block text-[11px] leading-[1.5] text-ink-3">上一期写的是「{prevTitle}」</span>
              )}
            </>
          )
          return (
            <li key={e.key}>
              {onJump ? (
                <button
                  type="button"
                  onClick={() => onJump(e.key)}
                  className="flex w-full items-baseline gap-2 rounded-lg px-2.5 py-1 text-left hover:bg-cream"
                >
                  <span className="shrink-0 text-[10px] text-ink-3">{e.section}</span>
                  <span className="min-w-0 flex-1">{body}</span>
                </button>
              ) : (
                <div className="flex items-baseline gap-2 px-2.5 py-1">
                  <span className="shrink-0 text-[10px] text-ink-3">{e.section}</span>
                  <span className="min-w-0 flex-1">{body}</span>
                </div>
              )}
            </li>
          )
        })}
        {entries.length > MAX_PER_GROUP && (
          <li className="px-2.5 py-1 text-[11px] text-ink-3">还有 {entries.length - MAX_PER_GROUP} 条没列</li>
        )}
      </ul>
    </div>
  )
}
