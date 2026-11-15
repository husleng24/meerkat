import { describe, it, expect } from 'vitest'
import { cleanAliases, fallbackAliases, mergeAliases, parseAliasesJson } from '../src/app/aliases'
import { expandAliases } from '../src/main/alias-expander'
import { createMemoryStore } from '../src/adapters/store-sqlite/store'
import { collectRelatedItems } from '../src/app/event-timeline'
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

describe('别名清洗', () => {
  it('过滤指令词和过长句子', () => {
    expect(cleanAliases(['黄仁勋', '@agent 帮我盯着', 'Jensen Huang', '这件事', 'Introducing'])).toEqual([
      '黄仁勋',
      'Jensen Huang'
    ])
  })

  it('标题保底别名包含实体', () => {
    expect(fallbackAliases('黄仁勋辞职，英伟达33年首换帅')).toEqual(expect.arrayContaining(['黄仁勋']))
  })

  it('合并时实体优先且去重', () => {
    expect(mergeAliases(['黄仁勋'], ['Jensen Huang', '黄仁勋'])).toEqual(['黄仁勋', 'Jensen Huang'])
  })

  it('解析 JSON 数组，坏输入返回空', () => {
    expect(parseAliasesJson('["黄仁勋","Jensen Huang"]')).toEqual(['黄仁勋', 'Jensen Huang'])
    expect(parseAliasesJson('不是 json')).toEqual([])
    expect(parseAliasesJson('{"a":1}')).toEqual([])
  })
})

describe('模型别名扩展', () => {
  it('没有模型时退回标题实体，不抛错', async () => {
    const aliases = await expandAliases({ keys: {} }, item('i1', '黄仁勋辞职，英伟达换帅'))
    expect(aliases).toContain('黄仁勋')
  })
})

describe('别名参与检索', () => {
  it('中文事件可以通过英文别名找到英文报道', () => {
    const store = createMemoryStore()
    store.sources.upsertMany([
      { id: 's1', name: '量子位', kind: 'rss', tier: 2, bucketHint: 'product', enabled: true, failStreak: 0 }
    ])
    store.items.upsertMany([
      item('i1', '黄仁勋辞职，英伟达33年首换帅'),
      item('i2', 'Jensen Huang resigns as NVIDIA CEO'),
      item('i3', 'OpenAI launches a new model')
    ])
    const r = collectRelatedItems(store, { itemId: 'i1', aliases: ['Jensen Huang', 'NVIDIA'] })
    const ids = r.items.map((i) => i.id)
    expect(ids).toContain('i2')
    expect(ids).not.toContain('i3')
  })
})
