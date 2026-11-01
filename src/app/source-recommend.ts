/**
 * 按主题推荐源。
 *
 * 输入不止源名，还有**这个源最近发了什么**：一个叫「半导体行业观察」的源，
 * 名字和「芯片与算力」一个词都不重合，但它的标题会和这个主题已有的条目高度重合。
 * 所以打分 = 名称重合（权重高） + 最近内容重合（权重低），并把理由写出来。
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

export function recommendSources(store: Store, topicId: string, opts: RecommendOptions = {}): SourceRecommendation[] {
  const topic = store.topics.get(topicId)
  if (!topic) return []
  const limit = opts.limit ?? 5
  const now = opts.now ?? Date.now()
  const since = now - (opts.windowDays ?? 30) * 86_400_000

  const sources = store.sources.list()
  const items = store.items.since(since, MAX_ITEMS)
  const titlesBySource = new Map<string, string[]>()
  for (const it of items) {
    const list = titlesBySource.get(it.sourceId) ?? []
    if (list.length < 40) list.push(it.title)
    titlesBySource.set(it.sourceId, list)
  }

  const selected = new Set(store.topics.sourceIds(topicId))
  const topicTokens = tokenize(topic.name)

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

  // 主题语料：已选源的名字 + 这些源最近的标题
  const corpus = new Set(topicTokens)
  for (const s of sources) {
    if (!selected.has(s.id)) continue
    for (const t of tokenize(`${s.name} ${s.url ?? ''}`)) corpus.add(t)
    for (const t of tokensBySource.get(s.id) ?? []) corpus.add(t)
  }

  const out: SourceRecommendation[] = []
  for (const s of sources) {
    if (selected.has(s.id) || !s.enabled) continue
    const nameTokens = tokenize(`${s.name} ${s.url ?? ''}`)
    const nameScore = overlap(nameTokens, topicTokens)
    const itemTokens = tokensBySource.get(s.id) ?? new Set<string>()
    let itemScore = 0
    for (const t of itemTokens) {
      if (corpus.has(t)) itemScore += weight(t)
    }
    // 只沾到一个稀有词也不够：主题已经收了大部分源时，任何候选都能撞上一两个词。
    // 阈值取 1.5，约等于"至少三个稀有词重合"。
    if (nameScore === 0 && itemScore < 1.5) continue

    const score = nameScore * 3 + itemScore
    const reason =
      nameScore > 0
        ? `名字和「${topic.name}」有重合`
        : `最近的内容和这个主题的稀有词重合（${itemScore.toFixed(1)} 分）`
    out.push({ id: s.id, name: s.name, kind: s.kind, score, reason })
  }

  return out.sort((a, b) => b.score - a.score).slice(0, limit)
}
