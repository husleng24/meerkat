import { describe, expect, it } from 'vitest'
import { createMemoryStore } from '../src/adapters/store-sqlite/store'
import { seedVideoTopic, VIDEO_TOPIC_ID } from '../src/app/seed-video-topic'
import type { Source } from '../src/core/domain/types'

describe('预置 YouTube 博主主题', () => {
  it('首次启动创建 17 个源和主题，重复执行不复活', () => {
    const store = createMemoryStore()
    expect(seedVideoTopic(store)).toBe(17)
    const topic = store.topics.get(VIDEO_TOPIC_ID)
    expect(topic?.name).toBe('YouTube 博主')
    expect(store.topics.sourceIds(VIDEO_TOPIC_ID)).toHaveLength(17)
    expect(store.topics.sourceIds('ai')).toHaveLength(0)
    expect(seedVideoTopic(store)).toBe(0)
    expect(store.sources.list()).toHaveLength(17)
    store.close()
  })

  it('已有同频道源时复用原 id，不制造重复', () => {
    const store = createMemoryStore()
    const custom: Source = {
      id: 'my-no-priors',
      name: 'My No Priors',
      kind: 'youtube',
      channelId: 'UCSI7h9hydQ40K5MJHnCrQvw',
      tier: 2,
      bucketHint: 'video',
      alwaysKeep: true,
      enabled: true,
      failStreak: 0
    }
    store.sources.upsert(custom)
    seedVideoTopic(store)
    expect(store.sources.list()).toHaveLength(17)
    expect(store.topics.sourceIds(VIDEO_TOPIC_ID)).toContain('my-no-priors')
    store.close()
  })
})
