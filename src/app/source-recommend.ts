/**
 * 按主题推荐源。
 *
 * 输入不止源名，还有**这个源最近发了什么**：一个叫「半导体行业观察」的源，
 * 名字和「芯片与算力」一个词都不重合，但它的标题会和这个主题已有的条目高度重合。
 * 所以打分 = 名称重合（权重高） + 最近内容重合（按词稀有度加权），并把理由写出来。
 *
 * 同一个打分给两处用：
 *  - 已有主题：语料 = 这个主题已选的源与它们的标题
 *  - 新建主题：语料 = 同领域其他主题的源与标题（此时新主题还没有任何源）
 */
import type { Store } from '../core/ports/store'
import { overlap, tokenize } from './text-match'

export interface SourceRecommendation {
  id: string
  name: string
  kind: string
  score: number
  /** 给用户看的一句话理由 */
  reason: string
}

export interface RecommendOptions {
  limit?: number
  /** 用最近多少天的条目做语料 */
  windowDays?: number
  now?: number
}

/** 语料条目上限：足够表达"这个源在写什么"，又不会把打分拖慢 */
const MAX_ITEMS = 400

/** 新建主题的默认源数量：够跑一期简报，又不至于把所有源都塞进去 */
export const NEW_TOPIC_SOURCE_LIMIT = 8

interface ScoringInput {
  name: string
  /** 不参与推荐（已在主题里的、或用户排除的） */
  excluded: Set<string>
  /** 用来判断"这个源和主题像不像"的语料源 */
  corpusSourceIds: Set<string>
  limit: number
  windowDays: number
  now: number
}

function score(store: Store, input: ScoringInput): SourceRecommendation[] {
  const sources = store.sources.list()
  const since = input.now - input.windowDays * 86_400_000
  const items = store.items.since(since, MAX_ITEMS)

  const titlesBySource = new Map<string, string[]>()
  for (const it of items) {
    const list = titlesBySource.get(it.sourceId) ?? []
    if (list.length < 40) list.push(it.title)
    titlesBySource.set(it.sourceId, list)
  }

  const topicTokens = tokenize(input.name)

  // 每个源的标题词集合：既用来打分，也用来算"这个词有多常见"
  const tokensBySource = new Map<string, Set<string>>()
  for (const s of sources) {
    const set = new Set<string>()
    for (const title of titlesBySource.get(s.id) ?? []) {
      for (const t of tokenize(title)) set.add(t)
    }
    tokensBySource.set(s.id, set)
  }
  // 文档频率：一个词出现在几个源里。跨源到处出现的词（如公司名）权重必须压低，
  // 否则"最近常被提到"的源会被推给任何主题——实测给「芯片与算力」推过 Anthropic。
  const df = new Map<string, number>()
  for (const set of tokensBySource.values()) {
    for (const t of set) df.set(t, (df.get(t) ?? 0) + 1)
  }
  // 超过这个文档频率的词直接不计分：它们区分不了任何两个源
  const withItems = [...tokensBySource.values()].filter((set) => set.size > 0).length
  const maxDf = Math.max(2, Math.ceil(withItems * 0.25))
  const weight = (t: string): number => {
    const d = df.get(t) ?? 1
    return d > maxDf ? 0 : 1 / d
  }

  // 主题语料：语料源的名字 + 这些源最近的标题
  const corpus = new Set(topicTokens)
  for (const s of sources) {
    if (!input.corpusSourceIds.has(s.id)) continue
    for (const t of tokenize(`${s.name} ${s.url ?? ''}`)) corpus.add(t)
    for (const t of tokensBySource.get(s.id) ?? []) corpus.add(t)
  }

  const out: SourceRecommendation[] = []
  for (const s of sources) {
    if (input.excluded.has(s.id) || !s.enabled) continue
    const nameTokens = tokenize(`${s.name} ${s.url ?? ''}`)
    const nameScore = overlap(nameTokens, topicTokens)
    const itemTokens = tokensBySource.get(s.id) ?? new Set<string>()
    let itemScore = 0
    for (const t of itemTokens) {
      if (corpus.has(t)) itemScore += weight(t)
    }
    // 只沾到一个稀有词也不够：语料很大时任何候选都能撞上一两个词。
    // 阈值取 1.5，约等于"至少三个稀有词重合"。
    if (nameScore === 0 && itemScore < 1.5) continue

    const scoreValue = nameScore * 3 + itemScore
    const reason =
      nameScore > 0
        ? `名字和「${input.name}」有重合`
        : `最近的内容和这个主题的稀有词重合（${itemScore.toFixed(1)} 分）`
    out.push({ id: s.id, name: s.name, kind: s.kind, score: scoreValue, reason })
  }

  return out.sort((a, b) => b.score - a.score).slice(0, input.limit)
}

/** 已有主题：推荐"还没加进它"的源 */
export function recommendSources(store: Store, topicId: string, opts: RecommendOptions = {}): SourceRecommendation[] {
  const topic = store.topics.get(topicId)
  if (!topic) return []
  const selected = new Set(store.topics.sourceIds(topicId))
  return score(store, {
    name: topic.name,
    excluded: selected,
    corpusSourceIds: selected,
    limit: opts.limit ?? 5,
    windowDays: opts.windowDays ?? 30,
    now: opts.now ?? Date.now()
  })
}

/**
 * 新建主题：此时它还没有源，用**同领域其他主题**的语料判断候选是否相关。
 * 这样「Agent 与工具」能推荐到 GitHub Trending 之类，而不是把 35 个源全塞进去。
 */
export function recommendSourcesForNewTopic(
  store: Store,
  name: string,
  domainId: string,
  opts: RecommendOptions & { exclude?: string[] } = {}
): SourceRecommendation[] {
  const corpusSourceIds = new Set<string>()
  for (const t of store.topics.list()) {
    if (t.domainId !== domainId) continue
    for (const id of store.topics.sourceIds(t.id)) corpusSourceIds.add(id)
  }
  return score(store, {
    name,
    excluded: new Set(opts.exclude ?? []),
    corpusSourceIds,
    limit: opts.limit ?? NEW_TOPIC_SOURCE_LIMIT,
    windowDays: opts.windowDays ?? 30,
    now: opts.now ?? Date.now()
  })
}
