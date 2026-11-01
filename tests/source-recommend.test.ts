import { describe, it, expect } from 'vitest'
import { createMemoryStore } from '../src/adapters/store-sqlite/store'
import { recommendSources } from '../src/app/source-recommend'

const NOW = 1_793_500_000_000

function seed() {
  const s = createMemoryStore()
  const now = NOW
  s.topics.upsert({
    id: 'chip',
    name: '芯片与算力',
    domainId: 'ai',
    enabled: true,
    hour: 8,
    minute: 30,
    createdAt: now,
    updatedAt: now
  })
  s.sources.upsertMany([
    { id: 'nvidia', name: '英伟达博客', kind: 'rss', url: 'https://nvidia.com/blog', tier: 1, bucketHint: 'infra', enabled: true, failStreak: 0 },
    { id: 'semi', name: '半导体行业观察', kind: 'rss', tier: 2, bucketHint: 'infra', enabled: true, failStreak: 0 },
    { id: 'cat', name: '猫咪日常', kind: 'rss', tier: 3, bucketHint: 'opinion', enabled: true, failStreak: 0 },
    { id: 'off', name: '停更的芯片源', kind: 'rss', tier: 2, bucketHint: 'infra', enabled: false, failStreak: 0 }
  ])
  s.topics.setSources('chip', ['nvidia'])

  const item = (id: string, sourceId: string, title: string): void =>
    s.items.upsertMany([
      {
        id,
        sourceId,
        title,
        url: `https://example.com/${id}`,
        summary: '',
        bucket: 'infra',
        score: 10,
        formulaVersion: 1,
        alsoIn: [],
        publishedAt: now - 86_400_000,
        fetchedAt: now - 86_400_000
      }
    ])
  // 已选源的语料
  item('n1', 'nvidia', '英伟达发布新一代 GPU 架构')
  item('n2', 'nvidia', '台积电 3nm 产能爬坡')
  // 候选源：名字完全不同，但内容重合
  item('s1', 'semi', '台积电 3nm 产能再创新高')
  item('s2', 'semi', '英伟达 GPU 供货周期缩短')
  // 无关源
  item('c1', 'cat', '猫咪今天吃了两条小鱼')
  item('o1', 'off', '芯片 产能')
  return s
}

describe('按主题推荐源', () => {
  it('内容重合的源排在前面，并给出理由', () => {
    const s = seed()
    const rec = recommendSources(s, 'chip', { now: NOW })
    expect(rec.map((r) => r.id)).toContain('semi')
    expect(rec.find((r) => r.id === 'semi')?.reason).toContain('重合')
    // 已选源不重复推荐
    expect(rec.map((r) => r.id)).not.toContain('nvidia')
  })

  it('无关源、停用源不推荐', () => {
    const s = seed()
    const ids = recommendSources(s, 'chip', { now: NOW }).map((r) => r.id)
    expect(ids).not.toContain('cat')
    expect(ids).not.toContain('off')
  })

  it('主题名和源名重合时权重更高', () => {
    const s = seed()
    s.sources.upsertMany([
      { id: 'chipnews', name: '芯片与算力日报', kind: 'rss', tier: 2, bucketHint: 'infra', enabled: true, failStreak: 0 }
    ])
    const rec = recommendSources(s, 'chip', { now: NOW })
    expect(rec[0]?.id).toBe('chipnews')
    expect(rec[0]?.reason).toContain('名字')
  })

  it('没有条目语料时仍然能按名字推荐，完全不相关时返回空', () => {
    const s = createMemoryStore()
    s.sources.upsertMany([
      { id: 'a', name: 'AI 周报', kind: 'rss', tier: 2, bucketHint: 'product', enabled: true, failStreak: 0 },
      { id: 'b', name: '天气预报', kind: 'rss', tier: 3, bucketHint: 'opinion', enabled: true, failStreak: 0 }
    ])
    expect(recommendSources(s, 'ai', { now: NOW }).map((r) => r.id)).toEqual(['a'])
  })

  it('只重合一个稀有词也不推荐（避免撞词）', () => {
    const s = createMemoryStore()
    s.sources.upsertMany([
      { id: 'base', name: '基础源', kind: 'rss', tier: 2, bucketHint: 'infra', enabled: true, failStreak: 0 },
      { id: 'weak', name: '边缘源', kind: 'rss', tier: 2, bucketHint: 'infra', enabled: true, failStreak: 0 }
    ])
    s.topics.setSources('ai', ['base'])
    const mk = (id: string, sourceId: string, title: string): void =>
      s.items.upsertMany([
        {
          id,
          sourceId,
          title,
          url: `https://example.com/${id}`,
          summary: '',
          bucket: 'infra',
          score: 10,
          formulaVersion: 1,
          alsoIn: [],
          publishedAt: NOW - 3_600_000,
          fetchedAt: NOW - 3_600_000
        }
      ])
    mk('b1', 'base', '台积电 3nm 产能')
    mk('w1', 'weak', '台积电 财报')
    expect(recommendSources(s, 'ai', { now: NOW }).map((r) => r.id)).not.toContain('weak')
  })

  it('到处都出现的词（公司名）不足以推荐一个源', () => {
    const s = createMemoryStore()
    const ids = ['s1', 's2', 's3']
    s.sources.upsertMany(
      ids.map((id) => ({
        id,
        name: `源 ${id}`,
        kind: 'rss',
        tier: 2,
        bucketHint: 'product' as const,
        enabled: true,
        failStreak: 0
      }))
    )
    s.topics.setSources('ai', ['s1', 's2'])
    for (const id of ids) {
      s.items.upsertMany([
        {
          id: `i-${id}`,
          sourceId: id,
          title: 'OpenAI 发布新模型',
          url: `https://example.com/${id}`,
          summary: '',
          bucket: 'product',
          score: 10,
          formulaVersion: 1,
          alsoIn: [],
          publishedAt: NOW - 3_600_000,
          fetchedAt: NOW - 3_600_000
        }
      ])
    }
    // s3 只和主题共享"OpenAI"这个到处都是的词 → 不推荐
    expect(recommendSources(s, 'ai', { now: NOW }).map((r) => r.id)).not.toContain('s3')
  })

  it('主题不存在时返回空数组', () => {
    expect(recommendSources(createMemoryStore(), 'nope', { now: NOW })).toEqual([])
  })
})
