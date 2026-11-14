import type { EventTimeline } from '../../../app/event-timeline'

const STATUS_LABEL: Record<string, string> = {
  confirmed: '已确认',
  reported: '报道',
  rumor: '未证实'
}

/**
 * 事件时间线卡：agent 在评论串里的主要产出。
 *
 * 每条都带来源；确定性的兜底版会明确写"没有生成解读"，避免用户把按日期
 * 罗列的条目误当成模型梳理过的因果。
 */
export function TimelineCard({ timeline }: { timeline: EventTimeline }): React.JSX.Element {
  const byId = new Map((timeline.items ?? []).map((i) => [i.id, i]))

  return (
    <div className="rounded-xl border border-rule bg-cream/30 p-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-[12.5px] font-semibold text-ink">{timeline.title}</span>
        <span className="text-[10.5px] tabular-nums text-ink-3">
          {timeline.range.from} → {timeline.range.to}
        </span>
        {timeline.mode === 'deterministic' && (
          <span className="rounded bg-cream px-1.5 py-px text-[9.5px] text-ink-3">按日期整理</span>
        )}
      </div>

      {timeline.summary && (
        <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-2">{timeline.summary}</p>
      )}
      {timeline.note && <p className="mt-1 text-[10.5px] text-ink-3">{timeline.note}</p>}

      <ol className="mt-2.5 space-y-2.5">
        {timeline.phases.map((p, i) => (
          <li key={`${p.date}-${i}`} className="relative pl-4">
            <span className="absolute left-0 top-[5px] h-1.5 w-1.5 rounded-full bg-accent" />
            {i < timeline.phases.length - 1 && (
              <span className="absolute bottom-[-10px] left-[2.5px] top-[14px] w-px bg-rule" />
            )}
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-[10.5px] tabular-nums text-ink-3">{p.date}</span>
              <span className="text-[12px] font-medium text-ink">{p.headline}</span>
              <span
                className={[
                  'rounded px-1 py-px text-[9px]',
                  p.status === 'confirmed'
                    ? 'bg-emerald-50 text-emerald-700'
                    : p.status === 'rumor'
                      ? 'bg-alert/10 text-alert'
                      : 'bg-cream text-ink-3'
                ].join(' ')}
              >
                {STATUS_LABEL[p.status] ?? p.status}
              </span>
              <span className="text-[9px] text-ink-3">
                {p.confidence === 'multi-source' ? '多来源' : '单一来源'}
              </span>
            </div>
            {p.detail && <p className="mt-0.5 text-[11px] leading-relaxed text-ink-2">{p.detail}</p>}
            <div className="mt-1 flex flex-wrap gap-1">
              {p.sourceItemIds.map((id) => {
                const src = byId.get(id)
                return src ? (
                  <a
                    key={id}
                    href={src.url}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded bg-white px-1.5 py-px text-[9.5px] text-ink-3 hover:text-accent"
                  >
                    {src.sourceName}
                  </a>
                ) : null
              })}
            </div>
          </li>
        ))}
      </ol>

      {timeline.gaps.length > 0 && (
        <div className="mt-2.5 rounded-lg bg-white px-2.5 py-2 text-[10.5px] text-ink-3">
          <span className="font-medium text-ink-2">时间线缺口：</span>
          {timeline.gaps.join('；')}
        </div>
      )}
      {timeline.openQuestions.length > 0 && (
        <div className="mt-1.5 text-[10.5px] text-ink-3">
          <span className="font-medium text-ink-2">待确认：</span>
          {timeline.openQuestions.join('；')}
        </div>
      )}
    </div>
  )
}
