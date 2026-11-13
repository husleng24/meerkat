import { describe, expect, it } from 'vitest'
import { createMemoryStore } from '../src/adapters/store-sqlite/store'
import { applyImport, buildPack, parsePack, planImport } from '../src/app/source-pack'
import type { Source } from '../src/core/domain/types'

const source = (over: Partial<Source> = {}): Source => ({
  id: 's1',
  name: 'S1',
  kind: 'rss',
  url: 'https://example.com/feed',
  tier: 2,
  bucketHint: 'research',
  enabled: true,
  failStreak: 0,
  ...over
})

const pack = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  format: 'meerkat/source-pack',
  version: 1,
  exportedAt: '2026-11-12T00:00:00.000Z',
  domains: [{ id: 'ai', name: 'AI' }],
  topics: [],
  sources: [],
  ...over
})

describe('source pack：导出', () => {
  it('主题包只带该主题的源和领域，不带排程与健康度', () => {
    const store = createMemoryStore()
    store.sources.upsert(source({ id: 'a', name: 'A' }))
    store.sources.upsert(source({ id: 'b', name: 'B', url: 'https://example.com/b' }))
    store.topics.upsert({
      id: 'robotics',
      name: '机器人',
      domainId: 'ai',
      enabled: true,
      hour: 9,
      minute: 15,
      editorialFocus: '只关注人形机器人融资与失败',
      createdAt: 1,
      updatedAt: 1
    })
    store.topics.setSources('robotics', ['a'])

    const p = buildPack(store, { kind: 'topic', topicId: 'robotics' })
    expect(p.sources.map((s) => s.id)).toEqual(['a'])
    expect(p.topics).toHaveLength(1)
    expect(p.topics[0]?.focus).toBe('只关注人形机器人融资与失败')
    expect(p.topics[0]).not.toHaveProperty('hour')
    expect(p.topics[0]).not.toHaveProperty('minute')
    expect(p.sources[0]).not.toHaveProperty('failStreak')
    expect(p.domains.map((d) => d.id)).toEqual(['ai'])

    store.close()
  })

  it('全部包包含所有源与主题', () => {
    const store = createMemoryStore()
    store.sources.upsert(source({ id: 'a', name: 'A' }))
    const p = buildPack(store, { kind: 'all' })
    expect(p.sources.map((s) => s.id)).toEqual(['a'])
    expect(p.topics.map((t) => t.id)).toContain('ai')
    store.close()
  })
})

describe('source pack：校验', () => {
  it('拒绝错误的 format / version', () => {
    expect(() => parsePack(pack({ format: 'other' }))).toThrow('不是 Meerkat source pack')
    expect(() => parsePack(pack({ version: 2 }))).toThrow('不支持的包版本')
  })

  it('拒绝重复 id 与悬空源引用', () => {
    expect(() =>
      parsePack(
        pack({
          sources: [
            { id: 'a', name: 'A', kind: 'rss', tier: 2, bucketHint: 'research' },
            { id: 'a', name: 'B', kind: 'rss', tier: 2, bucketHint: 'research' }
          ]
        })
      )
    ).toThrow('源 id 重复')

    expect(() =>
      parsePack(
        pack({
          topics: [{ id: 't', name: 'T', domainId: 'ai', sources: ['missing'] }]
        })
      )
    ).toThrow('引用了不存在的源')
  })
})

describe('source pack：导入', () => {
  it('新主题默认 08:30，源与归属一次建好', () => {
    const store = createMemoryStore()
    const p = parsePack(
      pack({
        sources: [{ id: 'a', name: 'A', kind: 'rss', url: 'https://example.com/a', tier: 2, bucketHint: 'research' }],
        topics: [{ id: 'robotics', name: '机器人', domainId: 'ai', sources: ['a'] }]
      })
    )
    const plan = applyImport(store, p)

    expect(plan.counts.sources.create).toBe(1)
    expect(plan.counts.topics.create).toBe(1)
    const topic = store.topics.get('robotics')
    expect(topic?.hour).toBe(8)
    expect(topic?.minute).toBe(30)
    expect(store.topics.sourceIds('robotics')).toEqual(['a'])
    store.close()
  })

  it('同名主题整组替换源归属，但保留本机排程与源健康度', () => {
    const store = createMemoryStore()
    store.sources.upsert(
      source({
        id: 'old-source',
        name: 'arXiv cs.RO',
        url: 'https://old.example/feed',
        failStreak: 3
      })
    )
    store.sources.upsert(source({ id: 'extra', name: 'Extra', url: 'https://extra.example/feed' }))
    store.topics.upsert({
      id: 'robotics',
      name: '机器人',
      domainId: 'ai',
      enabled: true,
      hour: 9,
      minute: 15,
      createdAt: 1,
      updatedAt: 1
    })
    store.topics.setSources('robotics', ['old-source', 'extra'])

    const p = parsePack(
      pack({
        sources: [
          {
            id: 'pack-source',
            name: 'arXiv cs.RO',
            kind: 'rss',
            url: 'https://new.example/feed',
            tier: 2,
            bucketHint: 'research'
          }
        ],
        topics: [{ id: 'pack-topic', name: '机器人', domainId: 'ai', sources: ['pack-source'] }]
      })
    )
    const plan = planImport(store, p)
    expect(plan.counts.sources.update).toBe(1)
    expect(plan.counts.topics.update).toBe(1)
    applyImport(store, p)

    const topic = store.topics.get('robotics')
    expect(topic?.hour).toBe(9)
    expect(topic?.minute).toBe(15)
    expect(store.topics.sourceIds('robotics')).toEqual(['old-source'])
    const updated = store.sources.get('old-source')
    expect(updated?.url).toBe('https://new.example/feed')
    expect(updated?.failStreak).toBe(3)
    // 导入只换主题归属，不删库里没进包/没进主题的源
    expect(store.sources.get('extra')).toBeDefined()
    store.close()
  })

  it('导出再导入是幂等的', () => {
    const store = createMemoryStore()
    store.sources.upsert(source({ id: 'a', name: 'A' }))
    store.topics.upsert({
      id: 'robotics',
      name: '机器人',
      domainId: 'ai',
      enabled: true,
      hour: 9,
      minute: 15,
      createdAt: 1,
      updatedAt: 1
    })
    store.topics.setSources('robotics', ['a'])

    const exported = buildPack(store, { kind: 'all' })
    const plan = applyImport(store, parsePack(JSON.parse(JSON.stringify(exported))))

    expect(plan.counts.sources.create).toBe(0)
    expect(plan.counts.topics.create).toBe(0)
    expect(store.topics.get('robotics')?.hour).toBe(9)
    expect(store.topics.sourceIds('robotics')).toEqual(['a'])
    store.close()
  })
})
