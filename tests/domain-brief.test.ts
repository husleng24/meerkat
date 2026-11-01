import { describe, it, expect, vi } from 'vitest'
import { createMemoryStore } from '../src/adapters/store-sqlite/store'
import { composeDomainRollup, type DomainDeps } from '../src/main/domain-daily'
import type { ChatProvider } from '../src/core/ports/chat'

const NOW = new Date('2026-11-01T02:00:00Z').getTime() // 上海时间 10:00

const BRIEF = `# AI 简报 · 2026-11-01（周日）

## 三句话速览

1. 甲事件。
2. 乙事件。

## ① 模型与产品

- **甲事件（10-31）**——解读甲。
  [The Verge](https://example.com/a)

## ② 算力与本地

- **乙事件（10-30）**——解读乙。
  [量子位](https://example.com/b)
`

function seed(): ReturnType<typeof createMemoryStore> {
  const s = createMemoryStore()
  const now = NOW
  s.topics.upsert({
    id: 'models',
    name: '模型与产品',
    domainId: 'ai',
    enabled: true,
    hour: 8,
    minute: 30,
    createdAt: now,
    updatedAt: now
  })
  s.briefs.save({
    id: '2026-11-01-models',
    date: '2026-11-01',
    topicId: 'models',
    markdown: BRIEF,
    model: 'deepseek',
    tokensIn: 1,
    tokensOut: 2,
    createdAt: now
  })
  return s
}

function fakeChat(text: string): { provider: ChatProvider; calls: ReturnType<typeof vi.fn> } {
  const calls = vi.fn().mockResolvedValue({
    ok: true,
    text,
    model: 'fake-model',
    usage: { input: 10, output: 20 }
  })
  return {
    calls,
    provider: { id: 'fake', listModels: () => [], chat: calls }
  }
}

describe('领域汇总生成', () => {
  it('没接模型时写摘录兜底稿，并标记 degraded', async () => {
    const s = seed()
    const out = await composeDomainRollup(s, { chat: null }, { domainId: 'ai', now: NOW })
    expect(out.ok).toBe(true)
    expect(out.degraded).toBe(true)
    expect(out.date).toBe('2026-11-01')
    expect(out.topicCount).toBe(1)
    expect(out.itemCount).toBe(2)

    const saved = s.domainBriefs.latest('ai', '2026-11-01')
    expect(saved?.markdown).toContain('没有生成综述')
    expect(saved?.markdown).toContain('## 模型与产品')
    expect(saved?.markdown).toContain('[The Verge](https://example.com/a)')
    expect(saved?.model).toBe('fallback')
  })

  it('接了模型就用模型稿，并记录 token', async () => {
    const s = seed()
    const { provider, calls } = fakeChat('# AI 领域汇总\n\n## 今天这个领域在发生什么\n\n趋势。')
    const deps: DomainDeps = { chat: { provider, model: 'fake-model' } }
    const out = await composeDomainRollup(s, deps, { domainId: 'ai', now: NOW })

    expect(out.degraded).toBe(false)
    expect(calls).toHaveBeenCalledTimes(1)
    const saved = s.domainBriefs.latest('ai', '2026-11-01')
    expect(saved?.markdown).toContain('趋势。')
    expect(saved?.model).toBe('fake-model')
    expect(saved?.tokensIn).toBe(10)
    expect(saved?.tokensOut).toBe(20)
  })

  it('模型失败时退回兜底稿，而不是什么都不写', async () => {
    const s = seed()
    const provider: ChatProvider = {
      id: 'fake',
      listModels: () => [],
      chat: vi.fn().mockResolvedValue({ ok: false, reason: 'provider-error', detail: 'boom' })
    }
    const out = await composeDomainRollup(s, { chat: { provider, model: 'm' } }, { domainId: 'ai', now: NOW })
    expect(out.ok).toBe(true)
    expect(out.degraded).toBe(true)
    expect(s.domainBriefs.latest('ai')?.markdown).toContain('没有生成综述')
  })

  it('主题还没有简报时返回失败原因，不写空稿', async () => {
    const s = createMemoryStore()
    const out = await composeDomainRollup(s, { chat: null }, { domainId: 'ai', now: NOW })
    expect(out.ok).toBe(false)
    expect(out.reason).toContain('还没有简报')
    expect(s.domainBriefs.latest('ai')).toBeUndefined()
  })

  it('重复汇总会覆盖同一天的稿子', async () => {
    const s = seed()
    await composeDomainRollup(s, { chat: null }, { domainId: 'ai', now: NOW })
    const first = s.domainBriefs.latest('ai', '2026-11-01')!
    await composeDomainRollup(s, { chat: null }, { domainId: 'ai', now: NOW + 60_000 })
    const second = s.domainBriefs.latest('ai', '2026-11-01')!
    expect(second.id).toBe(first.id)
    expect(second.createdAt).toBeGreaterThan(first.createdAt)
  })
})
