import { useState } from 'react'
import type { DomainPayload, TopicPayload } from '../lib/ipc-types'

interface Props {
  topics: TopicPayload[]
  domains: DomainPayload[]
  activeId: string
  onPick: (id: string) => void
  /** 新建 / 改名 / 删除之后刷新主题列表 */
  onChanged: () => void
  /** 跳到「本主题的源」并聚焦到这个主题 */
  onManageSources?: (topicId: string) => void
}

/**
 * 主题管理：按领域分组列出全部主题。
 *
 * 主题是采集与简报的单位；领域只是分组。这里同时负责"把主题放进哪个领域"，
 * 因为新建主题时必须有一个归属。
 */
export function TopicManager({
  topics,
  domains,
  activeId,
  onPick,
  onChanged,
  onManageSources
}: Props): React.JSX.Element {
  const [draftName, setDraftName] = useState('')
  const [draftDomain, setDraftDomain] = useState(domains[0]?.id ?? 'ai')
  const [rename, setRename] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [note, setNote] = useState('')

  const api = window.meerkat?.topics
  if (!api) {
    return <p className="text-[12px] text-ink-3">预览模式下不可用：需要在桌面应用内运行。</p>
  }

  const create = async (): Promise<void> => {
    const name = draftName.trim()
    if (!name) return
    const id = `t-${Date.now().toString(36)}`
    const res = await api.create({ id, name, domainId: draftDomain })
    if (res.ok) {
      setDraftName('')
      setNote(
        res.sourceCount && res.sourceCount > 0
          ? `已创建「${name}」，按推荐加入了 ${res.sourceCount} 个源；下面可以增减`
          : `已创建「${name}」，暂时没有匹配的源；下面手动勾选或用推荐`
      )
      onChanged()
      onPick(id)
      // 新建之后最想知道的就是"去哪选源"——直接把页面带到那里
      onManageSources?.(id)
    } else {
      setNote(res.error ?? '创建失败')
    }
  }

  const doRename = async (t: TopicPayload): Promise<void> => {
    const name = rename.trim()
    if (!name) return
    const res = await api.update({ id: t.id, name })
    setNote(res.ok ? `已改名为「${name}」` : (res.error ?? '改名失败'))
    if (res.ok) {
      setEditing(null)
      setRename('')
      onChanged()
    }
  }

  const remove = async (t: TopicPayload): Promise<void> => {
    if (!window.confirm(`删除主题「${t.name}」？它的简报与源归属会一起删掉，源本身不受影响。`)) return
    const res = await api.remove(t.id)
    setNote(res.ok ? `已删除「${t.name}」` : (res.error ?? '删除失败'))
    if (res.ok) {
      onChanged()
      onPick('')
    }
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <input
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void create()
          }}
          placeholder="新主题名，例如「芯片与算力」"
          className="min-w-0 flex-1 rounded-lg border border-cream bg-white px-3 py-1.5 text-[12px] outline-none focus:border-accent"
        />
        <select
          value={draftDomain}
          onChange={(e) => setDraftDomain(e.target.value)}
          className="rounded-lg border border-cream bg-white px-2.5 py-1.5 text-[12px] outline-none focus:border-accent"
        >
          {domains.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <button
          onClick={() => void create()}
          disabled={!draftName.trim()}
          className="rounded-lg bg-ink px-3 py-1.5 text-[12px] font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          新建主题
        </button>
      </div>

      <div className="overflow-hidden rounded-lg border border-cream">
        {domains.map((d) => {
          const list = topics.filter((t) => t.domainId === d.id)
          return (
            <div key={d.id} className="border-b border-cream/70 last:border-b-0">
              <div className="bg-cream/40 px-3 py-1.5 text-[11px] font-semibold text-ink-3">{d.name}</div>
              {list.length === 0 && <div className="px-3 py-2 text-[11.5px] text-ink-3">这个领域还没有主题</div>}
              {list.map((t) => {
                const isActive = t.id === activeId
                return (
                  <div
                    key={t.id}
                    className={[
                      'flex flex-wrap items-center gap-2 px-3 py-2 text-[12px]',
                      isActive ? 'bg-accent-soft/50' : ''
                    ].join(' ')}
                  >
                    {editing === t.id ? (
                      <input
                        autoFocus
                        value={rename}
                        onChange={(e) => setRename(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void doRename(t)
                          if (e.key === 'Escape') setEditing(null)
                        }}
                        className="w-40 rounded border border-accent/40 px-2 py-1 text-[12px] outline-none"
                      />
                    ) : (
                      <button
                        onClick={() => onPick(t.id)}
                        className={['font-medium', isActive ? 'text-accent' : 'text-ink'].join(' ')}
                      >
                        {t.name}
                      </button>
                    )}
                    <span className="text-[11px] text-ink-3">
                      {t.sourceCount} 个源 · {t.hasBrief ? '已有简报' : '还没有简报'}
                    </span>
                    <span className="ml-auto flex gap-1">
                      {onManageSources && (
                        <button
                          onClick={() => onManageSources(t.id)}
                          title="选择这个主题要采集哪些源"
                          className="rounded border border-cream px-2 py-1 text-[10.5px] text-accent/90 transition-colors hover:border-accent hover:text-accent"
                        >
                          选源
                        </button>
                      )}
                      <button
                        onClick={() => {
                          setEditing(t.id)
                          setRename(t.name)
                        }}
                        className="rounded border border-cream px-2 py-1 text-[10.5px] text-ink/60 transition-colors hover:border-accent hover:text-ink"
                      >
                        改名
                      </button>
                      <button
                        onClick={() => void remove(t)}
                        disabled={topics.length <= 1}
                        className="rounded border border-cream px-2 py-1 text-[10.5px] text-ink-3 transition-colors hover:border-alert hover:text-alert disabled:opacity-40"
                      >
                        删除
                      </button>
                    </span>
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
      {note && <p className="mt-2 text-[11px] text-ink-3">{note}</p>}
    </div>
  )
}
