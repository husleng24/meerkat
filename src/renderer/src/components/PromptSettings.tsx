import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  PromptDryRunPayload,
  PromptEvaluationPayload,
  PromptProfilePayload,
  PromptVersionPayload,
  TopicPayload
} from '../lib/ipc-types'
import { ChatMarkdown } from './ChatMarkdown'
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
  const [trial, setTrial] = useState<PromptDryRunPayload | null>(null)
  const [trialBusy, setTrialBusy] = useState(false)
  const [rating, setRating] = useState(0)
  const [notes, setNotes] = useState('')
  const [evaluations, setEvaluations] = useState<PromptEvaluationPayload[]>([])
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
    setEvaluations([])
    // 长模板切过来时从头看，而不是停在上一份的滚动位置
    requestAnimationFrame(() => {
      if (editorRef.current) editorRef.current.scrollTop = 0
    })
  }, [profiles, selectedId])

  const loadEvaluations = useCallback(async (): Promise<void> => {
    const list = await api?.evaluations(topicId).catch(() => [])
    setEvaluations(list ?? [])
  }, [api, topicId])

  useEffect(() => {
    void loadEvaluations()
  }, [loadEvaluations, selectedId])

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

  const runTrial = async (): Promise<void> => {
    if (!api || !selected) return
    setTrialBusy(true)
    setMsg('')
    const res = await api.dryRun({
      topicId,
      systemMd,
      profileId: selected.id,
      profileName: selected.name,
      profileVersion: selected.version,
      ...(topic?.selectionPolicy ? { selectionPolicy: topic.selectionPolicy } : {})
    })
    setTrialBusy(false)
    if (!res.ok || !res.result) return setMsg(res.error ?? '试跑失败')
    setTrial(res.result)
    setRating(0)
    setNotes('')
  }

  const saveEvaluation = async (): Promise<void> => {
    if (!api || !trial || rating < 1) return
    const res = await api.evaluate({
      topicId,
      profileId: trial.profileId,
      profileName: trial.profileName,
      profileVersion: trial.profileVersion,
      rating,
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      metrics: trial.metrics
    })
    if (!res.ok) return setMsg(res.error ?? '保存评测失败')
    setMsg('评测已保存')
    await loadEvaluations()
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
        <button
          onClick={() => void runTrial()}
          disabled={trialBusy}
          className="rounded-lg border border-accent/40 px-3 py-1.5 text-[11.5px] text-accent hover:bg-accent-soft disabled:opacity-40"
        >
          {trialBusy ? '试跑中…' : '试跑（最近素材）'}
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

      {evaluations.length > 0 && (
        <div className="mt-2 rounded-lg border border-cream bg-cream/30 px-3 py-2">
          <div className="text-[10.5px] font-medium text-ink-3">最近评测</div>
          <ul className="mt-1 space-y-1">
            {evaluations.slice(0, 5).map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-2 text-[10.5px] text-ink-2">
                <span className="text-amber-600">{'★'.repeat(e.rating)}</span>
                <span className="truncate">{e.profileName} v{e.profileVersion}</span>
                <span className="text-ink-3">
                  引用 {e.metrics.cited ?? 0} · 链接率 {e.metrics.linkRate ?? 0}%
                </span>
                <span className="ml-auto text-ink-3">{new Date(e.createdAt).toLocaleDateString('zh-CN')}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {trial && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-ink/20 p-6 backdrop-blur-[2px]">
          <div className="mx-auto max-w-[860px] rounded-2xl border border-rule bg-white shadow-2xl">
            <div className="sticky top-0 flex items-center gap-3 rounded-t-2xl border-b border-rule bg-white px-5 py-3">
              <div className="min-w-0">
                <div className="truncate text-[13px] font-bold text-ink">试跑 · {trial.profileName}</div>
                <div className="text-[10.5px] text-ink-3">
                  使用最近素材，不落库 · 引用 {trial.metrics.cited}/{trial.usedItems} · 链接率{' '}
                  {trial.metrics.linkRate}% · {trial.metrics.sections} 个板块 · {trial.model}
                </div>
              </div>
              <button onClick={() => setTrial(null)} className="ml-auto text-[11px] text-ink-3 hover:text-ink">
                关闭
              </button>
            </div>
            <div className="max-h-[65vh] overflow-y-auto px-6 py-4">
              {trial.degraded && (
                <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-700">
                  未配置模型或调用失败，下面是仅聚合降级稿。
                </p>
              )}
              <ChatMarkdown text={trial.markdown} />
            </div>
            <div className="border-t border-rule px-5 py-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-[11px] text-ink-3">这次结果打几分？</span>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    onClick={() => setRating(n)}
                    className={['text-[16px]', n <= rating ? 'text-amber-500' : 'text-ink-3/40'].join(' ')}
                    aria-label={`${n} 星`}
                  >
                    ★
                  </button>
                ))}
                <input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="备注（可选）"
                  className="min-w-[200px] flex-1 rounded-lg border border-cream px-2.5 py-1.5 text-[11px] outline-none focus:border-accent"
                />
                <button
                  onClick={() => void saveEvaluation()}
                  disabled={rating < 1}
                  className="rounded-lg bg-ink px-3 py-1.5 text-[11.5px] font-medium text-paper disabled:opacity-40"
                >
                  保存评测
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
