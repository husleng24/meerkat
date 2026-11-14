import { describe, it, expect } from 'vitest'
import { createMemoryStore } from '../src/adapters/store-sqlite/store'
import {
  STALE_AFTER_MISSES,
  createStoryFromItem,
  markStoryPrompted,
  newStoryItems,
  refreshStories,
  setStoryStatus,
  storiesToReview
} from '../src/app/story-tracking'
import type { Item } from '../src/core/domain/types'

const NOW = new Date('2026-11-14T10:00:00+08:00').getTime()
const DAY = 86_400_000

function seedItem(id: string, title: string, publishedAt: number): Item {
  return {
    id,
    sourceId: 's1',
    title,
    url: `https://example.com/${id}`,
    summary: '摘要',
    bucket: 'product',
    score: 10,
    formulaVersion: 1,
    alsoIn: [],
    publishedAt,
    fetchedAt: publishedAt
  }
}

function seed() {
  const store = createMemoryStore()
  store.sources.upsertMany([
    { id: 's1', name: '量子位', kind: 'rss', tier: 2, bucketHint: 'product', enabled: true, failStreak: 0 }
  ])
  store.items.upsertMany([seedItem('i1', '黄仁勋辞职，英伟达换帅', NOW - DAY)])
  return store
}

function makeStory(store: ReturnType<typeof seed>) {
  const story = createStoryFromItem(store, {
    itemId: 'i1',
    threadId: 'ct-1',
    topicId: 'ai',
    text: '@agent 帮我盯着',
    now: NOW - 2 * DAY
  })!
  store.stories.create(story)
  store.stories.addItems(story.id, ['i1'], NOW - 2 * DAY)
  return story
}

describe('跟踪匹配', () => {
  it('从条目创建 story，别名来自标题', () => {
    const store = seed()
    const story = makeStory(store)
    expect(story.aliases.some((a) => a.includes('黄仁勋'))).toBe(true)
    expect(store.stories.get(story.id)?.status).toBe('active')
  })

  it('只返回上次检查之后的新条目', () => {
    const store = seed()
    const story = makeStory(store)
    store.stories.update(story.id, { lastMatchAt: NOW - DAY })
    store.items.upsertMany([seedItem('i2', '黄仁勋回应辞职传闻', NOW)])
    const fresh = newStoryItems(store, store.stories.get(story.id)!)
    expect(fresh.map((i) => i.id)).toContain('i2')
  })

  it('有新进展时清零 missCount，连续空跑累加', () => {
    const store = seed()
    const story = makeStory(store)
    store.stories.update(story.id, { lastMatchAt: NOW - 2 * DAY })
    store.items.upsertMany([seedItem('i2', '黄仁勋回应辞职传闻', NOW - DAY)])
    const first = refreshStories(store, NOW - DAY)
    expect(first[0]!.added.length).toBe(1)
    expect(first[0]!.missCount).toBe(0)
    const second = refreshStories(store, NOW)
    expect(second[0]!.missCount).toBe(1)
    const third = refreshStories(store, NOW + DAY)
    expect(third[0]!.missCount).toBe(2)
    expect(store.stories.get(story.id)?.missCount).toBe(2)
  })
})

describe('连续无进展的询问', () => {
  it('达到阈值后进入待询问，弹过就冷却', () => {
    const store = seed()
    const story = makeStory(store)
    store.stories.update(story.id, { missCount: STALE_AFTER_MISSES })
    expect(storiesToReview(store, NOW).map((s) => s.id)).toEqual([story.id])
    markStoryPrompted(store, story.id, NOW)
    expect(storiesToReview(store, NOW)).toEqual([])
    expect(storiesToReview(store, NOW + 8 * DAY).map((s) => s.id)).toEqual([story.id])
  })

  it('继续跟踪会清零，放弃会归档', () => {
    const store = seed()
    const story = makeStory(store)
    store.stories.update(story.id, { missCount: STALE_AFTER_MISSES, lastPromptAt: NOW })
    setStoryStatus(store, story.id, 'active')
    expect(store.stories.get(story.id)?.missCount).toBe(0)
    setStoryStatus(store, story.id, 'archived')
    expect(store.stories.get(story.id)?.status).toBe('archived')
    expect(storiesToReview(store, NOW + 30 * DAY)).toEqual([])
  })
})
