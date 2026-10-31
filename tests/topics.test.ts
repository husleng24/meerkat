import { describe, it, expect, beforeEach } from 'vitest'
import { createMemoryStore } from '../src/adapters/store-sqlite/store'
import type { Store } from '../src/core/ports/store'
import type { Brief, Item, Source } from '../src/core/domain/types'

const T = 1_761_000_000_000

function src(id: string): Source {
  return {
    id,
    name: id,
    kind: 'rss',
    url: `https://example.com/${id}.xml`,
    tier: 1,
    bucketHint: 'product',
    enabled: true,
    failStreak: 0
  }
}

function item(id: string): Item {
  return {
    id,
    sourceId: 's1',
    title: `Title ${id}`,
    url: `https://example.com/${id}`,
    summary: '',
    bucket: 'product',
    score: 10,
    formulaVersion: 1,
    alsoIn: [],
    fetchedAt: T
  }
}

function brief(id: string, topicId: string, date = '2026-10-30'): Brief {
  return {
    id,
    date,
    topicId,
    markdown: `# 简报 ${topicId}`,
    model: 'test',
    tokensIn: 0,
    tokensOut: 0,
    createdAt: T
  }
}

describe('主题仓储', () => {
  let s: Store
  beforeEach(() => {
    s = createMemoryStore()
    s.sources.upsertMany([src('s1'), src('s2')])
  })

  it('新库自带一个 ai 主题', () => {
    expect(s.topics.list().map((t) => t.id)).toEqual(['ai'])
    expect(s.topics.get('ai')!.name).toBe('AI 综合')
  })

  it('可新增、改名、删除', () => {
    s.topics.upsert({ ...s.topics.get('ai')!, id: 'chip', name: '芯片与算力' })
    expect(s.topics.list()).toHaveLength(2)

    s.topics.upsert({ ...s.topics.get('chip')!, name: '芯片', enabled: false })
    expect(s.topics.get('chip')!.name).toBe('芯片')
    expect(s.topics.get('chip')!.enabled).toBe(false)

    s.topics.remove('chip')
    expect(s.topics.get('chip')).toBeUndefined()
  })

  it('源归属按主题分别记，同一个源可以同时在两个主题里', () => {
    s.topics.upsert({ ...s.topics.get('ai')!, id: 'chip', name: '芯片' })
    s.topics.setSources('ai', ['s1', 's2'])
    s.topics.setSources('chip', ['s2'])
    expect(s.topics.sourceIds('ai').sort()).toEqual(['s1', 's2'])
    expect(s.topics.sourceIds('chip')).toEqual(['s2'])

    s.topics.removeSource('chip', 's2')
    expect(s.topics.sourceIds('chip')).toEqual([])
    expect(s.topics.sourceIds('ai')).toHaveLength(2)
  })

  it('setSources 是替换而不是追加', () => {
    s.topics.setSources('ai', ['s1', 's2'])
    s.topics.setSources('ai', ['s1'])
    expect(s.topics.sourceIds('ai')).toEqual(['s1'])
  })

  it('删主题会级联删掉它的源归属', () => {
    s.topics.upsert({ ...s.topics.get('ai')!, id: 'chip', name: '芯片' })
    s.topics.setSources('chip', ['s1'])
    s.topics.remove('chip')
    expect(s.topics.sourceIds('chip')).toEqual([])
  })
})

describe('简报按主题隔离', () => {
  let s: Store
  beforeEach(() => {
    s = createMemoryStore()
    s.sources.upsertMany([src('s1')])
    s.topics.upsert({ ...s.topics.get('ai')!, id: 'chip', name: '芯片' })
    s.briefs.save(brief('2026-10-30-ai', 'ai'))
    s.briefs.save(brief('2026-10-30-chip', 'chip'))
    s.briefs.save(brief('2026-10-29-ai', 'ai', '2026-10-29'))
  })

  it('latest 只返回该主题的最近一期', () => {
    expect(s.briefs.latest('ai')!.markdown).toContain('ai')
    expect(s.briefs.latest('chip')!.date).toBe('2026-10-30')
  })

  it('同一天两个主题各有一条，互不覆盖', () => {
    expect(s.briefs.byDate('2026-10-30', 'ai')!.date).toBe('2026-10-30')
    expect(s.briefs.byDate('2026-10-30', 'chip')!.date).toBe('2026-10-30')
  })

  it('list 按主题过滤，不传主题时跨主题', () => {
    expect(s.briefs.list(10, 'ai')).toHaveLength(2)
    expect(s.briefs.list(10, 'chip')).toHaveLength(1)
    expect(s.briefs.list(10)).toHaveLength(3)
  })
})

describe('已推送记录按主题隔离', () => {
  let s: Store
  beforeEach(() => {
    s = createMemoryStore()
    s.sources.upsertMany([src('s1')])
    s.items.upsertMany([item('i1'), item('i2')])
    s.topics.upsert({ ...s.topics.get('ai')!, id: 'chip', name: '芯片' })
  })

  it('A 主题推过的条目，B 主题仍然算新', () => {
    s.items.markBriefed(['i1'], T, 'ai')
    expect(s.items.briefedIds(T - 1, 'ai').has('i1')).toBe(true)
    expect(s.items.briefedIds(T - 1, 'chip').has('i1')).toBe(false)
  })

  it('不传主题时返回全局已推送集合（诊断用）', () => {
    s.items.markBriefed(['i1'], T, 'ai')
    s.items.markBriefed(['i2'], T, 'chip')
    expect([...s.items.briefedIds(T - 1)].sort()).toEqual(['i1', 'i2'])
  })

  it('重复标记同一主题不产生重复行', () => {
    s.items.markBriefed(['i1'], T, 'ai')
    s.items.markBriefed(['i1'], T + 1000, 'ai')
    expect(s.items.briefedIds(T - 1, 'ai').size).toBe(1)
  })
})
