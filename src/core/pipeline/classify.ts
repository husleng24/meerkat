/**
 * 板块分类。与 radar.py::assign_bucket 等价。
 *
 * 规则优先级（顺序不能改，会改变 golden 结果）：
 * 1. 论文/热榜类型 → research
 * 2. tier=1（一手厂商）：标题像观点文章 → opinion；标题有发布动词且不像论文 → product
 * 3. 关键词打分，最高分且 ≥2 或 hint 未被命中 → 该板块
 * 4. 兜底 bucketHint，非法则 community
 */
import type { Bucket, Source } from '../domain/types'
import { BUCKET_LABEL } from '../domain/types'
import { BUCKET_KEYWORDS, itemTypeOf } from '../policy/ranking'

const OPINION_TITLE = /^(the future of|why |how |what |reflections|notes on)/i
const PAPER_WORDS = /\b(paper|benchmark|dataset|arxiv|preprint)\b/
const RELEASE_WORDS =
  /(introduc|announc|launch|releas|unveil|our next|now available|frontier model|generally available|ships)/i

export interface ClassifyInput {
  title: string
  summary: string
  sourceId: string
  tier: number
  bucketHint: Bucket
  type: string
}

export function classifyBucket(input: ClassifyInput): Bucket {
  const { title, summary, sourceId, tier, bucketHint, type } = input

  if (type === 'arxiv' || type === 'hfpapers') return 'research'

  const blob = `${title} ${summary}`.toLowerCase()

  if (tier === 1) {
    if (OPINION_TITLE.test(title)) return 'opinion'
    if (!PAPER_WORDS.test(blob) && RELEASE_WORDS.test(title)) return 'product'
    if (bucketHint === 'product') return 'product'
  }

  const scores = new Map<Bucket, number>()
  for (const [bucket, keywords] of Object.entries(BUCKET_KEYWORDS) as [Bucket, string[]][]) {
    let hit = 0
    for (const k of keywords) if (blob.includes(k)) hit += 1
    if (hit > 0) scores.set(bucket, hit)
  }

  if (type === 'video' || sourceId.startsWith('yt-')) {
    scores.set('video', (scores.get('video') ?? 0) + 2)
  }
  if (sourceId === 'reddit-localllama' || sourceId === 'reddit-ml') {
    scores.set('community', (scores.get('community') ?? 0) + 1)
  }
  if (sourceId === 'github-new') return 'agent'

  if (scores.size > 0) {
    let bestBucket: Bucket = 'community'
    let bestScore = -Infinity
    // Python 的 max() 在并列时取先插入的键；Map 保持插入顺序，行为一致
    for (const [bucket, score] of scores) {
      if (score > bestScore) {
        bestScore = score
        bestBucket = bucket
      }
    }
    if (bestScore >= 2 || !scores.has(bucketHint)) return bestBucket
  }

  return bucketHint in BUCKET_LABEL ? bucketHint : 'community'
}

/** 便捷重载：直接从 source + item 字段推导 */
export function classifyForSource(
  source: Pick<Source, 'id' | 'kind' | 'tier' | 'bucketHint'>,
  item: { title: string; summary: string }
): Bucket {
  return classifyBucket({
    title: item.title,
    summary: item.summary,
    sourceId: source.id,
    tier: source.tier,
    bucketHint: source.bucketHint,
    type: itemTypeOf(source)
  })
}
