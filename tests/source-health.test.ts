import { describe, it, expect } from 'vitest'
import {
  FAIL_THRESHOLD,
  healthOf,
  sortByHealth,
  suggestReplacement,
  summarizeHealth,
  summarizeProbe
} from '../src/app/source-health'
import type { Source } from '../src/core/domain/types'

function src(over: Partial<Source> = {}): Source {
  return {
    id: 's1',
    name: 'S1',
    kind: 'rss',
    tier: 2,
    bucketHint: 'product',
    enabled: true,
    failStreak: 0,
    ...over
  }
}

describe('healthOf', () => {
  it('从未成功过 → unknown', () => {
    expect(healthOf(src())).toBe('unknown')
  })
  it('成功过且无失败 → ok', () => {
    expect(healthOf(src({ lastOkAt: 1000 }))).toBe('ok')
  })
  it('失败 1–2 次 → degraded', () => {
    expect(healthOf(src({ failStreak: 1 }))).toBe('degraded')
    expect(healthOf(src({ failStreak: 2 }))).toBe('degraded')
  })
  it(`失败 ${FAIL_THRESHOLD} 次及以上 → failing`, () => {
    expect(healthOf(src({ failStreak: FAIL_THRESHOLD }))).toBe('failing')
    expect(healthOf(src({ failStreak: 9 }))).toBe('failing')
  })
})

describe('summarizeHealth', () => {
  it('分别统计四种状态与启用数', () => {
    const s = summarizeHealth([
      src({ id: 'a', lastOkAt: 1 }),
      src({ id: 'b', failStreak: 1 }),
      src({ id: 'c', failStreak: 5 }),
      src({ id: 'd' }),
      src({ id: 'e', enabled: false, lastOkAt: 1 })
    ])
    expect(s).toMatchObject({ total: 5, enabled: 4, ok: 2, degraded: 1, failing: 1, unknown: 1, attention: 2 })
  })
})

describe('sortByHealth', () => {
  it('坏源排前面，同级别按条数降序', () => {
    const list = [
      src({ id: 'ok-big', lastOkAt: 1, avgItems: 30 }),
      src({ id: 'fail', failStreak: 4 }),
      src({ id: 'ok-small', lastOkAt: 1, avgItems: 2 }),
      src({ id: 'degraded', failStreak: 1 })
    ]
    expect(sortByHealth(list).map((s) => s.id)).toEqual(['fail', 'degraded', 'ok-big', 'ok-small'])
  })
})

describe('suggestReplacement', () => {
  it('给失效源推荐同类里最健康的', () => {
    const failing = src({ id: 'bad', kind: 'rss', failStreak: 3 })
    const all = [
      failing,
      src({ id: 'good-1', kind: 'rss', lastOkAt: 1, avgItems: 5 }),
      src({ id: 'good-2', kind: 'rss', lastOkAt: 1, avgItems: 20 }),
      src({ id: 'other-kind', kind: 'youtube', lastOkAt: 1, avgItems: 99 })
    ]
    expect(suggestReplacement(failing, all)?.id).toBe('good-2')
  })
  it('没有可替代的返回 undefined', () => {
    const failing = src({ id: 'bad', kind: 'arxiv', failStreak: 3 })
    expect(suggestReplacement(failing, [failing])).toBeUndefined()
  })
})

describe('summarizeProbe', () => {
  it('全成功与部分失败的文案', () => {
    expect(
      summarizeProbe([
        { id: 'a', ok: true, n: 3, ms: 100 },
        { id: 'b', ok: true, n: 5, ms: 200 }
      ])
    ).toBe('2/2 全部可用')
    expect(
      summarizeProbe([
        { id: 'a', ok: true, n: 3, ms: 100 },
        { id: 'b', ok: false, n: 0, ms: 900, error: 'HTTP 429' }
      ])
    ).toBe('1/2 可用，1 个失败')
  })
})
