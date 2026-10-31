import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ParsedBrief } from '../lib/parseBrief'
import type { FlagsApi } from '../lib/useFlags'
import { ItemCard } from './ItemCard'

interface Props {
  brief: ParsedBrief
  flags: FlagsApi
}

/**
 * 简报阅读视图。
 *
 * 键盘模型照抄 vim/邮件客户端：j/k 上下、s 收藏、o 打开、h 隐藏、g/G 首尾。
 * 之所以值得做：这份东西的设计目标是"5 分钟读完"，用鼠标滚轮逐条扫是最大的损耗。
 *
 * 状态不再存在组件里——已读/收藏/隐藏都走 flags（持久化到数据库），
 * 否则关掉窗口再打开就全丢，等于没做。
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

  return (
    <div ref={listRef} className="mx-auto max-w-[760px] px-10 pb-24 pt-8">
      {/* 速览：给"只看三行"的人 */}
      {brief.highlights.length > 0 && (
        <section className="mb-8 rounded-2xl border border-cream bg-white/70 px-6 py-5">
          <h2 className="mb-3 text-[11px] font-bold uppercase tracking-[0.16em] text-caramel">三句话速览</h2>
          <ol className="space-y-2.5">
            {brief.highlights.map((h, i) => (
              <li key={i} className="flex gap-3 text-[13.5px] leading-6 text-ink/90">
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-ink text-[11px] font-semibold text-paper">
                  {i + 1}
                </span>
                <span>{h}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* 板块与条目 */}
      {brief.sections.map((section, si) => {
        const visible = section.items.filter((i) => !flags.of(flags.idOf(i.key)).isHidden).length
        return (
          <section key={section.heading} className="mb-9">
            <div className="mb-3 flex items-baseline gap-3">
              <h2 className="text-[13px] font-bold tracking-wide text-ink">{section.heading}</h2>
              <span className="text-[11px] tabular-nums text-caramel/70">{visible}</span>
              <span className="h-px flex-1 bg-cream" />
            </div>
            <div className="space-y-3">
              {section.items.map((item) => {
                const globalIndex = allItems.findIndex((i) => i.key === item.key)
                const id = flags.idOf(item.key)
                const f = flags.of(id)
                return (
                  <ItemCard
                    key={item.key}
                    item={item}
                    index={globalIndex}
                    selected={globalIndex === cursor}
                    saved={f.isSaved}
                    hidden={f.isHidden}
                    read={f.isRead}
                    onSelect={() => setCursor(globalIndex)}
                    onToggleSave={() => flags.toggle(id, 'isSaved')}
                    onToggleHide={() => flags.toggle(id, 'isHidden')}
                    onOpen={() => openFirstLink(item.key)}
                  />
                )
              })}
            </div>
            {si === brief.sections.length - 1 && <div className="h-2" />}
          </section>
        )
      })}

      {/* 今日一句 */}
      {brief.punchline && (
        <section className="mt-10 rounded-2xl bg-ink px-6 py-6 text-paper">
          <h2 className="mb-2 text-[11px] font-bold uppercase tracking-[0.16em] text-paper/50">今日一句</h2>
          <p className="text-[15px] font-medium leading-7">{brief.punchline}</p>
        </section>
      )}

      {/* 键盘提示 */}
      <div className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-caramel/80">
        <span>
          <Kbd>j</Kbd>/<Kbd>k</Kbd> 上下
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
    <kbd className="rounded border border-cream bg-white px-1.5 py-0.5 font-mono text-[10px] text-ink/70">
      {children}
    </kbd>
  )
}
