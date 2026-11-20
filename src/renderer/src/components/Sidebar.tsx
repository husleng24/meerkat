import { useState } from 'react'
import type { TopicPayload } from '../lib/ipc-types'

interface Props {
  /** 全部主题，按创建顺序平铺；领域不再是一层可见的导航 */
  topics: TopicPayload[]
  activeTopic: string
  onPickTopic: (id: string) => void
  topicsAvailable: boolean
  /** 就地新建主题；返回新主题 id 或 null */
  onCreateTopic?: (input: { id: string; name: string }) => Promise<string | null>
}

/**
 * 左侧主题列表：只留主题，全局导航全部在 NavRail。
 */
export function Sidebar({
  topics,
  activeTopic,
  onPickTopic,
  topicsAvailable,
  onCreateTopic
}: Props): React.JSX.Element {
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState('')

  const submit = async (): Promise<void> => {
    const name = draft.trim()
    if (!name || !onCreateTopic) return
    try {
      const id = await onCreateTopic({ id: `t-${Date.now().toString(36)}`, name })
      if (id) onPickTopic(id)
    } finally {
      // 创建失败、请求超时、或用户已经点到别处，都不能把输入框留在原地
      setCreating(false)
      setDraft('')
    }
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
      <div className="mb-2 flex items-center px-2.5">
        <span className="text-[10.5px] font-medium uppercase tracking-[0.14em] text-ink-3">主题</span>
      </div>

      <div className="mt-0 flex max-h-[calc(100vh-120px)] flex-col gap-0.5 overflow-y-auto">
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
            onBlur={() => {
              // 点击侧栏其他地方等于放弃这次输入；不要把空输入框留在界面上
              setCreating(false)
              setDraft('')
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
    </aside>
  )
}
