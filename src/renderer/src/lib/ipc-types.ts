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

export interface SourcesBridge {
  list: () => Promise<Source[]>
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

export interface KeyStatusPayload {
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

export interface TopicPayload {
  id: string
  name: string
  enabled: boolean
  hour: number
  minute: number
  sourceCount: number
  hasBrief: boolean
}

export interface MeerkatBridge {
  topics?: {
    list: () => Promise<TopicPayload[]>
    create: (input: { id: string; name: string; sourceIds?: string[] }) => Promise<{ ok: boolean; id?: string; error?: string }>
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
    status: () => Promise<KeyStatusPayload>
    set: (value: string) => Promise<{ ok: boolean; error?: string }>
    clear: () => Promise<{ ok: boolean }>
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
