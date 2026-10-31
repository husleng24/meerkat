import { describe, it, expect } from 'vitest'
import {
  MIN_AFTER_FILTER,
  citedItemIds,
  extractUrls,
  filterAlreadyBriefed
} from '../src/app/brief-selection'
import { decideSave, isDegradedBrief } from '../src/app/brief-save'
import type { DedupedItem } from '../src/core/pipeline/dedupe'
import type { Brief } from '../src/core/domain/types'

function item(id: string, url = `https://e.com/${id}`): DedupedItem {
  return {
    id,
    sourceId: 's1',
    title: `标题 ${id}`,
    url,
    summary: '',
    bucket: 'product',
    score: 10,
    formulaVersion: 1,
    alsoIn: [],
    fetchedAt: 0,
    sourceName: '源'
  }
}

describe('extractUrls', () => {
  it('抽出 markdown 链接，去掉尾部标点', () => {
    expect(extractUrls('- **标题**——解读\n  [源](https://a.com/1)。')).toEqual(['https://a.com/1'])
  })
})

describe('citedItemIds', () => {
  const items = [item('a'), item('b'), item('c')]

  it('只把成稿里引用的条目标为已推送', () => {
    const md = '## 板块\n- **[源](https://e.com/a)**\n- **[源](https://e.com/c)**'
    expect(citedItemIds(md, items).sort()).toEqual(['a', 'c'])
  })

  it('模型看过但没选的条目不会被标记（留给明天）', () => {
    const md = '只有 https://e.com/a'
    const cited = citedItemIds(md, items)
    expect(cited).toEqual(['a'])
    expect(cited).not.toContain('b')
  })

  it('成稿里没有链接时返回空', () => {
    expect(citedItemIds('没有任何链接', items)).toEqual([])
  })
})

describe('filterAlreadyBriefed', () => {
  const many = Array.from({ length: 20 }, (_, i) => item(`i${i}`))

  it('没有历史记录时原样返回', () => {
    const r = filterAlreadyBriefed(many, new Set())
    expect(r.items).toHaveLength(20)
    expect(r.dropped).toBe(0)
  })

  it('过滤掉已推送过的条目', () => {
    const r = filterAlreadyBriefed(many, new Set(['i0', 'i1', 'i2']))
    expect(r.items).toHaveLength(17)
    expect(r.dropped).toBe(3)
    expect(r.items.map((i) => i.id)).not.toContain('i0')
  })

  it('剩得太少时放弃过滤（宁可重复也不交空简报）', () => {
    const briefed = new Set(many.slice(0, 18).map((i) => i.id))
    const r = filterAlreadyBriefed(many, briefed)
    expect(r.overridden).toBe(true)
    expect(r.items).toHaveLength(20)
    expect(r.dropped).toBe(0)
  })

  it('剩余数量刚好到下限时仍然过滤', () => {
    const briefed = new Set(many.slice(0, 20 - MIN_AFTER_FILTER).map((i) => i.id))
    const r = filterAlreadyBriefed(many, briefed)
    expect(r.overridden).toBe(false)
    expect(r.items).toHaveLength(MIN_AFTER_FILTER)
  })

  it('全部推送过时回退到完整列表', () => {
    const r = filterAlreadyBriefed(many, new Set(many.map((i) => i.id)))
    expect(r.overridden).toBe(true)
    expect(r.items).toHaveLength(20)
  })

  it('小样本（不足下限）即使全推过也只回退，不会返回空数组', () => {
    const few = many.slice(0, 5)
    const r = filterAlreadyBriefed(few, new Set(few.map((i) => i.id)))
    expect(r.items.length).toBeGreaterThan(0)
  })
})

describe('decideSave：降级版不得覆盖完整版', () => {
  const good: Brief = {
    id: '2026-10-31',
    date: '2026-10-31',
    topicId: 'default',
    markdown: '# 好版本',
    model: 'deepseek-flash',
    tokensIn: 1,
    tokensOut: 1,
    createdAt: 1
  }
  const bad: Brief = { ...good, markdown: '# 降级版', model: 'none' }

  it('当天第一次：写入', () => {
    expect(decideSave(undefined, { degraded: false }).reason).toBe('first')
  })

  it('新版本降级、旧版本正常：拒绝写入', () => {
    const d = decideSave(good, { degraded: true })
    expect(d.write).toBe(false)
    expect(d.reason).toBe('kept-existing')
    expect(d.detail).toContain('保留')
  })

  it('新版本正常、旧版本降级：写入并标记升级', () => {
    const d = decideSave(bad, { degraded: false })
    expect(d.write).toBe(true)
    expect(d.reason).toBe('upgraded')
  })

  it('两份都正常：覆盖', () => {
    expect(decideSave(good, { degraded: false }).reason).toBe('replaced')
  })

  it('两份都降级：覆盖（没有更好的可保）', () => {
    expect(decideSave(bad, { degraded: true }).write).toBe(true)
  })

  it('isDegradedBrief 以 model === none 判定', () => {
    expect(isDegradedBrief(good)).toBe(false)
    expect(isDegradedBrief(bad)).toBe(true)
  })
})
