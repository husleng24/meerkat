import { describe, expect, it } from 'vitest'
import { buildEntityEventClusters, classifyEntityEvent, entityPeriods } from '../src/app/entity-events'

describe('实体事件分类', () => {
  it('优先识别负面/监管事件', () => {
    expect(classifyEntityEvent('OpenAI lays off 50 people')).toBe('layoff')
    expect(classifyEntityEvent('Hackers breached OpenAI')).toBe('security')
    expect(classifyEntityEvent('FTC sues Anthropic')).toBe('regulation')
  })

  it('识别融资、产品、研究、合作', () => {
    expect(classifyEntityEvent('Anthropic raises $2B Series F')).toBe('funding')
    expect(classifyEntityEvent('OpenAI launches GPT-6.2')).toBe('product')
    expect(classifyEntityEvent('New benchmark paper from DeepMind')).toBe('research')
    expect(classifyEntityEvent('NVIDIA partners with Foxconn')).toBe('partnership')
  })

  it('全部未命中时归为其他', () => {
    expect(classifyEntityEvent('A quiet week')).toBe('other')
  })

  it('同类型且 3 天内聚成一个事件，超出窗口另起', () => {
    const now = Date.UTC(2026, 10, 19)
    const day = 86_400_000
    const items = [
      { id: '1', title: 'OpenAI ships A', url: 'u1', summary: '', at: now, sourceName: 's1', event: 'product' as const },
      { id: '2', title: 'OpenAI ships A again', url: 'u2', summary: '', at: now - day, sourceName: 's2', event: 'product' as const },
      { id: '3', title: 'OpenAI ships old thing', url: 'u3', summary: '', at: now - 6 * day, sourceName: 's1', event: 'product' as const }
    ]
    const clusters = buildEntityEventClusters('openai', items)
    expect(clusters).toHaveLength(2)
    expect(clusters[0]!.items).toHaveLength(2)
    expect(clusters[0]!.sourceCount).toBe(2)
    expect(clusters[0]!.key.startsWith(`openai:product:${new Date(now - day).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })}`)).toBe(true)
  })
})

describe('实体周期对比', () => {
  it('最近 7 天与上周分别计数，并按事件拆分', () => {
    const now = Date.UTC(2026, 10, 19)
    const day = 86_400_000
    const items = [
      { at: now - day, event: 'product' as const },
      { at: now - 2 * day, event: 'funding' as const },
      { at: now - 8 * day, event: 'product' as const },
      { at: now - 20 * day, event: 'product' as const }
    ]
    const p = entityPeriods(items, now)
    expect(p.current).toBe(2)
    expect(p.previous).toBe(1)
    expect(p.currentByEvent.product).toBe(1)
    expect(p.currentByEvent.funding).toBe(1)
    expect(p.previousByEvent.product).toBe(1)
  })
})
