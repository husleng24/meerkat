import type { DB } from './db'
import { openDatabase, schemaVersion } from './db'
import type {
  Store, SourceStore, ItemStore, BriefStore, RunStore, FlagStore, SettingsStore, SearchOptions, TopicStore,
  DomainStore, ChatStore, StoryStore, VideoStore, DecisionStore, EntityStore, EventNoteStore, ManualEventStore,
  PromptProfileStore
} from '../../core/ports/store'
import type {
  Domain,
  Item, ItemFlags, Brief, RunRecord, Source, SourceKind, Bucket, Tier, Topic, ChatThread, ChatStoredMessage, ChatRole, Story, PromptProfile, PromptProfileVersion, PromptEvaluation,
  VideoCreator, VideoReport, DecisionNote, Entity, EventNote, ManualEvent
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
  scope: string; item_id: string | null; event_key: string | null
  model: string; created_at: number; updated_at: number; archived: number
}
interface StoryRow {
  id: string; title: string; query: string; aliases_json: string
  topic_id: string; item_id: string | null; thread_id: string | null
  status: string; miss_count: number; last_match_at: number | null
  last_prompt_at: number | null; created_at: number; updated_at: number
}

interface VideoCreatorRow {
  id: string; channel_id: string; name: string; handle: string | null
  created_at: number; updated_at: number
}

interface VideoReportRow {
  id: string; creator_id: string; video_id: string; title: string; url: string
  published_at: number | null; duration_sec: number | null; language: string | null
  transcript_md: string; summary_md: string; model: string
  created_at: number; updated_at: number
}

interface DecisionRow {
  item_id: string; note: string; verify_at: number | null
  created_at: number; updated_at: number
}

interface EntityRow {
  id: string; name: string; kind: string; aliases_json: string
  created_at: number; updated_at: number
}

interface EventNoteRow {
  event_key: string; note: string; created_at: number; updated_at: number
  entity_id: string | null; title: string | null; event_type: string | null; latest_at: number | null
}

interface ManualEventRow {
  id: string; entity_id: string; title: string; event: string
  item_ids_json: string; created_at: number; updated_at: number
}

interface ChatMessageRow {
  id: string; thread_id: string; role: string; content: string; model: string | null
  tokens_in: number | null; tokens_out: number | null; context_json: string | null; created_at: number
}
interface TopicRow {
  id: string; name: string; domain_id: string; enabled: number; hour: number; minute: number
  editorial_focus: string | null
  prompt_profile_id: string | null
  selection_policy_json: string | null
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
  ...(r.editorial_focus !== null && r.editorial_focus.trim() !== ''
    ? { editorialFocus: r.editorial_focus }
    : {}),
  ...(r.prompt_profile_id !== null ? { promptProfileId: r.prompt_profile_id } : {}),
  ...(r.selection_policy_json !== null
    ? { selectionPolicy: JSON.parse(r.selection_policy_json) as Topic['selectionPolicy'] }
    : {}),
  createdAt: r.created_at,
  updatedAt: r.updated_at
})

const toChatThread = (r: ChatThreadRow): ChatThread => ({
  id: r.id,
  title: r.title,
  topicId: r.topic_id,
  scope: r.scope === 'item' ? 'item' : r.scope === 'event' ? 'event' : 'brief',
  ...(r.item_id !== null ? { itemId: r.item_id } : {}),
  ...(r.event_key !== null ? { eventKey: r.event_key } : {}),
  ...(r.brief_date !== null ? { briefDate: r.brief_date } : {}),
  model: r.model,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  archived: bool(r.archived)
})

const toStory = (r: StoryRow): Story => ({
  id: r.id,
  title: r.title,
  query: r.query,
  aliases: JSON.parse(r.aliases_json) as string[],
  topicId: r.topic_id,
  ...(r.item_id !== null ? { itemId: r.item_id } : {}),
  ...(r.thread_id !== null ? { threadId: r.thread_id } : {}),
  status: r.status === 'paused' || r.status === 'archived' ? r.status : 'active',
  missCount: r.miss_count,
  ...(r.last_match_at !== null ? { lastMatchAt: r.last_match_at } : {}),
  ...(r.last_prompt_at !== null ? { lastPromptAt: r.last_prompt_at } : {}),
  createdAt: r.created_at,
  updatedAt: r.updated_at
})

