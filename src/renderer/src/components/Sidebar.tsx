import { useState } from 'react'
import type { TopicPayload } from '../lib/ipc-types'
import { UpdateNotice } from './UpdateNotice'
import { SidebarMenu } from './SidebarMenu'

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
  /** 需关注的源（连续失败 + 不稳定），与源页同一个口径 */
  attentionSources: number
  dateLabel: string
}

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
  attentionSources,
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

  // macOS 用 hiddenInset，红黄绿窗控压在内容上，必须留出顶部；Windows 用原生标题栏，不需要
  const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)

  return (
    <aside
      className={[
        'flex w-[216px] shrink-0 flex-col border-r border-rule bg-white px-4 pb-5',
        isMac ? 'pt-10' : 'pt-3'
      ].join(' ')}
    >
      {/* 品牌区已移除：macOS 的顶部留白只为避开红黄绿窗控 */}
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

      <div className="mt-auto border-t border-rule pt-3">
        <UpdateNotice />
        <SidebarMenu
          active={active}
          attentionSources={attentionSources}
          dateLabel={dateLabel}
          onNavigate={onNavigate}
        />
      </div>
    </aside>
  )
}
