import { describe, expect, it } from 'vitest'
import { buildBriefTrace, parseBriefTrace } from '../src/app/brief-trace'
import type { Item, Source } from '../src/core/domain/types'

const source: Source = {
  id: 's1',
  name: '官方博客',
  kind: 'rss',
  url: 'https://example.com/feed',
  tier: 1,
  bucketHint: 'product',
  enabled: true,
  failStreak: 0,
  createdAt: 0,
  updatedAt: 0
}

const item: Item & { sourceName: string } = {
  id: 'i1',
  sourceId: 's1',
  title: 'LangChain 融资',
  url: 'https://example.com/a',
  summary: '摘要',
  bucket: 'business',
  score: 8.4,
  formulaVersion: 1,
  alsoIn: ['Tech.eu'],
  fetchedAt: 1,
  publishedAt: 1_700_000_000_000,
  sourceName: '官方博客'
}

describe('简报来源证据', () => {
  it('只为被引用的条目建 trace，并保留主链接', () => {
    const merged = { ...item, id: 'i2', url: 'https://example.com/b', sourceName: 'Tech.eu' }
    const trace = buildBriefTrace([item, merged], ['i1'], [source], {
      candidates: 2,
      sourceCount: 1,
      failedSources: 0,
      droppedAsBriefed: 3,
      filterOverridden: false
    })

    expect(trace.cited).toHaveLength(1)
    expect(trace.cited[0]).toMatchObject({
      itemId: 'i1',
      tier: 1,
      sourceName: '官方博客',
      alsoIn: ['Tech.eu']
    })
    expect(trace.cited[0]?.urls).toEqual([item.url])
    expect(trace).toMatchObject({ candidates: 2, droppedAsBriefed: 3, filterOverridden: false })
  })

  it('旧简报或坏 JSON 返回 undefined，不炸界面', () => {
    expect(parseBriefTrace(undefined)).toBeUndefined()
    expect(parseBriefTrace('')).toBeUndefined()
    expect(parseBriefTrace('{')).toBeUndefined()
    expect(parseBriefTrace(JSON.stringify({ version: 2, cited: [] }))).toBeUndefined()
  })

  it('能 round-trip 自己写出的 trace', () => {
    const trace = buildBriefTrace([item], ['i1'], [source], {
      candidates: 1,
      sourceCount: 1,
      failedSources: 0,
      droppedAsBriefed: 0,
      filterOverridden: false
    })
    expect(parseBriefTrace(JSON.stringify(trace))?.cited[0]?.itemId).toBe('i1')
  })
})
