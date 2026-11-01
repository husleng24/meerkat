/**
 * 加源时的主题推荐（规则版，不调模型）。
 *
 * 目标不是"猜得准"，而是给一个可解释的默认值：新源的名字/域名如果和某个主题
 * 已有的源或主题名重合，就先推荐它；用户仍然要自己点「采用」。
 *
 * 分成两步：
 *  1. 把文本拆成 token（英文按词，中文按二元组）
 *  2. 与「主题名」和「该主题下已有源的名字」求重合度
 */
export interface TopicSuggestion {
  topicId: string
  name: string
  score: number
  reason: string
}

export interface SuggestInput {
  name: string
  url?: string
  kind?: string
}

import { overlap, tokenize as tokens } from './text-match'

/**
 * @param topics 候选主题（当前领域下的）
 * @param sourceNames 每个主题已有的源名，用来判断"这个主题平时收什么"
 */
export function suggestTopic(
  input: SuggestInput,
  topics: Array<{ id: string; name: string }>,
  sourceNames: Record<string, string[]>
): TopicSuggestion | null {
  const text = [input.name, input.url ?? '', input.kind ?? ''].join(' ')
  const mine = tokens(text)
  if (mine.size === 0) return null

  let best: TopicSuggestion | null = null
  for (const t of topics) {
    const nameScore = overlap(mine, tokens(t.name))
    const known = sourceNames[t.id] ?? []
    const sourceScore = known.reduce((n, s) => n + overlap(mine, tokens(s)), 0)
    const score = nameScore * 3 + sourceScore
    if (score <= 0) continue
    const reason =
      nameScore > 0
        ? `和主题名「${t.name}」有重合的词`
        : `和这个主题已有的源（${known.slice(0, 2).join('、') || '—'}）相似`
    if (!best || score > best.score) best = { topicId: t.id, name: t.name, score, reason }
  }
  return best
}
