/**
 * 存储端口：接口由 core 拥有，适配器去实现（依赖倒置，见 ADR-1）。
 *
 * 设计取舍：方法全部同步。better-sqlite3 是同步 API，本地单文件库延迟在微秒级，
 * 引入 async 只会让调用方到处 await 而没有收益。将来若换远程存储再改端口。
 */
import type { Item, ItemFlags, Brief, RunRecord, Source } from '../domain/types'

export interface SourceStore {
  list(): Source[]
  get(id: string): Source | undefined
  upsert(source: Source): void
  upsertMany(sources: Source[]): void
  remove(id: string): void
  /** 抓取结果回写：成功时清零 failStreak 并更新 lastOkAt */
  recordSuccess(id: string, itemCount: number, ms: number): void
  recordFailure(id: string, error: string): void
}

export interface SearchOptions {
  limit?: number
  bucket?: string
  sourceId?: string
  /** 只返回此时间之后发布的条目；没有发布时间时按抓取时间算 */
  sinceTs?: number
  /** 相关度（默认）或最新 */
  sort?: 'score' | 'time'
}

export interface ItemStore {
  upsertMany(items: Item[]): number
  get(id: string): Item | undefined
  /** 按发布时间倒序，取窗口内的条目 */
  since(ts: number, limit?: number): Item[]
  /** 已写过简报的条目 id，用于增量过滤 */
  briefedIds(sinceTs: number): Set<string>
  markBriefed(ids: string[], ts: number): void
  /** 全文检索；空查询返回空数组 */
  search(query: string, opts?: SearchOptions): Item[]
  count(): number
}

export interface BriefStore {
  save(brief: Brief): void
  latest(): Brief | undefined
  byDate(date: string): Brief | undefined
  list(limit?: number): Brief[]
}

export interface RunStore {
  start(record: RunRecord): void
  finish(id: string, patch: Partial<RunRecord>): void
  recent(limit?: number): RunRecord[]
}

export interface FlagStore {
  get(itemId: string): ItemFlags | undefined
  set(itemId: string, patch: Partial<Omit<ItemFlags, 'itemId'>>): void
  /** 已读/收藏列表，供界面筛选 */
  byFlag(flag: 'isRead' | 'isSaved' | 'isHidden', value: boolean): string[]
}

export interface SettingsStore {
  get<T = unknown>(key: string): T | undefined
  set(key: string, value: unknown): void
  all(): Record<string, unknown>
}

export interface Store {
  sources: SourceStore
  items: ItemStore
  briefs: BriefStore
  runs: RunStore
  flags: FlagStore
  settings: SettingsStore
  /** 当前 schema 版本，便于诊断包记录 */
  schemaVersion(): number
  close(): void
}
