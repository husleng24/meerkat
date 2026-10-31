/**
 * YouTube 抓取器。
 *
 * 重要背景：YouTube 在 2026 年 10 月下线了频道 Atom feed
 * （feeds/videos.xml 全部 404），所以这里改为解析频道页内嵌的 ytInitialData。
 * 页面结构在 2026 年已是 lockupViewModel，不再是 videoRenderer。
 */
import type { RawItem, Source } from '../../core/domain/types'
import type { FetchContext, FetchResult, Fetcher } from '../../core/ports/fetcher'
import { httpGet } from '../http/client'
import { parseRelAge } from '../../core/pipeline/dates'

interface Lockup {
  contentId?: string
  metadata?: {
    lockupMetadataViewModel?: {
      title?: { content?: string }
      metadata?: {
        contentMetadataViewModel?: { metadataRows?: Array<{ metadataParts?: Array<{ text?: { content?: string } }> }> }
      }
    }
  }
}

/** 递归找所有 lockupViewModel（页面结构经常变，按形状找比按路径找稳） */
function collectLockups(node: unknown, out: Lockup[]): void {
  if (Array.isArray(node)) {
    for (const n of node) collectLockups(n, out)
    return
  }
  if (!node || typeof node !== 'object') return
  const obj = node as Record<string, unknown>
  if (obj['lockupViewModel'] && typeof obj['lockupViewModel'] === 'object') {
    out.push(obj['lockupViewModel'] as Lockup)
  }
  for (const v of Object.values(obj)) collectLockups(v, out)
}

export function parseViews(s: string): number {
  const m = /([\d.]+)\s*([KMB])/i.exec(s.replace(/,/g, ''))
  if (!m) {
    const plain = /^(\d+)$/.exec(s.trim())
    return plain ? Number(plain[1]) : 0
  }
  const mult = m[2]!.toUpperCase() === 'K' ? 1_000 : m[2]!.toUpperCase() === 'M' ? 1_000_000 : 1_000_000_000
  return Math.round(Number(m[1]) * mult)
}

export function parseYoutubePage(html: string, source: Source, now: number): RawItem[] {
  const m = /var ytInitialData = (\{[\s\S]*?\});<\/script>/.exec(html)
  if (!m) return []
  let data: unknown
  try {
    data = JSON.parse(m[1]!)
  } catch {
    return []
  }

  const lockups: Lockup[] = []
  collectLockups(data, lockups)

  const out: RawItem[] = []
  for (const lu of lockups) {
    const title = lu.metadata?.lockupMetadataViewModel?.title?.content ?? ''
    const videoId = lu.contentId ?? ''
    if (!title || !videoId) continue

    const rows = lu.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel?.metadataRows ?? []
    const parts: string[] = []
    for (const row of rows) for (const p of row.metadataParts ?? []) if (p.text?.content) parts.push(p.text.content)

    const agePart = parts.find((p) => p.toLowerCase().includes('ago'))
    const publishedAt = agePart ? parseRelAge(agePart, now) : undefined
    if (publishedAt === undefined) continue // 时间解析不出来就不收，避免把老视频当新内容

    // 非官方频道做 AI 关键词过滤，避免访谈类频道把无关内容带进来
    if (!source.alwaysKeep && !/ai|llm|gpt|claude|gemini|model|agent|neural|robot/i.test(title)) continue

    const views = parts.map(parseViews).reduce((a, b) => Math.max(a, b), 0)
    out.push({
      title,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      publishedAt,
      summary: `观看 ${views.toLocaleString('en-US')} · ${source.name}`,
      type: 'video',
      points: 0
    })
  }

  out.sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0))
  return out.slice(0, 3)
}

export const youtubeFetcher: Fetcher = {
  kinds: ['youtube'],
  async fetch(source: Source, ctx: FetchContext): Promise<FetchResult> {
    const started = Date.now()
    if (!source.channelId) return { ok: false, error: '缺少 channelId', ms: 0 }
    try {
      const res = await httpGet(`https://www.youtube.com/channel/${source.channelId}/videos`, {
        ...(ctx.signal ? { signal: ctx.signal } : {})
      })
      const items = parseYoutubePage(res.body, source, ctx.now)
      return { ok: true, items, ms: Date.now() - started }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e), ms: Date.now() - started }
    }
  }
}
