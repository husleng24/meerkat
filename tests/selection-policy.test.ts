import { describe, it, expect } from 'vitest'
import { createMemoryStore } from '../src/adapters/store-sqlite/store'
import {
  DEFAULT_SELECTION_POLICY,
  applySelectionPolicy,
  resolveSelectionPolicy
} from '../src/app/selection-policy'
import type { Item } from '../src/core/domain/types'

const item = (id: string, bucket: Item['bucket'], title: string, score: number): Item => ({
  id,
  sourceId: 's1',
  title,
  url: `https://example.com/${id}`,
  summary: title,
  bucket,
  score,
  formulaVersion: 1,
  alsoIn: [],
  fetchedAt: Date.now()
})

describe('选材策略', () => {
  it('默认值保持原行为', () => {
    expect(DEFAULT_SELECTION_POLICY).toMatchObject({ windowHours: 48, maxItems: 80, targetMin: 15, targetMax: 24 })
    expect(resolveSelectionPolicy(null)).toEqual(DEFAULT_SELECTION_POLICY)
  })

  it('越界值会被收敛，板块为空时退回默认', () => {
    const p = resolveSelectionPolicy({
      windowHours: 9999,
      maxItems: 1,
      targetMin: 0,
      targetMax: 999,
      buckets: [],
      boostKeywords: [' 融资 ', '融资'],
      suppressKeywords: ['教程']
    })
    expect(p.windowHours).toBe(336)
    expect(p.maxItems).toBe(10)
    expect(p.targetMin).toBe(1)
    expect(p.targetMax).toBe(60)
    expect(p.buckets.length).toBeGreaterThan(0)
    expect(p.boostKeywords).toEqual(['融资'])
  })

  it('按板块过滤，并按关键词加减分', () => {
    const items = [
      item('a', 'product', '融资新闻', 10),
      item('b', 'product', '招聘启事', 12),
      item('c', 'policy', '监管新规', 9)
    ]
    const p = resolveSelectionPolicy({
      buckets: ['product'],
      boostKeywords: ['融资'],
      suppressKeywords: ['招聘']
    })
    const out = applySelectionPolicy(items, p)
    // 压制词是扣分，不是直接删除；a 11.5 仍排在 b 9.5 前面
    expect(out.map((x) => x.id)).toEqual(['a', 'b'])
    expect(out[0]!.score).toBeCloseTo(11.5)
    expect(out[1]!.score).toBeCloseTo(9.5)
  })

  it('maxItems 截断', () => {
    const items = Array.from({ length: 15 }, (_, i) => item(`i${i}`, 'product', `标题${i}`, 20 - i))
    const out = applySelectionPolicy(items, resolveSelectionPolicy({ maxItems: 10 }))
    expect(out).toHaveLength(10)
  })
})

describe('策略持久化', () => {
  it('存到主题上并能读回', () => {
    const store = createMemoryStore()
    const topic = store.topics.get('ai')!
    const policy = resolveSelectionPolicy({ windowHours: 72, targetMax: 12, boostKeywords: ['开源'] })
    store.topics.upsert({ ...topic, selectionPolicy: policy })
    const got = store.topics.get('ai')!
    expect(got.selectionPolicy).toMatchObject({ windowHours: 72, targetMax: 12, boostKeywords: ['开源'] })
  })
})
