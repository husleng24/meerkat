import type { DB } from './db'
import { openDatabase, schemaVersion } from './db'
import type { Store, SourceStore, ItemStore, BriefStore, RunStore, FlagStore, SettingsStore } from '../../core/ports/store'
import type { Item, ItemFlags, Brief, RunRecord, Source, SourceKind, Bucket, Tier } from '../../core/domain/types'

const now = (): number => Date.now()
const bool = (v: unknown): boolean => v === 1 || v === true
const int = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0))

interface SourceRow {
  id: string; name: string; kind: string; url: string | null; channel_id: string | null
  tier: number; bucket_hint: string; window_hours: number | null; always_keep: number
  insecure: number; parser: string | null; enabled: number; last_ok_at: number | null
  fail_streak: number; last_error: string | null; avg_items: number | null; avg_ms: number | null
  created_at: number; updated_at: number
}
interface ItemRow {
  id: string; source_id: string; title: string; url: string; author: string | null
  published_at: number | null; summary: string; bucket: string; score: number
  formula_version: number; points: number | null; comments: number | null
  also_in: string; fetched_at: number
}
interface BriefRow {
  id: string; date: string; topic_id: string; markdown: string; ir_json: string | null
  model: string; tokens_in: number; tokens_out: number; link_check: string | null; created_at: number
}
interface RunRow {
  id: string; started_at: number; finished_at: number | null
  n_sources: number; n_raw: number; n_kept: number; errors_json: string | null
}
interface FlagRow {
  item_id: string; is_read: number; is_saved: number; is_hidden: number
  briefed_at: number | null; noted_at: number | null
}
interface SettingRow { key: string; value: string }

const toSource = (r: SourceRow): Source => ({
  id: r.id,
  name: r.name,
  kind: r.kind as SourceKind,
  ...(r.url !== null ? { url: r.url } : {}),
  ...(r.channel_id !== null ? { channelId: r.channel_id } : {}),
  tier: r.tier as Tier,
  bucketHint: r.bucket_hint as Bucket,
  ...(r.window_hours !== null ? { windowHours: r.window_hours } : {}),
  ...(bool(r.always_keep) ? { alwaysKeep: true } : {}),
  ...(bool(r.insecure) ? { insecure: true } : {}),
  ...(r.parser !== null ? { parser: r.parser } : {}),
  enabled: bool(r.enabled),
  ...(r.last_ok_at !== null ? { lastOkAt: r.last_ok_at } : {}),
  failStreak: r.fail_streak,
  ...(r.last_error !== null ? { lastError: r.last_error } : {}),
  ...(r.avg_items !== null ? { avgItems: r.avg_items } : {}),
  ...(r.avg_ms !== null ? { avgMs: r.avg_ms } : {}),
  createdAt: r.created_at,
  updatedAt: r.updated_at
})

const toItem = (r: ItemRow): Item => ({
  id: r.id,
  sourceId: r.source_id,
  title: r.title,
  url: r.url,
  ...(r.author !== null ? { author: r.author } : {}),
  ...(r.published_at !== null ? { publishedAt: r.published_at } : {}),
  summary: r.summary,
  bucket: r.bucket as Bucket,
  score: r.score,
  formulaVersion: r.formula_version,
  ...(r.points !== null ? { points: r.points } : {}),
  ...(r.comments !== null ? { comments: r.comments } : {}),
  alsoIn: safeParseArray(r.also_in),
  fetchedAt: r.fetched_at
})

const toBrief = (r: BriefRow): Brief => ({
  id: r.id,
  date: r.date,
  topicId: r.topic_id,
  markdown: r.markdown,
  ...(r.ir_json !== null ? { irJson: r.ir_json } : {}),
  model: r.model,
  tokensIn: r.tokens_in,
  tokensOut: r.tokens_out,
  ...(r.link_check !== null ? { linkCheck: r.link_check } : {}),
  createdAt: r.created_at
})

const toRun = (r: RunRow): RunRecord => ({
  id: r.id,
  startedAt: r.started_at,
  ...(r.finished_at !== null ? { finishedAt: r.finished_at } : {}),
  nSources: r.n_sources,
  nRaw: r.n_raw,
  nKept: r.n_kept,
  ...(r.errors_json !== null ? { errorsJson: r.errors_json } : {})
})

const toFlags = (r: FlagRow): ItemFlags => ({
  itemId: r.item_id,
  isRead: bool(r.is_read),
  isSaved: bool(r.is_saved),
  isHidden: bool(r.is_hidden),
  ...(r.briefed_at !== null ? { briefedAt: r.briefed_at } : {}),
  ...(r.noted_at !== null ? { notedAt: r.noted_at } : {})
})

