import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ONBOARDING_DIRECTIONS,
  type OnboardingDirection
} from '../../../app/onboarding'
import type { RunNowPayload, TopicPayload } from '../lib/ipc-types'

const IS_MAC = typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent)

type Phase = 'choose' | 'running' | 'done' | 'error'

interface Props {
  mode: 'first-run' | 'replay'
  topics: TopicPayload[]
  /** 浏览器预览里没有 IPC；只影响文案和补源能力 */
  topicsAvailable: boolean
  activeDomain?: string
  createTopic: (input: {
    id: string
    name: string
    domainId?: string
    editorialFocus?: string
  }) => Promise<string | null>
  onPickTopic: (id: string) => void
  startRun: (topicId: string) => Promise<RunNowPayload>
  complete: (input: { skipped: boolean }) => Promise<boolean>
  onDone: () => void
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function todayLabel(): string {
  try {
    return new Date().toLocaleDateString('sv-SE')
  } catch {
    return ''
  }
}

/** 已有主题但一个源都没有：先用推荐源补上，避免首跑出空简报 */
async function ensureExistingSources(topic: TopicPayload): Promise<void> {
  if (topic.sourceCount > 0) return
  const sourcesApi = window.meerkat?.sources
  const topicsApi = window.meerkat?.topics
  if (!sourcesApi || !topicsApi) throw new Error('预览模式下不可用')
  const rec = await sourcesApi.recommend({ topicId: topic.id })
  if (rec.length === 0) throw new Error(`「${topic.name}」还没有可用源，先在设置里加源`)
  const r = await topicsApi.setSources({ topicId: topic.id, sourceIds: rec.map((x) => x.id) })
  if (!r.ok) throw new Error(r.error ?? `「${topic.name}」补源失败`)
}

/**
 * 首启引导：单屏选方向 → 运行 → 完成/失败。
 *
 * 不放在 shell 里，也不做多屏向导：
 * 首屏只问一个产品配置（方向），源和模型都推迟。
 */
export function Onboarding({
  mode,
  topics,
  topicsAvailable,
  activeDomain,
  createTopic,
  onPickTopic,
  startRun,
  complete,
  onDone
}: Props): React.JSX.Element {
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set([ONBOARDING_DIRECTIONS[0]!.id])
  )
  const [phase, setPhase] = useState<Phase>('choose')
  const [busy, setBusy] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<RunNowPayload | null>(null)
  const [runTopicId, setRunTopicId] = useState('')
  const [runTopicName, setRunTopicName] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [progress, setProgress] = useState<{
    done: number
    total: number
    name: string
    ok: boolean
  } | null>(null)
  const runTopicRef = useRef('')

  const replay = mode === 'replay'
  const ordered = useMemo(
    () => ONBOARDING_DIRECTIONS.filter((d) => picked.has(d.id)),
    [picked]
  )
  const runTopic = useMemo(
    () => topics.find((t) => t.id === runTopicId),
    [topics, runTopicId]
  )

  useEffect(() => {
    const off = window.meerkat?.onRunProgress?.((p) => {
      // 只认本轮主题；定时任务或其他主题的进度不能混进来
      if (runTopicRef.current && p.topicId && p.topicId !== runTopicRef.current) return
      setProgress({ done: p.done, total: p.total, name: p.name, ok: p.ok })
    })
    return off
  }, [])

