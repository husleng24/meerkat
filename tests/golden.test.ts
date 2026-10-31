/**
 * 黄金测试：用 Python 原型真实跑出来的 80 条数据，逐条校验 TS 移植的
 * 分类与打分是否与 Python 完全一致。
 *
 * 这是移植正确性的唯一硬证据 —— 没有它，移植完只能"看起来对"。
 *
 * 数据来源：ai-radar/out/items-2026-10-29.json（35 源、48h 窗口、80 条）
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { classifyBucket } from '../src/core/pipeline/classify'
import { scoreItem } from '../src/core/pipeline/rank'
import { itemTypeOf } from '../src/core/policy/ranking'
import type { Bucket, SourceKind } from '../src/core/domain/types'

interface FixtureItem {
  id: string
  source_id: string
  source_name: string
  tier: number
  type: string
  bucket_hint: string
  title: string
  url: string
  published: string | null
  summary: string
  engagement: { points?: number; comments?: number; views?: number }
  bucket: string
  score: number
}

interface Fixture {
  generated_at: string
  window_hours: number
  count: number
  items: FixtureItem[]
}

const fixture: Fixture = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'python-items.json'), 'utf8')
) as Fixture

const now = Date.parse(fixture.generated_at)
const windowHours = fixture.window_hours

describe('golden：分类与 Python 一致', () => {
  it('80 条全部命中相同板块', () => {
    const mismatches: Array<{ title: string; expected: string; actual: string }> = []
    for (const it of fixture.items) {
      const actual = classifyBucket({
        title: it.title,
        summary: it.summary,
        sourceId: it.source_id,
        tier: it.tier,
        bucketHint: it.bucket_hint as Bucket,
        type: it.type
      })
      if (actual !== it.bucket) {
        mismatches.push({ title: it.title.slice(0, 60), expected: it.bucket, actual })
      }
    }
    expect(mismatches).toEqual([])
  })
})

describe('golden：打分与 Python 一致', () => {
  it('80 条分数误差 <0.01', () => {
    const mismatches: Array<{ title: string; expected: number; actual: number; diff: number }> = []
    for (const it of fixture.items) {
      const actual = scoreItem(
        {
          title: it.title,
          summary: it.summary,
          tier: it.tier,
          type: it.type,
          ...(it.published ? { publishedAt: Date.parse(it.published) } : {}),
          ...(it.engagement?.points !== undefined ? { points: it.engagement.points } : {})
        },
        { now, windowHours }
      )
      const diff = Math.abs(actual - it.score)
      if (diff >= 0.01) {
        mismatches.push({ title: it.title.slice(0, 60), expected: it.score, actual, diff })
      }
    }
    expect(mismatches).toEqual([])
  })
})

describe('golden：来源类型推导与 Python 抓取器一致', () => {
  it('每种来源的 type 都与 Python 产物相同', () => {
    // 从 fixture 反推：同一 source_id 的 type 应恒定
    const bySource = new Map<string, Set<string>>()
    for (const it of fixture.items) {
      const set = bySource.get(it.source_id) ?? new Set<string>()
      set.add(it.type)
      bySource.set(it.source_id, set)
    }
    for (const [sourceId, types] of bySource) {
      expect(types.size, `来源 ${sourceId} 的 type 不唯一: ${[...types].join(',')}`).toBe(1)
    }

    // 已知映射：sources.yaml 里的 kind -> Python 产出的 type
    const expected: Array<[SourceKind, string]> = [
      ['youtube', 'video'],
      ['github-trending', 'repo'],
      ['arxiv', 'arxiv'],
      ['hfpapers', 'hfpapers'],
      ['hn', 'hn'],
      ['anthropic', 'anthropic'],
      ['rss', 'rss'],
      ['html', 'rss']
    ]
    for (const [kind, type] of expected) {
      expect(itemTypeOf({ kind }), `kind=${kind}`).toBe(type)
    }
  })
})
