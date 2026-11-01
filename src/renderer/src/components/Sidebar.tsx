import { useEffect, useRef, useState } from 'react'
import type { TopicPayload } from '../lib/ipc-types'

interface Props {
  active: string
  topics: TopicPayload[]
  activeTopic: string
  onPickTopic: (id: string) => void
  topicsAvailable: boolean
  /** 就地新建领域；返回新领域 id 或 null */
  onCreateTopic?: (input: { id: string; name: string }) => Promise<string | null>
  onNavigate: (id: string) => void
  itemCount: number
  savedCount: number
  readCount: number
  /** 需关注的源（连续失败 + 不稳定），与源页同一个口径 */
  attentionSources: number
  origin: 'ipc' | 'sample'
  bridgeAvailable: boolean
  dateLabel: string
}

const NAV = [
  { id: 'today', label: '今日', hint: '' },
  { id: 'search', label: '搜索', hint: '' },
  { id: 'timeline', label: '时间线', hint: '' },
  { id: 'sources', label: '源', hint: 'warn' },
  { id: 'settings', label: '设置', hint: '' }
]

/**
 * 左侧导航。
 *
 * 领域是**作用域**（决定今日/时间线看哪一份数据），和导航不是同一层：
 * 所以它是一行切换器（常驻显示当前值），点开才是列表——而不是第二排导航。
 * 位置遵循 Slack / Multica 的习惯：左上角。
 */
