import { useState } from 'react'
import type { TopicPayload } from '../lib/ipc-types'
import { UpdateNotice } from './UpdateNotice'

interface Props {
  active: string
  /** 全部主题，按创建顺序平铺；领域不再是一层可见的导航 */
  topics: TopicPayload[]
  activeTopic: string
  onPickTopic: (id: string) => void
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
 * 左侧导航：主题是一等公民，领域不再出现在导航里。
 *
 * 领域仍然存在于数据层（用于设置页的分组），但普通阅读路径上只选主题：
 * 少一层可见的分组，就少一次「我在哪个领域」的追问。
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
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState('')

  const submit = async (): Promise<void> => {
    const name = draft.trim()
    if (!name || !onCreateTopic) return
    const id = await onCreateTopic({ id: `t-${Date.now().toString(36)}`, name })
    setCreating(false)
    setDraft('')
    if (id) onPickTopic(id)
  }

  const topicButton = (t: TopicPayload): React.JSX.Element => {
    const isActive = t.id === activeTopic
    return (
      <button
        key={t.id}
        onClick={() => onPickTopic(t.id)}
        aria-current={isActive ? 'true' : undefined}
        title={t.unreadCount > 0 ? `${t.unreadCount} 条未读` : undefined}
        className={[
          'flex w-full items-center gap-1.5 rounded-lg px-2.5 py-[7px] text-left text-[13px] transition-colors',
          isActive
            ? 'bg-accent-soft text-accent'
            : 'text-ink-2 hover:bg-cream hover:text-ink'
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
        <span className={['shrink-0 tabular-nums text-[11px]', isActive ? 'text-accent/80' : 'text-ink-3'].join(' ')}>
          {t.hasBrief ? t.todayCount : '—'}
        </span>
      </button>
    )
  }

  return (
    <aside className="flex w-[216px] shrink-0 flex-col border-r border-rule bg-white px-4 pb-5 pt-10">
      {/* 品牌区已移除：顶部留白只为避开 macOS 的红黄绿窗控（hiddenInset 会把它们压在内容上） */}
      <div className="mt-0 flex max-h-[320px] flex-col gap-0.5 overflow-y-auto">
        {topics.length === 0 && topicsAvailable && (
          <div className="px-2.5 py-1 text-[12px] text-ink-3">还没有主题</div>
        )}

        {topics.map(topicButton)}

        {creating ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit()
              if (e.key === 'Escape') {
                setCreating(false)
                setDraft('')
              }
            }}
            placeholder="主题名，回车创建"
            className="mt-1 w-full rounded-lg border border-accent/40 bg-white px-2 py-1 text-[12px] outline-none"
          />
        ) : (
          onCreateTopic && (
            <button
              onClick={() => setCreating(true)}
              className="mt-1 flex w-full items-center gap-1 rounded-lg px-2.5 py-[7px] text-left text-[13px] text-ink-3 transition-colors hover:bg-cream hover:text-ink"
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
                  ? 'bg-accent-soft text-accent'
                  : 'text-ink-2 hover:bg-cream hover:text-ink'
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
