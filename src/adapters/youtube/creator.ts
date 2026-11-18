/**
 * 博主（YouTube 频道）解析。
 *
 * 不做 OAuth、不依赖 YouTube Data API：
 * 频道页本身带 channelId 和最近视频，和现有 YouTube 源用同一份页面解析。
 */
import { httpGet } from '../http/client'
import { parseYoutubePage } from '../sources/youtube'
import type { Source } from '../../core/domain/types'

export interface CreatorInfo {
  channelId: string
  name: string
  handle?: string
}

export interface CreatorVideo {
  videoId: string
  title: string
  url: string
  publishedAt?: number
}

const CHANNEL_RE = /"channelId":"(UC[\w-]{20,})"/
const EXTERNAL_ID_RE = /"externalId":"(UC[\w-]{20,})"/
const OG_TITLE_RE = /<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i
const TITLE_RE = /<title>([^<]+)<\/title>/i

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

/** 接受 @handle、channel URL、裸 channelId，统一成频道页 URL */
export function normalizeCreatorUrl(raw: string): { url: string; handle?: string } {
  const input = raw.trim()
  if (!input) throw new Error('请输入博主频道地址或 @handle')
  if (/^UC[\w-]{20,}$/.test(input)) {
    return { url: `https://www.youtube.com/channel/${input}/videos` }
  }
  if (input.startsWith('@')) {
    return { url: `https://www.youtube.com/${input}/videos`, handle: input }
  }
  if (!/^https?:\/\//i.test(input)) {
    if (/^[\w.-]+\.[a-z]{2,}/i.test(input)) return normalizeCreatorUrl(`https://${input}`)
    throw new Error('无法识别这个博主地址，请用 @handle 或 /channel/UC... 链接')
  }

  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new Error('博主地址格式不正确')
  }
  if (!/(^|\.)youtube\.com$/i.test(url.hostname)) throw new Error('目前只支持 YouTube 频道')
  url.hash = ''
  url.search = ''
  let path = url.pathname.replace(/\/+$/, '')
  if (path.startsWith('/@')) {
    const handle = path.split('/')[1]!
    if (!path.endsWith('/videos')) path += '/videos'
    return { url: `${url.origin}${path}`, handle }
  }
  if (path.startsWith('/channel/')) {
    if (!path.endsWith('/videos')) path += '/videos'
    return { url: `${url.origin}${path}` }
  }
  throw new Error('请使用频道主页链接（/@handle 或 /channel/UC...），不要用视频链接')
}

export function parseCreatorPage(html: string): CreatorInfo {
  const channelId = CHANNEL_RE.exec(html)?.[1] ?? EXTERNAL_ID_RE.exec(html)?.[1]
  if (!channelId) throw new Error('这个页面里找不到频道 ID，可能不是频道主页')
  const name =
    decodeEntities(OG_TITLE_RE.exec(html)?.[1] ?? TITLE_RE.exec(html)?.[1] ?? '')
      .replace(/\s*-\s*YouTube\s*$/i, '')
      .trim() || channelId
  return { channelId, name }
}

export async function fetchCreator(raw: string): Promise<{ creator: CreatorInfo; videos: CreatorVideo[] }> {
  const normalized = normalizeCreatorUrl(raw)
  const res = await httpGet(normalized.url, { timeoutMs: 30_000 })
  const creator = parseCreatorPage(res.body)
  const fakeSource = {
    id: 'video-creator',
    name: creator.name,
    kind: 'youtube',
    channelId: creator.channelId,
    tier: 2,
    bucketHint: 'video',
    enabled: true,
    alwaysKeep: true,
    failStreak: 0,
    createdAt: 0,
    updatedAt: 0
  } as Source
  const items = parseYoutubePage(res.body, fakeSource, Date.now(), { limit: 12, aiFilter: false })
  return {
    creator: { ...creator, ...(normalized.handle ? { handle: normalized.handle } : {}) },
    videos: items.map((it) => ({
      videoId: new URL(it.url).searchParams.get('v') ?? '',
      title: it.title,
      url: it.url,
      ...(it.publishedAt !== undefined ? { publishedAt: it.publishedAt } : {})
    })).filter((v) => v.videoId)
  }
}

/** 已保存博主再次拉视频列表：直接走 channelId，不依赖用户当初输入的 handle */
export async function fetchCreatorVideos(channelId: string): Promise<CreatorVideo[]> {
  const res = await httpGet(`https://www.youtube.com/channel/${channelId}/videos`, { timeoutMs: 30_000 })
  const fakeSource = {
    id: 'video-creator',
    name: channelId,
    kind: 'youtube',
    channelId,
    tier: 2,
    bucketHint: 'video',
    enabled: true,
    alwaysKeep: true,
    failStreak: 0,
    createdAt: 0,
    updatedAt: 0
  } as Source
  const items = parseYoutubePage(res.body, fakeSource, Date.now(), { limit: 12, aiFilter: false })
  return items.map((it) => ({
    videoId: new URL(it.url).searchParams.get('v') ?? '',
    title: it.title,
    url: it.url,
    ...(it.publishedAt !== undefined ? { publishedAt: it.publishedAt } : {})
  })).filter((v) => v.videoId)
}
