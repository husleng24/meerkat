import { describe, expect, it } from 'vitest'
import { createMemoryStore } from '../src/adapters/store-sqlite/store'
import { bootstrapEntities, matchEntityIds, rebuildEntityIndex, SEED_ENTITIES } from '../src/app/entities'
import type { Entity, Item, Source } from '../src/core/domain/types'

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

function item(id: string, title: string, summary = ''): Item {
  return {
    id,
    sourceId: 's1',
    title,
    url: `https://example.com/${id}`,
    summary,
    bucket: 'business',
    score: 8,
    formulaVersion: 1,
    alsoIn: [],
    fetchedAt: 1,
    publishedAt: 1
  }
}

const entities: Entity[] = [
  { id: 'openai', name: 'OpenAI', kind: 'company', aliases: ['OpenAI'], createdAt: 1, updatedAt: 1 },
  { id: 'sam', name: 'Sam Altman', kind: 'person', aliases: ['Sam Altman'], createdAt: 1, updatedAt: 1 }
]

describe('实体记忆', () => {
  it('ASCII 别名按词边界匹配，中文与全名也能命中', () => {
    expect(matchEntityIds('OpenAI launches a model', entities)).toContain('openai')
    expect(matchEntityIds('OpenAIssimo is not OpenAI', entities)).toEqual(['openai'])
    expect(matchEntityIds('Sam Altman said OpenAI will ship', entities)).toEqual(['openai', 'sam'])
    expect(matchEntityIds('nothing here', entities)).toEqual([])
  })

  it('首次启动建词表并把已有条目倒排进去', () => {
    const store = createMemoryStore()
    store.sources.upsert(source)
    store.items.upsertMany([item('a', 'OpenAI ships GPT', 'Sam Altman was there'), item('b', 'NVIDIA earnings')])
    expect(bootstrapEntities(store)).toBe(SEED_ENTITIES.length)
    expect(store.entities.linkCount()).toBeGreaterThan(0)
    expect(store.entities.itemIds('openai')).toContain('a')
    expect(store.entities.itemIds('sam-altman')).toContain('a')
    store.close()
  })

  it('重建会清掉旧关系再按当前词表重算', () => {
    const store = createMemoryStore()
    store.sources.upsert(source)
    store.items.upsertMany([item('a', 'OpenAI ships GPT')])
    bootstrapEntities(store)
    const first = store.entities.linkCount()
    expect(rebuildEntityIndex(store)).toBeGreaterThan(0)
    expect(store.entities.linkCount()).toBe(first)
    store.close()
  })
})
