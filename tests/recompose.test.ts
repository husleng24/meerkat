import { describe, it, expect, vi, beforeAll } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createMemoryStore } from '../src/adapters/store-sqlite/store'
import type { Store } from '../src/core/ports/store'
import type { Item, Source } from '../src/core/domain/types'

// daily.ts 会 import log，log 会拿 app.getPath('userData')——给个临时目录
let logDir = ''
vi.mock('electron', () => ({ app: { getPath: () => logDir } }))
beforeAll(() => {
  logDir = mkdtempSync(join(tmpdir(), 'meerkat-recompose-'))
})

const NOW = new Date(2026, 10, 1, 15, 0, 0).getTime()
const HOUR = 3_600_000
const DAY = 24 * HOUR

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

function item(id: string, sourceId: string, ageHours: number): Item {
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
    publishedAt: NOW - ageHours * HOUR,
    fetchedAt: NOW - ageHours * HOUR
  }
}

function seeded(): Store {
  const s = createMemoryStore()
  s.sources.upsertMany([src('s1'), src('s2')])
  s.topics.setSources('ai', ['s1'])
  s.items.upsertMany([
    item('fresh', 's1', 2), // 今天抓到、没推过 → 要
    item('other-topic', 's2', 2), // 源不属于这个主题 → 不要
    item('too-old', 's1', 60), // 超出 48 小时 → 不要
    item('briefed-yesterday', 's1', 3), // 昨天推过 → 不要
    item('briefed-today', 's1', 1) // 今天推过（就是没法覆盖掉的那一版）→ 要
  ])
  return s
}

describe('重新成稿的素材池', () => {
  it('只取本主题的源、48 小时以内、且不是今天之前推过的', async () => {
    const s = seeded()
    s.items.markBriefed(['briefed-yesterday'], NOW - DAY, 'ai')
    s.items.markBriefed(['briefed-today'], NOW - 2 * HOUR, 'ai')

    const { collectReusableItems } = await import('../src/main/daily')
    const pool = collectReusableItems(s, 'ai', NOW)

    expect(pool.items.map((i) => i.id).sort()).toEqual(['briefed-today', 'fresh'])
    // 每条素材都带上源名，成稿模板要用
    expect(pool.items.every((i) => i.sourceName === 's1')).toBe(true)
  })

  it('源统计只列真正有素材的源', async () => {
    const s = seeded()
    const { collectReusableItems } = await import('../src/main/daily')
    const pool = collectReusableItems(s, 'ai', NOW)
    // s2 的条目不属于这个主题，所以源统计里只该有 s1（窗口内有 3 条）
    expect(pool.sourceStats).toEqual([{ name: 's1', ok: true, n: 3, note: '' }])
  })

  it('别的主题推过的不影响这个主题', async () => {
    const s = seeded()
    s.sources.upsertMany([src('s3')])
    s.topics.upsert({ ...s.topics.get('ai')!, id: 'chip', name: '芯片' })
    s.topics.setSources('chip', ['s2'])
    s.items.markBriefed(['fresh'], NOW - DAY, 'chip')

    const { collectReusableItems } = await import('../src/main/daily')
    const pool = collectReusableItems(s, 'ai', NOW)
    expect(pool.items.map((i) => i.id)).toContain('fresh')
  })

  it('窗口内没有素材时返回空池（调用方据此报错而不是交白卷）', async () => {
    const s = createMemoryStore()
    s.sources.upsertMany([src('s1')])
    s.topics.setSources('ai', ['s1'])

    const { collectReusableItems } = await import('../src/main/daily')
    const pool = collectReusableItems(s, 'ai', NOW)
    expect(pool.items).toEqual([])
    expect(pool.sourceStats).toEqual([])
  })
})
