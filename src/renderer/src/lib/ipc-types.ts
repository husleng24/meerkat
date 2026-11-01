/**
 * preload 暴露的 window.meerkat 的单一类型声明。
 *
 * 只能有一处 `declare global`：多处声明同名属性时 TypeScript 要求类型完全一致，
 * 实际开发中几乎必然漂移（P1-4 与 P1-5 就撞过一次）。
 */
import type { Source } from '../../../core/domain/types'

export interface ProbeProgress {
  id: string
  ok: boolean
  n: number
  ms: number
  error?: string
  done: number
  total: number
}

export interface SourceRecommendationPayload {
  id: string
  name: string
  kind: string
  score: number
  reason: string
}

export interface SourcesBridge {
  list: () => Promise<Source[]>
  recommend: (input: { topicId: string; limit?: number }) => Promise<SourceRecommendationPayload[]>
  toggle: (id: string, enabled: boolean) => Promise<{ ok: boolean; error?: string }>
  test: (id: string) => Promise<{ ok: boolean; n?: number; ms?: number; error?: string }>
  testAll: () => Promise<{ ok: boolean; summary: string }>
  add: (input: {
    name: string
    url?: string
    kind: string
    tier: number
    bucketHint: string
  }) => Promise<{ ok: boolean; id?: string; error?: string }>
  remove: (id: string) => Promise<{ ok: boolean; error?: string }>
  update: (input: {
    id: string
    name: string
    url?: string
    tier: number
    bucketHint: string
  }) => Promise<{ ok: boolean; error?: string }>
  onProgress: (cb: (p: ProbeProgress) => void) => () => void
}

export interface SearchHit {
  id: string
  title: string
  url: string
  bucket: string
  summary: string
  score: number
  publishedAt?: number
  sourceName: string
}

export interface BriefPayload {
  date: string
  topicId?: string
  markdown: string
  model: string
  linkCheck?: string
  /** URL → 条目 id，供界面反查后持久化已读/收藏 */
  urlToId?: Record<string, string>
  /** 上一期（日期更早的最近一份）；首期为 null，界面据此隐藏「和昨天比」 */
  previous?: { date: string; markdown: string } | null
}

export interface ItemFlagState {
  isRead: boolean
  isSaved: boolean
  isHidden: boolean
}

export interface FlagsBridge {
  get: (ids: string[]) => Promise<Record<string, ItemFlagState>>
  set: (itemId: string, patch: Partial<ItemFlagState>) => Promise<{ ok: boolean; error?: string }>
}

export interface SchedulePayload {
  enabled: boolean
  hour: number
  minute: number
  lastRunAt: number | null
}

export type ProviderId = 'deepseek' | 'openai' | 'anthropic'

export interface KeyStatusPayload {
  provider: ProviderId
  providerLabel: string
  hasKey: boolean
  source: 'store' | 'env' | 'dsh-file' | 'none'
  sourceLabel: string
  masked: string
  canEncrypt: boolean
  dshAvailable: boolean
}

export interface AutoLaunchState {
  enabled: boolean
  supported: boolean
  reason?: string
}

export interface ChatThreadPayload {
  id: string
  title: string
  topicId: string
  briefDate?: string
  model: string
  createdAt: number
  updatedAt: number
  archived: boolean
  contextTokens: number
  /** 会话创建之后简报又被重写过：历史回答可能对不上当前内容 */
  briefStale?: boolean
}

export interface ChatMessagePayload {
  id: string
  threadId: string
  role: 'user' | 'assistant'
  content: string
  model?: string
  tokensIn?: number
  tokensOut?: number
  createdAt: number
}

export interface ChatModelPayload {
  id: string
  label: string
  provider: string
  contextWindow: number
  tier: 'fast' | 'deep'
}

export interface ChatProviderPayload {
  id: ProviderId
  label: string
  protocol: string
  /** 该供应商的默认模型 id（输入框的 placeholder） */
  defaultModel: string
  /** 用户覆盖的模型 id；空串表示用默认 */
  override: string
  hasKey: boolean
}

export interface ChatBridge {
  models: () => Promise<ChatModelPayload[]>
  ensure: (input: { topicId: string; briefDate?: string; model?: string }) => Promise<ChatThreadPayload | null>
  messages: (threadId: string) => Promise<ChatMessagePayload[]>
  send: (input: {
    threadId: string
    text: string
    actionId?: 'ask' | 'summarize5' | 'compare' | 'why' | 'reorder'
    model?: string
    includePrevious?: boolean
  }) => Promise<{
    ok: boolean
    user?: ChatMessagePayload
    assistant?: ChatMessagePayload
    error?: string
    estimatedTokens?: number
    model?: string
  }>
  cancel: () => Promise<{ cancelled: boolean }>
  reset: (threadId: string) => Promise<{ ok: boolean; error?: string }>
  providers: () => Promise<ChatProviderPayload[]>
  setModel: (input: { provider: ProviderId; model: string }) => Promise<{ ok: boolean; error?: string }>
}

export interface DomainPayload {
  id: string
  name: string
  createdAt: number
  topicCount: number
}

