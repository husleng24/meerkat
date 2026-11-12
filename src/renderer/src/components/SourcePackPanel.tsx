import { useState } from 'react'
import type { ImportPlan, SourcePack } from '../lib/ipc-types'

interface Props {
  activeTopic?: string
  /** 导入成功后让源页与主题列表各自重取 */
  onApplied: () => void
}

/**
 * 源配置的导入/导出条。
 *
 * 只做三件事：导出当前主题、导出全部、导入一个 JSON 包。
 * 导入先出预览，确认后再写库；同名主题整组替换源归属，排程保留本机值。
 */
export function SourcePackPanel({ activeTopic, onApplied }: Props): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<{ pack: SourcePack; plan: ImportPlan; path?: string } | null>(null)

  const api = window.meerkat?.sources
  const canUse = Boolean(api)

  const exportPack = async (scope: 'all' | 'topic'): Promise<void> => {
    if (!api?.exportPack) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const res = await api.exportPack({
        scope,
        ...(scope === 'topic' && activeTopic ? { topicId: activeTopic } : {})
      })
      if (res.canceled) return
      if (!res.ok) {
        setError(res.error ?? '导出失败')
        return
      }
      setMessage(`已导出到 ${res.path ?? ''}`)
    } finally {
      setBusy(false)
    }
  }

  const importPack = async (): Promise<void> => {
    if (!api?.importPack) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const res = await api.importPack()
      if (res.canceled) return
      if (!res.ok || !res.pack || !res.plan) {
        setError(res.error ?? '导入失败')
        return
      }
      setPreview({ pack: res.pack, plan: res.plan, ...(res.path ? { path: res.path } : {}) })
    } finally {
      setBusy(false)
    }
  }

  const confirm = async (): Promise<void> => {
    if (!api?.applyPack || !preview) return
    setBusy(true)
    setError('')
    try {
      const res = await api.applyPack(preview.pack)
      if (!res.ok) {
        setError(res.error ?? '导入失败')
        return
      }
      const c = preview.plan.counts
      setMessage(
        `导入完成：源 ${c.sources.create} 新增 / ${c.sources.update} 覆盖，主题 ${c.topics.create} 新增 / ${c.topics.update} 覆盖`
      )
      setPreview(null)
      onApplied()
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-1 text-[11.5px] text-ink-3">
        <button
          onClick={() => void exportPack('topic')}
          disabled={!canUse || busy || !activeTopic}
          className="rounded-md px-2 py-1 transition-colors hover:bg-cream hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
        >
          导出当前主题
        </button>
        <button
          onClick={() => void exportPack('all')}
          disabled={!canUse || busy}
          className="rounded-md px-2 py-1 transition-colors hover:bg-cream hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
        >
          导出全部
        </button>
        <button
          onClick={() => void importPack()}
          disabled={!canUse || busy}
          className="rounded-md px-2 py-1 transition-colors hover:bg-cream hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
        >
          导入配置
        </button>
        {message && (
          <span className="max-w-[520px] truncate text-ink-3" title={message}>
            {message}
          </span>
        )}
        {error && <span className="text-alert">{error}</span>}
        {!canUse && <span className="text-ink-3/70">（浏览器预览不可用）</span>}
      </div>

      {preview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/25 px-6"
          onClick={() => {
            if (!busy) setPreview(null)
          }}
        >
          <div
            className="w-full max-w-[560px] rounded-2xl border border-rule bg-paper p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-[15px] font-semibold text-ink">导入事实源配置</h3>
            <p className="mt-1 truncate text-[11px] text-ink-3" title={preview.path}>
              {preview.path ?? '已读取配置'}
            </p>

            <div className="mt-4 grid grid-cols-3 gap-2 text-[11.5px]">
              <Count label="事实源" value={preview.plan.counts.sources} />
              <Count label="主题" value={preview.plan.counts.topics} />
              <Count label="领域" value={preview.plan.counts.domains} />
            </div>

            <div className="mt-4 max-h-[260px] overflow-y-auto rounded-xl border border-rule">
              {preview.plan.entries.map((entry, i) => (
                <div
                  key={`${entry.kind}-${entry.label}-${i}`}
                  className="flex items-baseline gap-3 border-b border-rule/60 px-3 py-2 text-[11.5px] last:border-b-0"
                >
                  <span
                    className={
                      entry.action === 'create'
                        ? 'w-[28px] shrink-0 text-[11px] text-accent'
                        : 'w-[28px] shrink-0 text-[11px] text-alert'
                    }
                  >
                    {entry.action === 'create' ? '新增' : '覆盖'}
                  </span>
                  <span className="shrink-0 text-ink-3">{KIND_LABEL[entry.kind]}</span>
                  <span className="truncate text-ink" title={entry.label}>
                    {entry.label}
                  </span>
                  {entry.detail && <span className="ml-auto shrink-0 text-[10.5px] text-ink-3">{entry.detail}</span>}
                </div>
              ))}
            </div>

            <p className="mt-3 text-[11px] leading-relaxed text-ink-3">
              同名主题会整组替换事实源归属；本机排程与事实源健康度不会被覆盖。包里没有的事实源和主题保持不动。
            </p>

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setPreview(null)}
                disabled={busy}
                className="rounded-lg border border-cream px-4 py-2 text-[12px] text-ink/80 transition-colors hover:border-accent hover:text-ink disabled:opacity-40"
              >
                取消
              </button>
              <button
                onClick={() => void confirm()}
                disabled={busy}
                className="rounded-lg bg-ink px-4 py-2 text-[12px] font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {busy ? '导入中…' : '确认导入'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

const KIND_LABEL = { domain: '领域', source: '事实源', topic: '主题' } as const

function Count({
  label,
  value
}: {
  label: string
  value: { create: number; update: number }
}): React.JSX.Element {
  return (
    <div className="rounded-lg border border-rule px-3 py-2">
      <div className="text-[10.5px] text-ink-3">{label}</div>
      <div className="mt-0.5 tabular-nums text-ink">
        +{value.create} <span className="text-ink-3">/</span> 覆盖 {value.update}
      </div>
    </div>
  )
}
