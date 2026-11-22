import { describe, it, expect, vi } from 'vitest'

// main/daily -> log -> electron；测试里必须 mock，否则 Electron 44 会触发二进制下载
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/meerkat-test' } }))
import { createMemoryStore } from '../src/adapters/store-sqlite/store'
import { dryRunPrompt } from '../src/main/prompt-eval'
import type { Item } from '../src/core/domain/types'

const NOW = Date.now()

function item(id: string, title: string): Item {
  return {
    id,
    sourceId: 's1',
    title,
    url: `https://example.com/${id}`,
    summary: title,
    bucket: 'product',
    score: 10,
    formulaVersion: 1,
    alsoIn: [],
    publishedAt: NOW,
    fetchedAt: NOW
  }
}

function seed() {
  const store = createMemoryStore()
  store.sources.upsertMany([
    { id: 's1', name: '官方博客', kind: 'rss', tier: 1, bucketHint: 'product', enabled: true, failStreak: 0 }
  ])
  store.topics.setSources('ai', ['s1'])
  store.items.upsertMany([item('i1', '新模型发布'), item('i2', '产品更新')])
  return store
}

describe('提示词试跑', () => {
  it('没有模型时也能返回降级稿和指标，且不落库', async () => {
    const store = seed()
    const before = store.briefs.list(10, 'ai').length
    const res = await dryRunPrompt(store, { compose: null, promptText: 'PROMPT' }, {
      topicId: 'ai',
      profileId: 'builtin',
      profileName: '内置 · 通用',
      profileVersion: 0
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.result.degraded).toBe(true)
    expect(res.result.metrics.items).toBe(2)
    expect(res.result.metrics.cited).toBeGreaterThan(0)
    expect(store.briefs.list(10, 'ai').length).toBe(before)
  })

  it('主题不存在时返回错误', async () => {
    const store = seed()
    const res = await dryRunPrompt(store, { compose: null, promptText: 'PROMPT' }, {
      topicId: 'nope',
      profileId: 'builtin',
      profileName: '内置',
      profileVersion: 0
    })
    expect(res.ok).toBe(false)
  })
})

describe('评测记录', () => {
  it('保存后能按主题读出', () => {
    const store = seed()
    store.prompts.addEvaluation({
      id: 'pe-1',
      topicId: 'ai',
      profileId: 'pp-1',
      profileName: '时装',
      profileVersion: 2,
      rating: 4,
      notes: '结构更清楚',
      metrics: { cited: 12, linkRate: 100 },
      createdAt: NOW
    })
    const list = store.prompts.evaluations('ai')
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ rating: 4, metrics: { cited: 12, linkRate: 100 } })
  })
})
