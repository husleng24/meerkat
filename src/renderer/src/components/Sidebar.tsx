import { useEffect, useRef, useState } from 'react'
import type { DomainPayload, TopicPayload } from '../lib/ipc-types'
import { UpdateNotice } from './UpdateNotice'

interface Props {
  active: string
  /** 当前领域下的主题 */
  topics: TopicPayload[]
  activeTopic: string
  onPickTopic: (id: string) => void
  /** 全部领域 */
  domains: DomainPayload[]
  activeDomain: string
  onPickDomain: (id: string) => void
  onCreateDomain?: (input: { id: string; name: string }) => Promise<string | null>
  topicsAvailable: boolean
  /** 就地新建主题；返回新主题 id 或 null */
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
 * 左侧导航，两层：领域（作用域）→ 主题（采集与简报的单位）。
 *
 * 领域是"在哪个世界"，主题是"看哪一栏"。切换器常驻显示当前领域，
 * 点开才是列表——位置遵循 Slack / Multica 的左上角习惯。
 */
export function Sidebar({
  active,
  topics,
  activeTopic,
  onPickTopic,
  domains,
  activeDomain,
  onPickDomain,
  onCreateDomain,
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
  const [creating, setCreating] = useState<'domain' | 'topic' | null>(null)
  const [draft, setDraft] = useState('')
  const [domainCursor, setDomainCursor] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)

  const activeDomainInfo = domains.find((d) => d.id === activeDomain)
  const activeDomainIndex = domains.findIndex((d) => d.id === activeDomain)

  const close = (): void => {
    setOpen(false)
    setCreating(null)
    setDraft('')
  }

  const toggleSwitcher = (): void => {
    if (!open) setDomainCursor(activeDomainIndex >= 0 ? activeDomainIndex : 0)
    setOpen((v) => !v)
  }

  const submit = async (): Promise<void> => {
    const name = draft.trim()
    if (!name) return
    if (creating === 'domain' && onCreateDomain) {
      const id = await onCreateDomain({ id: `d-${Date.now().toString(36)}`, name })
      close()
      if (id) onPickDomain(id)
    } else if (creating === 'topic' && onCreateTopic) {
      const id = await onCreateTopic({ id: `t-${Date.now().toString(36)}`, name })
      close()
      if (id) onPickTopic(id)
    }
  }

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
      if (creating) return
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setDomainCursor((c) => Math.min(c + 1, domains.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setDomainCursor((c) => Math.max(c - 1, 0))
      } else if (e.key === 'Enter') {
        const d = domains[domainCursor]
        if (!d) return
        e.preventDefault()
        onPickDomain(d.id)
        close()
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, creating, domains, domainCursor, onPickDomain])

  // 领域或主题被换掉时收起弹层，避免它停在旧状态
  useEffect(() => {
    close()
  }, [activeDomain, activeTopic])

  return (
    <aside className="flex w-[216px] shrink-0 flex-col border-r border-rule bg-white px-4 pb-5 pt-10">
      {/* 品牌区已移除：顶部留白只为避开 macOS 的红黄绿窗控（hiddenInset 会把它们压在内容上） */}
      {topicsAvailable && domains.length > 0 && (
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
              {activeDomainInfo?.name ?? '—'}
            </span>
            <span className="ml-auto shrink-0 text-ink-3">
              <svg
                width="10"
                height="10"
                viewBox="0 0 10 10"
                aria-hidden="true"
                className={open ? 'rotate-180' : ''}
              >
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
              {domains.map((d, i) => {
                const isActive = d.id === activeDomain
                return (
                  <button
                    key={d.id}
                    role="option"
                    aria-selected={isActive}
                    onMouseEnter={() => setDomainCursor(i)}
                    onClick={() => {
                      onPickDomain(d.id)
                      close()
                    }}
                    className={[
                      'flex w-full items-center gap-1.5 rounded-md px-2 py-[5px] text-left text-[13px] transition-colors',
                      domainCursor === i ? 'bg-cream' : '',
                      isActive ? 'font-semibold text-accent' : 'text-ink-2'
                    ].join(' ')}
                  >
                    <span className="min-w-0 truncate">{d.name}</span>
                    <span className="ml-auto shrink-0 tabular-nums text-[11px] text-ink-3">{d.topicCount}</span>
                  </button>
                )
              })}

              <div className="my-1 h-px bg-rule" />

              {creating === 'domain' ? (
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void submit()
                    if (e.key === 'Escape') {
                      setCreating(null)
                      setDraft('')
                    }
                  }}
                  placeholder="领域名，回车创建"
                  className="w-full rounded-md border border-accent/40 bg-white px-2 py-1 text-[12px] outline-none"
                />
              ) : (
                onCreateDomain && (
                  <button
                    onClick={() => setCreating('domain')}
                    className="flex w-full items-center rounded-md px-2 py-[5px] text-left text-[12px] text-ink-3 transition-colors hover:bg-cream hover:text-ink"
                  >
                    ＋ 新建领域
                  </button>
                )
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

      <button
        onClick={() => onNavigate('rollup')}
        className={[
          'mt-2 flex w-full items-center gap-2 rounded-lg px-2.5 py-[7px] text-left text-[13px] transition-colors',
          active === 'rollup'
            ? 'bg-accent-soft font-semibold text-accent'
            : 'font-medium text-ink-2 hover:bg-cream hover:text-ink'
        ].join(' ')}
      >
        <span className="flex-1">领域汇总</span>
        <span className="text-[11px] font-normal text-ink-3">今天</span>
      </button>

      <div className="mb-1 mt-3 px-2.5 text-[13px] font-semibold text-ink-3">主题</div>
      <div className="flex max-h-[220px] flex-col gap-0.5 overflow-y-auto">
        {topics.map((t) => {
          const isActive = t.id === activeTopic
          return (
            <button
              key={t.id}
              onClick={() => onPickTopic(t.id)}
              title={t.unreadCount > 0 ? `${t.unreadCount} 条未读` : undefined}
              className={[
                'flex w-full items-center gap-1.5 rounded-lg px-2.5 py-[7px] text-left text-[13px] transition-colors',
                isActive
                  ? 'bg-accent-soft font-semibold text-accent'
                  : 'font-medium text-ink-2 hover:bg-cream hover:text-ink'
              ].join(' ')}
            >
              <span className="min-w-0 truncate">{t.name}</span>
              {t.unreadCount > 0 && (
                <span
                  aria-label={`${t.unreadCount} 条未读`}
                  className={['h-1.5 w-1.5 shrink-0 rounded-full', isActive ? 'bg-accent' : 'bg-ink/35'].join(' ')}
                />
              )}
              <span className="flex-1" />
              <span
                className={[
                  'shrink-0 tabular-nums text-[11px]',
                  isActive ? 'text-accent/80' : 'text-ink-3'
                ].join(' ')}
              >
                {t.hasBrief ? t.todayCount : '—'}
              </span>
            </button>
          )
        })}

        {topics.length === 0 && topicsAvailable && (
          <div className="px-2.5 py-1 text-[12px] text-ink-3">这个领域还没有主题</div>
        )}

        {creating === 'topic' ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit()
              if (e.key === 'Escape') {
                setCreating(null)
                setDraft('')
              }
            }}
            placeholder="主题名，回车创建"
            className="w-full rounded-lg border border-accent/40 bg-white px-2 py-1 text-[12px] outline-none"
          />
        ) : (
          onCreateTopic && (
            <button
              onClick={() => setCreating('topic')}
              className="flex w-full items-center gap-1 rounded-lg px-2.5 py-[7px] text-left text-[12px] text-ink-3 transition-colors hover:bg-cream hover:text-ink"
            >
              ＋ 新建主题
            </button>
          )
        )}
      </div>

      <nav className="mt-3 flex flex-col gap-0.5 border-t border-rule pt-3">
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

      <div className="mx-2 my-4 h-px bg-rule" />

      <div className="space-y-2 px-2.5 text-[11px] text-ink-3">
        <Row label="今日条目" value={String(itemCount)} />
        <Row label="已读" value={String(readCount)} />
        <Row label="已收藏" value={String(savedCount)} />
        <Row label="需关注" value={String(attentionSources)} warn={attentionSources > 0} />
      </div>

      <div className="mt-auto">
        <UpdateNotice />
        <div className="px-2.5 text-[11px] leading-relaxed text-ink-3">
        {!bridgeAvailable
          ? '浏览器预览（无 preload）'
          : origin === 'sample'
            ? '示例数据 · 还没有简报'
            : '数据来源：本地数据库'}
        </div>
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