function safeParseArray(s: string): string[] {
  try {
    const v: unknown = JSON.parse(s)
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

/** FTS5 查询串：整体当一个短语，避免用户输入里的运算符导致语法错误 */
function ftsPhrase(q: string): string {
  return `"${q.replace(/"/g, '""')}"`
}

class SqliteSourceStore implements SourceStore {
  constructor(private db: DB) {}

  list(): Source[] {
    return (this.db.prepare('SELECT * FROM sources ORDER BY tier ASC, id ASC').all() as SourceRow[]).map(toSource)
  }
  get(id: string): Source | undefined {
    const r = this.db.prepare('SELECT * FROM sources WHERE id = ?').get(id) as SourceRow | undefined
    return r ? toSource(r) : undefined
  }
  upsert(s: Source): void {
    this.upsertMany([s])
  }
  upsertMany(list: Source[]): void {
    const stmt = this.db.prepare(`
      INSERT INTO sources (id,name,kind,url,channel_id,tier,bucket_hint,window_hours,always_keep,
                           insecure,parser,enabled,last_ok_at,fail_streak,last_error,avg_items,avg_ms,
                           created_at,updated_at)
      VALUES (@id,@name,@kind,@url,@channel_id,@tier,@bucket_hint,@window_hours,@always_keep,
              @insecure,@parser,@enabled,@last_ok_at,@fail_streak,@last_error,@avg_items,@avg_ms,
              @created_at,@updated_at)
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name, kind=excluded.kind, url=excluded.url, channel_id=excluded.channel_id,
        tier=excluded.tier, bucket_hint=excluded.bucket_hint, window_hours=excluded.window_hours,
        always_keep=excluded.always_keep, insecure=excluded.insecure, parser=excluded.parser,
        enabled=excluded.enabled, updated_at=excluded.updated_at
    `)
    const ts = now()
    this.db.transaction((rows: Source[]) => {
      for (const s of rows) {
        stmt.run({
          id: s.id, name: s.name, kind: s.kind,
          url: s.url ?? null, channel_id: s.channelId ?? null,
          tier: s.tier, bucket_hint: s.bucketHint,
          window_hours: s.windowHours ?? null,
          always_keep: s.alwaysKeep ? 1 : 0, insecure: s.insecure ? 1 : 0,
          parser: s.parser ?? null, enabled: s.enabled ? 1 : 0,
          last_ok_at: s.lastOkAt ?? null, fail_streak: s.failStreak,
          last_error: s.lastError ?? null,
          avg_items: s.avgItems ?? null, avg_ms: s.avgMs ?? null,
          created_at: s.createdAt ?? ts, updated_at: ts
        })
      }
    })(list)
  }
  remove(id: string): void {
    this.db.prepare('DELETE FROM sources WHERE id = ?').run(id)
  }
  recordSuccess(id: string, itemCount: number, ms: number): void {
    this.db
      .prepare(
        `UPDATE sources SET last_ok_at=?, fail_streak=0, last_error=NULL,
         avg_items = CASE WHEN avg_items IS NULL THEN ? ELSE (avg_items*0.7 + ?*0.3) END,
         avg_ms    = CASE WHEN avg_ms    IS NULL THEN ? ELSE (avg_ms   *0.7 + ?*0.3) END,
         updated_at=? WHERE id=?`
      )
      .run(now(), itemCount, itemCount, ms, ms, now(), id)
  }
  recordFailure(id: string, error: string): void {
    this.db
      .prepare('UPDATE sources SET fail_streak = fail_streak + 1, last_error=?, updated_at=? WHERE id=?')
      .run(error.slice(0, 500), now(), id)
  }
}

class SqliteItemStore implements ItemStore {
  constructor(private db: DB) {}

  upsertMany(items: Item[]): number {
    if (items.length === 0) return 0
    const stmt = this.db.prepare(`
      INSERT INTO items (id,source_id,title,url,author,published_at,summary,bucket,score,
                         formula_version,points,comments,also_in,fetched_at)
      VALUES (@id,@source_id,@title,@url,@author,@published_at,@summary,@bucket,@score,
              @formula_version,@points,@comments,@also_in,@fetched_at)
      ON CONFLICT(id) DO UPDATE SET
        title=excluded.title, url=excluded.url, author=excluded.author,
        published_at=excluded.published_at, summary=excluded.summary, bucket=excluded.bucket,
        score=excluded.score, formula_version=excluded.formula_version,
        points=excluded.points, comments=excluded.comments, also_in=excluded.also_in,
        fetched_at=excluded.fetched_at
    `)
    const tx = this.db.transaction((rows: Item[]) => {
      for (const it of rows) {
        stmt.run({
          id: it.id, source_id: it.sourceId, title: it.title, url: it.url,
          author: it.author ?? null, published_at: it.publishedAt ?? null,
          summary: it.summary, bucket: it.bucket, score: it.score,
          formula_version: it.formulaVersion, points: it.points ?? null,
          comments: it.comments ?? null, also_in: JSON.stringify(it.alsoIn),
          fetched_at: it.fetchedAt
        })
      }
      return rows.length
    })
    return tx(items)
  }

  get(id: string): Item | undefined {
    const r = this.db.prepare('SELECT * FROM items WHERE id = ?').get(id) as ItemRow | undefined
    return r ? toItem(r) : undefined
  }

  since(ts: number, limit = 500): Item[] {
    const rows = this.db
      .prepare('SELECT * FROM items WHERE COALESCE(published_at, fetched_at) >= ? ORDER BY score DESC LIMIT ?')
      .all(ts, limit) as ItemRow[]
    return rows.map(toItem)
  }

  briefedIds(sinceTs: number): Set<string> {
    const rows = this.db
      .prepare('SELECT item_id FROM item_flags WHERE briefed_at IS NOT NULL AND briefed_at >= ?')
      .all(sinceTs) as { item_id: string }[]
    return new Set(rows.map((r) => r.item_id))
  }

  markBriefed(ids: string[], ts: number): void {
    if (ids.length === 0) return
    const stmt = this.db.prepare(`
      INSERT INTO item_flags (item_id, briefed_at, noted_at) VALUES (?, ?, ?)
      ON CONFLICT(item_id) DO UPDATE SET briefed_at=excluded.briefed_at
    `)
    this.db.transaction((list: string[]) => {
      for (const id of list) stmt.run(id, ts, ts)
    })(ids)
  }

  search(query: string, opts?: { limit?: number; bucket?: string }): Item[] {
    const q = query.trim()
    if (!q) return []
    const limit = opts?.limit ?? 50
    const bucket = opts?.bucket

    // trigram 分词要求查询至少 3 个字符，短查询退化为 LIKE
    if (q.length < 3) {
      const like = `%${q}%`
      const rows = bucket
        ? (this.db
            .prepare('SELECT * FROM items WHERE (title LIKE ? OR summary LIKE ?) AND bucket = ? ORDER BY score DESC LIMIT ?')
            .all(like, like, bucket, limit) as ItemRow[])
        : (this.db
            .prepare('SELECT * FROM items WHERE (title LIKE ? OR summary LIKE ?) ORDER BY score DESC LIMIT ?')
            .all(like, like, limit) as ItemRow[])
      return rows.map(toItem)
    }

    const sql = `
      SELECT i.* FROM items i
      JOIN items_fts f ON f.rowid = i.rowid
      WHERE items_fts MATCH ?${bucket ? ' AND i.bucket = ?' : ''}
      ORDER BY i.score DESC LIMIT ?`
    const args: unknown[] = bucket ? [ftsPhrase(q), bucket, limit] : [ftsPhrase(q), limit]
    const rows = this.db.prepare(sql).all(...args) as ItemRow[]
    return rows.map(toItem)
  }

  count(): number {
    return int((this.db.prepare('SELECT COUNT(*) c FROM items').get() as { c: number }).c)
  }
}

class SqliteBriefStore implements BriefStore {
  constructor(private db: DB) {}
  save(b: Brief): void {
    this.db
      .prepare(
        `INSERT INTO briefs (id,date,topic_id,markdown,ir_json,model,tokens_in,tokens_out,link_check,created_at)
         VALUES (@id,@date,@topic_id,@markdown,@ir_json,@model,@tokens_in,@tokens_out,@link_check,@created_at)
         ON CONFLICT(id) DO UPDATE SET markdown=excluded.markdown, ir_json=excluded.ir_json,
           model=excluded.model, tokens_in=excluded.tokens_in, tokens_out=excluded.tokens_out,
           link_check=excluded.link_check`
      )
      .run({
        id: b.id, date: b.date, topic_id: b.topicId, markdown: b.markdown,
        ir_json: b.irJson ?? null, model: b.model,
        tokens_in: b.tokensIn, tokens_out: b.tokensOut,
        link_check: b.linkCheck ?? null, created_at: b.createdAt
      })
  }
  latest(): Brief | undefined {
    const r = this.db.prepare('SELECT * FROM briefs ORDER BY date DESC, created_at DESC LIMIT 1').get() as
      | BriefRow
      | undefined
    return r ? toBrief(r) : undefined
  }
  byDate(date: string): Brief | undefined {
    const r = this.db
      .prepare('SELECT * FROM briefs WHERE date = ? ORDER BY created_at DESC LIMIT 1')
      .get(date) as BriefRow | undefined
    return r ? toBrief(r) : undefined
  }
  list(limit = 30): Brief[] {
    const rows = this.db
      .prepare('SELECT * FROM briefs ORDER BY date DESC, created_at DESC LIMIT ?')
      .all(limit) as BriefRow[]
    return rows.map(toBrief)
  }
}

class SqliteRunStore implements RunStore {
  constructor(private db: DB) {}
  start(r: RunRecord): void {
    this.db
      .prepare('INSERT INTO runs (id,started_at,n_sources,n_raw,n_kept,errors_json) VALUES (?,?,?,?,?,?)')
      .run(r.id, r.startedAt, r.nSources, r.nRaw, r.nKept, r.errorsJson ?? null)
  }
  finish(id: string, patch: Partial<RunRecord>): void {
    const cur = this.db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as RunRow | undefined
    if (!cur) return
    this.db
      .prepare('UPDATE runs SET finished_at=?, n_sources=?, n_raw=?, n_kept=?, errors_json=? WHERE id=?')
      .run(
        patch.finishedAt ?? now(),
        patch.nSources ?? cur.n_sources,
        patch.nRaw ?? cur.n_raw,
        patch.nKept ?? cur.n_kept,
        patch.errorsJson ?? cur.errors_json,
        id
      )
  }
  recent(limit = 10): RunRecord[] {
    const rows = this.db.prepare('SELECT * FROM runs ORDER BY started_at DESC LIMIT ?').all(limit) as RunRow[]
    return rows.map(toRun)
  }
}

class SqliteFlagStore implements FlagStore {
  constructor(private db: DB) {}
  get(itemId: string): ItemFlags | undefined {
    const r = this.db.prepare('SELECT * FROM item_flags WHERE item_id = ?').get(itemId) as FlagRow | undefined
    return r ? toFlags(r) : undefined
  }
  set(itemId: string, patch: Partial<Omit<ItemFlags, 'itemId'>>): void {
    const cur = this.get(itemId) ?? { itemId, isRead: false, isSaved: false, isHidden: false }
    this.db
      .prepare(
        `INSERT INTO item_flags (item_id,is_read,is_saved,is_hidden,briefed_at,noted_at)
         VALUES (@item_id,@is_read,@is_saved,@is_hidden,@briefed_at,@noted_at)
         ON CONFLICT(item_id) DO UPDATE SET is_read=excluded.is_read, is_saved=excluded.is_saved,
           is_hidden=excluded.is_hidden, briefed_at=excluded.briefed_at, noted_at=excluded.noted_at`
      )
      .run({
        item_id: itemId,
        is_read: (patch.isRead ?? cur.isRead) ? 1 : 0,
        is_saved: (patch.isSaved ?? cur.isSaved) ? 1 : 0,
        is_hidden: (patch.isHidden ?? cur.isHidden) ? 1 : 0,
        briefed_at: patch.briefedAt ?? cur.briefedAt ?? null,
        noted_at: now()
      })
  }
  byFlag(flag: 'isRead' | 'isSaved' | 'isHidden', value: boolean): string[] {
    const col = flag === 'isRead' ? 'is_read' : flag === 'isSaved' ? 'is_saved' : 'is_hidden'
    const rows = this.db
      .prepare(`SELECT item_id FROM item_flags WHERE ${col} = ?`)
      .all(value ? 1 : 0) as { item_id: string }[]
    return rows.map((r) => r.item_id)
  }
}

class SqliteSettingsStore implements SettingsStore {
  constructor(private db: DB) {}
  get<T = unknown>(key: string): T | undefined {
    const r = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as SettingRow | undefined
    if (!r) return undefined
    try {
      return JSON.parse(r.value) as T
    } catch {
      return undefined
    }
  }
  set(key: string, value: unknown): void {
    this.db
      .prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .run(key, JSON.stringify(value))
  }
  all(): Record<string, unknown> {
    const rows = this.db.prepare('SELECT key,value FROM settings').all() as SettingRow[]
    const out: Record<string, unknown> = {}
    for (const r of rows) {
      try {
        out[r.key] = JSON.parse(r.value)
      } catch {
        out[r.key] = r.value
      }
    }
    return out
  }
}

class SqliteStore implements Store {
  readonly sources: SourceStore
  readonly items: ItemStore
  readonly briefs: BriefStore
  readonly runs: RunStore
  readonly flags: FlagStore
  readonly settings: SettingsStore

  constructor(private db: DB) {
    this.sources = new SqliteSourceStore(db)
    this.items = new SqliteItemStore(db)
    this.briefs = new SqliteBriefStore(db)
    this.runs = new SqliteRunStore(db)
    this.flags = new SqliteFlagStore(db)
    this.settings = new SqliteSettingsStore(db)
  }

  schemaVersion(): number {
    return schemaVersion(this.db)
  }
  close(): void {
    this.db.close()
  }
}

export function createStore(file: string): Store {
  return new SqliteStore(openDatabase(file))
}

/** 测试用：内存库 */
export function createMemoryStore(): Store {
  return new SqliteStore(openDatabase(':memory:'))
}
