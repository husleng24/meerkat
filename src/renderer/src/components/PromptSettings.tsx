import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PromptProfilePayload, PromptVersionPayload, TopicPayload } from '../lib/ipc-types'
import { PROMPT_VARIABLES, promptWarnings, renderPromptTemplate } from '../../../app/prompt-profile'

interface Props {
  topicId: string
  topics: TopicPayload[]
  onTopicsChanged: () => void | Promise<void>
}

const SAMPLE_DATE = new Date().toLocaleDateString('sv-SE')
const SAMPLE_WEEKDAY = `周${'日一二三四五六'[new Date().getDay()]}`

/**
 * 简报风格：每个主题可以绑定一份可版本化的提示词。
 *
 * 内置模板只读；自定义 profile 存 DB，保存即新版本，可回滚。
 */
export function PromptSettings({ topicId, topics, onTopicsChanged }: Props): React.JSX.Element {
  const topic = topics.find((t) => t.id === topicId)
  const [profiles, setProfiles] = useState<PromptProfilePayload[]>([])
  const [selectedId, setSelectedId] = useState<string>('builtin')
  const [name, setName] = useState('')
  const [systemMd, setSystemMd] = useState('')
  const [versions, setVersions] = useState<PromptVersionPayload[]>([])
  const [showPreview, setShowPreview] = useState(false)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const api = window.meerkat?.prompts
  const editorRef = useRef<HTMLTextAreaElement>(null)

  const selected = profiles.find((p) => p.id === selectedId)
  const readOnly = selected?.builtin !== false
  const warnings = useMemo(() => promptWarnings(systemMd), [systemMd])

  const load = useCallback(async (): Promise<void> => {
    if (!api) return
    const list = await api.list().catch(() => [])
    setProfiles(list)
    const bound = topic?.promptProfileId ?? 'builtin'
    setSelectedId(list.some((p) => p.id === bound) ? bound : 'builtin')
  }, [api, topic?.promptProfileId])

  useEffect(() => {
    void load()
  }, [load])

  // 选中项变化时同步编辑框
  useEffect(() => {
    const p = profiles.find((x) => x.id === selectedId)
    if (!p) return
    setName(p.name)
    setSystemMd(p.systemMd)
    setVersions([])
    setMsg('')
    // 长模板切过来时从头看，而不是停在上一份的滚动位置
    requestAnimationFrame(() => {
      if (editorRef.current) editorRef.current.scrollTop = 0
    })
  }, [profiles, selectedId])

  const bind = async (id: string | null): Promise<void> => {
    const res = await window.meerkat?.topics?.update({ id: topicId, promptProfileId: id })
    if (!res?.ok) return setMsg(res?.error ?? '绑定失败')
    await onTopicsChanged()
    setMsg(id ? '已绑定这个主题' : '已恢复内置模板')
  }

  const select = async (id: string): Promise<void> => {
    setSelectedId(id)
    await bind(id === 'builtin' ? null : id)
  }

  const save = async (): Promise<void> => {
    if (!api || !selected || selected.builtin) return
    setBusy(true)
    const res = await api.update({ id: selected.id, name: name.trim() || selected.name, systemMd })
    setBusy(false)
    if (!res.ok) return setMsg(res.error ?? '保存失败')
    setMsg(`已保存 v${res.profile?.version ?? ''}`)
    await load()
  }

  const duplicate = async (): Promise<void> => {
    if (!api) return
    setBusy(true)
    const base = selected?.builtin ? `${topic?.name ?? '自定义'} 风格` : `${selected?.name ?? '自定义'} 副本`
    const res = await api.create({ name: base, systemMd })
    setBusy(false)
    if (!res.ok || !res.profile) return setMsg(res.error ?? '复制失败')
    await load()
    setSelectedId(res.profile.id)
    await bind(res.profile.id)
    setMsg('已复制为自定义，可以编辑了')
  }

  const remove = async (): Promise<void> => {
    if (!api || !selected || selected.builtin) return
    if (!window.confirm(`删除「${selected.name}」？历史版本会一起删掉。`)) return
    const res = await api.remove(selected.id)
    if (!res.ok) return setMsg(res.error ?? '删除失败')
    await bind(null)
    setSelectedId('builtin')
    await load()
    setMsg('已删除，恢复内置模板')
  }

  const loadVersions = async (): Promise<void> => {
    if (!api || !selected || selected.builtin) return
    setVersions(await api.versions(selected.id).catch(() => []))
  }

  const restore = async (version: number): Promise<void> => {
    if (!api || !selected) return
    const res = await api.restore({ id: selected.id, version })
    if (!res.ok) return setMsg(res.error ?? '恢复失败')
    setMsg(`已恢复 v${version}，保存为新版本`)
    await load()
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={selectedId}
          onChange={(e) => void select(e.target.value)}
          className="min-w-[220px] rounded-lg border border-cream bg-white px-2.5 py-1.5 text-[12px] outline-none focus:border-accent"
        >
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.builtin ? '（内置）' : ` · v${p.version}`}
            </option>
          ))}
        </select>
        <button
          onClick={() => void duplicate()}
          disabled={busy}
          className="rounded-lg border border-cream px-3 py-1.5 text-[11.5px] text-ink-2 hover:border-accent hover:text-ink disabled:opacity-40"
        >
          复制为自定义
        </button>
        {!selected?.builtin && (
          <button
            onClick={() => void remove()}
            disabled={busy}
            className="rounded-lg border border-cream px-3 py-1.5 text-[11.5px] text-ink-3 hover:border-alert hover:text-alert disabled:opacity-40"
          >
            删除
          </button>
        )}
        <span className="text-[10.5px] text-ink-3">变量：{PROMPT_VARIABLES.join(' ')}</span>
      </div>

      {!readOnly && (
        <div className="mt-2 flex items-center gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-52 rounded-lg border border-cream bg-white px-2.5 py-1.5 text-[12px] outline-none focus:border-accent"
            placeholder="风格名称"
          />
          <button
            onClick={() => void save()}
            disabled={busy || warnings.includes('提示词不能为空')}
            className="rounded-lg bg-ink px-3 py-1.5 text-[11.5px] font-medium text-paper disabled:opacity-40"
          >
            保存为新版本
          </button>
          <button
            onClick={() => setShowPreview((v) => !v)}
            className="text-[11px] text-accent hover:underline"
          >
            {showPreview ? '看原文' : '预览变量'}
          </button>
          <button onClick={() => void loadVersions()} className="text-[11px] text-ink-3 hover:text-ink">
            历史版本
          </button>
        </div>
      )}

      <textarea
        ref={editorRef}
        value={showPreview ? renderPromptTemplate(systemMd, {
          topic: topic?.name ?? '主题',
          date: SAMPLE_DATE,
          weekday: SAMPLE_WEEKDAY,
          ...(topic?.editorialFocus ? { editorialFocus: topic.editorialFocus } : {})
        }) : systemMd}
        onChange={(e) => !readOnly && !showPreview && setSystemMd(e.target.value)}
        readOnly={readOnly || showPreview}
        rows={12}
        spellCheck={false}
        className="mt-2 w-full resize-y rounded-xl border border-cream bg-white px-3 py-2 font-mono text-[11px] leading-5 text-ink outline-none focus:border-accent read-only:bg-cream/40"
      />

      {warnings.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 text-[10.5px] text-amber-700">
          {warnings.map((w) => (
            <li key={w}>· {w}</li>
          ))}
        </ul>
      )}

      {versions.length > 0 && (
        <div className="mt-2 rounded-lg border border-cream bg-cream/30 px-3 py-2">
          <div className="text-[10.5px] font-medium text-ink-3">历史版本</div>
          <ul className="mt-1 space-y-1">
            {versions.map((v) => (
              <li key={v.version} className="flex items-center gap-2 text-[10.5px] text-ink-2">
                <span className="tabular-nums">v{v.version}</span>
                <span className="text-ink-3">{new Date(v.createdAt).toLocaleString('zh-CN', { hour12: false })}</span>
                <button onClick={() => void restore(v.version)} className="ml-auto text-accent hover:underline">
                  恢复
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {msg && <p className="mt-1.5 text-[10.5px] text-ink-3">{msg}</p>}
    </div>
  )
}