export function Sidebar({
  active,
  topics,
  activeTopic,
  onPickTopic,
  topicsAvailable,
  onCreateTopic,
  onNavigate,
  itemCount,
  savedCount,
  readCount,
  attentionSources,
  origin,
  bridgeAvailable,
  dateLabel
}: Props): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState('')
  const [cursor, setCursor] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)

  const activeInfo = topics.find((t) => t.id === activeTopic)
  const activeIndex = topics.findIndex((t) => t.id === activeTopic)

  const close = (): void => {
    setOpen(false)
    setCreating(false)
    setDraft('')
  }

  const toggleSwitcher = (): void => {
    if (!open) setCursor(activeIndex >= 0 ? activeIndex : 0)
    setOpen((v) => !v)
  }

  const submitTopic = async (): Promise<void> => {
    const name = draft.trim()
    if (!name || !onCreateTopic) return
    const id = await onCreateTopic({ id: `t-${Date.now().toString(36)}`, name })
    close()
    if (id) onPickTopic(id)
  }

  // 领域被换掉时（弹层里选、⌘1–9、或别处触发）收起弹层，避免它停在旧状态
  useEffect(() => {
    setOpen(false)
    setCreating(false)
    setDraft('')
  }, [activeTopic])

  // 弹层打开时：点外部关闭、Esc 关闭、上下键移动、回车选中
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent): void => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
        return
      }
      if (creating) return // 输入框自己处理按键
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setCursor((c) => Math.min(c + 1, topics.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setCursor((c) => Math.max(c - 1, 0))
      } else if (e.key === 'Enter') {
        const t = topics[cursor]
        if (!t) return
        e.preventDefault()
        onPickTopic(t.id)
        close()
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, creating, topics, cursor, onPickTopic])

  return (
    <aside className="flex w-[216px] shrink-0 flex-col border-r border-rule bg-white px-4 pb-5 pt-10">
      {/* 品牌区已移除：顶部留白只为避开 macOS 的红黄绿窗控（hiddenInset 会把它们压在内容上） */}
      {topicsAvailable && topics.length > 0 && (
        <div ref={wrapRef} className="relative mb-1">
          <button
            onClick={toggleSwitcher}
            aria-haspopup="listbox"
            aria-expanded={open}
            title="切换领域"
            className="flex w-full items-center gap-1.5 rounded-lg border border-rule px-2.5 py-[6px] text-left transition-colors hover:border-accent/40 hover:bg-cream"
          >
            <span className="shrink-0 text-[13px] font-semibold text-ink-3">领域</span>
            <span className="min-w-0 truncate text-[13px] font-semibold text-ink">
              {activeInfo?.name ?? '—'}
            </span>
            {activeInfo && activeInfo.unreadCount > 0 && (
              <span
                aria-label={`${activeInfo.unreadCount} 条未读`}
                className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
              />
            )}
            <span
              className={['ml-auto shrink-0 text-ink-3 transition-transform', open ? 'rotate-180' : ''].join(' ')}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                <path
                  d="M2 3.5 5 6.5 8 3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          </button>

          {open && (
            <div
              role="listbox"
              aria-label="切换领域"
              className="absolute left-0 top-full z-50 mt-1 w-full rounded-xl border border-rule bg-white p-1.5"
              style={{ boxShadow: '0 18px 40px -24px rgba(11,18,32,.45), 0 2px 6px rgba(11,18,32,.06)' }}
            >
              <div className="px-2 pb-1 pt-0.5 text-[10px] tracking-[0.08em] text-ink-3">切换领域</div>
              {topics.map((t, i) => {
                const isActive = t.id === activeTopic
                return (
                  <button
                    key={t.id}
                    role="option"
                    aria-selected={isActive}
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => {
                      onPickTopic(t.id)
                      close()
                    }}
                    className={[
                      'flex w-full items-center gap-1.5 rounded-md px-2 py-[5px] text-left text-[13px] transition-colors',
                      cursor === i ? 'bg-cream' : '',
                      isActive ? 'font-semibold text-accent' : 'text-ink-2'
                    ].join(' ')}
                  >
                    <span className="min-w-0 truncate">{t.name}</span>
                    {t.unreadCount > 0 && (
                      <span
                        aria-label={`${t.unreadCount} 条未读`}
                        className={['h-1.5 w-1.5 shrink-0 rounded-full', isActive ? 'bg-accent' : 'bg-ink/35'].join(' ')}
                      />
                    )}
                    <span className="ml-auto shrink-0 tabular-nums text-[11px] text-ink-3">
                      {t.hasBrief ? t.todayCount : '—'}
                    </span>
                    <span className="w-[18px] shrink-0 text-right text-[10px] tabular-nums text-ink-3/70">
                      {i < 9 ? `⌘${i + 1}` : ''}
                    </span>
                  </button>
                )
              })}

              <div className="my-1 h-px bg-rule" />

              {creating ? (
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void submitTopic()
                    if (e.key === 'Escape') {
                      setCreating(false)
                      setDraft('')
                    }
                  }}
                  placeholder="领域名，回车创建"
                  className="w-full rounded-md border border-accent/40 bg-white px-2 py-1 text-[12px] outline-none"
                />
              ) : (
                <button
                  onClick={() => setCreating(true)}
                  className="flex w-full items-center rounded-md px-2 py-[5px] text-left text-[12px] text-ink-3 transition-colors hover:bg-cream hover:text-ink"
                >
                  ＋ 新建领域
                </button>
              )}
              <button
                onClick={() => {
                  onNavigate('settings')
                  close()
                }}
                className="flex w-full items-center rounded-md px-2 py-[5px] text-left text-[12px] text-ink-3 transition-colors hover:bg-cream hover:text-ink"
              >
                管理领域…
              </button>
            </div>
          )}
        </div>
      )}

      <nav className="mt-2 flex flex-col gap-0.5">
        {NAV.map((n) => {
          const isActive = n.id === active
          return (
            <button
              key={n.id}
              onClick={() => onNavigate(n.id)}
              className={[
                'flex w-full items-center gap-2 rounded-lg px-2.5 py-[7px] text-left text-[13px] transition-colors',
                isActive
                  ? 'bg-accent-soft font-semibold text-accent'
                  : 'font-medium text-ink-2 hover:bg-cream hover:text-ink'
              ].join(' ')}
            >
              <span className="flex-1">{n.label}</span>
              {n.id === 'sources' && attentionSources > 0 && (
                <span className="grid h-[17px] min-w-[17px] place-items-center rounded-full bg-[#fee2e2] px-1 text-[10px] font-bold text-[#dc2626]">
                  {attentionSources}
                </span>
              )}
              {n.id === 'timeline' && (
                <span className="text-[11px] font-normal tabular-nums text-ink-3">{dateLabel}</span>
              )}
            </button>
          )
        })}
      </nav>

      <div className="mx-2 my-5 h-px bg-rule" />

      <div className="space-y-2 px-2.5 text-[11px] text-ink-3">
        <Row label="今日条目" value={String(itemCount)} />
        <Row label="已读" value={String(readCount)} />
        <Row label="已收藏" value={String(savedCount)} />
        <Row label="需关注" value={String(attentionSources)} warn={attentionSources > 0} />
      </div>

      <div className="mt-auto px-2.5 text-[11px] leading-relaxed text-ink-3">
        {!bridgeAvailable
          ? '浏览器预览（无 preload）'
          : origin === 'sample'
            ? '示例数据 · 还没有简报'
            : '数据来源：本地数据库'}
      </div>
    </aside>
  )
}

function Row({ label, value, warn }: { label: string; value: string; warn?: boolean }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between">
      <span>{label}</span>
      <span className={warn ? 'font-bold tabular-nums text-alert' : 'tabular-nums text-ink-2'}>{value}</span>
    </div>
  )
}
