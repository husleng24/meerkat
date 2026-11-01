import { describe, it, expect, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MIGRATIONS } from '../src/adapters/store-sqlite/schema'
import { createMemoryStore, createStore } from '../src/adapters/store-sqlite/store'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function tempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), 'meerkat-domains-'))
  dirs.push(dir)
  return join(dir, 'meerkat.db')
}

/** 造一个 v3 的旧库：两条主题、一条归属、一份简报 */
function makeV3(file: string): void {
  const db = new Database(file)
  db.pragma('foreign_keys = ON')
  for (const m of MIGRATIONS.filter((x) => x.version <= 3)) {
    db.exec(m.up)
    db.pragma(`user_version = ${m.version}`)
  }
  const now = Date.now()
  db.prepare(
    `INSERT INTO topics (id,name,enabled,hour,minute,created_at,updated_at)
     VALUES ('chip','芯片与算力',1,8,30,?,?)`
  ).run(now, now)
  db.prepare(
    `INSERT INTO sources (id,name,kind,tier,bucket_hint,created_at,updated_at)
     VALUES ('s1','S1','rss',1,'product',?,?)`
  ).run(now, now)
  db.prepare(`INSERT INTO topic_sources (topic_id, source_id) VALUES ('chip','s1')`).run()
  db.prepare(
    `INSERT INTO briefs (id,date,topic_id,markdown,model,created_at)
     VALUES ('2026-11-01-chip','2026-11-01','chip','- **甲** [A](https://example.com/a)','m',?)`
  ).run(now)
  db.close()
}

describe('schema v4：领域迁移', () => {
  it('旧库升级后主题、源归属、简报都还在，并落到默认领域', () => {
    const file = tempDb()
    makeV3(file)
    const s = createStore(file)

    expect(s.domains.list().map((d) => d.id)).toEqual(['ai'])
    expect(s.domains.get('ai')?.name).toBe('AI')

    const topics = s.topics.list()
    expect(topics.map((t) => t.id).sort()).toEqual(['ai', 'chip'])
    expect(topics.every((t) => t.domainId === 'ai')).toBe(true)

    expect(s.topics.sourceIds('chip')).toEqual(['s1'])
    expect(s.briefs.latest('chip')?.markdown).toContain('甲')
    expect(s.schemaVersion()).toBe(4)
    s.close()
  })

  it('全新库也有默认领域与默认主题', () => {
    const s = createMemoryStore()
    expect(s.domains.list().map((d) => d.id)).toEqual(['ai'])
    expect(s.topics.list()[0]?.domainId).toBe('ai')
  })
})

describe('领域仓储', () => {
  it('新增、改名、删除', () => {
    const s = createMemoryStore()
    s.domains.upsert({ id: 'robot', name: '机器人', createdAt: 1 })
    expect(s.domains.list().map((d) => d.id).sort()).toEqual(['ai', 'robot'])

    s.domains.upsert({ id: 'robot', name: '具身智能', createdAt: 1 })
    expect(s.domains.get('robot')?.name).toBe('具身智能')

    s.domains.remove('robot')
    expect(s.domains.get('robot')).toBeUndefined()
  })

  it('主题按领域归属，可以移动到别的领域', () => {
    const s = createMemoryStore()
    s.domains.upsert({ id: 'robot', name: '机器人', createdAt: 1 })
    const now = Date.now()
    s.topics.upsert({
      id: 'humanoid',
      name: '人形机器人',
      domainId: 'robot',
      enabled: true,
      hour: 8,
      minute: 30,
      createdAt: now,
      updatedAt: now
    })
    expect(s.topics.get('humanoid')?.domainId).toBe('robot')

    s.topics.upsert({ ...s.topics.get('humanoid')!, domainId: 'ai', updatedAt: now + 1 })
    expect(s.topics.get('humanoid')?.domainId).toBe('ai')
  })
})
