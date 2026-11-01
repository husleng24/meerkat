import { describe, it, expect } from 'vitest'
import { createMemoryStore } from '../src/adapters/store-sqlite/store'
import { countBriefItems, topicStats } from '../src/app/topic-stats'
import type { Brief, Item } from '../src/core/domain/types'

const NOW = 1_793_520_000_000

function item(id: string, url: string): Item {
  return {
    id,
    sourceId: 's1',
    title: `Title ${id}`,
    url,
    summary: '',
    bucket: 'product',
    score: 10,
    formulaVersion: 1,
    alsoIn: [],
    publishedAt: NOW - 3_600_000,
    fetchedAt: NOW - 3_600_000
  }
}

function brief(markdown: string, topicId = 'ai'): Brief {
  return {
    id: `2026-11-01-${topicId}`,
    date: '2026-11-01',
    topicId,
    markdown,
    model: 'deepseek-flash',
    tokensIn: 0,
    tokensOut: 0,
    createdAt: NOW
  }
}

const MD = `# AI 简报 · 2026-11-01（周日）

## 三句话速览

1. 速览不算条目

## ① 模型与产品

- **甲事件（10-31）** 正文。[A](https://example.com/a)
- **乙事件（10-31）** 正文。[B](https://example.com/b)

## ② Agent 与开发工具

- **丙事件（10-30）** 正文。[C](https://example.com/c)
`

describe('简报条目计数', () => {
  it('只数 `- **标题**` 的条目，不数速览与标题', () => {
    expect(countBriefItems(MD)).toBe(3)
  })

  it('附录（details 之后）不计入', () => {
    expect(countBriefItems(`${MD}\n<details><summary>说明</summary>\n- **不是条目** x\n</details>`)).toBe(3)
  })

  it('空简报是 0', () => {
    expect(countBriefItems('')).toBe(0)
  })
})

describe('领域侧栏统计', () => {
  it('没有简报时全为 0，且不带日期（界面显示「—」）', () => {
    const s = createMemoryStore()
    expect(topicStats(s, 'ai')).toEqual({ todayCount: 0, unreadCount: 0 })
  })

  it('条数来自最新一期，未读＝未被标记已读的条目', () => {
    const s = createMemoryStore()
    s.sources.upsertMany([
      {
        id: 's1',
        name: 'S1',
        kind: 'rss',
        tier: 1,
        bucketHint: 'product',
        enabled: true,
        failStreak: 0
      }
    ])
    s.items.upsertMany([
      item('i-a', 'https://example.com/a'),
      item('i-b', 'https://example.com/b'),
      item('i-c', 'https://example.com/c')
    ])
    s.briefs.save(brief(MD))
    s.flags.set('i-a', { isRead: true })

    const stats = topicStats(s, 'ai')
    expect(stats.todayCount).toBe(3)
    expect(stats.unreadCount).toBe(2)
    expect(stats.date).toBe('2026-11-01')
  })

  it('正文里对不上条目的链接不算未读（样例/手写简报不会虚高）', () => {
    const s = createMemoryStore()
    s.briefs.save(brief('- **只有链接** [X](https://example.com/unknown)\n'))
    const stats = topicStats(s, 'ai')
    expect(stats.todayCount).toBe(1)
    expect(stats.unreadCount).toBe(0)
  })

  it('只看该领域自己的那一期', () => {
    const s = createMemoryStore()
    s.sources.upsertMany([
      { id: 's1', name: 'S1', kind: 'rss', tier: 1, bucketHint: 'product', enabled: true, failStreak: 0 }
    ])
    s.topics.upsert({ ...s.topics.get('ai')!, id: 'chip', name: '芯片' })
    s.items.upsertMany([item('i-a', 'https://example.com/a')])
    s.briefs.save(brief('- **甲** [A](https://example.com/a)\n', 'chip'))
    expect(topicStats(s, 'ai').todayCount).toBe(0)
    expect(topicStats(s, 'chip').todayCount).toBe(1)
  })
})