const toVideoCreator = (r: VideoCreatorRow): VideoCreator => ({
  id: r.id,
  channelId: r.channel_id,
  name: r.name,
  ...(r.handle !== null ? { handle: r.handle } : {}),
  createdAt: r.created_at,
  updatedAt: r.updated_at
})

const toVideoReport = (r: VideoReportRow): VideoReport => ({
  id: r.id,
  creatorId: r.creator_id,
  videoId: r.video_id,
  title: r.title,
  url: r.url,
  ...(r.published_at !== null ? { publishedAt: r.published_at } : {}),
  ...(r.duration_sec !== null ? { durationSec: r.duration_sec } : {}),
  ...(r.language !== null ? { language: r.language } : {}),
  transcriptMd: r.transcript_md,
  summaryMd: r.summary_md,
  model: r.model,
  createdAt: r.created_at,
  updatedAt: r.updated_at
})

const toDecision = (r: DecisionRow): DecisionNote => ({
  itemId: r.item_id,
  note: r.note,
  ...(r.verify_at !== null ? { verifyAt: r.verify_at } : {}),
  createdAt: r.created_at,
  updatedAt: r.updated_at
})

const toEntity = (r: EntityRow): Entity => ({
  id: r.id,
  name: r.name,
  kind: r.kind as Entity['kind'],
  aliases: safeParseArray(r.aliases_json),
  createdAt: r.created_at,
  updatedAt: r.updated_at
})

const toEventNote = (r: EventNoteRow): EventNote => ({
  eventKey: r.event_key,
  note: r.note,
  ...(r.entity_id !== null ? { entityId: r.entity_id } : {}),
  ...(r.title !== null ? { title: r.title } : {}),
  ...(r.event_type !== null ? { eventType: r.event_type } : {}),
  ...(r.latest_at !== null ? { latestAt: r.latest_at } : {}),
  createdAt: r.created_at,
  updatedAt: r.updated_at
})

