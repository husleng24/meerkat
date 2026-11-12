/**
 * Source pack：把「源 + 主题归属」变成可导出的 JSON。
 *
 * 设计取舍：
 * - 不导出排程（hour/minute）——排程是个人习惯，导入时保留本机值；
 * - 不导出健康度/时间戳——那些是本机运行状态，不是配置；
 * - 身份优先按 id，其次按规范化 URL，最后按名称（同名覆盖）；
 * - 导入只增不删：不碰包里没有的源/主题。
 */
import {
  BUCKET_LABEL,
  type Bucket,
  type Domain,
  type Source,
  type SourceKind,
  type Tier,
  type Topic
} from '../core/domain/types'
import { canonicalUrl } from '../core/pipeline/text'
import type { Store } from '../core/ports/store'

export const PACK_FORMAT = 'meerkat/source-pack'
export const PACK_VERSION = 1

export interface PackDomain {
  id: string
  name: string
}

export interface PackSource {
  id: string
  name: string
  kind: SourceKind
  url?: string
  channelId?: string
  tier: Tier
  bucketHint: Bucket
  parser?: string
  windowHours?: number
  alwaysKeep?: boolean
  insecure?: boolean
  enabled?: boolean
}

export interface PackTopic {
  id: string
  name: string
  domainId: string
  enabled?: boolean
  /** 主题收录的源 id，顺序即导出时的顺序 */
  sources: string[]
}

export interface SourcePack {
  format: string
  version: number
  exportedAt: string
  domains: PackDomain[]
  topics: PackTopic[]
  sources: PackSource[]
}

const KINDS: readonly SourceKind[] = [
  'rss',
  'atom',
  'arxiv',
  'hn',
  'youtube',
  'github-trending',
  'hfpapers',
  'anthropic',
  'html'
]

const MAX_SOURCES = 500
const MAX_TOPICS = 100
const MAX_DOMAINS = 50

function fail(message: string): never {
  throw new Error(message)
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(`${label} 必须是对象`)
  return value as Record<string, unknown>
}

function list(value: unknown, label: string, max: number): unknown[] {
  if (!Array.isArray(value)) fail(`${label} 必须是数组`)
  if (value.length > max) fail(`${label} 超过上限 ${max}`)
  return value
}

function str(value: unknown, label: string, max = 200): string {
  if (typeof value !== 'string' || value.trim().length === 0) fail(`${label} 必须是非空字符串`)
  if (value.length > max) fail(`${label} 超过 ${max} 字符`)
  return value.trim()
}

function optStr(value: unknown, label: string, max = 500): string | undefined {
  if (value === undefined || value === null) return undefined
  return str(value, label, max)
}

function optBool(value: unknown, label: string): boolean | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'boolean') fail(`${label} 必须是布尔值`)
  return value
}

function optInt(value: unknown, label: string, min: number, max: number): number | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    fail(`${label} 必须是 ${min}–${max} 的整数`)
  }
  return value
}

