/**
 * 源健康度：纯函数，便于单测，也便于界面与诊断包共用同一套口径。
 *
 * 判定规则（与产品定义一致）：
 *  - ok       连续失败 0 次
 *  - degraded 连续失败 1–2 次（还能用，但要留意）
 *  - failing  连续失败 ≥3 次（触发告警，界面上标红并给替代建议）
 */
import type { Source } from '../core/domain/types'

export type HealthLevel = 'ok' | 'degraded' | 'failing' | 'unknown'

export const FAIL_THRESHOLD = 3

export function healthOf(source: Source): HealthLevel {
  if (source.failStreak >= FAIL_THRESHOLD) return 'failing'
  if (source.failStreak > 0) return 'degraded'
  if (source.lastOkAt === undefined) return 'unknown'
  return 'ok'
}

export interface HealthSummary {
  total: number
  enabled: number
  ok: number
  degraded: number
  failing: number
  unknown: number
  /** 有问题的源（degraded + failing），界面据此排序与告警 */
  attention: number
}

export function summarizeHealth(sources: Source[]): HealthSummary {
  const s: HealthSummary = {
    total: sources.length,
    enabled: 0,
    ok: 0,
    degraded: 0,
    failing: 0,
    unknown: 0,
    attention: 0
  }
  for (const src of sources) {
    if (src.enabled) s.enabled += 1
    s[healthOf(src)] += 1
  }
  s.attention = s.degraded + s.failing
  return s
}

const LEVEL_WEIGHT: Record<HealthLevel, number> = { failing: 0, degraded: 1, unknown: 2, ok: 3 }

/** 有问题的排前面，同级别按条数降序——用户打开"源"页最想先看到坏的 */
export function sortByHealth(sources: Source[]): Source[] {
  return [...sources].sort((a, b) => {
    const wa = LEVEL_WEIGHT[healthOf(a)]
    const wb = LEVEL_WEIGHT[healthOf(b)]
    if (wa !== wb) return wa - wb
    return (b.avgItems ?? 0) - (a.avgItems ?? 0)
  })
}

/** 失效源的替代建议：同类源里最健康的一个，作为"换成谁"的提示 */
export function suggestReplacement(failing: Source, all: Source[]): Source | undefined {
  return all
    .filter((s) => s.id !== failing.id && s.kind === failing.kind && healthOf(s) === 'ok' && s.enabled)
    .sort((a, b) => (b.avgItems ?? 0) - (a.avgItems ?? 0))[0]
}

export interface ProbeResult {
  id: string
  ok: boolean
  n: number
  ms: number
  error?: string
}

export function summarizeProbe(results: ProbeResult[]): string {
  const ok = results.filter((r) => r.ok).length
  const failed = results.length - ok
  return failed === 0 ? `${ok}/${results.length} 全部可用` : `${ok}/${results.length} 可用，${failed} 个失败`
}
