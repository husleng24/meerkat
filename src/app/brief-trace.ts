/**
 * 简报的来源证据：只记录确定性事实，不调用模型。
 *
 * `ir_json` 以前一直空着；现在把它当作「这期简报引用了哪些条目」的索引。
 * 旧简报没有 trace 时界面直接隐藏该入口，不做猜测。
 */
import type { BriefTrace, BriefTraceEntry, Item, Source } from '../core/domain/types'

type TraceItem = Item & { sourceName: string }

export function buildBriefTrace(
  items: TraceItem[],
  citedIds: string[],
  sources: Source[],
  counts: { candidates: number; sourceCount: number; failedSources: number; droppedAsBriefed: number; filterOverridden: boolean }
): BriefTrace {
  const cited = new Set(citedIds)
  const tierById = new Map(sources.map((s) => [s.id, s.tier]))
  const entries: BriefTraceEntry[] = []

  for (const item of items) {
    if (!cited.has(item.id)) continue
    entries.push({
      itemId: item.id,
      title: item.title,
      url: item.url,
      urls: [item.url],
      sourceName: item.sourceName,
      tier: tierById.get(item.sourceId) ?? 0,
      ...(item.publishedAt !== undefined ? { publishedAt: item.publishedAt } : {}),
      score: item.score,
      alsoIn: item.alsoIn
    })
  }

  return {
    version: 1,
    cited: entries,
    candidates: counts.candidates,
    sourceCount: counts.sourceCount,
    failedSources: counts.failedSources,
    droppedAsBriefed: counts.droppedAsBriefed,
    filterOverridden: counts.filterOverridden
  }
}

/** 无变化简报没有引用条目，只需要记录为什么判定为「不值得写」 */
export function buildNoChangeTrace(counts: {
  candidates: number
  sourceCount: number
  failedSources: number
  droppedAsBriefed: number
  filterOverridden: boolean
}): BriefTrace {
  return {
    version: 1,
    cited: [],
    candidates: counts.candidates,
    sourceCount: counts.sourceCount,
    failedSources: counts.failedSources,
    droppedAsBriefed: counts.droppedAsBriefed,
    filterOverridden: counts.filterOverridden,
    noChange: true
  }
}

/** 读到旧数据/坏 JSON 时返回 undefined，而不是让整个简报打不开 */
export function parseBriefTrace(raw: string | undefined): BriefTrace | undefined {
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw) as Partial<BriefTrace>
    if (parsed?.version !== 1 || !Array.isArray(parsed.cited)) return undefined
    return {
      version: 1,
      cited: parsed.cited.filter(
        (e): e is BriefTraceEntry =>
          typeof e === 'object' &&
          e !== null &&
          typeof e.itemId === 'string' &&
          typeof e.title === 'string' &&
          typeof e.url === 'string' &&
          Array.isArray(e.urls) &&
          typeof e.sourceName === 'string' &&
          typeof e.tier === 'number' &&
          typeof e.score === 'number' &&
          Array.isArray(e.alsoIn)
      ),
      candidates: typeof parsed.candidates === 'number' ? parsed.candidates : 0,
      ...(typeof parsed.sourceCount === 'number' ? { sourceCount: parsed.sourceCount } : {}),
      ...(typeof parsed.failedSources === 'number' ? { failedSources: parsed.failedSources } : {}),
      droppedAsBriefed: typeof parsed.droppedAsBriefed === 'number' ? parsed.droppedAsBriefed : 0,
      filterOverridden: parsed.filterOverridden === true,
      ...(parsed.noChange === true ? { noChange: true } : {})
    }
  } catch {
    return undefined
  }
}
