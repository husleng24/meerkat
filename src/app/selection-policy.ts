/**
 * 选材策略：把「看多宽的窗口、看多少条、选哪些板块、偏好什么词」从代码常量里抽出来。
 *
 * 这些参数直接决定模型看到什么，所以和 prompt 分开管理：prompt 管"怎么写"，
 * 策略管"从什么范围里选"。默认值保持原行为不变。
 */
import type { Bucket, Item, SelectionPolicy } from '../core/domain/types'
import { BUCKETS } from '../core/domain/types'

export const DEFAULT_SELECTION_POLICY: SelectionPolicy = {
  windowHours: 48,
  maxItems: 80,
  targetMin: 15,
  targetMax: 24,
  buckets: [...BUCKETS],
  boostKeywords: [],
  suppressKeywords: []
}

const cleanWords = (words: string[]): string[] =>
  [...new Set(words.map((w) => w.trim()).filter((w) => w.length > 0 && w.length <= 30))].slice(0, 30)

export function resolveSelectionPolicy(input?: Partial<SelectionPolicy> | null): SelectionPolicy {
  if (!input) return { ...DEFAULT_SELECTION_POLICY, buckets: [...DEFAULT_SELECTION_POLICY.buckets] }
  const buckets = Array.isArray(input.buckets)
    ? BUCKETS.filter((b) => input.buckets!.includes(b))
    : [...DEFAULT_SELECTION_POLICY.buckets]
  return {
    windowHours: clampInt(input.windowHours, 1, 24 * 14, DEFAULT_SELECTION_POLICY.windowHours),
    maxItems: clampInt(input.maxItems, 10, 200, DEFAULT_SELECTION_POLICY.maxItems),
    targetMin: clampInt(input.targetMin, 1, 60, DEFAULT_SELECTION_POLICY.targetMin),
    targetMax: clampInt(input.targetMax, 1, 60, DEFAULT_SELECTION_POLICY.targetMax),
    buckets: buckets.length > 0 ? buckets : [...DEFAULT_SELECTION_POLICY.buckets],
    boostKeywords: cleanWords(input.boostKeywords ?? []),
    suppressKeywords: cleanWords(input.suppressKeywords ?? [])
  }
}

function clampInt(value: number | undefined, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}

/** 先按板块过滤，再按关键词做小幅加减分，最后排序 */
export function applySelectionPolicy<T extends Item>(items: T[], policy: SelectionPolicy): T[] {
  const allowed = new Set<Bucket>(policy.buckets)
  const boost = policy.boostKeywords.map((k) => k.toLowerCase())
  const suppress = policy.suppressKeywords.map((k) => k.toLowerCase())

  const adjusted = items
    .filter((it) => allowed.has(it.bucket))
    .map((it) => {
      let score = it.score
      if (boost.length > 0 || suppress.length > 0) {
        const blob = `${it.title} ${it.summary}`.toLowerCase()
        for (const k of boost) if (blob.includes(k)) score += 1.5
        for (const k of suppress) if (blob.includes(k)) score -= 2.5
      }
      return { ...it, score: Math.round(score * 100) / 100 }
    })

  return adjusted.sort((a, b) => b.score - a.score).slice(0, policy.maxItems)
}
