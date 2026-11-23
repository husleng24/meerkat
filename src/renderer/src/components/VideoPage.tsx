import { useCallback, useEffect, useState } from 'react'
import { ChatMarkdown } from './ChatMarkdown'
import type { VideoCreatorPayload, VideoEntryPayload, VideoReportPayload } from '../lib/ipc-types'

function dateLabel(ts?: number): string {
  return ts
    ? new Date(ts).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })
    : ''
}

function SpinnerIcon({ className = 'h-3.5 w-3.5' }: { className?: string }): React.JSX.Element {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="5.6" stroke="currentColor" strokeOpacity="0.22" strokeWidth="1.8" />
      <path d="M8 2.4a5.6 5.6 0 0 1 5.6 5.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

/**
 * 视频解读：指定博主 → 最近 12 条 → 手动选一期。
 *
 * 只做有字幕的视频；没有字幕时明确报错，不在前端假装可以转写。
 */
export function VideoPage(): React.JSX.Element {
  const api = window.meerkat?.videos
  const [creators, setCreators] = useState<VideoCreatorPayload[]>([])
  const [activeCreator, setActiveCreator] = useState<string>('')
  const [videos, setVideos] = useState<VideoEntryPayload[]>([])
  const [activeVideo, setActiveVideo] = useState<string>('')
  const [report, setReport] = useState<VideoReportPayload | null>(null)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [msg, setMsg] = useState('')
  const [showTranscript, setShowTranscript] = useState(false)

  const refreshCreators = useCallback(async (): Promise<void> => {
    if (!api) return
    const list = await api.creators()
    setCreators(list)
    if (!activeCreator && list[0]) setActiveCreator(list[0].id)
  }, [api, activeCreator])

  useEffect(() => {
    void refreshCreators()
  }, [refreshCreators])

  const loadVideos = useCallback(
    async (creatorId: string): Promise<void> => {
      if (!api || !creatorId) return
      setBusy(true)
      setMsg('')
      try {
        const r = await api.list(creatorId)
        if (!r.ok) {
          setMsg(r.error ?? '读取视频列表失败')
          setVideos([])
          return
        }
        setVideos(r.videos ?? [])
      } finally {
        setBusy(false)
      }
    },
    [api]
  )

  useEffect(() => {
    if (!activeCreator) return
    setReport(null)
    setActiveVideo('')
    setShowTranscript(false)
    setGenerating(false)
    void loadVideos(activeCreator)
  }, [activeCreator, loadVideos])

  // 生成期间显示已等待时间；不是真实进度条，但不让界面像死了一样。
  useEffect(() => {
    if (!generating) {
      setElapsed(0)
      return
    }
    const started = Date.now()
    setElapsed(0)
    const timer = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - started) / 1000))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [generating])

  const add = async (): Promise<void> => {
    if (!api || !input.trim()) return
    setBusy(true)
    setMsg('')
    try {
      const r = await api.addCreator(input.trim())
      if (!r.ok || !r.creator) {
        setMsg(r.error ?? '添加博主失败')
        return
      }
      setInput('')
      await refreshCreators()
      setActiveCreator(r.creator.id)
      setVideos(r.videos ?? [])
    } finally {
      setBusy(false)
    }
  }

  const removeCreator = async (): Promise<void> => {
    if (!api || !activeCreator) return
    if (!window.confirm('移除这个博主？已生成的视频解读也会一起删除。')) return
    const r = await api.removeCreator(activeCreator)
    if (!r.ok) {
      setMsg(r.error ?? '移除失败')
      return
    }
    setActiveCreator('')
    setVideos([])
    setReport(null)
    await refreshCreators()
  }

  const openReport = useCallback(
    async (video: VideoEntryPayload): Promise<void> => {
      if (!api || !activeCreator || generating) return
      setActiveVideo(video.videoId)
      setShowTranscript(false)
      setReport(null)
      setMsg('')
      setGenerating(true)
      setBusy(true)
      try {
        const cached = await api.getReport(video.videoId)
        if (cached) {
          setReport(cached)
          return
        }
        const r = await api.generate({
          creatorId: activeCreator,
          videoId: video.videoId,
          title: video.title,
          url: video.url,
          ...(video.publishedAt !== undefined ? { publishedAt: video.publishedAt } : {})
        })
        if (!r.ok || !r.report) {
          setReport(null)
          setMsg(r.error ?? '解读失败')
          return
        }
        setReport(r.report)
        setVideos((prev) => prev.map((v) => (v.videoId === video.videoId ? { ...v, hasReport: true } : v)))
      } catch (e) {
        setReport(null)
        setMsg(e instanceof Error ? e.message : '解读失败，请重试')
      } finally {
        setBusy(false)
        setGenerating(false)
      }
    },
    [api, activeCreator, generating]
  )

  const copy = async (): Promise<void> => {
    if (!report) return
    const md = `${report.summaryMd}\n\n---\n\n${report.transcriptMd}`
    try {
      await navigator.clipboard.writeText(md)
      setMsg('已复制 Markdown')
    } catch {
      setMsg('复制失败，请在桌面应用内重试')
    }
  }

  const exportMd = async (): Promise<void> => {
    if (!api || !report) return
    const r = await api.export(report.videoId)
    setMsg(r.ok ? `Markdown 已导出到 ${r.path}` : (r.error ?? '导出失败'))
  }

  if (!api) {
    return <div className="px-10 py-16 text-[13px] text-ink-3">预览模式下不可用：需要在桌面应用内运行。</div>
  }

  return (
    <div className="mx-auto max-w-[1060px] px-8 pb-24 pt-7">
      <header className="mb-5">
        <h1 className="text-[22px] font-bold tracking-[-0.03em] text-ink">视频解读</h1>
        <p className="mt-1 text-[12px] text-ink-3">
          指定一位 YouTube 博主，选最近 12 条中的一期；只解读有字幕的视频，字幕转成完整对话记录，再总结核心。
        </p>
      </header>

      <div className="card mb-4 flex flex-wrap items-center gap-2 px-4 py-3">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void add()
          }}
          placeholder="博主频道：@handle 或 https://youtube.com/@handle"
          className="min-w-[280px] flex-1 rounded-lg border border-cream bg-white px-3 py-1.5 text-[12px] outline-none focus:border-accent"
        />
        <button
          onClick={() => void add()}
          disabled={busy || !input.trim()}
          className="rounded-lg bg-ink px-3 py-1.5 text-[12px] font-medium text-paper disabled:opacity-40"
        >
          添加博主
        </button>
        {creators.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {creators.map((c) => (
              <button
                key={c.id}
                onClick={() => setActiveCreator(c.id)}
                disabled={generating}
                className={[
                  'rounded-full border px-2.5 py-1 text-[11px] transition-colors disabled:opacity-40',
                  c.id === activeCreator
                    ? 'border-accent bg-accent-soft text-accent'
                    : 'border-cream text-ink-2 hover:border-accent'
                ].join(' ')}
              >
                {c.name}
              </button>
            ))}
          </div>
        )}
        {creators.length > 0 && (
          <button
            onClick={() => void removeCreator()}
            disabled={generating}
            className="text-[11px] text-ink-3 hover:text-alert disabled:opacity-40"
          >
            移除当前博主
          </button>
        )}
      </div>

      {msg && <p className="mb-3 rounded-lg bg-cream/70 px-3 py-2 text-[11.5px] text-ink-2">{msg}</p>}

      <div className="grid gap-4 lg:grid-cols-[330px_1fr]">
        <section className="card overflow-hidden">
          <div className="border-b border-cream px-4 py-2.5 text-[12px] font-semibold text-ink">
            最近 12 条{' '}
            {(generating || busy) && (
              <span className="ml-2 font-normal text-ink-3">{generating ? '正在生成解读…' : '读取中…'}</span>
            )}
          </div>
          {videos.length === 0 && !busy && (
            <p className="px-4 py-5 text-[11.5px] leading-relaxed text-ink-3">
              {activeCreator ? '这个博主最近没有可读取的视频。' : '先添加一位博主。'}
            </p>
          )}
          <div className="max-h-[620px] overflow-y-auto">
            {videos.map((v) => (
              <button
                key={v.videoId}
                onClick={() => void openReport(v)}
                disabled={generating}
                aria-busy={generating && v.videoId === activeVideo}
                className={[
                  'block w-full border-b border-cream/70 px-4 py-3 text-left last:border-b-0 transition-colors disabled:cursor-wait',
                  v.videoId === activeVideo ? 'bg-accent-soft/50' : 'hover:bg-white/70'
                ].join(' ')}
              >
                <p className="line-clamp-2 text-[12px] font-medium leading-relaxed text-ink">{v.title}</p>
                <p className="mt-1 flex items-center gap-1.5 text-[10.5px] text-ink-3">
                  <span>{dateLabel(v.publishedAt)}</span>
                  {v.hasReport && <span>· 已解读</span>}
                  {generating && v.videoId === activeVideo && (
                    <span className="ml-auto flex items-center gap-1 font-medium text-accent">
                      <SpinnerIcon className="h-3 w-3" />
                      生成中…
                    </span>
                  )}
                </p>
              </button>
            ))}
          </div>
        </section>

        <section className="min-w-0">
          {generating && (
            <div className="card min-h-[260px] px-6 py-8" role="status" aria-live="polite">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
                  <SpinnerIcon className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-ink">正在生成这期视频的解读</p>
                  <p className="mt-1 text-[11.5px] text-ink-3">
                    {elapsed > 0 ? `已等待 ${elapsed} 秒` : '正在读取字幕…'}
                    {' · '}完成后结果会自动出现在这里
                  </p>
                </div>
              </div>
              <div className="mt-5 rounded-xl border border-cream bg-cream/40 px-4 py-3 text-[11px] leading-6 text-ink-3">
                <p>先读取视频字幕，再生成完整对话记录和摘要。</p>
                <p>通常需要 30–90 秒；这段时间不能切换视频，避免两次生成互相覆盖。</p>
              </div>
            </div>
          )}
          {!report && !generating && (
            <div className="card grid min-h-[260px] place-items-center px-6 py-10 text-center">
              <div>
                <p className="text-[13px] font-medium text-ink">
                  选一期视频，生成完整对话记录和“值不值得看”
                </p>
                <p className="mt-2 text-[11.5px] leading-relaxed text-ink-3">
                  有字幕才会解读；无字幕视频会明确提示，不会假装能转写。
                </p>
              </div>
            </div>
          )}
          {report && !generating && (
            <div className="card px-6 py-5">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <a
                  href={report.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[11.5px] text-accent hover:underline"
                >
                  打开原视频 ↗
                </a>
                <span className="text-[10.5px] text-ink-3">
                  {report.language ? `字幕 ${report.language} · ` : ''}
                  {report.durationSec ? `${Math.round(report.durationSec / 60)} 分钟` : ''}
                </span>
                <button onClick={() => void copy()} className="rounded border border-cream px-2 py-1 text-[11px] text-ink-2 hover:border-accent">
                  复制 Markdown
                </button>
                <button onClick={() => void exportMd()} className="rounded border border-cream px-2 py-1 text-[11px] text-ink-2 hover:border-accent">
                  导出 .md
                </button>
              </div>
              <ChatMarkdown text={report.summaryMd} />
              <details
                className="mt-4 border-t border-cream pt-3"
                open={showTranscript}
                onToggle={(e) => setShowTranscript((e.currentTarget as HTMLDetailsElement).open)}
              >
                <summary className="cursor-pointer text-[12px] font-medium text-ink-2">完整对话记录</summary>
                <div className="mt-3">
                  <ChatMarkdown text={report.transcriptMd} />
                </div>
              </details>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
