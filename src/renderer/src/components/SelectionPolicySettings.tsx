import { useEffect, useState } from 'react'
import type { Bucket, SelectionPolicy } from '../../../core/domain/types'
import { BUCKETS, BUCKET_LABEL } from '../../../core/domain/types'
import type { TopicPayload } from '../lib/ipc-types'
import { DEFAULT_SELECTION_POLICY, resolveSelectionPolicy } from '../../../app/selection-policy'

interface Props {
  topicId: string
  topics: TopicPayload[]
  onTopicsChanged: () => void | Promise<void>
}

const splitWords = (raw: string): string[] =>
  raw
    .split(/[\n,，、;；]+/)
    .map((w) => w.trim())
    .filter(Boolean)

/**
 * 选材策略：决定模型"从什么范围里选"。
 *
 * prompt 管怎么写，这里管窗口/候选数/目标条数/板块/关键词偏置。
 */
export function SelectionPolicySettings({ topicId, topics, onTopicsChanged }: Props): React.JSX.Element {
  const topic = topics.find((t) => t.id === topicId)
  const [policy, setPolicy] = useState<SelectionPolicy>(DEFAULT_SELECTION_POLICY)
  const [boost, setBoost] = useState('')
  const [suppress, setSuppress] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const next = resolveSelectionPolicy(topic?.selectionPolicy)
    setPolicy(next)
    setBoost(next.boostKeywords.join('\n'))
    setSuppress(next.suppressKeywords.join('\n'))
    setMsg('')
  }, [topic?.id, topic?.selectionPolicy])

  const set = <K extends keyof SelectionPolicy>(key: K, value: SelectionPolicy[K]): void => {
    setPolicy((p) => ({ ...p, [key]: value }))
  }

  const toggleBucket = (b: Bucket): void => {
    setPolicy((p) => ({
      ...p,
      buckets: p.buckets.includes(b) ? p.buckets.filter((x) => x !== b) : [...p.buckets, b]
    }))
  }

  const save = async (): Promise<void> => {
    setBusy(true)
    const payload = resolveSelectionPolicy({
      ...policy,
      boostKeywords: splitWords(boost),
      suppressKeywords: splitWords(suppress)
    })
    const res = await window.meerkat?.topics?.update({ id: topicId, selectionPolicy: payload })
    setBusy(false)
    if (!res?.ok) return setMsg(res?.error ?? '保存失败')
    setPolicy(payload)
    setMsg('已保存，下次采集/成稿生效')
    await onTopicsChanged()
  }

  const reset = (): void => {
    setPolicy(DEFAULT_SELECTION_POLICY)
    setBoost('')
    setSuppress('')
    setMsg('已恢复默认值，记得保存')
  }

  const num = (key: 'windowHours' | 'maxItems' | 'targetMin' | 'targetMax', label: string, min: number, max: number): React.JSX.Element => (
    <label className="flex items-center gap-1.5 text-[11px] text-ink-3">
      {label}
      <input
        type="number"
        min={min}
        max={max}
        value={policy[key]}
        onChange={(e) => set(key, Number(e.target.value))}
        className="w-16 rounded-lg border border-cream bg-white px-2 py-1 text-[12px] text-ink outline-none focus:border-accent"
      />
    </label>
  )

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        {num('windowHours', '回看窗口（小时）', 1, 336)}
        {num('maxItems', '候选上限', 10, 200)}
        {num('targetMin', '目标最少', 1, 60)}
        {num('targetMax', '目标最多', 1, 60)}
        <button
          onClick={() => void save()}
          disabled={busy || policy.targetMin > policy.targetMax}
          className="rounded-lg bg-ink px-3 py-1.5 text-[11.5px] font-medium text-paper disabled:opacity-40"
        >
          保存策略
        </button>
        <button onClick={reset} className="text-[11px] text-ink-3 hover:text-ink">
          恢复默认
        </button>
      </div>

      <div className="mt-3 text-[10.5px] text-ink-3">参与选材的板块</div>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {BUCKETS.map((b) => (
          <button
            key={b}
            onClick={() => toggleBucket(b)}
            className={[
              'rounded-full border px-2 py-[3px] text-[10px] transition-colors',
              policy.buckets.includes(b)
                ? 'border-accent bg-accent-soft text-accent'
                : 'border-rule text-ink-3 hover:border-accent hover:text-ink'
            ].join(' ')}
          >
            {BUCKET_LABEL[b]}
          </button>
        ))}
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-2">
        <label className="text-[10.5px] text-ink-3">
          加权关键词（换行/逗号分隔，命中 +1.5 分）
          <textarea
            value={boost}
            onChange={(e) => setBoost(e.target.value)}
            rows={3}
            placeholder="例如：融资\n开源\n监管"
            className="mt-1 w-full resize-y rounded-lg border border-cream bg-white px-2 py-1.5 text-[11px] text-ink outline-none focus:border-accent"
          />
        </label>
        <label className="text-[10.5px] text-ink-3">
          压制关键词（命中 −2.5 分）
          <textarea
            value={suppress}
            onChange={(e) => setSuppress(e.target.value)}
            rows={3}
            placeholder="例如：教程\n招聘"
            className="mt-1 w-full resize-y rounded-lg border border-cream bg-white px-2 py-1.5 text-[11px] text-ink outline-none focus:border-accent"
          />
        </label>
      </div>

      {policy.targetMin > policy.targetMax && (
        <p className="mt-1 text-[10.5px] text-alert">目标最少不能大于目标最多</p>
      )}
      {msg && <p className="mt-1 text-[10.5px] text-ink-3">{msg}</p>}
    </div>
  )
}
