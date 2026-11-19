import { describe, expect, it } from 'vitest'
import { classifyEntityEvent, entityPeriods } from '../src/app/entity-events'

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