const toManualEvent = (r: ManualEventRow): ManualEvent => ({
  id: r.id,
  entityId: r.entity_id,
  title: r.title,
  event: r.event,
  itemIds: safeParseArray(r.item_ids_json),
  createdAt: r.created_at,
  updatedAt: r.updated_at
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

  all(limit = 5000): Item[] {
    const rows = this.db
      .prepare('SELECT * FROM items ORDER BY COALESCE(published_at, fetched_at) DESC LIMIT ?')
      .all(limit) as ItemRow[]
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
        `INSERT INTO topics
           (id,name,domain_id,enabled,hour,minute,editorial_focus,prompt_profile_id,selection_policy_json,created_at,updated_at)
         VALUES
           (@id,@name,@domain_id,@enabled,@hour,@minute,@editorial_focus,@prompt_profile_id,@selection_policy_json,@created_at,@updated_at)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, domain_id=excluded.domain_id,
           enabled=excluded.enabled, hour=excluded.hour, minute=excluded.minute,
           editorial_focus=excluded.editorial_focus,
           prompt_profile_id=excluded.prompt_profile_id,
           selection_policy_json=excluded.selection_policy_json,
           updated_at=excluded.updated_at`
      )
      .run({
        id: t.id, name: t.name, domain_id: t.domainId, enabled: t.enabled ? 1 : 0, hour: t.hour, minute: t.minute,
        editorial_focus: t.editorialFocus ?? null,
        prompt_profile_id: t.promptProfileId ?? null,
        selection_policy_json: t.selectionPolicy ? JSON.stringify(t.selectionPolicy) : null,
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
      .prepare(
        `SELECT * FROM chat_threads
         WHERE topic_id = ? AND brief_date = ? AND scope = 'brief'
         ORDER BY updated_at DESC LIMIT 1`
      )
      .get(topicId, briefDate) as ChatThreadRow | undefined
    return r ? toChatThread(r) : undefined
  }
  findByItem(topicId: string, itemId: string): ChatThread | undefined {
    const r = this.db
      .prepare(
        `SELECT * FROM chat_threads
         WHERE topic_id = ? AND item_id = ? AND scope = 'item'
         ORDER BY updated_at DESC LIMIT 1`
      )
      .get(topicId, itemId) as ChatThreadRow | undefined
    return r ? toChatThread(r) : undefined
  }
  findByEvent(topicId: string, eventKey: string): ChatThread | undefined {
    const r = this.db
      .prepare(
        `SELECT * FROM chat_threads
         WHERE topic_id = ? AND event_key = ? AND scope = 'event'
         ORDER BY updated_at DESC LIMIT 1`
      )
      .get(topicId, eventKey) as ChatThreadRow | undefined
    return r ? toChatThread(r) : undefined
  }
  create(t: ChatThread): void {
    this.db
      .prepare(
        `INSERT INTO chat_threads (id,title,topic_id,scope,item_id,event_key,brief_date,model,created_at,updated_at,archived)
         VALUES (@id,@title,@topic_id,@scope,@item_id,@event_key,@brief_date,@model,@created_at,@updated_at,@archived)`
      )
      .run({
        id: t.id,
        title: t.title,
        topic_id: t.topicId,
        scope: t.scope ?? 'brief',
        item_id: t.itemId ?? null,
        event_key: t.eventKey ?? null,
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

class SqliteStoryStore implements StoryStore {
  constructor(private db: DB) {}
  create(story: Story): void {
    this.db
      .prepare(
        `INSERT INTO stories
         (id,title,query,aliases_json,topic_id,item_id,thread_id,status,miss_count,last_match_at,last_prompt_at,created_at,updated_at)
         VALUES (@id,@title,@query,@aliases_json,@topic_id,@item_id,@thread_id,@status,@miss_count,@last_match_at,@last_prompt_at,@created_at,@updated_at)`
      )
      .run({
        id: story.id,
        title: story.title,
        query: story.query,
        aliases_json: JSON.stringify(story.aliases),
        topic_id: story.topicId,
        item_id: story.itemId ?? null,
        thread_id: story.threadId ?? null,
        status: story.status,
        miss_count: story.missCount,
        last_match_at: story.lastMatchAt ?? null,
        last_prompt_at: story.lastPromptAt ?? null,
        created_at: story.createdAt,
        updated_at: story.updatedAt
      })
  }
  get(id: string): Story | undefined {
    const r = this.db.prepare('SELECT * FROM stories WHERE id = ?').get(id) as StoryRow | undefined
    return r ? toStory(r) : undefined
  }
  list(status?: Story['status']): Story[] {
    const rows = (
      status
        ? this.db.prepare('SELECT * FROM stories WHERE status = ? ORDER BY updated_at DESC').all(status)
        : this.db.prepare('SELECT * FROM stories ORDER BY updated_at DESC').all()
    ) as StoryRow[]
    return rows.map(toStory)
  }
  byThread(threadId: string): Story | undefined {
    const r = this.db
      .prepare("SELECT * FROM stories WHERE thread_id = ? AND status != 'archived' ORDER BY updated_at DESC LIMIT 1")
      .get(threadId) as StoryRow | undefined
    return r ? toStory(r) : undefined
  }
  update(
    id: string,
    patch: Partial<Pick<Story, 'status' | 'missCount' | 'lastMatchAt' | 'lastPromptAt' | 'updatedAt' | 'title' | 'aliases'>>
  ): void {
    const cur = this.get(id)
    if (!cur) return
    this.db
      .prepare(
        `UPDATE stories SET status=?, miss_count=?, last_match_at=?, last_prompt_at=?, updated_at=?, title=?, aliases_json=?
         WHERE id=?`
      )
      .run(
        patch.status ?? cur.status,
        patch.missCount ?? cur.missCount,
        patch.lastMatchAt ?? cur.lastMatchAt ?? null,
        patch.lastPromptAt ?? cur.lastPromptAt ?? null,
        patch.updatedAt ?? Date.now(),
        patch.title ?? cur.title,
        JSON.stringify(patch.aliases ?? cur.aliases),
        id
      )
  }
  itemIds(storyId: string): string[] {
    return (this.db.prepare('SELECT item_id FROM story_items WHERE story_id = ?').all(storyId) as Array<{ item_id: string }>).map(
      (r) => r.item_id
    )
  }
  latestItem(storyId: string): { title: string; at: number } | undefined {
    const r = this.db
      .prepare(
        `SELECT i.title AS title, si.added_at AS at
         FROM story_items si
         JOIN items i ON i.id = si.item_id
         WHERE si.story_id = ?
         ORDER BY si.added_at DESC, COALESCE(i.published_at, i.fetched_at) DESC
         LIMIT 1`
      )
      .get(storyId) as { title: string; at: number } | undefined
    return r
  }
  addItems(storyId: string, itemIds: string[], ts: number): number {
    const stmt = this.db.prepare('INSERT OR IGNORE INTO story_items (story_id,item_id,added_at) VALUES (?,?,?)')
    let added = 0
    for (const id of itemIds) added += stmt.run(storyId, id, ts).changes
    return added
  }
  remove(id: string): void {
    this.db.prepare('DELETE FROM stories WHERE id = ?').run(id)
  }
}

class SqliteVideoStore implements VideoStore {
  constructor(private db: DB) {}

  listCreators(): VideoCreator[] {
    const rows = this.db.prepare('SELECT * FROM video_creators ORDER BY created_at ASC').all() as VideoCreatorRow[]
    return rows.map(toVideoCreator)
  }

  getCreator(id: string): VideoCreator | undefined {
    const r = this.db.prepare('SELECT * FROM video_creators WHERE id = ?').get(id) as VideoCreatorRow | undefined
    return r ? toVideoCreator(r) : undefined
  }

  upsertCreator(creator: VideoCreator): void {
    this.db
      .prepare(
        `INSERT INTO video_creators (id,channel_id,name,handle,created_at,updated_at)
         VALUES (@id,@channel_id,@name,@handle,@created_at,@updated_at)
         ON CONFLICT(id) DO UPDATE SET channel_id=excluded.channel_id, name=excluded.name,
           handle=excluded.handle, updated_at=excluded.updated_at`
      )
      .run({
        id: creator.id,
        channel_id: creator.channelId,
        name: creator.name,
        handle: creator.handle ?? null,
        created_at: creator.createdAt,
        updated_at: creator.updatedAt
      })
  }

  removeCreator(id: string): void {
    this.db.prepare('DELETE FROM video_creators WHERE id = ?').run(id)
  }

  listReports(creatorId?: string): VideoReport[] {
    const rows = (
      creatorId
        ? this.db
            .prepare('SELECT * FROM video_reports WHERE creator_id = ? ORDER BY published_at DESC, created_at DESC')
            .all(creatorId)
        : this.db.prepare('SELECT * FROM video_reports ORDER BY published_at DESC, created_at DESC').all()
    ) as VideoReportRow[]
    return rows.map(toVideoReport)
  }

  getReport(videoId: string): VideoReport | undefined {
    const r = this.db.prepare('SELECT * FROM video_reports WHERE video_id = ?').get(videoId) as VideoReportRow | undefined
    return r ? toVideoReport(r) : undefined
  }

  saveReport(report: VideoReport): void {
    this.db
      .prepare(
        `INSERT INTO video_reports
         (id,creator_id,video_id,title,url,published_at,duration_sec,language,transcript_md,summary_md,model,created_at,updated_at)
         VALUES (@id,@creator_id,@video_id,@title,@url,@published_at,@duration_sec,@language,@transcript_md,@summary_md,@model,@created_at,@updated_at)
         ON CONFLICT(video_id) DO UPDATE SET creator_id=excluded.creator_id, title=excluded.title,
           url=excluded.url, published_at=excluded.published_at, duration_sec=excluded.duration_sec,
           language=excluded.language, transcript_md=excluded.transcript_md, summary_md=excluded.summary_md,
           model=excluded.model, updated_at=excluded.updated_at`
      )
      .run({
        id: report.id,
        creator_id: report.creatorId,
        video_id: report.videoId,
        title: report.title,
        url: report.url,
        published_at: report.publishedAt ?? null,
        duration_sec: report.durationSec ?? null,
        language: report.language ?? null,
        transcript_md: report.transcriptMd,
        summary_md: report.summaryMd,
        model: report.model,
        created_at: report.createdAt,
        updated_at: report.updatedAt
      })
  }

  removeReport(videoId: string): void {
    this.db.prepare('DELETE FROM video_reports WHERE video_id = ?').run(videoId)
  }
}

class SqliteDecisionStore implements DecisionStore {
  constructor(private db: DB) {}

  get(itemId: string): DecisionNote | undefined {
    const r = this.db.prepare('SELECT * FROM decision_notes WHERE item_id = ?').get(itemId) as DecisionRow | undefined
    return r ? toDecision(r) : undefined
  }

  listByIds(itemIds: string[]): DecisionNote[] {
    if (itemIds.length === 0) return []
    const placeholders = itemIds.map(() => '?').join(',')
    const rows = this.db
      .prepare(`SELECT * FROM decision_notes WHERE item_id IN (${placeholders})`)
      .all(...itemIds) as DecisionRow[]
    return rows.map(toDecision)
  }

  recent(sinceTs: number, limit = 200): DecisionNote[] {
    const rows = this.db
      .prepare('SELECT * FROM decision_notes WHERE updated_at >= ? ORDER BY updated_at DESC LIMIT ?')
      .all(sinceTs, limit) as DecisionRow[]
    return rows.map(toDecision)
  }

  upsert(note: DecisionNote): void {
    this.db
      .prepare(
        `INSERT INTO decision_notes (item_id,note,verify_at,created_at,updated_at)
         VALUES (@item_id,@note,@verify_at,@created_at,@updated_at)
         ON CONFLICT(item_id) DO UPDATE SET note=excluded.note, verify_at=excluded.verify_at,
           updated_at=excluded.updated_at`
      )
      .run({
        item_id: note.itemId,
        note: note.note,
        verify_at: note.verifyAt ?? null,
        created_at: note.createdAt,
        updated_at: note.updatedAt
      })
  }

  remove(itemId: string): void {
    this.db.prepare('DELETE FROM decision_notes WHERE item_id = ?').run(itemId)
  }
}

class SqliteEntityStore implements EntityStore {
  constructor(private db: DB) {}

  list(): Entity[] {
    return (this.db.prepare('SELECT * FROM entities ORDER BY name ASC').all() as EntityRow[]).map(toEntity)
  }

  get(id: string): Entity | undefined {
    const r = this.db.prepare('SELECT * FROM entities WHERE id = ?').get(id) as EntityRow | undefined
    return r ? toEntity(r) : undefined
  }

  upsert(entity: Entity): void {
    this.db
      .prepare(
        `INSERT INTO entities (id,name,kind,aliases_json,created_at,updated_at)
         VALUES (@id,@name,@kind,@aliases_json,@created_at,@updated_at)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, kind=excluded.kind,
           aliases_json=excluded.aliases_json, updated_at=excluded.updated_at`
      )
      .run({
        id: entity.id,
        name: entity.name,
        kind: entity.kind,
        aliases_json: JSON.stringify(entity.aliases),
        created_at: entity.createdAt,
        updated_at: entity.updatedAt
      })
  }

  remove(id: string): void {
    this.db.prepare('DELETE FROM entities WHERE id = ?').run(id)
  }

  link(entityId: string, itemIds: string[]): void {
    if (itemIds.length === 0) return
    const stmt = this.db.prepare('INSERT OR IGNORE INTO item_entities (entity_id,item_id) VALUES (?,?)')
    this.db.transaction((ids: string[]) => {
      for (const id of ids) stmt.run(entityId, id)
    })(itemIds)
  }

  clearLinks(): void {
    this.db.prepare('DELETE FROM item_entities').run()
  }

  itemIds(entityId: string): string[] {
    const rows = this.db
      .prepare(
        `SELECT ie.item_id FROM item_entities ie
         JOIN items i ON i.id = ie.item_id
         WHERE ie.entity_id = ?
         ORDER BY COALESCE(i.published_at, i.fetched_at) DESC`
      )
      .all(entityId) as Array<{ item_id: string }>
    return rows.map((r) => r.item_id)
  }

  counts(): Array<{ entityId: string; count: number; latestAt: number }> {
    return (
      this.db
        .prepare(
          `SELECT ie.entity_id, COUNT(*) AS count,
                  MAX(COALESCE(i.published_at, i.fetched_at)) AS latest_at
           FROM item_entities ie JOIN items i ON i.id = ie.item_id
           GROUP BY ie.entity_id`
        )
        .all() as Array<{ entity_id: string; count: number; latest_at: number }>
    ).map((r) => ({ entityId: r.entity_id, count: int(r.count), latestAt: int(r.latest_at) }))
  }

  linkCount(): number {
    return int((this.db.prepare('SELECT COUNT(*) c FROM item_entities').get() as { c: number }).c)
  }
}

class SqliteEventNoteStore implements EventNoteStore {
  constructor(private db: DB) {}

  get(eventKey: string): EventNote | undefined {
    const r = this.db.prepare('SELECT * FROM event_notes WHERE event_key = ?').get(eventKey) as EventNoteRow | undefined
    return r ? toEventNote(r) : undefined
  }

  recent(sinceTs: number, limit = 100): EventNote[] {
    const rows = this.db
      .prepare('SELECT * FROM event_notes WHERE updated_at >= ? ORDER BY updated_at DESC LIMIT ?')
      .all(sinceTs, limit) as EventNoteRow[]
    return rows.map(toEventNote)
  }

  upsert(note: EventNote): void {
    this.db
      .prepare(
        `INSERT INTO event_notes (event_key,note,entity_id,title,event_type,latest_at,created_at,updated_at)
         VALUES (@event_key,@note,@entity_id,@title,@event_type,@latest_at,@created_at,@updated_at)
         ON CONFLICT(event_key) DO UPDATE SET note=excluded.note, entity_id=excluded.entity_id,
           title=excluded.title, event_type=excluded.event_type, latest_at=excluded.latest_at,
           updated_at=excluded.updated_at`
      )
      .run({
        event_key: note.eventKey,
        note: note.note,
        entity_id: note.entityId ?? null,
        title: note.title ?? null,
        event_type: note.eventType ?? null,
        latest_at: note.latestAt ?? null,
        created_at: note.createdAt,
        updated_at: note.updatedAt
      })
  }

  remove(eventKey: string): void {
    this.db.prepare('DELETE FROM event_notes WHERE event_key = ?').run(eventKey)
  }
}

class SqliteManualEventStore implements ManualEventStore {
  constructor(private db: DB) {}

  list(entityId?: string): ManualEvent[] {
    const rows = (
      entityId
        ? this.db.prepare('SELECT * FROM manual_events WHERE entity_id = ? ORDER BY updated_at DESC').all(entityId)
        : this.db.prepare('SELECT * FROM manual_events ORDER BY updated_at DESC').all()
    ) as ManualEventRow[]
    return rows.map(toManualEvent)
  }

  get(id: string): ManualEvent | undefined {
    const r = this.db.prepare('SELECT * FROM manual_events WHERE id = ?').get(id) as ManualEventRow | undefined
    return r ? toManualEvent(r) : undefined
  }

  upsert(event: ManualEvent): void {
    this.db
      .prepare(
        `INSERT INTO manual_events (id,entity_id,title,event,item_ids_json,created_at,updated_at)
         VALUES (@id,@entity_id,@title,@event,@item_ids_json,@created_at,@updated_at)
         ON CONFLICT(id) DO UPDATE SET title=excluded.title, event=excluded.event,
           item_ids_json=excluded.item_ids_json, updated_at=excluded.updated_at`
      )
      .run({
        id: event.id,
        entity_id: event.entityId,
        title: event.title,
        event: event.event,
        item_ids_json: JSON.stringify(event.itemIds),
        created_at: event.createdAt,
        updated_at: event.updatedAt
      })
  }

  remove(id: string): void {
    this.db.prepare('DELETE FROM manual_events WHERE id = ?').run(id)
  }
}

class SqlitePromptStore implements PromptProfileStore {
  constructor(private db: DB) {}
  list(): PromptProfile[] {
    const rows = this.db.prepare('SELECT * FROM prompt_profiles ORDER BY created_at ASC').all() as Array<{
      id: string; name: string; version: number; system_md: string; created_at: number; updated_at: number
    }>
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      version: r.version,
      systemMd: r.system_md,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    }))
  }
  get(id: string): PromptProfile | undefined {
    return this.list().find((p) => p.id === id)
  }
  create(profile: PromptProfile): void {
    this.db
      .prepare(
        `INSERT INTO prompt_profiles (id,name,version,system_md,created_at,updated_at)
         VALUES (@id,@name,@version,@system_md,@created_at,@updated_at)`
      )
      .run({
        id: profile.id,
        name: profile.name,
        version: profile.version,
        system_md: profile.systemMd,
        created_at: profile.createdAt,
        updated_at: profile.updatedAt
      })
  }
  update(id: string, patch: { name?: string; systemMd?: string }): PromptProfile | undefined {
    const cur = this.get(id)
    if (!cur) return undefined
    const now = Date.now()
    const version = cur.version + 1
    this.db
      .prepare(
        'INSERT OR REPLACE INTO prompt_profile_versions (profile_id,version,system_md,created_at) VALUES (?,?,?,?)'
      )
      .run(id, cur.version, cur.systemMd, cur.createdAt)
    this.db
      .prepare('UPDATE prompt_profiles SET name=?, system_md=?, version=?, updated_at=? WHERE id=?')
      .run(patch.name ?? cur.name, patch.systemMd ?? cur.systemMd, version, now, id)
    return this.get(id)
  }
  versions(id: string): PromptProfileVersion[] {
    return (
      this.db
        .prepare('SELECT * FROM prompt_profile_versions WHERE profile_id = ? ORDER BY version DESC')
        .all(id) as Array<{ profile_id: string; version: number; system_md: string; created_at: number }>
    ).map((r) => ({
      profileId: r.profile_id,
      version: r.version,
      systemMd: r.system_md,
      createdAt: r.created_at
    }))
  }
  restore(id: string, version: number): PromptProfile | undefined {
    const old = this.versions(id).find((v) => v.version === version)
    if (!old) return undefined
    return this.update(id, { systemMd: old.systemMd })
  }
  remove(id: string): void {
    this.db.prepare('DELETE FROM prompt_profiles WHERE id = ?').run(id)
  }
  evaluations(topicId: string, limit = 20): PromptEvaluation[] {
    return (
      this.db
        .prepare('SELECT * FROM prompt_evaluations WHERE topic_id = ? ORDER BY created_at DESC LIMIT ?')
        .all(topicId, limit) as Array<{
        id: string; topic_id: string; profile_id: string; profile_name: string; profile_version: number
        rating: number; notes: string | null; metrics_json: string; created_at: number
      }>
    ).map((r) => ({
      id: r.id,
      topicId: r.topic_id,
      profileId: r.profile_id,
      profileName: r.profile_name,
      profileVersion: r.profile_version,
      rating: r.rating,
      ...(r.notes ? { notes: r.notes } : {}),
      metrics: JSON.parse(r.metrics_json) as Record<string, number>,
      createdAt: r.created_at
    }))
  }
  addEvaluation(e: PromptEvaluation): void {
    this.db
      .prepare(
        `INSERT INTO prompt_evaluations
         (id,topic_id,profile_id,profile_name,profile_version,rating,notes,metrics_json,created_at)
         VALUES (@id,@topic_id,@profile_id,@profile_name,@profile_version,@rating,@notes,@metrics_json,@created_at)`
      )
      .run({
        id: e.id,
        topic_id: e.topicId,
        profile_id: e.profileId,
        profile_name: e.profileName,
        profile_version: e.profileVersion,
        rating: e.rating,
        notes: e.notes ?? null,
        metrics_json: JSON.stringify(e.metrics),
        created_at: e.createdAt
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
  readonly stories: StoryStore
  readonly prompts: PromptProfileStore
  readonly runs: RunStore
  readonly flags: FlagStore
  readonly settings: SettingsStore
  readonly videos: VideoStore
  readonly decisions: DecisionStore
  readonly entities: EntityStore
  readonly eventNotes: EventNoteStore
  readonly manualEvents: ManualEventStore

  constructor(private db: DB) {
    this.sources = new SqliteSourceStore(db)
    this.domains = new SqliteDomainStore(db)
    this.topics = new SqliteTopicStore(db)
    this.items = new SqliteItemStore(db)
    this.briefs = new SqliteBriefStore(db)
    this.chat = new SqliteChatStore(db)
    this.stories = new SqliteStoryStore(db)
    this.prompts = new SqlitePromptStore(db)
    this.runs = new SqliteRunStore(db)
    this.flags = new SqliteFlagStore(db)
    this.settings = new SqliteSettingsStore(db)
    this.videos = new SqliteVideoStore(db)
    this.decisions = new SqliteDecisionStore(db)
    this.entities = new SqliteEntityStore(db)
    this.eventNotes = new SqliteEventNoteStore(db)
    this.manualEvents = new SqliteManualEventStore(db)
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

export interface StoreOptions {
  /** CLI 用：只读打开，不迁移、不 seed 默认主题 */
  readOnly?: boolean
}

export function createStore(file: string, opts: StoreOptions = {}): Store {
  const store = new SqliteStore(openDatabase(file, opts))
  if (opts.readOnly) return store
  return ensureDefaultTopic(ensureDefaultDomain(store))
}

/** 测试用：内存库 */
export function createMemoryStore(): Store {
  return ensureDefaultTopic(ensureDefaultDomain(new SqliteStore(openDatabase(':memory:'))))
}