function assertHttpUrl(url: string | undefined, label: string): void {
  if (url === undefined) return
  if (!/^https?:\/\//i.test(url)) fail(`${label} 必须以 http:// 或 https:// 开头`)
  try {
    new URL(url)
  } catch {
    fail(`${label} 格式不正确`)
  }
}

function parseSource(raw: unknown, index: number): PackSource {
  const r = record(raw, `sources[${index}]`)
  const kind = str(r['kind'], `sources[${index}].kind`, 30) as SourceKind
  if (!KINDS.includes(kind)) fail(`sources[${index}].kind 不支持：${kind}`)
  const tier = optInt(r['tier'], `sources[${index}].tier`, 1, 3)
  if (tier === undefined) fail(`sources[${index}].tier 必须是 1–3`)
  const bucketHint = str(r['bucketHint'], `sources[${index}].bucketHint`, 30) as Bucket
  if (!(bucketHint in BUCKET_LABEL)) fail(`sources[${index}].bucketHint 未知：${bucketHint}`)
  const url = optStr(r['url'], `sources[${index}].url`)
  assertHttpUrl(url, `sources[${index}].url`)
  const windowHours = optInt(r['windowHours'], `sources[${index}].windowHours`, 1, 24 * 30)
  return {
    id: str(r['id'], `sources[${index}].id`, 80),
    name: str(r['name'], `sources[${index}].name`, 80),
    kind,
    tier: tier as Tier,
    bucketHint,
    ...(url !== undefined ? { url } : {}),
    ...(optStr(r['channelId'], `sources[${index}].channelId`, 80) !== undefined
      ? { channelId: optStr(r['channelId'], `sources[${index}].channelId`, 80)! }
      : {}),
    ...(optStr(r['parser'], `sources[${index}].parser`, 120) !== undefined
      ? { parser: optStr(r['parser'], `sources[${index}].parser`, 120)! }
      : {}),
    ...(windowHours !== undefined ? { windowHours } : {}),
    ...(optBool(r['alwaysKeep'], `sources[${index}].alwaysKeep`) !== undefined
      ? { alwaysKeep: optBool(r['alwaysKeep'], `sources[${index}].alwaysKeep`)! }
      : {}),
    ...(optBool(r['insecure'], `sources[${index}].insecure`) !== undefined
      ? { insecure: optBool(r['insecure'], `sources[${index}].insecure`)! }
      : {}),
    ...(optBool(r['enabled'], `sources[${index}].enabled`) !== undefined
      ? { enabled: optBool(r['enabled'], `sources[${index}].enabled`)! }
      : {})
  }
}

function parseTopic(raw: unknown, index: number): PackTopic {
  const r = record(raw, `topics[${index}]`)
  const sources = list(r['sources'], `topics[${index}].sources`, MAX_SOURCES).map((v, j) =>
    str(v, `topics[${index}].sources[${j}]`, 80)
  )
  return {
    id: str(r['id'], `topics[${index}].id`, 40),
    name: str(r['name'], `topics[${index}].name`, 60),
    domainId: str(r['domainId'], `topics[${index}].domainId`, 40),
    sources,
    ...(optBool(r['enabled'], `topics[${index}].enabled`) !== undefined
      ? { enabled: optBool(r['enabled'], `topics[${index}].enabled`)! }
      : {})
  }
}

/** 校验并归一化外部 JSON；手写或机器生成都走这一条 */
export function parsePack(raw: unknown): SourcePack {
  const root = record(raw, '包')
  const format = str(root['format'], 'format', 40)
  if (format !== PACK_FORMAT) fail(`不是 Meerkat source pack（format=${format}）`)
  if (root['version'] !== PACK_VERSION) fail(`不支持的包版本：${String(root['version'])}`)

  const domains = list(root['domains'] ?? [], 'domains', MAX_DOMAINS).map((v, i) => {
    const r = record(v, `domains[${i}]`)
    return { id: str(r['id'], `domains[${i}].id`, 40), name: str(r['name'], `domains[${i}].name`, 60) }
  })
  const sources = list(root['sources'] ?? [], 'sources', MAX_SOURCES).map(parseSource)
  const topics = list(root['topics'] ?? [], 'topics', MAX_TOPICS).map(parseTopic)

  const domainIds = new Set<string>()
  for (const d of domains) {
    if (domainIds.has(d.id)) fail(`领域 id 重复：${d.id}`)
    domainIds.add(d.id)
  }
  const sourceIds = new Set<string>()
  const sourceNames = new Set<string>()
  const sourceUrls = new Set<string>()
  for (const s of sources) {
    if (sourceIds.has(s.id)) fail(`源 id 重复：${s.id}`)
    if (sourceNames.has(s.name)) fail(`源名称重复：${s.name}`)
    if (s.url !== undefined) {
      const key = canonicalUrl(s.url)
      if (sourceUrls.has(key)) fail(`源 URL 重复：${s.url}`)
      sourceUrls.add(key)
    }
    sourceIds.add(s.id)
    sourceNames.add(s.name)
  }
  const topicIds = new Set<string>()
  const topicNames = new Set<string>()
  for (const t of topics) {
    if (topicIds.has(t.id)) fail(`主题 id 重复：${t.id}`)
    if (topicNames.has(t.name)) fail(`主题名称重复：${t.name}`)
    topicIds.add(t.id)
    topicNames.add(t.name)
    for (const sid of t.sources) {
      if (!sourceIds.has(sid)) fail(`主题「${t.name}」引用了不存在的源：${sid}`)
    }
  }

  return {
    format,
    version: PACK_VERSION,
    exportedAt: typeof root['exportedAt'] === 'string' ? root['exportedAt'] : new Date(0).toISOString(),
    domains,
    topics,
    sources
  }
}

export type PackScope = { kind: 'all' } | { kind: 'topic'; topicId: string }

function packSource(s: Source): PackSource {
  return {
    id: s.id,
    name: s.name,
    kind: s.kind,
    tier: s.tier,
    bucketHint: s.bucketHint,
    enabled: s.enabled,
    ...(s.url !== undefined ? { url: s.url } : {}),
    ...(s.channelId !== undefined ? { channelId: s.channelId } : {}),
    ...(s.parser !== undefined ? { parser: s.parser } : {}),
    ...(s.windowHours !== undefined ? { windowHours: s.windowHours } : {}),
    ...(s.alwaysKeep ? { alwaysKeep: true } : {}),
    ...(s.insecure ? { insecure: true } : {})
  }
}

/** 导出：只带配置，不带健康度、时间戳和排程 */
export function buildPack(store: Store, scope: PackScope, now = Date.now()): SourcePack {
  let topics: Topic[]
  let sources: Source[]
  let domains: Domain[]

  if (scope.kind === 'all') {
    topics = store.topics.list()
    sources = store.sources.list()
    domains = store.domains.list()
  } else {
    const topic = store.topics.get(scope.topicId)
    if (!topic) fail(`主题不存在：${scope.topicId}`)
    topics = [topic]
    const ids = store.topics.sourceIds(topic.id)
    sources = ids.map((id) => store.sources.get(id)).filter((s): s is Source => s !== undefined)
    const domain = store.domains.get(topic.domainId)
    domains = domain ? [domain] : []
  }

  const sourceIdSet = new Set(sources.map((s) => s.id))
  return {
    format: PACK_FORMAT,
    version: PACK_VERSION,
    exportedAt: new Date(now).toISOString(),
    domains: domains.map((d) => ({ id: d.id, name: d.name })),
    topics: topics.map((t) => ({
      id: t.id,
      name: t.name,
      domainId: t.domainId,
      enabled: t.enabled,
      sources: store.topics.sourceIds(t.id).filter((id) => sourceIdSet.has(id))
    })),
    sources: sources.map(packSource)
  }
}

export type PlanAction = 'create' | 'update'

export interface PlanEntry {
  kind: 'domain' | 'source' | 'topic'
  action: PlanAction
  label: string
  detail?: string
}

export interface ImportPlan {
  entries: PlanEntry[]
  domains: Array<{ action: PlanAction; domain: Domain }>
  sources: Array<{ action: PlanAction; source: Source }>
  topics: Array<{ action: PlanAction; topic: Topic; sourceIds: string[] }>
  counts: {
    domains: { create: number; update: number }
    sources: { create: number; update: number }
    topics: { create: number; update: number }
  }
}

const count = (entries: PlanEntry[], kind: PlanEntry['kind']): { create: number; update: number } => ({
  create: entries.filter((e) => e.kind === kind && e.action === 'create').length,
  update: entries.filter((e) => e.kind === kind && e.action === 'update').length
})

/**
 * 覆盖同名：主题按 id 或名称匹配后，源归属整组替换；排程保留本机值。
 * 源按 id → 规范化 URL → 名称匹配；健康度不参与匹配，也不会被覆盖。
 */
export function planImport(store: Store, pack: SourcePack, now = Date.now()): ImportPlan {
  const entries: PlanEntry[] = []
  const domainIdMap = new Map<string, string>()
  const sourceIdMap = new Map<string, string>()

  const existingDomains = store.domains.list()
  const domainPlans: ImportPlan['domains'] = []
  for (const pd of pack.domains) {
    const existing = store.domains.get(pd.id) ?? existingDomains.find((d) => d.name === pd.name)
    const id = existing?.id ?? pd.id
    domainIdMap.set(pd.id, id)
    const action: PlanAction = existing ? 'update' : 'create'
    const domain: Domain = existing
      ? { ...existing, name: pd.name }
      : { id: pd.id, name: pd.name, createdAt: now }
    domainPlans.push({ action, domain })
    entries.push({
      kind: 'domain',
      action,
      label: pd.name,
      ...(existing ? { detail: existing.id === pd.id ? '更新名称' : '按名称匹配现有领域' } : {})
    })
  }

  const existingSources = store.sources.list()
  const sourcePlans: ImportPlan['sources'] = []
  for (const ps of pack.sources) {
    const byId = store.sources.get(ps.id)
    const byUrl = existingSources.find(
      (s) => s.url !== undefined && ps.url !== undefined && canonicalUrl(s.url) === canonicalUrl(ps.url)
    )
    const byName = existingSources.find((s) => s.name === ps.name)
    const existing = byId ?? byUrl ?? byName
    const id = existing?.id ?? ps.id
    sourceIdMap.set(ps.id, id)
    const action: PlanAction = existing ? 'update' : 'create'
    const source: Source = {
      id,
      name: ps.name,
      kind: ps.kind,
      tier: ps.tier,
      bucketHint: ps.bucketHint,
      enabled: ps.enabled ?? existing?.enabled ?? true,
      failStreak: existing?.failStreak ?? 0,
      ...(ps.url !== undefined ? { url: ps.url } : existing?.url !== undefined ? { url: existing.url } : {}),
      ...(ps.channelId !== undefined
        ? { channelId: ps.channelId }
        : existing?.channelId !== undefined
          ? { channelId: existing.channelId }
          : {}),
      ...(ps.parser !== undefined ? { parser: ps.parser } : existing?.parser !== undefined ? { parser: existing.parser } : {}),
      ...(ps.windowHours !== undefined
        ? { windowHours: ps.windowHours }
        : existing?.windowHours !== undefined
          ? { windowHours: existing.windowHours }
          : {}),
      ...(ps.alwaysKeep ?? existing?.alwaysKeep ? { alwaysKeep: true } : {}),
      ...(ps.insecure ?? existing?.insecure ? { insecure: true } : {})
    }
    sourcePlans.push({ action, source })
    entries.push({
      kind: 'source',
      action,
      label: ps.name,
      ...(existing
        ? { detail: byId ? '按 id 覆盖元数据' : byUrl ? '按 URL 覆盖元数据' : '按名称覆盖' }
        : {})
    })
  }

  const existingTopics = store.topics.list()
  const topicPlans: ImportPlan['topics'] = []
  for (const pt of pack.topics) {
    const existing = store.topics.get(pt.id) ?? existingTopics.find((t) => t.name === pt.name)
    const action: PlanAction = existing ? 'update' : 'create'
    const domainId = domainIdMap.get(pt.domainId) ?? store.domains.get(pt.domainId)?.id
    if (!domainId) fail(`主题「${pt.name}」引用了不存在的领域：${pt.domainId}`)
    const sourceIds = pt.sources.map((sid) => {
      const mapped = sourceIdMap.get(sid) ?? store.sources.get(sid)?.id
      if (!mapped) fail(`主题「${pt.name}」引用了不存在的源：${sid}`)
      return mapped
    })
    const topic: Topic = existing
      ? {
          ...existing,
          name: pt.name,
          domainId,
          enabled: pt.enabled ?? existing.enabled,
          updatedAt: now
        }
      : {
          id: pt.id,
          name: pt.name,
          domainId,
          enabled: pt.enabled ?? true,
          hour: 8,
          minute: 30,
          createdAt: now,
          updatedAt: now
        }
    topicPlans.push({ action, topic, sourceIds })
    entries.push({
      kind: 'topic',
      action,
      label: pt.name,
      ...(existing
        ? { detail: existing.id === pt.id ? '覆盖源归属，保留本机排程' : '按名称匹配现有主题，保留本机排程' }
        : { detail: '使用默认排程 08:30' })
    })
  }

  return {
    entries,
    domains: domainPlans,
    sources: sourcePlans,
    topics: topicPlans,
    counts: {
      domains: count(entries, 'domain'),
      sources: count(entries, 'source'),
      topics: count(entries, 'topic')
    }
  }
}

/** 应用：整体一个事务；失败不留下半套数据 */
export function applyImport(store: Store, pack: SourcePack, now = Date.now()): ImportPlan {
  const plan = planImport(store, pack, now)
  store.transaction(() => {
    for (const d of plan.domains) store.domains.upsert(d.domain)
    for (const s of plan.sources) store.sources.upsert(s.source)
    for (const t of plan.topics) {
      store.topics.upsert(t.topic)
      store.topics.setSources(t.topic.id, t.sourceIds)
    }
  })
  return plan
}
