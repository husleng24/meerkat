/**
 * 新增/编辑信息源的输入校验。
 *
 * 纯函数：界面与主进程两侧都能用同一份规则，避免"界面放行、主进程拒绝"的割裂。
 * 校验偏严，因为一个非法源会在每次采集时都失败一次，噪声很大。
 */
import { BUCKET_LABEL, type Bucket, type Source, type SourceKind } from '../core/domain/types'

export const ALLOWED_KINDS: SourceKind[] = [
  'rss',
  'atom',
  'html',
  'youtube',
  'arxiv',
  'hn',
  'github-trending',
  'hfpapers'
]

/** 需要 url 的 kind；youtube 走 channelId */
const URL_KINDS: SourceKind[] = ['rss', 'atom', 'html', 'arxiv', 'hfpapers', 'github-trending']

export interface NewSourceInput {
  name: string
  url?: string
  kind: string
  tier: number
  bucketHint: string
}

export type ValidationResult = { ok: true; source: Source } | { ok: false; error: string }

/** 从 URL 生成稳定 id：可注册域名 + 路径首段，冲突时加序号 */
export function makeSourceId(url: string, existing: Set<string>): string {
  let base = 'custom'
  try {
    const u = new URL(url)
    const host = u.hostname.replace(/^www\./, '').toLowerCase()
    // 取域名后两段：blog.example.com → example-com（可注册域名比子域更有辨识度）
    const hostPart = host.split('.').slice(-2).join('-').replace(/[^a-z0-9-]/g, '')
    const pathPart = (u.pathname.split('/').filter(Boolean)[0] ?? '').replace(/[^a-z0-9]/gi, '').toLowerCase()
    base = [hostPart, pathPart].filter(Boolean).join('-') || 'custom'
  } catch {
    base = 'custom'
  }
  let id = base
  let n = 2
  while (existing.has(id)) {
    id = `${base}-${n}`
    n += 1
  }
  return id
}

/** 从 YouTube 频道 URL 里抽 channelId（UC 开头 24 位） */
export function extractChannelId(url: string): string | undefined {
  const m = /\/channel\/(UC[A-Za-z0-9_-]{22})/.exec(url)
  if (m) return m[1]
  const bare = /^(UC[A-Za-z0-9_-]{22})$/.exec(url.trim())
  return bare ? bare[1] : undefined
}

export function validateNewSource(input: NewSourceInput, existingIds: Set<string>): ValidationResult {  const name = (input.name ?? '').trim()
  if (name.length < 2) return { ok: false, error: '名称至少 2 个字' }
  if (name.length > 60) return { ok: false, error: '名称过长（最多 60 字）' }

  const kind = input.kind as SourceKind
  if (!ALLOWED_KINDS.includes(kind)) {
    return { ok: false, error: `不支持的类型：${input.kind}` }
  }

  const tier = Number(input.tier)
  if (!Number.isInteger(tier) || tier < 1 || tier > 3) {
    return { ok: false, error: '层级只能是 1、2 或 3' }
  }

  const bucketHint = input.bucketHint as Bucket
  if (!(bucketHint in BUCKET_LABEL)) return { ok: false, error: `未知板块：${input.bucketHint}` }

  const rawUrl = (input.url ?? '').trim()

  if (kind === 'youtube') {
    const channelId = extractChannelId(rawUrl)
    if (!channelId) {
      return {
        ok: false,
        error: 'YouTube 源需要频道地址（形如 https://www.youtube.com/channel/UC…）'
      }
    }
    return {
      ok: true,
      source: {
        id: makeSourceId(`https://youtube.com/${channelId}`, existingIds),
        name,
        kind,
        channelId,
        tier: tier as 1 | 2 | 3,
        bucketHint,
        enabled: true,
        failStreak: 0
      }
    }
  }

  if (kind === 'hn') {
    return {
      ok: true,
      source: {
        id: makeSourceId('https://news.ycombinator.com', existingIds),
        name,
        kind,
        tier: tier as 1 | 2 | 3,
        bucketHint,
        enabled: true,
        failStreak: 0
      }
    }
  }

  if (URL_KINDS.includes(kind)) {
    if (!/^https?:\/\//i.test(rawUrl)) return { ok: false, error: '地址必须以 http:// 或 https:// 开头' }
    try {
      new URL(rawUrl)
    } catch {
      return { ok: false, error: '地址格式不正确' }
    }
    return {
      ok: true,
      source: {
        id: makeSourceId(rawUrl, existingIds),
        name,
        kind,
        url: rawUrl,
        tier: tier as 1 | 2 | 3,
        bucketHint,
        enabled: true,
        failStreak: 0
      }
    }
  }

  return { ok: false, error: '无法判断该源的类型' }
}

export interface UpdateSourceInput {
  id: string
  name: string
  url?: string
  tier: number
  bucketHint: string
}

/**
 * 编辑已有源：只允许改名、改地址、改层级、改板块。
 *
 * 不允许改 **id 与 kind**——id 是外键（items.source_id 指向它），
 * kind 决定用哪个抓取器；改这两样等于换了一个源，应该删了重建。
 */
export function validateSourceUpdate(input: UpdateSourceInput, existing: Source): ValidationResult {
  const name = (input.name ?? '').trim()
  if (name.length < 2) return { ok: false, error: '名称至少 2 个字' }
  if (name.length > 60) return { ok: false, error: '名称过长（最多 60 字）' }

  const tier = Number(input.tier)
  if (!Number.isInteger(tier) || tier < 1 || tier > 3) {
    return { ok: false, error: '层级只能是 1、2 或 3' }
  }

  const bucketHint = input.bucketHint as Bucket
  if (!(bucketHint in BUCKET_LABEL)) return { ok: false, error: `未知板块：${input.bucketHint}` }

  const rawUrl = (input.url ?? '').trim()
  const merged: Source = { ...existing, name, tier: tier as 1 | 2 | 3, bucketHint }

  if (existing.kind === 'youtube') {
    if (rawUrl) {
      const channelId = extractChannelId(rawUrl)
      if (!channelId) return { ok: false, error: 'YouTube 源需要频道地址（形如 …/channel/UC…）' }
      merged.channelId = channelId
    }
    if (!merged.channelId) return { ok: false, error: '缺少频道 ID' }
    return { ok: true, source: merged }
  }

  if (existing.kind === 'hn') return { ok: true, source: merged }

  if (URL_KINDS.includes(existing.kind)) {
    if (!/^https?:\/\//i.test(rawUrl)) return { ok: false, error: '地址必须以 http:// 或 https:// 开头' }
    try {
      new URL(rawUrl)
    } catch {
      return { ok: false, error: '地址格式不正确' }
    }
    merged.url = rawUrl
    return { ok: true, source: merged }
  }

  return { ok: false, error: '该类型的源不支持编辑地址' }
}
