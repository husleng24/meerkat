import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { createMemoryStore, createStore } from '../src/adapters/store-sqlite/store'
import { openDatabase, migrate, schemaVersion } from '../src/adapters/store-sqlite/db'
import type { Store } from '../src/core/ports/store'
import type { Item, Source } from '../src/core/domain/types'

const T = 1_761_000_000_000

function src(id: string, over: Partial<Source> = {}): Source {
  return {
    id,
    name: id,
    kind: 'rss',
    url: `https://example.com/${id}.xml`,
    tier: 1,
    bucketHint: 'product',
    enabled: true,
    failStreak: 0,
    ...over
  }
}

function item(id: string, over: Partial<Item> = {}): Item {
  return {
    id,
    sourceId: 's1',
    title: `Title ${id}`,
    url: `https://example.com/${id}`,
    summary: '',
    bucket: 'product',
    score: 10,
    formulaVersion: 1,
    alsoIn: [],
    fetchedAt: T,
    ...over
  }
}

describe('schema 与迁移', () => {
  it('新库跑到最新版本', () => {
    const s = createMemoryStore()
    expect(s.schemaVersion()).toBeGreaterThanOrEqual(1)
    s.close()
  })

  it('迁移幂等：重复 migrate 不报错、版本不变', () => {
    const db = openDatabase(':memory:')
    const v1 = schemaVersion(db)
    migrate(db)
    migrate(db)
    expect(schemaVersion(db)).toBe(v1)
    db.close()
  })

  it('文件库重开不重复建表', () => {
    const dir = mkdtempSync(join(__dirname, '.tmp-'))
    const file = join(dir, 't.db')
    const a = createStore(file)
    a.sources.upsertMany([src('s1')])
    a.close()
    const b = createStore(file)
    expect(b.sources.list()).toHaveLength(1)
    b.close()
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('sources', () => {
  let s: Store
  beforeEach(() => {
    s = createMemoryStore()
  })

  it('增删查改', () => {
    s.sources.upsertMany([src('a'), src('b', { tier: 2 })])
    expect(s.sources.list()).toHaveLength(2)
    // 排序：tier 升序
    expect(s.sources.list()[0]!.id).toBe('a')
    expect(s.sources.get('b')!.tier).toBe(2)
    s.sources.remove('a')
    expect(s.sources.list()).toHaveLength(1)
  })

  it('upsert 保留健康度，不覆盖 failStreak', () => {
    s.sources.upsert(src('a'))
    s.sources.recordFailure('a', 'HTTP 429')
    s.sources.recordFailure('a', 'HTTP 429')
    expect(s.sources.get('a')!.failStreak).toBe(2)
    // 再次 upsert（例如用户编辑源）不应清掉失败计数
    s.sources.upsert(src('a', { name: '改名了' }))
    expect(s.sources.get('a')!.failStreak).toBe(2)
    expect(s.sources.get('a')!.name).toBe('改名了')
  })

  it('recordSuccess 清零 failStreak 并记录耗时', () => {
    s.sources.upsert(src('a'))
    s.sources.recordFailure('a', 'boom')
    s.sources.recordSuccess('a', 12, 800)
    const got = s.sources.get('a')!
    expect(got.failStreak).toBe(0)
    expect(got.lastOkAt).toBeGreaterThan(0)
    expect(got.avgItems).toBe(12)
    expect(got.avgMs).toBe(800)
    expect(got.lastError).toBeUndefined()
  })
})

describe('items 与去重落库', () => {
  let s: Store
  beforeEach(() => {
    s = createMemoryStore()
    s.sources.upsertMany([src('s1')])
  })

  it('批量写入并计数', () => {
    const n = s.items.upsertMany([item('i1'), item('i2')])
    expect(n).toBe(2)
    expect(s.items.count()).toBe(2)
  })

  it('同 id 重复写入是更新而非插入', () => {
    s.items.upsertMany([item('i1', { score: 10 })])
    s.items.upsertMany([item('i1', { score: 99, title: '改过标题' })])
    expect(s.items.count()).toBe(1)
    expect(s.items.get('i1')!.score).toBe(99)
    expect(s.items.get('i1')!.title).toBe('改过标题')
  })

  it('since 按分数倒序且受时间窗限制', () => {
    s.items.upsertMany([
      item('old', { publishedAt: T - 100 * 3600_000 }),
      item('new1', { publishedAt: T - 1 * 3600_000, score: 5 }),
      item('new2', { publishedAt: T - 2 * 3600_000, score: 50 })
    ])
    const rows = s.items.since(T - 48 * 3600_000)
    expect(rows.map((r) => r.id)).toEqual(['new2', 'new1'])
  })

  it('alsoIn 往返 JSON 正确', () => {
    s.items.upsertMany([item('i1', { alsoIn: ['HN', 'Reddit'] })])
    expect(s.items.get('i1')!.alsoIn).toEqual(['HN', 'Reddit'])
  })

  it('删源级联删条目', () => {
    s.items.upsertMany([item('i1')])
    s.sources.remove('s1')
    expect(s.items.count()).toBe(0)
  })
})

describe('全文检索', () => {
  let s: Store
  beforeEach(() => {
    s = createMemoryStore()
    s.sources.upsertMany([src('s1')])
    s.items.upsertMany([
      item('a', { title: 'Gemini 4 Carbon 发布', summary: 'Google 新前沿模型登顶评测' }),
      item('b', { title: 'Anthropic S-1 数据流出', summary: '增速 1400%，毛利 85%' }),
      item('c', { title: 'Qwen4 支持 1M 上下文窗口', summary: '长文档场景' })
    ])
  })

  it('英文子串命中', () => {
    const r = s.items.search('Carbon')
    expect(r.map((x) => x.id)).toEqual(['a'])
  })

  it('中文子串命中（trigram）', () => {
    const r = s.items.search('上下文')
    expect(r.map((x) => x.id)).toEqual(['c'])
  })

  it('中文跨词子串命中（trigram 的核心价值）', () => {
    // '前沿模型登顶' 是摘要里的连续片段，unicode61 分词下不会命中
    const r = s.items.search('前沿模型')
    expect(r.map((x) => x.id)).toEqual(['a'])
  })

  it('短查询（<3 字符）走 LIKE 兜底', () => {
    expect(s.items.search('85').map((x) => x.id)).toEqual(['b'])
  })

  it('空查询返回空数组', () => {
    expect(s.items.search('   ')).toEqual([])
  })

  it('无法解析的查询串不会抛异常', () => {
    expect(() => s.items.search('AND OR NEAR(')).not.toThrow()
  })

  it('可按板块过滤', () => {
    expect(s.items.search('Gemini', { bucket: 'research' })).toEqual([])
    expect(s.items.search('Gemini', { bucket: 'product' })).toHaveLength(1)
  })

  it('筛选在 SQL 里生效，不是取回来再过滤（否则 50 条上限会造假空结果）', () => {
    // a 是 product，c 是 research；按 research 过滤时 a 必须缺席而不是"被截断"
    expect(s.items.search('Gemini', { bucket: 'research' })).toEqual([])
    expect(s.items.search('Gemini', { bucket: 'product', limit: 1 }).map((x) => x.id)).toEqual(['a'])
  })
})

describe('检索筛选：来源 / 时间 / 排序', () => {
  let s: Store
  const DAY = 86_400_000
  beforeEach(() => {
    s = createMemoryStore()
    s.sources.upsertMany([src('s1'), src('s2')])
    s.items.upsertMany([
      item('old', { title: 'Gemini 旧闻', sourceId: 's1', publishedAt: T - 20 * DAY, score: 30 }),
      item('mid', { title: 'Gemini 中闻', sourceId: 's2', publishedAt: T - 5 * DAY, score: 10 }),
      item('new', { title: 'Gemini 新文', sourceId: 's1', publishedAt: T - 1 * DAY, score: 20 })
    ])
  })

  it('按来源过滤', () => {
    expect(s.items.search('Gemini', { sourceId: 's1' }).map((x) => x.id).sort()).toEqual(['new', 'old'])
    expect(s.items.search('Gemini', { sourceId: 's2' }).map((x) => x.id)).toEqual(['mid'])
  })

  it('按时间窗口过滤（sinceTs）', () => {
    const ids = s.items.search('Gemini', { sinceTs: T - 7 * DAY }).map((x) => x.id).sort()
    expect(ids).toEqual(['mid', 'new'])
  })

  it('没有发布时间的条目按抓取时间参与时间筛选', () => {
    s.items.upsertMany([item('fresh', { title: 'Gemini 无发布时间', sourceId: 's1', fetchedAt: T })])
    expect(s.items.search('Gemini', { sinceTs: T - 7 * DAY }).map((x) => x.id)).toContain('fresh')
  })

  it('默认按相关度（分数）排序', () => {
    expect(s.items.search('Gemini').map((x) => x.id)).toEqual(['old', 'new', 'mid'])
  })

  it('sort=time 时按发布时间倒序', () => {
    expect(s.items.search('Gemini', { sort: 'time' }).map((x) => x.id)).toEqual(['new', 'mid', 'old'])
  })

  it('组合条件：来源 + 时间 + 时间排序', () => {
    const ids = s.items.search('Gemini', { sourceId: 's1', sinceTs: T - 7 * DAY, sort: 'time' }).map((x) => x.id)
    expect(ids).toEqual(['new'])
  })
})

describe('增量：briefed 标记', () => {
  let s: Store
  beforeEach(() => {
    s = createMemoryStore()
    s.sources.upsertMany([src('s1')])
    s.items.upsertMany([item('i1'), item('i2')])
  })

  it('markBriefed 后能在 briefedIds 里查到', () => {
    s.items.markBriefed(['i1'], T)
    expect(s.items.briefedIds(T - 1000)).toEqual(new Set(['i1']))
  })

  it('时间窗之外的 briefed 不返回', () => {
    s.items.markBriefed(['i1'], T - 100_000)
    expect(s.items.briefedIds(T).size).toBe(0)
  })

  it('重复 markBriefed 不产生重复行', () => {
    s.items.markBriefed(['i1'], T)
    s.items.markBriefed(['i1'], T + 1)
    expect(s.items.briefedIds(0).size).toBe(1)
  })
})

describe('briefs', () => {
  it('保存与读取最新一期', () => {
    const s = createMemoryStore()
    s.briefs.save({
      id: '2026-10-30',
      date: '2026-10-30',
      topicId: 'default',
      markdown: '# 简报',
      model: 'deepseek-flash',
      tokensIn: 100,
      tokensOut: 200,
      linkCheck: '38/38',
      createdAt: T
    })
    const latest = s.briefs.latest()!
    expect(latest.markdown).toBe('# 简报')
    expect(latest.linkCheck).toBe('38/38')
    expect(s.briefs.byDate('2026-10-30')!.id).toBe('2026-10-30')
    expect(s.briefs.byDate('2026-01-01')).toBeUndefined()
    expect(s.briefs.list()).toHaveLength(1)
  })
})

describe('runs 与 settings', () => {
  it('run 生命周记', () => {
    const s = createMemoryStore()
    s.runs.start({ id: 'r1', startedAt: T, nSources: 35, nRaw: 300, nKept: 0 })
    s.runs.finish('r1', { nKept: 80, finishedAt: T + 5000, errorsJson: '[]' })
    const r = s.runs.recent()[0]!
    expect(r.nKept).toBe(80)
    expect(r.finishedAt).toBe(T + 5000)
  })

  it('settings 存 JSON 并往返', () => {
    const s = createMemoryStore()
    s.settings.set('llm', { model: 'deepseek-flash', temperature: 0.55 })
    expect(s.settings.get<{ model: string }>('llm')!.model).toBe('deepseek-flash')
    expect(s.settings.all()['llm']).toEqual({ model: 'deepseek-flash', temperature: 0.55 })
    expect(s.settings.get('不存在')).toBeUndefined()
  })
})
