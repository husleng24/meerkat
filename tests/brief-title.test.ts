import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createMemoryStore } from '../src/adapters/store-sqlite/store'
import { weekdayOf } from '../src/app/compose-brief'
import type { Item, Source } from '../src/core/domain/types'

// daily.ts → log.ts 会拿 app.getPath('userData')；测试里给个临时目录
let logDir = ''
vi.mock('electron', () => ({ app: { getPath: () => logDir } }))
beforeAll(() => {
  logDir = mkdtempSync(join(tmpdir(), 'meerkat-brief-title-'))
})
afterAll(() => {
  rmSync(logDir, { recursive: true, force: true })
})

const NOW = new Date(2026, 10, 12, 9, 0, 0).getTime()
const HOUR = 3_600_000

function src(id: string, name: string): Source {
  return {
    id,
    name,
    kind: 'rss',
    url: `https://example.com/${id}.xml`,
    tier: 2,
    bucketHint: 'product',
    enabled: true,
    failStreak: 0
  }
}

function item(id: string, sourceId: string): Item {
  return {
    id,
    sourceId,
    title: `Title ${id}`,
    url: `https://example.com/${id}`,
    summary: '',
    bucket: 'product',
    score: 10,
    formulaVersion: 1,
    alsoIn: [],
    publishedAt: NOW - HOUR,
    fetchedAt: NOW - HOUR
  }
}

const dateLabel = new Date(NOW).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })
const weekday = weekdayOf(NOW)

describe('同一台机器上的两个主题各出一份简报', () => {
  it('标题各自带主题名，不会都写成「AI 简报」', async () => {
    const store = createMemoryStore()
    try {
      store.sources.upsertMany([src('s-ai', 'OpenAI'), src('s-chip', '台积电')])
      store.topics.upsert({
        id: 'chip',
        name: '芯片与算力',
        domainId: 'ai',
        enabled: true,
        hour: 8,
        minute: 30,
        createdAt: NOW,
        updatedAt: NOW
      })
      store.topics.setSources('ai', ['s-ai'])
      store.topics.setSources('chip', ['s-chip'])
      store.items.upsertMany([item('ai-1', 's-ai'), item('chip-1', 's-chip')])

      const { recomposeDaily } = await import('../src/main/daily')
      // compose: null → 走「仅聚合」降级稿，同样要遵守标题规则
      const deps = { compose: null, promptText: '' }

      const aiOut = await recomposeDaily(store, deps, { topicId: 'ai', now: NOW })
      const chipOut = await recomposeDaily(store, deps, { topicId: 'chip', now: NOW })

      const aiBrief = store.briefs.latest('ai')!
      const chipBrief = store.briefs.latest('chip')!

      expect(aiBrief.markdown.split('\n')[0]).toBe(`# AI 综合 简报 · ${dateLabel}（${weekday}）`)
      expect(chipBrief.markdown.split('\n')[0]).toBe(`# 芯片与算力 简报 · ${dateLabel}（${weekday}）`)
      expect(chipBrief.markdown).not.toBe(aiBrief.markdown)
      // 通知标题与 H1 同源
      expect(aiOut.title).toBe(`AI 综合 简报 · ${dateLabel}（${weekday}）`)
      expect(chipOut.title).toBe(`芯片与算力 简报 · ${dateLabel}（${weekday}）`)
    } finally {
      store.close()
    }
  })
})
