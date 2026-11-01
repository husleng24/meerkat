import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ParsedBrief } from '../lib/parseBrief'
import type { BriefComparison } from '../lib/compareBriefs'
import type { FlagsApi } from '../lib/useFlags'
import { ItemCard } from './ItemCard'
import { CompareStrip } from './CompareStrip'

interface Props {
  brief: ParsedBrief
  flags: FlagsApi
  /** 与上一期的对比；没有上一期时为 null */
  comparison: BriefComparison | null
  previousDate: string
  /** 立即采集并重新生成；入口在报头右侧，不藏在设置里 */
  onRefresh?: () => void
  refreshing?: boolean
  /** 当前领域名：显示在标题上方，说明这一页属于哪个作用域 */
  topicName?: string
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

function dateLine(raw: string | undefined): string {
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(raw ?? '')
  const w = /[（(](周[一二三四五六日])[)）]/.exec(raw ?? '')
  if (!m) return raw ?? ''
  const base = `${m[1]}年${Number(m[2])}月${Number(m[3])}日`
  return w ? `${base} ${w[1]}` : base
}

/**
 * 简报阅读视图（Lumen）。
 *
 * 结构：标题行 → 三句话卡 → 板块卡片流 → 今日一句，全部悬浮在冷白底上。
 * 光只出现在两处：页面顶部的极淡光晕、以及"今日一句"卡片里的靛蓝辉光。
 *
 * 键盘模型：j/k 上下、s 收藏、o 打开、m 已读、h 隐藏、g/G 首尾。
 */
export function BriefView({
  brief,
  flags,
  comparison,
  previousDate,
  onRefresh,
  refreshing = false,
  topicName
}: Props): React.JSX.Element {
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

  const meta = readMeta(brief.meta)

  return (
    <div ref={listRef} className="mx-auto max-w-[780px] px-9 pb-24 pt-8">
      <header className="mb-5 flex items-start justify-between gap-4">
        <div>
          {topicName && (
            <span className="mb-1.5 inline-flex rounded-full bg-accent-soft px-2.5 py-0.5 text-[10.5px] font-medium text-accent">
              {topicName}
            </span>
          )}
          <h1 className="text-[22px] font-bold leading-tight tracking-[-0.03em] text-ink">今日简报</h1>
          <p className="mt-1.5 text-[11.5px] text-ink-3">
            {dateLine(brief.title)}
            {meta.windowHours ? ` · 覆盖最近 ${meta.windowHours} 小时` : ''}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {onRefresh && (
            <button
              onClick={onRefresh}
              disabled={refreshing}
              title="立即采集并重新生成今天的简报（约 1–2 分钟）"
              className="rounded-full border border-rule px-2.5 py-1 text-[11px] text-ink-2 transition-colors hover:border-accent hover:text-ink disabled:opacity-50"
            >
              {refreshing ? '更新中…' : '更新'}
            </button>
          )}
          {(meta.sources !== undefined || meta.picked !== undefined) && (
            <span className="rounded-full bg-accent-soft px-2.5 py-1 text-[11px] font-semibold text-accent">
              {meta.sources !== undefined ? `${meta.sources} 源` : ''}
              {meta.sources !== undefined && meta.picked !== undefined ? ' · ' : ''}
              {meta.picked !== undefined ? `${meta.picked} 条` : ''}
            </span>
          )}
        </div>
      </header>

      {comparison && (
        <CompareStrip comparison={comparison} previousDate={previousDate} onJump={(key) => scrollTo(key)} />
      )}

      {brief.highlights.length > 0 && (
        <section className="card px-[22px] py-1">
          {brief.highlights.map((h, i) => (
            <div key={i} className="flex gap-4 border-t border-rule py-[15px] first:border-t-0">
              <span className="w-[26px] shrink-0 pt-px text-[17px] font-extrabold leading-[1.35] tabular-nums tracking-[-0.02em] text-accent">
                {i + 1}
              </span>
              <span className="max-w-[62ch] text-[14.5px] leading-[1.7] tracking-[-0.008em] text-ink">{h}</span>
            </div>
          ))}
        </section>
      )}

      {brief.sections.map((section) => {
        const visible = section.items.filter((i) => !flags.of(flags.idOf(i.key)).isHidden).length
        return (
          <section key={section.heading} className="mt-6">
            <h2 className="mb-2.5 flex items-center gap-2 pl-0.5 text-[13px] font-bold text-ink">
              {section.heading.replace(/^[\u2460-\u2473]\s*/, '')}
              <span className="text-[11px] font-medium tabular-nums text-ink-3">{visible}</span>
            </h2>
            <div className="flex flex-col gap-2.5">
              {section.items.map((item, idx) => {
                const globalIndex = allItems.findIndex((i) => i.key === item.key)
                const id = flags.idOf(item.key)
                const f = flags.of(id)
                return (
                  <div
                    key={item.key}
                    className="rise"
                    style={{ animationDelay: `${Math.min(globalIndex, 12) * 40}ms` }}
                  >
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

      {brief.punchline && (
        <section className="relative mt-6 overflow-hidden rounded-2xl bg-[linear-gradient(135deg,#111827,#1f2937)] px-6 py-5">
          <div className="pointer-events-none absolute -right-12 -top-12 h-48 w-48 rounded-full bg-[radial-gradient(circle,rgba(99,102,241,0.5),transparent_70%)]" />
          <div className="relative">
            <div className="mb-2 text-[10.5px] font-semibold tracking-[0.18em] text-[#9ca3af]">今日一句</div>
            <p className="max-w-[58ch] text-[15.5px] font-semibold leading-[1.75] tracking-[-0.01em] text-[#f3f4f6]">
              {brief.punchline}
            </p>
          </div>
        </section>
      )}

      <div className="mt-5 flex items-center gap-2 text-[11px] text-ink-3">
        <Kbd>?</Kbd>
        <span>查看全部快捷键</span>
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
