import { useState } from 'react'
import type { TopicPayload } from '../lib/ipc-types'

interface Props {
  topics: TopicPayload[]
  activeId: string
  onPick: (id: string) => void
  /** 新建 / 改名 / 删除之后刷新主题列表 */
  onChanged: () => void
}

/**
 * 主题管理。
 *
 * 引导页会按"领域"建主题，但那是首启才走一次的路径；日常增减主题必须有个
 * 常规入口，否则用户永远只有一个主题。
 */
export function TopicManager({ topics, activeId, onPick, onChanged }: Props): React.JSX.Element {
  const active = topics.find((t) => t.id === activeId)
  const [draftName, setDraftName] = useState('')
  const [rename, setRename] = useState('')
  const [note, setNote] = useState('')

  const api = window.meerkat?.topics
  if (!api) {
    return <p className="text-[12px] text-ink-3">预览模式下不可用：需要在桌面应用内运行。</p>
  }

  const create = async (): Promise<void> => {
    const name = draftName.trim()
    if (!name) return
    const id = `t-${Date.now().toString(36)}`
    const res = await api.create({ id, name })
    if (res.ok) {
      setDraftName('')
      setNote(`已创建「${name}」，默认收录全部源`)
      onChanged()
      onPick(id)
    } else {
      setNote(res.error ?? '创建失败')
    }
  }

  const doRename = async (): Promise<void> => {
    const name = rename.trim()
    if (!name || !active) return
    const res = await api.update({ id: active.id, name })
    setNote(res.ok ? `已改名为「${name}」` : (res.error ?? '改名失败'))
    if (res.ok) {
      setRename('')
      onChanged()
    }
  }

  const remove = async (): Promise<void> => {
    if (!active) return
    if (!window.confirm(`删除主题「${active.name}」？它的简报与源归属会一起删掉，源本身不受影响。`)) return
    const res = await api.remove(active.id)
    setNote(res.ok ? `已删除「${active.name}」` : (res.error ?? '删除失败'))
    if (res.ok) {
      onChanged()
      onPick('')
    }
  }

  return (
    <div className="card px-5 py-4">
      <div className="flex items-center gap-3">
        <span className="text-[12px] text-ink-2">当前主题</span>
        <span className="text-[13px] font-semibold text-ink">{active?.name ?? '—'}</span>
        <span className="ml-auto text-[11px] text-ink-3">
          {active ? `${active.sourceCount} 个源 · ${active.hasBrief ? '已有简报' : '还没有简报'}` : ''}
        </span>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <input
          value={rename}
          onChange={(e) => setRename(e.target.value)}
          placeholder={active?.name ?? '改个名字'}
          className="min-w-0 flex-1 rounded-lg border border-cream bg-white px-3 py-1.5 text-[12px] outline-none focus:border-accent"
        />
        <button
          onClick={() => void doRename()}
          disabled={!rename.trim() || !active}
          className="rounded-lg border border-cream px-3 py-1.5 text-[12px] text-ink/80 transition-colors hover:border-accent hover:text-ink disabled:opacity-40"
        >
          改名
        </button>
        <button
          onClick={() => void remove()}
          disabled={topics.length <= 1 || !active}
          className="rounded-lg border border-cream px-3 py-1.5 text-[12px] text-ink-3 transition-colors hover:border-alert hover:text-alert disabled:opacity-40"
        >
          删除
        </button>
      </div>

      <div className="mt-3 flex items-center gap-2 border-t border-rule pt-3">
        <input
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          placeholder="新主题名字，例如「芯片与算力」"
          className="min-w-0 flex-1 rounded-lg border border-cream bg-white px-3 py-1.5 text-[12px] outline-none focus:border-accent"
        />
        <button
          onClick={() => void create()}
          disabled={!draftName.trim()}
          className="rounded-lg bg-ink px-3 py-1.5 text-[12px] font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          新建主题
        </button>
      </div>

      {note && <p className="mt-2 text-[11px] text-ink-3">{note}</p>}
    </div>
  )
}
