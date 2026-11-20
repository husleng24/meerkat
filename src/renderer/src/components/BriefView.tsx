import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ParsedBrief } from '../lib/parseBrief'
import type { BriefComparison } from '../lib/compareBriefs'
import type { FlagsApi } from '../lib/useFlags'
import { useDecisions } from '../lib/useDecisions'
import type { BriefPayload, BriefTraceEntryPayload } from '../lib/ipc-types'
import { ItemCard } from './ItemCard'
import { CompareStrip } from './CompareStrip'
import { renderBriefDocument } from '../lib/briefHtml'
import { auditClaimCoverage, auditTrust, bindClaimCitations, type TrustItem } from '../../../app/trust'

interface Props {
  brief: ParsedBrief
  flags: FlagsApi
  /** 这期引用的条目证据；旧简报没有 */
  trace?: BriefPayload['trace']
  /** 与上一期的对比；没有上一期时为 null */
  comparison: BriefComparison | null
  previousDate: string
  /** 立即采集并重新生成；入口在报头右侧，不藏在设置里 */
  onRefresh?: () => void
  refreshing?: boolean
  /** 当前领域名：显示在标题上方，说明这一页属于哪个作用域 */
  topicName?: string
  /** 原始 Markdown：无变化简报解析后没有条目，手机分享要拿原文兜底 */
  rawMarkdown?: string
}

/** 从简报的元信息行里抠数字：覆盖最近 48 小时 · 34 个信息源 · 精选 24 条 */
function readMeta(meta: string): { windowHours?: number; sources?: number; picked?: number } {
  const out: { windowHours?: number; sources?: number; picked?: number } = {}
  const w = /(\d+)\s*小时/.exec(meta)
  const s = /(\d+)\s*个信息源/.exec(meta)
  const p = /精选\s*(\d+)\s*条/.exec(meta)
  if (w) out.windowHours = Number(w[1])
  if (s) out.sources = Number(s[1])
  if (p) out.picked = Number(p[1])
  return out
}

function dateLine(raw: string | undefined): string {
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(raw ?? '')
  const w = /[（(](周[一二三四五六日])[)）]/.exec(raw ?? '')
  if (!m) return raw ?? ''
  const base = `${m[1]}年${Number(m[2])}月${Number(m[3])}日`
  return w ? `${base} ${w[1]}` : base
}

/**
 * 简报阅读视图（Lumen）。
 *
 * 结构：标题行 → 三句话卡 → 板块卡片流 → 今日一句，全部悬浮在冷白底上。
 * 光只出现在两处：页面顶部的极淡光晕、以及"今日一句"卡片里的靛蓝辉光。
 *
 * 键盘模型：j/k 上下、s 收藏、o 打开、m 已读、h 隐藏、g/G 首尾。
 */
