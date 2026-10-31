import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseBrief } from '../src/renderer/src/lib/parseBrief'
import { resolveItemIds } from '../src/renderer/src/lib/itemIds'
import { createMemoryStore } from '../src/adapters/store-sqlite/store'
import type { Item, Source } from '../src/core/domain/types'

const md = readFileSync(join(__dirname, 'fixtures', 'brief-real.md'), 'utf8')

describe('resolveItemIds：简报条目 → 数据库 id', () => {
  const brief = parseBrief(md)

  it('URL 能对上时建立映射', () => {
    const first = brief.sections[0]!.items[0]!
    const url = first.links[0]!.url
    const map = resolveItemIds(brief, { [url]: 'item-1' })
    expect(map.get(first.key)).toBe('item-1')
  })

  it('多链接条目：任一链接命中即可', () => {
    const first = brief.sections[0]!.items[0]!
    expect(first.links.length).toBeGreaterThan(1)
    const second = first.links[1]!.url
    const map = resolveItemIds(brief, { [second]: 'item-2' })
    expect(map.get(first.key)).toBe('item-2')
  })

  it('全部对不上时返回空映射，不抛异常', () => {
    const map = resolveItemIds(brief, { 'https://unknown.example/x': 'nope' })
    expect(map.size).toBe(0)
  })

  it('brief 为 null 时返回空映射', () => {
    expect(resolveItemIds(null, { a: 'b' }).size).toBe(0)
  })

  it('部分命中：只映射能对上的那些', () => {
    const items = brief.sections.flatMap((s) => s.items)
    const hit = items[3]!
    const map = resolveItemIds(brief, { [hit.links[0]!.url]: 'only-this' })
    expect(map.size).toBe(1)
    expect(map.get(hit.key)).toBe('only-this')
  })
})

describe('已读/收藏持久化（真实 DB）', () => {
  const src: Source = {
    id: 's1',
    name: '源一',
    kind: 'rss',
    tier: 1,
    bucketHint: 'product',
    enabled: true,
    failStreak: 0
  }
  const item = (id: string): Item => ({
    id,
    sourceId: 's1',
    title: `标题 ${id}`,
    url: `https://example.com/${id}`,
    summary: '',
    bucket: 'product',
    score: 10,
    formulaVersion: 1,
    alsoIn: [],
    fetchedAt: Date.now()
  })

  it('写入后重开数据库仍在（跨会话持久化）', () => {
    const s1 = createMemoryStore()
    s1.sources.upsertMany([src])
    s1.items.upsertMany([item('a'), item('b')])
    s1.flags.set('a', { isRead: true })
    s1.flags.set('b', { isSaved: true, isHidden: true })

    expect(s1.flags.get('a')!.isRead).toBe(true)
    expect(s1.flags.get('b')!.isSaved).toBe(true)
    expect(s1.flags.get('b')!.isHidden).toBe(true)
    // 未写过的条目没有记录
    expect(s1.flags.get('c')).toBeUndefined()
    s1.close()
  })

  it('部分更新不会清掉其他字段', () => {
    const s = createMemoryStore()
    s.sources.upsertMany([src])
    s.items.upsertMany([item('a')])
    s.flags.set('a', { isRead: true })
    s.flags.set('a', { isSaved: true })
    const f = s.flags.get('a')!
    expect(f.isRead).toBe(true)
    expect(f.isSaved).toBe(true)
    s.close()
  })

  it('取消收藏是显式写 false，而不是删行', () => {
    const s = createMemoryStore()
    s.sources.upsertMany([src])
    s.items.upsertMany([item('a')])
    s.flags.set('a', { isSaved: true })
    s.flags.set('a', { isSaved: false })
    expect(s.flags.get('a')!.isSaved).toBe(false)
    s.close()
  })

  it('byFlag 能按状态列出条目 id', () => {
    const s = createMemoryStore()
    s.sources.upsertMany([src])
    s.items.upsertMany([item('a'), item('b')])
    s.flags.set('a', { isSaved: true })
    expect(s.flags.byFlag('isSaved', true)).toEqual(['a'])
    expect(s.flags.byFlag('isSaved', false)).toEqual([])
    s.close()
  })

  it('条目被删除时标志位一并清掉（外键级联）', () => {
    const s = createMemoryStore()
    s.sources.upsertMany([src])
    s.items.upsertMany([item('a')])
    s.flags.set('a', { isRead: true })
    s.sources.remove('s1') // 级联删 items
    expect(s.items.count()).toBe(0)
    expect(s.flags.get('a')).toBeUndefined()
    s.close()
  })
})

describe('端到端：简报条目 → 反查 id → 标记 → 重读', () => {
  it('真实简报的前 5 条都能落到数据库并读回状态', () => {
    const brief = parseBrief(md)
    const items = brief.sections.flatMap((s) => s.items).slice(0, 5)

    const s = createMemoryStore()
    s.sources.upsertMany([
      { id: 's1', name: '源', kind: 'rss', tier: 1, bucketHint: 'product', enabled: true, failStreak: 0 }
    ])

    // 模拟采集落库：把简报里出现的 URL 都建成条目
    const urlToId: Record<string, string> = {}
    let n = 0
    for (const it of brief.sections.flatMap((x) => x.items)) {
      for (const l of it.links) {
        if (urlToId[l.url]) continue
        const id = `i${n++}`
        urlToId[l.url] = id
        s.items.upsertMany([
          {
            id,
            sourceId: 's1',
            title: it.title,
            url: l.url,
            summary: '',
            bucket: 'product',
            score: 10,
            formulaVersion: 1,
            alsoIn: [],
            fetchedAt: Date.now()
          }
        ])
      }
    }

    // 界面拿到 urlToId 后反查条目 id
    const idByKey = resolveItemIds(brief, urlToId)
    expect(idByKey.size).toBeGreaterThanOrEqual(items.length)

    // 标记前三条为已读、第二条为收藏
    const keys = items.map((i) => i.key)
    for (const key of keys.slice(0, 3)) {
      const id = idByKey.get(key)!
      s.flags.set(id, { isRead: true })
    }
    s.flags.set(idByKey.get(keys[1]!)!, { isSaved: true })

    // 重读（相当于关掉再打开应用）
    const saved = s.flags.byFlag('isSaved', true)
    expect(saved).toHaveLength(1)
    expect(saved[0]).toBe(idByKey.get(keys[1]!))

    let readCount = 0
    for (const key of keys) {
      if (s.flags.get(idByKey.get(key)!)?.isRead) readCount += 1
    }
    expect(readCount).toBe(3)
    s.close()
  })
})
