/**
 * 存储端口：接口由 core 拥有，适配器去实现（依赖倒置，见 ADR-1）。
 *
 * 设计取舍：方法全部同步。better-sqlite3 是同步 API，本地单文件库延迟在微秒级，
 * 引入 async 只会让调用方到处 await 而没有收益。将来若换远程存储再改端口。
 */
import type {
  Item, ItemFlags, Brief, RunRecord, Source, Topic, Domain, ChatThread, ChatStoredMessage, Story, PromptProfile, PromptProfileVersion,
  VideoCreator, VideoReport, DecisionNote, Entity, EventNote, ManualEvent
} from '../domain/types'

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
  /** 已写过简报的条目 id；按主题过滤，不同主题互不吞并 */
  briefedIds(sinceTs: number, topicId?: string): Set<string>
  /** 在 beforeTs 之前推送过的条目（重新成稿时用来排除"以前推过"的旧闻） */
  briefedIdsBefore(sinceTs: number, beforeTs: number, topicId?: string): Set<string>
  markBriefed(ids: string[], ts: number, topicId?: string): void
  /** 全文检索；空查询返回空数组 */
  search(query: string, opts?: SearchOptions): Item[]
  /** 按发布时间倒序取所有条目（有上限，防止诊断页一次拉爆） */
  all(limit?: number): Item[]
  count(): number
}

export interface DomainStore {
  list(): Domain[]
  get(id: string): Domain | undefined
  upsert(domain: Domain): void
  remove(id: string): void
}

export interface TopicStore {
  list(): Topic[]
  get(id: string): Topic | undefined
  upsert(topic: Topic): void
  remove(id: string): void
  /** 主题收录的源 id；没有归属的源不会参与这个主题的采集 */
  sourceIds(topicId: string): string[]
  setSources(topicId: string, sourceIds: string[]): void
  addSource(topicId: string, sourceId: string): void
  removeSource(topicId: string, sourceId: string): void
}

export interface BriefStore {
  save(brief: Brief): void
  /** 不传 topicId 时不限主题（诊断与旧脚本用） */
  latest(topicId?: string): Brief | undefined
  byDate(date: string, topicId?: string): Brief | undefined
  list(limit?: number, topicId?: string): Brief[]
  /** 全部简报期数，用于设置页的数据概览 */
  count(): number
}

export interface ChatStore {
  threads(topicId?: string): ChatThread[]
  get(id: string): ChatThread | undefined
  /** 同一主题同一天的会话（P0：一个位置一段对话） */
  findByDate(topicId: string, briefDate: string): ChatThread | undefined
  /** 某条新闻的评论串（一个条目一段） */
  findByItem(topicId: string, itemId: string): ChatThread | undefined
  /** 某个事件的评论串（一个事件一段） */
  findByEvent(topicId: string, eventKey: string): ChatThread | undefined
  create(thread: ChatThread): void
  update(id: string, patch: { title?: string; model?: string; updatedAt?: number }): void
  remove(id: string): void
  messages(threadId: string): ChatStoredMessage[]
  addMessage(message: ChatStoredMessage): void
}

export interface StoryStore {
  create(story: Story): void
  get(id: string): Story | undefined
  list(status?: Story['status']): Story[]
  byThread(threadId: string): Story | undefined
  update(id: string, patch: Partial<Pick<Story, 'status' | 'missCount' | 'lastMatchAt' | 'lastPromptAt' | 'updatedAt' | 'title' | 'aliases'>>): void
  /** 已经挂到这条 story 上的条目 id */
  itemIds(storyId: string): string[]
  /** 最新挂上来的素材（跟踪页"最近进展"用） */
  latestItem(storyId: string): { title: string; at: number } | undefined
  addItems(storyId: string, itemIds: string[], ts: number): number
  remove(id: string): void
}

export interface PromptProfileStore {
  list(): PromptProfile[]
  get(id: string): PromptProfile | undefined
  create(profile: PromptProfile): void
  /** 更新内容/名称；旧版本写入 versions */
  update(id: string, patch: { name?: string; systemMd?: string }): PromptProfile | undefined
  versions(id: string): PromptProfileVersion[]
  /** 把历史版本恢复成新版本 */
  restore(id: string, version: number): PromptProfile | undefined
  remove(id: string): void
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

export interface VideoStore {
  listCreators(): VideoCreator[]
  getCreator(id: string): VideoCreator | undefined
  upsertCreator(creator: VideoCreator): void
  removeCreator(id: string): void
  listReports(creatorId?: string): VideoReport[]
  getReport(videoId: string): VideoReport | undefined
  saveReport(report: VideoReport): void
  removeReport(videoId: string): void
}

export interface DecisionStore {
  get(itemId: string): DecisionNote | undefined
  listByIds(itemIds: string[]): DecisionNote[]
  recent(sinceTs: number, limit?: number): DecisionNote[]
  upsert(note: DecisionNote): void
  remove(itemId: string): void
}

export interface EntityStore {
  list(): Entity[]
  get(id: string): Entity | undefined
  upsert(entity: Entity): void
  remove(id: string): void
  /** 批量建立「实体 → 条目」关系；重复插入忽略 */
  link(entityId: string, itemIds: string[]): void
  clearLinks(): void
  itemIds(entityId: string): string[]
  counts(): Array<{ entityId: string; count: number; latestAt: number }>
  linkCount(): number
}

export interface EventNoteStore {
  get(eventKey: string): EventNote | undefined
  recent(sinceTs: number, limit?: number): EventNote[]
  upsert(note: EventNote): void
  remove(eventKey: string): void
}

export interface ManualEventStore {
  list(entityId?: string): ManualEvent[]
  get(id: string): ManualEvent | undefined
  upsert(event: ManualEvent): void
  remove(id: string): void
}

export interface Store {
  sources: SourceStore
  domains: DomainStore
  topics: TopicStore
  items: ItemStore
  briefs: BriefStore
  chat: ChatStore
  stories: StoryStore
  prompts: PromptProfileStore
  runs: RunStore
  flags: FlagStore
  settings: SettingsStore
  videos: VideoStore
  decisions: DecisionStore
  entities: EntityStore
  eventNotes: EventNoteStore
  manualEvents: ManualEventStore
  /** 当前 schema 版本，便于诊断包记录 */
  schemaVersion(): number
  /** 在单个事务里执行；导入配置这类多步写入必须原子完成 */
  transaction<T>(fn: () => T): T
  close(): void
}
