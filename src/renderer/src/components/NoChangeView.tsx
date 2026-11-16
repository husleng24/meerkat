/**
 * 「今天没有变化」不是错误页。
 *
 * 它应该像一份结论：说明检查了什么、为什么没有值得写的内容，
 * 并把唯一的动作留给「重新检查」。不塞推荐、不假装还有更多。
 */
interface Props {
  date: string
  topicName?: string
  sourceCount: number
  failedSources?: number
  candidates: number
  droppedAsBriefed: number
  onRefresh?: () => void
  refreshing?: boolean
  onOpenSources?: () => void
}

export function NoChangeView({
  date,
  topicName,
  sourceCount,
  failedSources = 0,
  candidates,
  droppedAsBriefed,
  onRefresh,
  refreshing = false,
  onOpenSources
}: Props): React.JSX.Element {
  const heading = failedSources > 0 ? '今天没有足够的新变化' : '今天没有值得改变判断的变化'
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-[700px] items-center px-9 py-12">
      <section className="w-full rounded-2xl border border-cream bg-white/80 px-8 py-10 shadow-[0_18px_60px_rgba(31,41,55,0.05)]">
        {topicName && (
          <span className="mb-4 inline-flex rounded-full bg-accent-soft px-2.5 py-0.5 text-[10.5px] font-medium text-accent">
            {topicName}
          </span>
        )}
        <p className="text-[11px] font-medium tabular-nums tracking-[0.08em] text-ink-3">{date}</p>
        <h1 className="mt-2 text-[24px] font-bold leading-tight tracking-[-0.03em] text-ink">
          {heading}
        </h1>
        <p className="mt-3 max-w-[52ch] text-[13.5px] leading-7 text-ink-2">
          {failedSources > 0
            ? `检查了 ${sourceCount} 个信息源，其中 ${failedSources} 个抓取失败；其余源没有足够的内容值得展开成一篇简报。`
            : `这不是抓取失败。检查了 ${sourceCount} 个信息源；去重后有 ${candidates} 条新候选，没有足够的内容值得展开成一篇简报。`}
        </p>

        <dl className="mt-7 grid grid-cols-3 gap-3 border-t border-cream pt-5 text-[12px]">
          <div>
            <dt className="text-ink-3">信息源</dt>
            <dd className="mt-1 text-[18px] font-semibold tabular-nums text-ink">{sourceCount}</dd>
          </div>
          <div>
            <dt className="text-ink-3">新候选</dt>
            <dd className="mt-1 text-[18px] font-semibold tabular-nums text-ink">{candidates}</dd>
          </div>
          <div>
            <dt className="text-ink-3">此前已推送</dt>
            <dd className="mt-1 text-[18px] font-semibold tabular-nums text-ink">{droppedAsBriefed}</dd>
          </div>
        </dl>

        <div className="mt-7 flex items-center gap-3">
          {onRefresh && (
            <button
              onClick={onRefresh}
              disabled={refreshing}
              className="rounded-lg bg-ink px-4 py-2 text-[12px] font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {refreshing ? '检查中…' : '重新检查'}
            </button>
          )}
          <p className="text-[11px] text-ink-3">明天再看，或检查一下来源配置。</p>
        </div>
        {onOpenSources && (
          <button
            onClick={onOpenSources}
            className="mt-4 text-[11.5px] text-accent hover:underline"
          >
            打开「来源」查看抓取详情
          </button>
        )}
      </section>
    </div>
  )
}