  useEffect(() => {
    if (phase !== 'running') return
    setElapsed(0)
    const started = Date.now()
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - started) / 1000))
    }, 1000)
    return () => clearInterval(timer)
  }, [phase])

  const existingOf = (d: OnboardingDirection): TopicPayload | undefined =>
    topics.find((t) => t.id === d.id)

  const countLabel = (d: OnboardingDirection): string => {
    if (!topicsAvailable) return '示例'
    const existing = existingOf(d)
    return existing ? `${existing.sourceCount} 个源` : '推荐约 8 个源'
  }

  const toggle = (id: string): void => {
    if (busy || phase !== 'choose') return
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const run = async (): Promise<void> => {
    if (busy) return
    if (replay) {
      onDone()
      return
    }
    if (ordered.length === 0) return

    setBusy(true)
    setCancelling(false)
    setError('')
    try {
      const ids: string[] = []
      for (const d of ordered) {
        const existing = existingOf(d)
        if (existing) {
          await ensureExistingSources(existing)
          ids.push(existing.id)
          continue
        }
        const id = await createTopic({
          id: d.id,
          name: d.name,
          ...(activeDomain ? { domainId: activeDomain } : {}),
          ...(d.editorialFocus ? { editorialFocus: d.editorialFocus } : {})
        })
        if (!id) throw new Error(`「${d.name}」创建失败，请重试`)
        ids.push(id)
      }

      const first = ordered[0]!
      const firstId = ids[0]!
      onPickTopic(firstId)
      setRunTopicId(firstId)
      runTopicRef.current = firstId
      setRunTopicName(first.name)
      setProgress(null)
      setCancelling(false)
      setPhase('running')

      const res = await startRun(firstId)
      if (!res.ok) {
        if (res.error === '已取消') {
          setCancelling(false)
          setProgress(null)
          setPhase('choose')
          setElapsed(0)
          return
        }
        setCancelling(false)
        setError(res.error ?? '生成第一份简报时出错了')
        setPhase('error')
        return
      }
      setCancelling(false)
      setResult(res)
      setPhase('done')
    } catch (e) {
      setCancelling(false)
      setError(e instanceof Error ? e.message : String(e))
      setPhase('error')
    } finally {
      setBusy(false)
    }
  }

  const skip = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      await complete({ skipped: true })
    } finally {
      setBusy(false)
      onDone()
    }
  }

  const cancel = async (): Promise<void> => {
    if (cancelling) return
    setCancelling(true)
    try {
      await window.meerkat?.cancelRun?.()
    } catch {
      /* 取消失败就让本轮自然结束；startRun 的结果会决定下一步 */
    }
  }

  const retry = (): void => {
    setError('')
    setPhase('choose')
    void run()
  }

  const primaryLabel = replay
    ? '关闭预览'
    : phase === 'done'
      ? '去读简报'
      : phase === 'error'
        ? '重试'
        : busy
          ? '准备中…'
          : '生成第一份简报'

  const onPrimary = (): void => {
    if (phase === 'done') {
      onDone()
      return
    }
    if (phase === 'error') {
      retry()
      return
    }
    if (phase === 'running') return
    void run()
  }

  const degraded = result?.degraded === true
  const failedSources =
    result && typeof result.nSources === 'number' && typeof result.nOk === 'number'
      ? Math.max(0, result.nSources - result.nOk)
      : 0
  const hasLinkCheck = typeof result?.linkTotal === 'number' && result.linkTotal > 0
  const sourceLine =
    runTopic && runTopic.sourceCount > 0 ? ` ${runTopic.sourceCount} 个源` : '公开信号源'
  const progressPct =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.done / progress.total) * 100))
      : 0

  return (
    <div className="relative flex h-full flex-col overflow-y-auto overflow-x-hidden bg-paper">
      {IS_MAC && <div className="app-drag-strip" aria-hidden="true" />}
      <div className="lumen-glow" />

      <main
        className={`relative z-10 mx-auto flex w-full max-w-[728px] flex-1 flex-col px-6 pb-10 ${
          IS_MAC ? 'pt-16' : 'pt-10'
        }`}
      >
        <div className={phase === 'choose' ? '' : 'w-full max-w-[620px]'}>
          <div className="flex items-center gap-3">
            <img src="./icon-meerkat-64.png" alt="" className="h-10 w-10 rounded-[10px]" />
            <div>
              <div className="text-[17px] font-bold leading-none text-ink">Meerkat</div>
              <div className="mt-1 text-[11px] text-ink-3">只留真正变了的那几条</div>
            </div>
          </div>

          {phase === 'choose' && (
            <>
              <h1
                id="onboarding-title"
                className="mt-9 text-[28px] font-bold leading-[1.45] tracking-[-0.02em] text-ink"
              >
                每天 5 分钟，
                <br />
                知道你在意的领域昨天真正变了什么
              </h1>
              <p className="mt-3.5 text-[13.5px] leading-[1.75] text-ink-2">
                Meerkat 抓取公开信号源，只保留 48 小时内真正变化的内容，写成一份能读完的中文简报。
                <br />
                数据留在本机，不需要账号。
              </p>

              {replay && (
                <p className="mt-3 text-[11.5px] text-ink-3">
                  这是引导预览，不会创建主题、不会改动设置，也不会跑采集。
                </p>
              )}

              <section className="mt-8" aria-labelledby="directions-title">
                <h2 id="directions-title" className="text-[13.5px] font-semibold text-ink">
                  先盯哪些方向？
                </h2>
                <p className="mt-1 text-[11.5px] text-ink-3">
                  选一个或多个；每个方向有自己的源和简报，之后随时可改。
                </p>

                <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  {ONBOARDING_DIRECTIONS.map((d) => {
                    const on = picked.has(d.id)
                    return (
                      <button
                        key={d.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggle(d.id)}
                        disabled={busy}
                        className={[
                          'relative flex min-h-[98px] flex-col items-start rounded-[14px] border px-4 py-3.5 text-left transition-colors disabled:opacity-60',
                          on
                            ? 'border-accent bg-[#f7f8ff]'
                            : 'border-rule bg-white hover:border-accent/40'
                        ].join(' ')}
                      >
                        <span
                          aria-hidden="true"
                          className={[
                            'absolute right-3.5 top-3.5 grid h-[18px] w-[18px] place-items-center rounded-full border',
                            on ? 'border-accent bg-accent' : 'border-[#d7dce6] bg-white'
                          ].join(' ')}
                        >
                          {on && (
                            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                              <path
                                d="M2 5.2 4.1 7.3 8 3.2"
                                stroke="#fff"
                                strokeWidth="1.6"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          )}
                        </span>
                        <span className="text-[13.5px] font-semibold text-ink">{d.name}</span>
                        <span className="mt-1 text-[11.5px] leading-[1.5] text-ink-3">{d.desc}</span>
                        <span className="mt-auto pt-2.5 text-[10.5px] tabular-nums text-ink-3">
                          {countLabel(d)}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </section>

              <div className="mt-7 flex items-center gap-4">
                {!replay && (
                  <button
                    type="button"
                    onClick={() => void skip()}
                    disabled={busy}
                    className="text-[12.5px] text-ink-3 transition-colors hover:text-ink disabled:opacity-40"
                  >
                    跳过，先进入
                  </button>
                )}
                <button
                  type="button"
                  onClick={onPrimary}
                  disabled={busy || (!replay && ordered.length === 0)}
                  className="ml-auto h-11 rounded-[11px] bg-ink px-6 text-[13px] font-semibold text-paper transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  {primaryLabel}
                </button>
              </div>
              <p className="mt-3 text-right text-[11px] text-ink-3">
                {replay
                  ? '回看模式：只展示，不写任何数据。'
                  : '第一份大约需要 1–2 分钟；不接模型也能出「仅聚合」版。'}
              </p>
            </>
          )}

          {phase === 'running' && (
            <>
              <h1 className="mt-9 text-[24px] font-bold leading-[1.35] tracking-[-0.02em] text-ink">
                正在生成第一份简报
              </h1>
              <p className="mt-3 text-[13.5px] leading-[1.75] text-ink-2">
                抓取「{runTopicName}」的{sourceLine}，通常 1–2 分钟。可以最小化窗口，采集会在后台继续。
              </p>

              <div className="mt-7 rounded-[14px] border border-rule bg-white p-5">
                <div className="flex items-center gap-2.5">
                  <span className="h-[7px] w-[7px] rounded-full bg-accent" />
                  <span className="text-[12.5px] font-semibold text-ink">
                    {progress ? `正在抓取 ${progress.done}/${progress.total}` : '正在抓取公开信号源'}
                  </span>
                  <span className="ml-auto text-[11.5px] tabular-nums text-ink-3">
                    已用 {formatElapsed(elapsed)}
                  </span>
                </div>
                {progress && progress.total > 0 && (
                  <div
                    className="mt-3 h-[3px] overflow-hidden rounded-full bg-cream"
                    role="progressbar"
                    aria-label="采集进度"
                    aria-valuemin={0}
                    aria-valuemax={progress.total}
                    aria-valuenow={progress.done}
                  >
                    <div className="h-full rounded-full bg-accent" style={{ width: `${progressPct}%` }} />
                  </div>
                )}
                <p className="mt-3 text-[11.5px] leading-[1.7] text-ink-3">
                  {progress
                    ? progress.done >= progress.total
                      ? '源抓取完成，正在写成简报…'
                      : `正在抓取「${progress.name}」`
                    : '跑完这里会显示结果；也可以先关掉窗口，稍后再回来。'}
                </p>
              </div>

              <div className="mt-7 flex items-center gap-4">
                <button
                  type="button"
                  onClick={() => void cancel()}
                  disabled={cancelling}
                  className="text-[12.5px] text-ink-3 transition-colors hover:text-ink disabled:opacity-40"
                >
                  {cancelling ? '取消中…' : '取消'}
                </button>
              </div>
            </>
          )}

          {phase === 'done' && (
            <>
              <h1 className="mt-9 text-[24px] font-bold leading-[1.35] tracking-[-0.02em] text-ink">
                第一份简报好了
              </h1>
              <p className="mt-3 text-[13.5px] leading-[1.75] text-ink-2">
                「{runTopicName}」· {todayLabel()} · {result?.nKept ?? 0} 条。之后每天按排程自动跑；也可以在报头点「更新」。
              </p>

              <div className="mt-7 rounded-[14px] border border-rule bg-white p-5">
                <div className="flex items-stretch">
                  <div className="flex-1">
                    <div className="text-[21px] font-bold leading-none tabular-nums text-ink">
                      {typeof result?.nOk === 'number' && typeof result?.nSources === 'number'
                        ? `${result.nOk}/${result.nSources}`
                        : '—'}
                    </div>
                    <div className="mt-1.5 text-[10.5px] text-ink-3">源成功</div>
                  </div>
                  <div className="flex-1 border-l border-rule pl-5">
                    <div className="text-[21px] font-bold leading-none tabular-nums text-ink">
                      {result?.nKept ?? 0}
                    </div>
                    <div className="mt-1.5 text-[10.5px] text-ink-3">条内容</div>
                  </div>
                  <div className="flex-1 border-l border-rule pl-5">
                    <div className="text-[21px] font-bold leading-none tabular-nums text-ink">
                      {hasLinkCheck ? `${result?.linkGood}/${result?.linkTotal}` : '—'}
                    </div>
                    <div className="mt-1.5 text-[10.5px] text-ink-3">链接校验</div>
                  </div>
                </div>

                {degraded && (
                  <div className="mt-4 flex items-start gap-2.5 rounded-[10px] bg-cream px-3 py-2.5">
                    <span className="mt-0.5 inline-block rounded-[5px] bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold leading-[1.4] text-accent">
                      仅聚合
                    </span>
                    <p className="text-[11.5px] leading-[1.65] text-ink-2">
                      这次没接模型：先列标题、来源和链接。接上模型后，会写成三句话速览。
                    </p>
                  </div>
                )}

                {failedSources > 0 && (
                  <p className="mt-3 text-[11.5px] leading-[1.65] text-ink-3">
                    {failedSources} 个源这次没成功，可在「事实源」页看原因。
                  </p>
                )}

                {result?.noChange === true && (
                  <p className="mt-3 text-[11.5px] leading-[1.65] text-ink-3">
                    今天没有值得改变判断的变化；明天到点再跑。
                  </p>
                )}
              </div>

              <div className="mt-7 flex items-center">
                <button
                  type="button"
                  onClick={onDone}
                  className="ml-auto h-11 rounded-[11px] bg-ink px-6 text-[13px] font-semibold text-paper transition-opacity hover:opacity-90"
                >
                  去读简报
                </button>
              </div>
            </>
          )}

          {phase === 'error' && (
            <>
              <h1 className="mt-9 text-[24px] font-bold leading-[1.35] tracking-[-0.02em] text-ink">
                这次没跑完
              </h1>
              <p className="mt-3 text-[13.5px] leading-[1.75] text-ink-2">
                采集过程中出错了。已经抓到的内容不会丢，可以重试；也可以先进入应用，之后在设置里再跑。
              </p>

              <div className="mt-7 rounded-[14px] border border-rule bg-white p-5">
                <div className="flex items-center gap-2.5">
                  <span className="h-[7px] w-[7px] rounded-full bg-alert" />
                  <span className="text-[12.5px] font-semibold text-alert">这次没有完成</span>
                </div>
                <p className="mt-3 text-[11.5px] leading-[1.7] text-ink-3">
                  {error || '请检查网络后重试。'}
                </p>
              </div>

              <div className="mt-7 flex items-center gap-4">
                <button
                  type="button"
                  onClick={() => void skip()}
                  disabled={busy}
                  className="text-[12.5px] text-ink-3 transition-colors hover:text-ink disabled:opacity-40"
                >
                  跳过，先进入
                </button>
                <button
                  type="button"
                  onClick={onPrimary}
                  disabled={busy}
                  className="ml-auto h-11 rounded-[11px] bg-ink px-6 text-[13px] font-semibold text-paper transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  {busy ? '准备中…' : '重试'}
                </button>
              </div>
            </>
          )}
        </div>
      </main>

      <div className="relative z-10 pb-8 text-center text-[11px] text-ink-3">
        Meerkat · 只留真正变了的那几条
      </div>
    </div>
  )
}
