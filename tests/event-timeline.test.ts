import { describe, it, expect } from 'vitest'
import { createMemoryStore } from '../src/adapters/store-sqlite/store'
import {
  buildDeterministicTimeline,
  collectRelatedItems,
  extractKeywords,
  findGaps,
  mergeDuplicates,
  parseTimelineJson
} from '../src/app/event-timeline'
import { composeItemTimeline } from '../src/main/item-timeline'
import type { Item } from '../src/core/domain/types'

const DAY = 86_400_000
const at = (iso: string): number => new Date(`${iso}T10:00:00+08:00`).getTime()

function item(id: string, title: string, iso: string, url = `https://example.com/${id}`): Item {
  return {
    id,
    sourceId: 's1',
    title,
    url,
    summary: `${title} 的摘要`,
    bucket: 'product',
    score: 10,
    formulaVersion: 1,
    alsoIn: [],
    publishedAt: at(iso),
    fetchedAt: at(iso)
  }
}

function seed() {
  const store = createMemoryStore()
  store.sources.upsertMany([
    { id: 's1', name: '量子位', kind: 'rss', tier: 2, bucketHint: 'product', enabled: true, failStreak: 0 }
  ])
  store.items.upsertMany([
    item('i1', '黄仁勋辞职，英伟达33年首换帅，市值蒸发超3万亿', '2026-11-13'),
    item('i2', '黄仁勋承认出轨发全员信道歉！英伟达启动紧急调查', '2026-11-09'),
    item('i3', '马斯克已准备好聘请黄仁勋', '2026-11-12'),
    item('i4', 'OpenAI 发布新模型', '2026-11-11')
  ])
  return store
}

describe('事件关键词', () => {
  it('从标题里剥掉事件词，留下实体', () => {
    const kw = extractKeywords('黄仁勋辞职，英伟达33年首换帅，市值蒸发超3万亿')
    expect(kw).toContain('黄仁勋')
    expect(kw.some((k) => k.startsWith('英伟达'))).toBe(true)
    expect(kw).not.toContain('黄仁勋辞职')
  })

  it('评论里的词也会被带上', () => {
    expect(extractKeywords('黄仁勋辞职', '英伟达 官方回应了吗')).toContain('英伟达')
  })
})

describe('检索与合并', () => {
  it('用实体词找到同一事件的多条报道', () => {
    const store = seed()
    const r = collectRelatedItems(store, { itemId: 'i1' })
    const ids = r.items.map((i) => i.id)
    expect(ids).toContain('i1')
    expect(ids).toContain('i2')
    expect(ids).toContain('i3')
    expect(ids).not.toContain('i4')
  })

  it('同标题的不同 URL 合并成一条', () => {
    const a = item('a', '英伟达发布新芯片', '2026-11-10', 'https://a.com/1')
    const b = item('b', '英伟达发布新芯片', '2026-11-10', 'https://b.com/2')
    const groups = mergeDuplicates([a, b])
    expect(groups).toHaveLength(1)
    expect(groups[0]!.ids.sort()).toEqual(['a', 'b'])
  })
})

describe('确定性时间线', () => {
  it('按日期排序并标出断档', () => {
    const store = seed()
    const r = collectRelatedItems(store, { itemId: 'i1' })
    const t = buildDeterministicTimeline(store, r.groups, '黄仁勋辞职风波')
    expect(t.phases.map((p) => p.date)).toEqual(['2026-11-09', '2026-11-12', '2026-11-13'])
    expect(t.gaps.join('')).toContain('2 天没有新进展')
    expect(t.mode).toBe('deterministic')
    expect(t.items?.length).toBeGreaterThan(0)
  })

  it('没有模型时 compose 仍返回可读时间线', async () => {
    const store = seed()
    const out = await composeItemTimeline(store, { keys: {} }, { itemId: 'i1' })
    expect(out?.timeline.mode).toBe('deterministic')
    expect(out?.timeline.note).toContain('未配置模型')
    expect(out?.timeline.phases.length).toBe(3)
  })

  it('findGaps 只在跨天时提示', () => {
    expect(findGaps(['2026-11-09', '2026-11-10'])).toEqual([])
    expect(findGaps(['2026-11-09', '2026-11-12'])[0]).toContain('2 天')
  })
})

describe('模型输出校验', () => {
  const valid = new Set(['i1', 'i2'])

  it('保留有合法来源的阶段，丢弃悬空引用', () => {
    const raw = JSON.stringify({
      title: '黄仁勋辞职风波',
      phases: [
        { date: '2026-11-09', headline: '道歉', sourceItemIds: ['i2'] },
        { date: '2026-11-13', headline: '编造的', sourceItemIds: ['nope'] }
      ],
      gaps: [],
      openQuestions: []
    })
    const t = parseTimelineJson(raw, valid, 'fallback')
    expect(t?.phases).toHaveLength(1)
    expect(t?.phases[0]!.sourceItemIds).toEqual(['i2'])
    expect(t?.mode).toBe('agent')
  })

  it('多来源自动标 multi-source', () => {
    const raw = JSON.stringify({
      phases: [{ date: '2026-11-10', headline: 'x', sourceItemIds: ['i1', 'i2'] }]
    })
    expect(parseTimelineJson(raw, valid, 'fallback')?.phases[0]!.confidence).toBe('multi-source')
  })

  it('非 JSON / 空阶段返回 null', () => {
    expect(parseTimelineJson('不是 json', valid, 'x')).toBeNull()
    expect(parseTimelineJson('{"phases":[]}', valid, 'x')).toBeNull()
  })
})
