import { useEffect, useMemo, useState } from 'react'
import type { EventTimeline } from '../../../app/event-timeline'

const STATUS_LABEL: Record<string, string> = {
  confirmed: '已确认',
  reported: '报道',
  rumor: '未证实'
}

/**
 * 事件时间线卡：agent 在评论串里的主要产出。
 *
 * 版型取舍：
 *  - 先给"现在到哪一步"，再给阶段，最后才是事件；不只堆时间轴
 *  - 默认最新在上，可切换"从头看"；上次看过的位置标出来
 *  - 缺口和待确认单独成块，不埋在长文里
 */
export function TimelineCard({
  timeline,
  storyId,
  tracking
}: {
  timeline: EventTimeline
  storyId?: string
  tracking?: boolean
}): React.JSX.Element {
  const byId = new Map((timeline.items ?? []).map((i) => [i.id, i]))
  const [stopped, setStopped] = useState(false)
  const [newestFirst, setNewestFirst] = useState(true)
  const [questionsOpen, setQuestionsOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)

  // 重新打开评论串时，以库里的状态为准：可能上次已经停止跟踪了
  useEffect(() => {
    if (!storyId) return
    void window.meerkat?.stories
      ?.list()
      .then((list) => {
        if (list.find((s) => s.id === storyId)?.status === 'archived') setStopped(true)
      })
      .catch(() => undefined)
  }, [storyId])

  const stop = async (): Promise<void> => {
    if (!storyId) return
    await window.meerkat?.stories?.setStatus({ id: storyId, status: 'archived' })
    setStopped(true)
  }

  const phases = timeline.phases
  const latest = phases.at(-1)
  // "现在"优先取综述的最后一句：那里通常就是最新状态；没有综述再退回最后节点
  const nowText =
    timeline.summary
      ?.split(/[。！？；]/)
      .map((x) => x.trim())
      .filter(Boolean)
      .at(-1) ?? latest?.headline
  const nodeCount = phases.length
  const reportCount = new Set(phases.flatMap((p) => p.sourceItemIds)).size

  // 阶段 chips：节点多时保留第一个 + 最近三个，避免挤爆窄面板
  const chips = phases.length > 4 ? [phases[0]!, ...phases.slice(-3)] : phases

  const seenKey = `meerkat.timeline.seen.${storyId ?? timeline.title}`
  const [seenAt] = useState<string | null>(() => {
    if (typeof localStorage === 'undefined') return null
    try {
      return localStorage.getItem(seenKey)
    } catch {
      return null
    }
  })
  const newCount = seenAt ? phases.filter((p) => p.date > seenAt).length : 0

  useEffect(() => {
    if (typeof localStorage === 'undefined' || !latest) return
    try {
      localStorage.setItem(seenKey, latest.date)
    } catch {
      /* 隐私模式写不了就算了 */
    }
  }, [seenKey, latest])

  const ordered = useMemo(() => {
    const list = phases.map((phase, index) => ({ phase, index }))
    return newestFirst ? [...list].reverse() : list
  }, [phases, newestFirst])
  // 默认只露 3 个节点，避免卡片在 420px 面板里长到必须一直滚
  const visible = expanded ? ordered : ordered.slice(0, 3)

  const jump = (index: number): void => {
    document.getElementById(`timeline-phase-${index}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }

  return (
    <div className="overflow-hidden rounded-xl border border-rule bg-white">
      <div className="border-b border-rule/70 bg-[linear-gradient(180deg,#fbfaff,#fff)] px-3.5 py-3">
        <div className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 text-[13px] font-semibold leading-snug text-ink">{timeline.title}</span>
          {timeline.mode === 'deterministic' && (
            <span className="shrink-0 rounded bg-cream px-1.5 py-px text-[9px] text-ink-3">按日期整理</span>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[10px] tabular-nums text-ink-3">
          <span>
            {timeline.range.from} → {timeline.range.to}
          </span>
          <span>·</span>
          <span>{nodeCount} 个节点</span>
          <span>·</span>
          <span>{reportCount} 篇报道</span>
        </div>
        {nowText && (
          <div className="mt-2 rounded-lg bg-accent-soft px-2.5 py-1.5 text-[11px] leading-relaxed text-[#3730a3]">
            <span className="font-semibold">现在：</span>
            {nowText.length > 90 ? `${nowText.slice(0, 90)}…` : nowText}
          </div>
        )}
        {timeline.note && <p className="mt-1 text-[10px] leading-relaxed text-ink-3">{timeline.note}</p>}
      </div>

      <div className="flex flex-wrap gap-1 px-3.5 pt-2.5">
        {chips.map((p, i) => {
          const original = phases.indexOf(p)
          return (
            <button
              key={`${p.date}-${i}`}
              onClick={() => jump(original)}
              className={[
                'shrink-0 rounded-full border px-2 py-[3px] text-[9.5px] transition-colors',
                original === phases.length - 1
                  ? 'border-[#c7d2fe] bg-accent-soft font-medium text-accent'
                  : 'border-rule bg-white text-ink-3 hover:border-accent hover:text-ink'
              ].join(' ')}
              title={p.headline}
            >
              {p.headline.length > 10 ? `${p.headline.slice(0, 10)}…` : p.headline}
              <span className="ml-1 opacity-60">{p.date.slice(5)}</span>
            </button>
          )
        })}
      </div>

      {newCount > 0 && seenAt && (
        <div className="mx-3.5 mt-2 flex items-center gap-1.5 rounded-md bg-emerald-50 px-2 py-1 text-[9.5px] text-emerald-700">
          上次查看后新增 {newCount} 条
          <span className="ml-auto opacity-70">已读至 {seenAt}</span>
        </div>
      )}

      <div className="flex items-center gap-2 px-3.5 pt-2 text-[9.5px] text-ink-3">
        <button
          onClick={() => setNewestFirst(true)}
          className={newestFirst ? 'font-semibold text-ink-2' : 'hover:text-ink'}
        >
          最新在上
        </button>
        <span>·</span>
        <button
          onClick={() => setNewestFirst(false)}
          className={!newestFirst ? 'font-semibold text-ink-2' : 'hover:text-ink'}
        >
          从头看
        </button>
        <span className="ml-auto">共 {nodeCount} 个节点</span>
      </div>

      <ol className="px-3.5 pb-1 pt-1">
        {visible.map(({ phase: p, index }) => (
          <li key={`${p.date}-${index}`} id={`timeline-phase-${index}`} className="relative py-2 pl-4">
            <span className="absolute left-0 top-[13px] h-1.5 w-1.5 rounded-full bg-accent" />
            {index !== 0 && <span className="absolute bottom-[-8px] left-[2.5px] top-[20px] w-px bg-rule" />}
            <div className="flex flex-wrap items-baseline gap-x-1.5">
              <span className="text-[9.5px] tabular-nums text-ink-3">{p.date}</span>
              <span className="text-[11.5px] font-medium leading-snug text-ink">{p.headline}</span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1">
              {p.confidence === 'multi-source' && (
                <span className="rounded bg-[#f5f3ff] px-1 py-px text-[8.5px] text-[#6d28d9]">多来源</span>
              )}
              {p.status === 'rumor' && (
                <span className="rounded bg-alert/10 px-1 py-px text-[8.5px] text-alert">未证实</span>
              )}
              {p.status === 'confirmed' && (
                <span className="rounded bg-emerald-50 px-1 py-px text-[8.5px] text-emerald-700">已确认</span>
              )}
              {p.confidence === 'single-source' && p.status !== 'confirmed' && (
                <span className="rounded bg-cream px-1 py-px text-[8.5px] text-ink-3">单一来源</span>
              )}
              <span className="text-[8.5px] text-ink-3">{STATUS_LABEL[p.status] ?? p.status}</span>
            </div>
            {p.detail && (
              <p className={['mt-1 text-[10.5px] leading-relaxed text-ink-2', expanded ? '' : 'line-clamp-2'].join(' ')}>
                {p.detail}
              </p>
            )}
            <div className="mt-1 flex flex-wrap gap-1">
              {[...new Map(
                p.sourceItemIds
                  .map((id) => byId.get(id))
                  .filter((x): x is NonNullable<typeof x> => Boolean(x))
                  .map((src) => [src.sourceName, src] as const)
              ).values()].map((src) => (
                <a
                  key={src.id}
                  href={src.url}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded bg-[#f8f7f3] px-1.5 py-px text-[9px] text-ink-3 hover:text-accent"
                >
                  {src.sourceName}
                </a>
              ))}
            </div>
          </li>
        ))}
      </ol>

      {ordered.length > 3 && (
        <div className="px-3.5 pb-1">
          <button onClick={() => setExpanded((v) => !v)} className="text-[9.5px] text-accent hover:underline">
            {expanded ? '收起' : `展开其余 ${ordered.length - 3} 个节点`}
          </button>
        </div>
      )}

      {timeline.gaps.length > 0 && (
        <div className="mx-3.5 mb-2 flex items-center gap-1.5 rounded-md border border-dashed border-rule px-2 py-1 text-[9.5px] text-ink-3">
          <span>⌁</span>
          <span>{timeline.gaps.join('；')}</span>
        </div>
      )}

      {timeline.openQuestions.length > 0 && (
        <div className="mx-3.5 mb-2 border-t border-rule/70 pt-2">
          <button
            onClick={() => setQuestionsOpen((v) => !v)}
            className="flex w-full items-center gap-1.5 text-left text-[9.5px] text-ink-3"
          >
            <span className="font-semibold text-ink-2">待确认 {timeline.openQuestions.length} 项</span>
            <span className="min-w-0 flex-1 truncate">{timeline.openQuestions[0]}</span>
            <span className="text-accent">{questionsOpen ? '收起' : '展开'}</span>
          </button>
          {questionsOpen && (
            <ul className="mt-1.5 space-y-1 text-[9.5px] leading-relaxed text-ink-2">
              {timeline.openQuestions.map((q, i) => (
                <li key={i}>· {q}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {(tracking || stopped) && storyId && (
        <div className="mx-3.5 flex items-center gap-2 border-t border-rule/70 py-2 text-[9.5px] text-ink-3">
          <span className={stopped ? '' : 'font-medium text-accent'}>{stopped ? '已停止跟踪' : '● 跟踪中'}</span>
          {!stopped && (
            <button onClick={() => void stop()} className="ml-auto hover:text-alert hover:underline">
              停止跟踪
            </button>
          )}
        </div>
      )}
    </div>
  )
}
