import type { DB } from './db'
import { openDatabase, schemaVersion } from './db'
import type {
  Store, SourceStore, ItemStore, BriefStore, RunStore, FlagStore, SettingsStore, SearchOptions, TopicStore,
  DomainStore, ChatStore
} from '../../core/ports/store'
import type {
  Domain,
  Item, ItemFlags, Brief, RunRecord, Source, SourceKind, Bucket, Tier, Topic, ChatThread, ChatStoredMessage, ChatRole
} from '../../core/domain/types'

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
interface ChatThreadRow {
  id: string; title: string; topic_id: string; brief_date: string | null
  model: string; created_at: number; updated_at: number; archived: number
}
interface ChatMessageRow {
  id: string; thread_id: string; role: string; content: string; model: string | null
  tokens_in: number | null; tokens_out: number | null; context_json: string | null; created_at: number
}
interface TopicRow {
  id: string; name: string; domain_id: string; enabled: number; hour: number; minute: number
  created_at: number; updated_at: number
}

interface DomainRow {
  id: string; name: string; created_at: number
}

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

const toTopic = (r: TopicRow): Topic => ({
  id: r.id,
  name: r.name,
  domainId: r.domain_id,
  enabled: bool(r.enabled),
  hour: r.hour,
  minute: r.minute,
  createdAt: r.created_at,
  updatedAt: r.updated_at
})

const toChatThread = (r: ChatThreadRow): ChatThread => ({
  id: r.id,
  title: r.title,
  topicId: r.topic_id,
  ...(r.brief_date !== null ? { briefDate: r.brief_date } : {}),
  model: r.model,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  archived: bool(r.archived)
})

