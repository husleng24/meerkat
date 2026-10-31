/**
 * 打分。与 radar.py::score_item 等价。
 *
 * 组成：层级权重 + 时效衰减 + 互动量 + 信号词 − 噪声/类型惩罚。
 * 返回保留两位小数，与 Python 的 round(s, 2) 对齐（golden test 靠这个）。
 */
import type { Item, Source } from '../domain/types'
import {
  ARXIV_EXTRA_PENALTY,
  ENGAGEMENT_MAX,
  ENGAGEMENT_SCALE,
  FORMULA_VERSION,
  NOISE,
  NOISE_PENALTY,
  PAPER_PENALTY,
  QUOTING_PENALTY,
  RECENCY_HALFLIFE_HOURS,
  RECENCY_MAX,
  SHORT_TITLE_LEN,
  SHORT_TITLE_PENALTY,
  SIGNAL_STRONG,
  SIGNAL_STRONG_EACH,
  SIGNAL_STRONG_MAX,
  SIGNAL_WEAK,
  SIGNAL_WEAK_EACH,
  SIGNAL_WEAK_MAX,
  TIER_WEIGHT,
  TIER_WEIGHT_FALLBACK,
  itemTypeOf
} from '../policy/ranking'

export interface ScoreContext {
  /** 当前时间（毫秒） */
  now: number
  /** 全局回看窗口（小时）；没有发布时间的条目按窗口上限计龄 */
  windowHours: number
  formulaVersion?: number
}

/** 只依赖评分的字段，方便单测 */
export interface Scorable {
  title: string
  summary: string
  tier: number
  type: string
  publishedAt?: number
  points?: number
}

export function scoreItem(input: Scorable, ctx: ScoreContext): number {
  const { now, windowHours } = ctx
  const ageHours =
    typeof input.publishedAt === 'number'
      ? Math.max(0, (now - input.publishedAt) / 3_600_000)
      : windowHours

  const recency = RECENCY_MAX * Math.exp(-ageHours / RECENCY_HALFLIFE_HOURS)
  let s = (TIER_WEIGHT[input.tier] ?? TIER_WEIGHT_FALLBACK) + recency

  const pts = input.points ?? 0
  if (pts > 0) s += Math.min(ENGAGEMENT_MAX, ENGAGEMENT_SCALE * Math.log10(1 + pts))

  const blob = `${input.title} ${input.summary}`.toLowerCase()
  const strong = SIGNAL_STRONG.reduce((n, k) => (blob.includes(k) ? n + 1 : n), 0)
  const weak = SIGNAL_WEAK.reduce((n, k) => (blob.includes(k) ? n + 1 : n), 0)
  s += Math.min(SIGNAL_STRONG_MAX, strong * SIGNAL_STRONG_EACH)
  s += Math.min(SIGNAL_WEAK_MAX, weak * SIGNAL_WEAK_EACH)

  if (NOISE.some((k) => blob.includes(k))) s -= NOISE_PENALTY
  if (input.type === 'arxiv' || input.type === 'hfpapers') s -= PAPER_PENALTY
  const lowerTitle = input.title.toLowerCase()
  if (lowerTitle.startsWith('quoting ') || lowerTitle.startsWith('quotes from ')) {
    s -= QUOTING_PENALTY
  }
  if (input.title.length < SHORT_TITLE_LEN) s -= SHORT_TITLE_PENALTY
  if (input.type === 'arxiv') s -= ARXIV_EXTRA_PENALTY

  return round2(s)
}

/** 与 Python round(x, 2) 行为一致的两位小数 */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/** 条目 + 来源一起打分（打分需要 tier 与类型，它们来自 source） */
export function scoreForSource(item: Item, source: Source, ctx: ScoreContext): number {
  return scoreItem(
    {
      title: item.title,
      summary: item.summary,
      tier: source.tier,
      type: itemTypeOf(source),
      ...(item.publishedAt !== undefined ? { publishedAt: item.publishedAt } : {}),
      ...(item.points !== undefined ? { points: item.points } : {})
    },
    { ...ctx, formulaVersion: ctx.formulaVersion ?? FORMULA_VERSION }
  )
}