export function BriefView({
  brief,
  flags,
  trace,
  comparison,
  previousDate,
  onRefresh,
  refreshing = false,
  topicName,
  rawMarkdown = ''
}: Props): React.JSX.Element {
  const allItems = useMemo(() => brief.sections.flatMap((s) => s.items), [brief])
  const decisionIds = useMemo(
    () => [...new Set(allItems.map((item) => flags.idOf(item.key)).filter((x): x is string => Boolean(x)))],
    [allItems, flags]
  )
  const decisions = useDecisions(decisionIds)
  const traceByUrl = useMemo(
    () =>
      new Map(
        (trace?.cited ?? []).flatMap((entry) =>
          entry.urls.map((url) => [url, entry] as const)
        )
      ),
    [trace]
  )
  const traceFor = useCallback(
    (item: (typeof allItems)[number]): BriefTraceEntryPayload | undefined => {
      for (const link of item.links) {
        const hit = traceByUrl.get(link.url)
        if (hit) return hit
      }
      return undefined
    },
    [traceByUrl]
  )
  const [cursor, setCursor] = useState(0)
  const trust = useMemo(() => {
    const items: TrustItem[] = allItems.map((item) => {
      const t = traceFor(item)
      return {
        title: item.title,
        body: item.body,
        sourceNames: t ? [t.sourceName, ...t.alsoIn] : item.links.map((l) => l.label),
        hasTrace: Boolean(t)
      }
    })
    return { items, audit: auditTrust(items) }
  }, [allItems, traceFor])
  const claimCoverage = useMemo(
    () =>
      auditClaimCoverage(
        allItems.map((item) => ({ text: item.body || item.title, hasLink: item.links.length > 0 })),
        brief.highlights
      ),
    [allItems, brief.highlights]
  )
  const claimCitations = useMemo(
    () =>
      allItems.flatMap((item) =>
        bindClaimCitations({ title: item.title, body: item.body, links: item.links })
      ),
    [allItems]
  )
  const [shareUrl, setShareUrl] = useState('')
  const [shareBusy, setShareBusy] = useState(false)
  const [shareMsg, setShareMsg] = useState('')
  const listRef = useRef<HTMLDivElement>(null)

  const startShare = async (): Promise<void> => {
    const api = window.meerkat?.share
    if (!api) {
      setShareMsg('预览模式下不可用')
      return
    }
    setShareBusy(true)
    setShareMsg('')
    try {
      const doc = renderBriefDocument(brief, dateLine(brief.title), rawMarkdown)
      const r = await api.start({ title: brief.title, html: doc.html })
      if (!r.ok || !r.url) {
        setShareMsg(r.error ?? '分享失败')
        return
      }
      setShareUrl(r.url)
      try {
        await navigator.clipboard.writeText(r.url)
        setShareMsg('链接已复制，手机与电脑需在同一 Wi-Fi')
      } catch {
        setShareMsg('链接已生成，请手动复制')
      }
    } finally {
      setShareBusy(false)
    }
  }

  const stopShare = async (): Promise<void> => {
    await window.meerkat?.share?.stop()
    setShareUrl('')
    setShareMsg('已停止分享')
  }

  useEffect(() => {
    return () => {
      void window.meerkat?.share?.stop()
    }
  }, [])

  const scrollTo = useCallback((key: string) => {
    document.getElementById(`item-${key}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [])

  const openFirstLink = useCallback(
    (key: string) => {
      const it = allItems.find((i) => i.key === key)
      const url = it?.links[0]?.url
      if (url) window.open(url, '_blank', 'noopener,noreferrer')
      flags.markRead(flags.idOf(key))
    },
    [allItems, flags]
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      const current = allItems[cursor]
      if (!current) return

      switch (e.key) {
        case 'j': {
          e.preventDefault()
          const n = Math.min(cursor + 1, allItems.length - 1)
          setCursor(n)
          scrollTo(allItems[n]!.key)
          break
        }
        case 'k': {
          e.preventDefault()
          const n = Math.max(cursor - 1, 0)
          setCursor(n)
          scrollTo(allItems[n]!.key)
          break
        }
        case 'g':
          setCursor(0)
          scrollTo(allItems[0]!.key)
          break
        case 'G':
          setCursor(allItems.length - 1)
          scrollTo(allItems[allItems.length - 1]!.key)
          break
        case 's':
          flags.toggle(flags.idOf(current.key), 'isSaved')
          break
        case 'o':
          openFirstLink(current.key)
          break
        case 'h':
          flags.toggle(flags.idOf(current.key), 'isHidden')
          break
        case 'm':
          flags.toggle(flags.idOf(current.key), 'isRead')
          break
        default:
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [allItems, cursor, scrollTo, flags, openFirstLink])

  const meta = readMeta(brief.meta)

  return (
    <div ref={listRef} className="mx-auto max-w-[780px] px-9 pb-24 pt-8">
      <header className="mb-5 flex items-start justify-between gap-4">
        <div>
          {topicName && (
            <span className="mb-1.5 inline-flex rounded-full bg-accent-soft px-2.5 py-0.5 text-[10.5px] font-medium text-accent">
              {topicName}
            </span>
          )}
          <h1 className="text-[22px] font-bold leading-tight tracking-[-0.03em] text-ink">今日简报</h1>
          <p className="mt-1.5 text-[11.5px] text-ink-3">
            {dateLine(brief.title)}
            {meta.windowHours ? ` · 覆盖最近 ${meta.windowHours} 小时` : ''}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {onRefresh && (
            <button
              onClick={onRefresh}
              disabled={refreshing}
              title="立即采集并重新生成今天的简报（约 1–2 分钟）"
              className="rounded-full border border-rule px-2.5 py-1 text-[11px] text-ink-2 transition-colors hover:border-accent hover:text-ink disabled:opacity-50"
            >
              {refreshing ? '更新中…' : '更新'}
            </button>
          )}
          <button
            onClick={() => void startShare()}
            disabled={shareBusy}
            title="生成手机可读的临时链接"
            className="rounded-full border border-rule px-2.5 py-1 text-[11px] text-ink-2 transition-colors hover:border-accent hover:text-ink disabled:opacity-50"
          >
            {shareBusy ? '生成中…' : '手机阅读'}
          </button>
          {(meta.sources !== undefined || meta.picked !== undefined) && (
            <span className="rounded-full bg-accent-soft px-2.5 py-1 text-[11px] font-semibold text-accent">
              {meta.sources !== undefined ? `${meta.sources} 源` : ''}
              {meta.sources !== undefined && meta.picked !== undefined ? ' · ' : ''}
              {meta.picked !== undefined ? `${meta.picked} 条` : ''}
            </span>
          )}
        </div>
      </header>

      {shareUrl && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-accent/25 bg-accent-soft px-3 py-2 text-[11px] text-ink-2">
          <span className="font-medium text-accent">手机阅读</span>
          <a href={shareUrl} target="_blank" rel="noreferrer" className="min-w-0 break-all text-ink underline underline-offset-2">
            {shareUrl}
          </a>
          <button
            onClick={() => void navigator.clipboard.writeText(shareUrl)}
            className="ml-auto rounded border border-accent/30 px-2 py-0.5 text-[10.5px] hover:bg-white"
          >
            复制链接
          </button>
          <button onClick={() => void stopShare()} className="rounded border border-accent/30 px-2 py-0.5 text-[10.5px] hover:bg-white">
            停止
          </button>
        </div>
      )}
      {shareMsg && !shareUrl && <p className="mb-3 text-[10.5px] text-ink-3">{shareMsg}</p>}

      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-ink-3">
        <span title="按 trace 的来源名去重；最大单源占比超过 60% 会标黄">
          来源 <strong className="font-semibold text-ink-2">{trust.audit.sources}</strong>
          {trust.audit.topSource ? ` · ${trust.audit.topSource} ${trust.audit.topShare}%` : ''}
          {trust.audit.topShare >= 60 && <span className="ml-1 text-amber-700">集中</span>}
        </span>
        <span>事实 {trust.audit.fact} · 推断 {trust.audit.inference} · 传闻 {trust.audit.rumor}</span>
        <span title="句子级：条目有链接即视为整条正文有出处；三句话速览没有逐条链接">
          引用覆盖 {claimCoverage.rate}% · {claimCoverage.cited}/{claimCoverage.claims} 句
        </span>
        <span title="没有 trace 来源证据的条目；旧简报可能没有 trace">
          {trust.audit.unsupported === null
            ? '旧简报无来源证据'
            : `无依据 ${trust.audit.unsupported}/${trust.audit.total} · ${trust.audit.unsupportedRate ?? 0}%`}
        </span>
      </div>

      <details className="mb-3 rounded-xl border border-rule bg-white/70 px-3 py-2 text-[10.5px] text-ink-3">
        <summary className="cursor-pointer select-none hover:text-ink">每句引用明细</summary>
        <div className="mt-2 max-h-[260px] space-y-1.5 overflow-y-auto pr-1">
          {claimCitations.length === 0 && <p>这一期没有可拆分的断言。</p>}
          {claimCitations.map((claim, i) => (
            <div key={i} className="flex gap-2 border-t border-rule/70 pt-1.5 first:border-t-0">
              <span
                className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[9px] ${
                  claim.sources.length === 0
                    ? 'bg-red-50 text-red-700'
                    : claim.direct
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'bg-cream text-ink-2'
                }`}
              >
                {claim.sources.length === 0 ? '无来源' : claim.direct ? '直接' : '条目级'}
              </span>
              <div className="min-w-0">
                <p className="leading-5 text-ink-2">{claim.text}</p>
                {claim.sources.length > 0 && (
                  <p className="mt-0.5 flex flex-wrap gap-x-2">
                    {claim.sources.map((s) => (
                      <a key={`${s.name}-${s.url}`} href={s.url} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                        {s.name}
                      </a>
                    ))}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      </details>

      {comparison && (
        <CompareStrip comparison={comparison} previousDate={previousDate} onJump={(key) => scrollTo(key)} />
      )}

      {brief.highlights.length > 0 && (
        <section className="card px-[22px] py-1">
          {brief.highlights.map((h, i) => (
            <div key={i} className="flex gap-4 border-t border-rule py-[15px] first:border-t-0">
              <span className="w-[26px] shrink-0 pt-px text-[17px] font-extrabold leading-[1.35] tabular-nums tracking-[-0.02em] text-accent">
                {i + 1}
              </span>
              <span className="max-w-[62ch] text-[14.5px] leading-[1.7] tracking-[-0.008em] text-ink">{h}</span>
            </div>
          ))}
        </section>
      )}

      {brief.sections.map((section) => {
        const visible = section.items.filter((i) => !flags.of(flags.idOf(i.key)).isHidden).length
        return (
          <section key={section.heading} className="mt-6">
            <h2 className="mb-2.5 flex items-center gap-2 pl-0.5 text-[13px] font-bold text-ink">
              {section.heading.replace(/^[\u2460-\u2473]\s*/, '')}
              <span className="text-[11px] font-medium tabular-nums text-ink-3">{visible}</span>
            </h2>
            <div className="flex flex-col gap-2.5">
              {section.items.map((item, idx) => {
                const globalIndex = allItems.findIndex((i) => i.key === item.key)
                const id = flags.idOf(item.key)
                const f = flags.of(id)
                return (
                  <div
                    key={item.key}
                    className="rise"
                    data-item-id={id || undefined}
                    data-item-title={item.title}
                    style={{ animationDelay: `${Math.min(globalIndex, 12) * 40}ms` }}
                  >
                    <ItemCard
                      item={item}
                      trace={traceFor(item)}
                      decision={decisions.of(flags.idOf(item.key))}
                      onSaveDecision={async (note) => {
                        const id = flags.idOf(item.key)
                        if (!id) return { ok: false, error: '这条内容无法映射到来源条目' }
                        return decisions.save(id, note)
                      }}
                      onRemoveDecision={async () => {
                        const id = flags.idOf(item.key)
                        if (id) await decisions.remove(id)
                      }}
                      selected={globalIndex === cursor}
                      saved={f.isSaved}
                      hidden={f.isHidden}
                      read={f.isRead}
                      lead={idx === 0}
                      onSelect={() => setCursor(globalIndex)}
                      onToggleSave={() => flags.toggle(id, 'isSaved')}
                      onToggleHide={() => flags.toggle(id, 'isHidden')}
                      onOpen={() => openFirstLink(item.key)}
                      {...(id
                        ? {
                            onComment: () =>
                              window.dispatchEvent(
                                new CustomEvent('meerkat:comment-item', {
                                  detail: { itemId: id, title: item.title }
                                })
                              )
                          }
                        : {})}
                    />
                  </div>
                )
              })}
            </div>
          </section>
        )
      })}

      {brief.punchline && (
        <section className="relative mt-6 overflow-hidden rounded-2xl bg-[linear-gradient(135deg,#111827,#1f2937)] px-6 py-5">
          <div className="pointer-events-none absolute -right-12 -top-12 h-48 w-48 rounded-full bg-[radial-gradient(circle,rgba(99,102,241,0.5),transparent_70%)]" />
          <div className="relative">
            <div className="mb-2 text-[10.5px] font-semibold tracking-[0.18em] text-[#9ca3af]">今日一句</div>
            <p className="max-w-[58ch] text-[15.5px] font-semibold leading-[1.75] tracking-[-0.01em] text-[#f3f4f6]">
              {brief.punchline}
            </p>
          </div>
        </section>
      )}

      <div className="mt-5 flex items-center gap-2 text-[11px] text-ink-3">
        <Kbd>?</Kbd>
        <span>查看全部快捷键</span>
        <span className="ml-auto tabular-nums">
          已读 {flags.counts.read} / {allItems.length} · 收藏 {flags.counts.saved}
        </span>
      </div>
    </div>
  )
}

function Kbd({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <kbd className="mr-0.5 rounded border border-rule bg-white px-1.5 py-0.5 font-mono text-[10px] text-ink-2">
      {children}
    </kbd>
  )
}