const toChatMessage = (r: ChatMessageRow): ChatStoredMessage => ({
  id: r.id,
  threadId: r.thread_id,
  role: r.role as ChatRole,
  content: r.content,
  ...(r.model !== null ? { model: r.model } : {}),
  ...(r.tokens_in !== null ? { tokensIn: r.tokens_in } : {}),
  ...(r.tokens_out !== null ? { tokensOut: r.tokens_out } : {}),
  ...(r.context_json !== null ? { contextJson: r.context_json } : {}),
  createdAt: r.created_at
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

  /** 已推送按 (主题, 条目) 记：A 主题推过的，B 主题仍可以推 */
  briefedIds(sinceTs: number, topicId?: string): Set<string> {
    const rows = (
      topicId
        ? this.db
            .prepare('SELECT item_id FROM brief_items WHERE topic_id = ? AND briefed_at >= ?')
            .all(topicId, sinceTs)
        : this.db.prepare('SELECT item_id FROM brief_items WHERE briefed_at >= ?').all(sinceTs)
    ) as { item_id: string }[]
    return new Set(rows.map((r) => r.item_id))
  }

  briefedIdsBefore(sinceTs: number, beforeTs: number, topicId?: string): Set<string> {
    const rows = (
      topicId
        ? this.db
            .prepare(
              'SELECT item_id FROM brief_items WHERE topic_id = ? AND briefed_at >= ? AND briefed_at < ?'
            )
            .all(topicId, sinceTs, beforeTs)
        : this.db
            .prepare('SELECT item_id FROM brief_items WHERE briefed_at >= ? AND briefed_at < ?')
            .all(sinceTs, beforeTs)
    ) as { item_id: string }[]
    return new Set(rows.map((r) => r.item_id))
  }

  markBriefed(ids: string[], ts: number, topicId = 'ai'): void {
    if (ids.length === 0) return
    const stmt = this.db.prepare(`
      INSERT INTO brief_items (topic_id, item_id, briefed_at) VALUES (?, ?, ?)
      ON CONFLICT(topic_id, item_id) DO UPDATE SET briefed_at=excluded.briefed_at
    `)
    // 冗余写一份到 item_flags：界面与诊断包还在读它（"这条属于哪一期"由 brief_items 负责）
    const flag = this.db.prepare(`
      INSERT INTO item_flags (item_id, briefed_at, noted_at) VALUES (?, ?, ?)
      ON CONFLICT(item_id) DO UPDATE SET briefed_at=excluded.briefed_at
    `)
    this.db.transaction((list: string[]) => {
      for (const id of list) {
        stmt.run(topicId, id, ts)
        flag.run(id, ts, ts)
      }
    })(ids)
  }

  search(query: string, opts: SearchOptions = {}): Item[] {
    const q = query.trim()
    if (!q) return []
    const limit = opts.limit ?? 50

    // 筛选条件对两条查询路径是同一套，只是表别名不同
    const filters: string[] = []
    const filterArgs: unknown[] = []
    if (opts.bucket) {
      filters.push('i.bucket = ?')
      filterArgs.push(opts.bucket)
    }
    if (opts.sourceId) {
      filters.push('i.source_id = ?')
      filterArgs.push(opts.sourceId)
    }
    if (opts.sinceTs !== undefined) {
      // 没有发布时间的条目按抓取时间算，否则它们会被时间筛选整批吞掉
      filters.push('COALESCE(i.published_at, i.fetched_at) >= ?')
      filterArgs.push(opts.sinceTs)
    }
    const where = filters.length > 0 ? ' AND ' + filters.join(' AND ') : ''
    const order = opts.sort === 'time' ? 'COALESCE(i.published_at, i.fetched_at) DESC' : 'i.score DESC'

    // trigram 分词要求查询至少 3 个字符，短查询退化为 LIKE
    if (q.length < 3) {
      const like = `%${q}%`
      const sql = `SELECT i.* FROM items i WHERE (i.title LIKE ? OR i.summary LIKE ?)${where} ORDER BY ${order} LIMIT ?`
      const rows = this.db.prepare(sql).all(like, like, ...filterArgs, limit) as ItemRow[]
      return rows.map(toItem)
    }

    const sql = `
      SELECT i.* FROM items i
      JOIN items_fts f ON f.rowid = i.rowid
      WHERE items_fts MATCH ?${where}
      ORDER BY ${order} LIMIT ?`
    const rows = this.db.prepare(sql).all(ftsPhrase(q), ...filterArgs, limit) as ItemRow[]
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
         ON CONFLICT(id) DO UPDATE SET topic_id=excluded.topic_id, markdown=excluded.markdown,
           ir_json=excluded.ir_json, model=excluded.model, tokens_in=excluded.tokens_in,
           tokens_out=excluded.tokens_out, link_check=excluded.link_check,
           -- createdAt 记的是"这一版内容什么时候写的"：重新成稿后必须跟着更新，
           -- 否则界面和时间线会拿旧时间描述新内容
           created_at=excluded.created_at`
      )
      .run({
        id: b.id, date: b.date, topic_id: b.topicId, markdown: b.markdown,
        ir_json: b.irJson ?? null, model: b.model,
        tokens_in: b.tokensIn, tokens_out: b.tokensOut,
        link_check: b.linkCheck ?? null, created_at: b.createdAt
      })
  }
  latest(topicId?: string): Brief | undefined {
    const r = (
      topicId
        ? this.db
            .prepare('SELECT * FROM briefs WHERE topic_id = ? ORDER BY date DESC, created_at DESC LIMIT 1')
            .get(topicId)
        : this.db.prepare('SELECT * FROM briefs ORDER BY date DESC, created_at DESC LIMIT 1').get()
    ) as BriefRow | undefined
    return r ? toBrief(r) : undefined
  }
  byDate(date: string, topicId?: string): Brief | undefined {
    const r = (
      topicId
        ? this.db
            .prepare('SELECT * FROM briefs WHERE date = ? AND topic_id = ? ORDER BY created_at DESC LIMIT 1')
            .get(date, topicId)
        : this.db.prepare('SELECT * FROM briefs WHERE date = ? ORDER BY created_at DESC LIMIT 1').get(date)
    ) as BriefRow | undefined
    return r ? toBrief(r) : undefined
  }
  list(limit = 30, topicId?: string): Brief[] {
    const rows = (
      topicId
        ? this.db
            .prepare('SELECT * FROM briefs WHERE topic_id = ? ORDER BY date DESC, created_at DESC LIMIT ?')
            .all(topicId, limit)
        : this.db.prepare('SELECT * FROM briefs ORDER BY date DESC, created_at DESC LIMIT ?').all(limit)
    ) as BriefRow[]
    return rows.map(toBrief)
  }
  count(): number {
    return int((this.db.prepare('SELECT COUNT(*) c FROM briefs').get() as { c: number }).c)
  }
}

class SqliteTopicStore implements TopicStore {
  constructor(private db: DB) {}
  list(): Topic[] {
    const rows = this.db.prepare('SELECT * FROM topics ORDER BY created_at ASC').all() as TopicRow[]
    return rows.map(toTopic)
  }
  get(id: string): Topic | undefined {
    const r = this.db.prepare('SELECT * FROM topics WHERE id = ?').get(id) as TopicRow | undefined
    return r ? toTopic(r) : undefined
  }
  upsert(t: Topic): void {
    this.db
      .prepare(
        `INSERT INTO topics (id,name,domain_id,enabled,hour,minute,created_at,updated_at)
         VALUES (@id,@name,@domain_id,@enabled,@hour,@minute,@created_at,@updated_at)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, domain_id=excluded.domain_id,
           enabled=excluded.enabled, hour=excluded.hour, minute=excluded.minute,
           updated_at=excluded.updated_at`
      )
      .run({
        id: t.id, name: t.name, domain_id: t.domainId, enabled: t.enabled ? 1 : 0, hour: t.hour, minute: t.minute,
        created_at: t.createdAt, updated_at: t.updatedAt
      })
  }
  remove(id: string): void {
    this.db.prepare('DELETE FROM topics WHERE id = ?').run(id)
  }
  sourceIds(topicId: string): string[] {
    const rows = this.db.prepare('SELECT source_id FROM topic_sources WHERE topic_id = ?').all(topicId) as {
      source_id: string
    }[]
    return rows.map((r) => r.source_id)
  }
  setSources(topicId: string, sourceIds: string[]): void {
    const ins = this.db.prepare('INSERT OR IGNORE INTO topic_sources (topic_id, source_id) VALUES (?, ?)')
    this.db.transaction((ids: string[]) => {
      this.db.prepare('DELETE FROM topic_sources WHERE topic_id = ?').run(topicId)
      for (const id of ids) ins.run(topicId, id)
    })(sourceIds)
  }
  addSource(topicId: string, sourceId: string): void {
    this.db.prepare('INSERT OR IGNORE INTO topic_sources (topic_id, source_id) VALUES (?, ?)').run(topicId, sourceId)
  }
  removeSource(topicId: string, sourceId: string): void {
    this.db.prepare('DELETE FROM topic_sources WHERE topic_id = ? AND source_id = ?').run(topicId, sourceId)
  }
}

class SqliteDomainStore implements DomainStore {
  constructor(private db: DB) {}
  list(): Domain[] {
    const rows = this.db.prepare('SELECT * FROM domains ORDER BY created_at ASC').all() as DomainRow[]
    return rows.map((r) => ({ id: r.id, name: r.name, createdAt: r.created_at }))
  }
  get(id: string): Domain | undefined {
    const r = this.db.prepare('SELECT * FROM domains WHERE id = ?').get(id) as DomainRow | undefined
    return r ? { id: r.id, name: r.name, createdAt: r.created_at } : undefined
  }
  upsert(d: Domain): void {
    this.db
      .prepare(
        `INSERT INTO domains (id,name,created_at) VALUES (@id,@name,@created_at)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name`
      )
      .run({ id: d.id, name: d.name, created_at: d.createdAt })
  }
  remove(id: string): void {
    this.db.prepare('DELETE FROM domains WHERE id = ?').run(id)
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

class SqliteChatStore implements ChatStore {
  constructor(private db: DB) {}
  threads(topicId?: string): ChatThread[] {
    const rows = (
      topicId
        ? this.db
            .prepare('SELECT * FROM chat_threads WHERE topic_id = ? ORDER BY updated_at DESC')
            .all(topicId)
        : this.db.prepare('SELECT * FROM chat_threads ORDER BY updated_at DESC').all()
    ) as ChatThreadRow[]
    return rows.map(toChatThread)
  }
  get(id: string): ChatThread | undefined {
    const r = this.db.prepare('SELECT * FROM chat_threads WHERE id = ?').get(id) as ChatThreadRow | undefined
    return r ? toChatThread(r) : undefined
  }
  findByDate(topicId: string, briefDate: string): ChatThread | undefined {
    const r = this.db
      .prepare('SELECT * FROM chat_threads WHERE topic_id = ? AND brief_date = ? ORDER BY updated_at DESC LIMIT 1')
      .get(topicId, briefDate) as ChatThreadRow | undefined
    return r ? toChatThread(r) : undefined
  }
  create(t: ChatThread): void {
    this.db
      .prepare(
        `INSERT INTO chat_threads (id,title,topic_id,brief_date,model,created_at,updated_at,archived)
         VALUES (@id,@title,@topic_id,@brief_date,@model,@created_at,@updated_at,@archived)`
      )
      .run({
        id: t.id,
        title: t.title,
        topic_id: t.topicId,
        brief_date: t.briefDate ?? null,
        model: t.model,
        created_at: t.createdAt,
        updated_at: t.updatedAt,
        archived: t.archived ? 1 : 0
      })
  }
  update(id: string, patch: { title?: string; model?: string; updatedAt?: number }): void {
    const cur = this.get(id)
    if (!cur) return
    this.db
      .prepare('UPDATE chat_threads SET title = ?, model = ?, updated_at = ? WHERE id = ?')
      .run(patch.title ?? cur.title, patch.model ?? cur.model, patch.updatedAt ?? Date.now(), id)
  }
  remove(id: string): void {
    this.db.prepare('DELETE FROM chat_threads WHERE id = ?').run(id)
  }
  messages(threadId: string): ChatStoredMessage[] {
    const rows = this.db
      .prepare('SELECT * FROM chat_messages WHERE thread_id = ? ORDER BY created_at ASC')
      .all(threadId) as ChatMessageRow[]
    return rows.map(toChatMessage)
  }
  addMessage(m: ChatStoredMessage): void {
    this.db
      .prepare(
        `INSERT INTO chat_messages (id,thread_id,role,content,model,tokens_in,tokens_out,context_json,created_at)
         VALUES (@id,@thread_id,@role,@content,@model,@tokens_in,@tokens_out,@context_json,@created_at)`
      )
      .run({
        id: m.id,
        thread_id: m.threadId,
        role: m.role,
        content: m.content,
        model: m.model ?? null,
        tokens_in: m.tokensIn ?? null,
        tokens_out: m.tokensOut ?? null,
        context_json: m.contextJson ?? null,
        created_at: m.createdAt
      })
  }
}

class SqliteStore implements Store {
  readonly sources: SourceStore
  readonly domains: DomainStore
  readonly topics: TopicStore
  readonly items: ItemStore
  readonly briefs: BriefStore
  readonly chat: ChatStore
  readonly runs: RunStore
  readonly flags: FlagStore
  readonly settings: SettingsStore

  constructor(private db: DB) {
    this.sources = new SqliteSourceStore(db)
    this.domains = new SqliteDomainStore(db)
    this.topics = new SqliteTopicStore(db)
    this.items = new SqliteItemStore(db)
    this.briefs = new SqliteBriefStore(db)
    this.chat = new SqliteChatStore(db)
    this.runs = new SqliteRunStore(db)
    this.flags = new SqliteFlagStore(db)
    this.settings = new SqliteSettingsStore(db)
  }

  schemaVersion(): number {
    return schemaVersion(this.db)
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)()
  }
  close(): void {
    this.db.close()
  }
}

/**
 * 保底主题：迁移会给老库建 'ai'，但全新的库要等这次调用。
 *
 * 放在仓储工厂而不是 app 层，是因为 brief_items.topic_id 有外键——
 * 任何写「已推送」的路径都必须先有一个主题存在，否则写入直接失败。
 */
function ensureDefaultDomain(store: Store): Store {
  if (store.domains.list().length > 0) return store
  store.domains.upsert({ id: 'ai', name: 'AI', createdAt: Date.now() })
  return store
}

function ensureDefaultTopic(store: Store): Store {
  if (store.topics.list().length > 0) return store
  const now = Date.now()
  store.topics.upsert({
    id: 'ai',
    name: 'AI 综合',
    domainId: 'ai',
    enabled: true,
    hour: 8,
    minute: 30,
    createdAt: now,
    updatedAt: now
  })
  return store
}

export function createStore(file: string): Store {
  return ensureDefaultTopic(ensureDefaultDomain(new SqliteStore(openDatabase(file))))
}

/** 测试用：内存库 */
export function createMemoryStore(): Store {
  return ensureDefaultTopic(ensureDefaultDomain(new SqliteStore(openDatabase(':memory:'))))
}
