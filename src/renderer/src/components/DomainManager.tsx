import { useState } from 'react'
import type { DomainPayload } from '../lib/ipc-types'

interface Props {
  domains: DomainPayload[]
  onCreate: (input: { id?: string; name: string }) => Promise<string | null>
  onRename: (id: string, name: string) => Promise<boolean>
  onRemove: (id: string) => Promise<boolean>
  onChanged: () => void
}

/**
 * 领域管理：主题的上层分组。
 *
 * 删除有主题的领域会被后端拒绝（要先把主题移走），所以这里不做"连带删除"，
 * 只在行内提示——避免一次误点把一组主题和它们的简报都带走。
 */
export function DomainManager({ domains, onCreate, onRename, onRemove, onChanged }: Props): React.JSX.Element {
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [rename, setRename] = useState('')
  const [note, setNote] = useState('')

  const create = async (): Promise<void> => {
    const name = draft.trim()
    if (!name) return
    const id = await onCreate({ name })
    setNote(id ? `已创建「${name}」` : '创建失败：领域名可能重复')
    if (id) {
      setDraft('')
      onChanged()
    }
  }

  const submitRename = async (id: string): Promise<void> => {
    const name = rename.trim()
    if (!name) return
    const ok = await onRename(id, name)
    setNote(ok ? `已改名为「${name}」` : '改名失败')
    if (ok) {
      setEditing(null)
      setRename('')
      onChanged()
    }
  }

  const remove = async (d: DomainPayload): Promise<void> => {
    if (!window.confirm(`删除领域「${d.name}」？`)) return
    const ok = await onRemove(d.id)
    setNote(ok ? `已删除「${d.name}」` : '删除失败：领域下还有主题，先移走或删掉它们')
    if (ok) onChanged()
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void create()
          }}
          placeholder="新领域名，例如「机器人」"
          className="w-52 rounded-lg border border-cream bg-white px-2.5 py-1.5 text-[12px] outline-none focus:border-accent"
        />
        <button
          onClick={() => void create()}
          disabled={draft.trim().length < 1}
          className="rounded-lg bg-ink px-3.5 py-1.5 text-[12px] font-medium text-paper disabled:opacity-40"
        >
          新建领域
        </button>
      </div>

      <div className="overflow-hidden rounded-lg border border-cream">
        {domains.map((d) => (
          <div
            key={d.id}
            className="flex flex-wrap items-center gap-2 border-b border-cream/70 px-3 py-2 text-[12px] last:border-b-0"
          >
            {editing === d.id ? (
              <input
                autoFocus
                value={rename}
                onChange={(e) => setRename(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void submitRename(d.id)
                  if (e.key === 'Escape') setEditing(null)
                }}
                className="w-40 rounded border border-accent/40 px-2 py-1 text-[12px] outline-none"
              />
            ) : (
              <span className="font-medium text-ink">{d.name}</span>
            )}
            <span className="text-[11px] text-ink-3">{d.topicCount} 个主题</span>
            <span className="ml-auto flex gap-1">
              <button
                onClick={() => {
                  setEditing(d.id)
                  setRename(d.name)
                }}
                className="rounded border border-cream px-2 py-1 text-[10.5px] text-ink/60 transition-colors hover:border-accent hover:text-ink"
              >
                改名
              </button>
              <button
                onClick={() => void remove(d)}
                className="rounded border border-cream px-2 py-1 text-[10.5px] text-ink/40 transition-colors hover:border-alert hover:text-alert"
              >
                删除
              </button>
            </span>
          </div>
        ))}
      </div>
      {note && <p className="mt-2 text-[11px] text-ink-3">{note}</p>}
    </div>
  )
}
