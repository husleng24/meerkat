import { describe, it, expect } from 'vitest'
import { createMemoryStore } from '../src/adapters/store-sqlite/store'
import { ensureItemThread, ensureThread } from '../src/main/chat'
import type { Item } from '../src/core/domain/types'

const NOW = new Date('2026-11-14T10:00:00+08:00').getTime()

function seed() {
  const store = createMemoryStore()
  store.sources.upsertMany([
    { id: 's1', name: '量子位', kind: 'rss', tier: 2, bucketHint: 'product', enabled: true, failStreak: 0 }
  ])
  const item: Item = {
    id: 'i1',
    sourceId: 's1',
    title: '黄仁勋辞职，英伟达33年首换帅',
    url: 'https://example.com/i1',
    summary: '摘要',
    bucket: 'product',
    score: 10,
    formulaVersion: 1,
    alsoIn: [],
    publishedAt: NOW,
    fetchedAt: NOW
  }
  store.items.upsertMany([item])
  return store
}

describe('条目评论串', () => {
  it('为一条新闻建独立的评论串，且重复打开复用', () => {
    const store = seed()
    const a = ensureItemThread(store, { topicId: 'ai', itemId: 'i1' })
    expect(a?.scope).toBe('item')
    expect(a?.itemId).toBe('i1')
    expect(a?.title).toContain('黄仁勋')
    const b = ensureItemThread(store, { topicId: 'ai', itemId: 'i1' })
    expect(b?.id).toBe(a?.id)
    expect(store.chat.findByItem('ai', 'i1')?.id).toBe(a?.id)
  })

  it('条目不存在时不建串', () => {
    const store = seed()
    expect(ensureItemThread(store, { topicId: 'ai', itemId: 'nope' })).toBeNull()
  })

  it('简报对话仍然是 brief scope，不会被条目串抢走', () => {
    const store = seed()
    ensureItemThread(store, { topicId: 'ai', itemId: 'i1' })
    const briefThread = ensureThread(store, { topicId: 'ai' })
    expect(briefThread?.scope).toBe('brief')
    expect(briefThread?.itemId).toBeUndefined()
  })
})
