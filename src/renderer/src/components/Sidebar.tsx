import { useState } from 'react'
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
 * 从前是米色底板 + 白色药丸 + 阴影；现在退成近白 + 一条细线，
 * 选中态用靛蓝浅底与靛蓝字，不再需要阴影来"抬起来"。
 * 橙色（现在是红色）只留给"失效源"——全站唯一的警报位。
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

  const submitTopic = async (): Promise<void> => {
    const name = draft.trim()
    if (!name || !onCreateTopic) return
    const id = await onCreateTopic({ id: `t-${Date.now().toString(36)}`, name })
    setCreating(false)
    setDraft('')
    if (id) onPickTopic(id)
  }

  return (
    <aside className="flex w-[216px] shrink-0 flex-col border-r border-rule bg-white px-4 pb-5 pt-10">
      {/* 品牌区已移除：顶部留白只为避开 macOS 的红黄绿窗控（hiddenInset 会把它们压在内容上） */}
      {topicsAvailable && topics.length > 0 && (
        <div className="mb-1 px-1">
          <div className="mb-1 text-[10px] font-semibold tracking-[0.12em] text-ink-3">领域</div>
          <div className="flex max-h-[200px] flex-col gap-0.5 overflow-y-auto">
            {topics.map((t) => {
              const isActive = t.id === activeTopic
              return (
                <button
                  key={t.id}
                  onClick={() => onPickTopic(t.id)}
                  title={t.unreadCount > 0 ? `${t.unreadCount} 条未读` : undefined}
                  className={[
                    'flex w-full items-center gap-1.5 rounded-lg px-2.5 py-[6px] text-left text-[12.5px] transition-colors',
                    isActive
                      ? 'bg-accent-soft font-semibold text-accent'
                      : 'text-ink-2 hover:bg-cream hover:text-ink'
                  ].join(' ')}
                >
                  <span className="min-w-0 truncate">{t.name}</span>
                  {/* 未读点紧跟在名字后面：放在数字前会被读成项目符号 */}
                  {t.unreadCount > 0 && (
                    <span
                      aria-label={`${t.unreadCount} 条未读`}
                      className={['h-1.5 w-1.5 shrink-0 rounded-full', isActive ? 'bg-accent' : 'bg-ink/35'].join(' ')}
                    />
                  )}
                  <span className="flex-1" />
                  <span
                    className={[
                      'shrink-0 tabular-nums text-[10.5px]',
                      isActive ? 'text-accent/80' : 'text-ink-3'
                    ].join(' ')}
                  >
                    {t.hasBrief ? t.todayCount : '—'}
                  </span>
                </button>
              )
            })}

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
                onBlur={() => {
                  if (!draft.trim()) setCreating(false)
                }}
                placeholder="领域名，回车创建"
                className="w-full rounded-lg border border-accent/40 bg-white px-2 py-1 text-[12px] outline-none"
              />
            ) : (
              onCreateTopic && (
                <button
                  onClick={() => setCreating(true)}
                  className="flex w-full items-center gap-1 rounded-lg px-2.5 py-[6px] text-left text-[12px] text-ink-3 transition-colors hover:bg-cream hover:text-ink"
                >
                  ＋ 新建领域
                </button>
              )
            )}
          </div>
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
              {n.id === 'timeline' && <span className="text-[10px] tabular-nums text-ink-3">{dateLabel}</span>}
            </button>
          )
        })}
      </nav>

      <div className="mx-2 my-5 h-px bg-rule" />

      <div className="space-y-1.5 px-2.5 text-[11.5px] text-ink-3">
        <Row label="今日条目" value={String(itemCount)} />
        <Row label="已读" value={String(readCount)} />
        <Row label="已收藏" value={String(savedCount)} />
        <Row label="需关注" value={String(attentionSources)} warn={attentionSources > 0} />
      </div>

      <div className="mt-auto px-2.5 text-[10px] leading-relaxed text-ink-3">
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