export interface TopicPayload {
  id: string
  name: string
  domainId: string
  enabled: boolean
  hour: number
  minute: number
  sourceCount: number
  hasBrief: boolean
  /** 最新一期简报的条目数；没有简报为 0，界面显示「—」 */
  todayCount: number
  /** 最新一期里尚未标记已读的条目数 */
  unreadCount: number
}

export interface DomainBriefPayload {
  id: string
  domainId: string
  date: string
  markdown: string
  model: string
  createdAt: number
}

export interface MeerkatBridge {
  chat?: ChatBridge
  domains?: {
    list: () => Promise<DomainPayload[]>
    create: (input: { id?: string; name: string }) => Promise<{ ok: boolean; id?: string; error?: string }>
    rename: (input: { id: string; name: string }) => Promise<{ ok: boolean; error?: string }>
    remove: (id: string) => Promise<{ ok: boolean; error?: string }>
  }
  domainBrief?: {
    latest: (input: { domainId: string; date?: string }) => Promise<DomainBriefPayload | null>
    compose: (input: { domainId: string }) => Promise<{
      ok: boolean
      date?: string
      degraded?: boolean
      topicCount?: number
      itemCount?: number
      error?: string
      note?: string
    }>
  }
  onDomainBriefUpdated?: (cb: (domainId: string) => void) => () => void
  topics?: {
    list: () => Promise<TopicPayload[]>
    create: (input: { id: string; name: string; domainId?: string; sourceIds?: string[] }) => Promise<{ ok: boolean; id?: string; error?: string }>
    update: (input: { id: string; name?: string; enabled?: boolean }) => Promise<{ ok: boolean; error?: string }>
    remove: (id: string) => Promise<{ ok: boolean; error?: string }>
    sourceIds: (id: string) => Promise<string[]>
    setSources: (input: { topicId: string; sourceIds: string[] }) => Promise<{ ok: boolean; error?: string }>
  }
  ping: () => Promise<{ ok: boolean; version: string; ts: number }>
  briefLatest?: (topicId?: string) => Promise<BriefPayload | null>
  briefByDate?: (date: string, topicId?: string) => Promise<BriefPayload | null>
  briefList?: (
    topicId?: string
  ) => Promise<Array<{ date: string; model: string; linkCheck: string; chars: number; createdAt: number }>>
  sources?: SourcesBridge
  flags?: FlagsBridge
  items?: {
    search: (input: {
      q: string
      bucket?: string
      sourceId?: string
      /** 只搜最近 N 天 */
      days?: number
      sort?: 'score' | 'time'
    }) => Promise<SearchHit[]>
  }
  key?: {
    all: () => Promise<KeyStatusPayload[]>
    status: (provider: ProviderId) => Promise<KeyStatusPayload>
    set: (input: { provider: ProviderId; value: string }) => Promise<{ ok: boolean; error?: string }>
    clear: (provider: ProviderId) => Promise<{ ok: boolean; error?: string }>
    importDsh: () => Promise<{ ok: boolean; masked?: string; error?: string }>
  }
  feedback?: {
    compose: (input: {
      category: 'bug' | 'idea' | 'source' | 'other'
      message: string
      includeDiagnostics: boolean
    }) => Promise<{ ok: boolean; title?: string; body?: string; issueUrl?: string; error?: string }>
    save: (text: { title: string; body: string }) => Promise<{ ok: boolean; path?: string; error?: string }>
    copy: (text: string) => Promise<{ ok: boolean; error?: string }>
  }
  schedule?: {
    get: (topicId: string) => Promise<SchedulePayload>
    set: (cfg: {
      topicId: string
      enabled: boolean
      hour: number
      minute: number
    }) => Promise<{ ok: boolean; error?: string }>
  }
  prefs?: {
    get: () => Promise<{ autoLaunch: AutoLaunchState }>
    setAutoLaunch: (enabled: boolean) => Promise<{ ok: boolean; error?: string; autoLaunch?: AutoLaunchState }>
  }
  runNow?: (
    topicId?: string
  ) => Promise<{ ok: boolean; nKept?: number; nOk?: number; nSources?: number; degraded?: boolean; error?: string }>
  composeNow?: (
    topicId?: string
  ) => Promise<{ ok: boolean; nKept?: number; nOk?: number; nSources?: number; degraded?: boolean; error?: string }>
  cancelRun?: () => Promise<{ ok: boolean; cancelled: boolean }>
  exportBrief?: () => Promise<{ ok: boolean; path?: string; error?: string }>
  exportDiagnostic?: () => Promise<{ ok: boolean; path?: string; summary?: string; error?: string }>
  exportHtml?: (input: { html: string; date: string }) => Promise<{ ok: boolean; path?: string; error?: string }>
  exportPdf?: (input: { html: string; date: string }) => Promise<{ ok: boolean; path?: string; error?: string }>
  copyRich?: (input: { html: string; text: string }) => Promise<{ ok: boolean; error?: string }>
  onBriefUpdated?: (cb: () => void) => () => void
}

declare global {
  interface Window {
    meerkat?: MeerkatBridge
  }
}
