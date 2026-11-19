import { describe, expect, it } from 'vitest'
import { createMemoryStore } from '../src/adapters/store-sqlite/store'
import type { Item, Source } from '../src/core/domain/types'

const source: Source = {
  id: 's1',
  name: '源',
  kind: 'rss',
  url: 'https://example.com/feed',
  tier: 2,
  bucketHint: 'business',
  enabled: true,
  failStreak: 0
}

const item: Item = {
  id: 'item-decision',
  sourceId: 's1',
  title: '一条新闻',
  url: 'https://example.com/news',
  summary: '摘要',
  bucket: 'business',
  score: 8,
  formulaVersion: 1,
  alsoIn: [],
  fetchedAt: 1,
  publishedAt: 1
}

describe('决策笔记存储', () => {
  it('按条目保存、批量读取并支持更新', () => {
    const store = createMemoryStore()
    store.sources.upsert(source)
    store.items.upsertMany([item])
    store.decisions.upsert({ itemId: item.id, note: '这会改变选型', createdAt: 1, updatedAt: 1 })
    expect(store.decisions.get(item.id)?.note).toBe('这会改变选型')
    expect(store.decisions.listByIds([item.id])).toHaveLength(1)

    store.decisions.upsert({ itemId: item.id, note: '判断更新', createdAt: 1, updatedAt: 2 })
    expect(store.decisions.get(item.id)?.note).toBe('判断更新')
    expect(store.decisions.recent(0)).toHaveLength(1)
    store.decisions.remove(item.id)
    expect(store.decisions.get(item.id)).toBeUndefined()
    store.close()
  })

  it('recent 只返回时间窗口内的判断', () => {
    const store = createMemoryStore()
    store.sources.upsert(source)
    store.items.upsertMany([item])
    store.decisions.upsert({ itemId: item.id, note: '旧判断', createdAt: 1, updatedAt: 1 })
    expect(store.decisions.recent(2)).toHaveLength(0)
    store.close()
  })
})
