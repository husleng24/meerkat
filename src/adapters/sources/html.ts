/**
 * 两个没有 RSS 的源，只能解析 HTML：
 *  - Anthropic News（页面结构：<time> + href="/news/slug" + img alt）
 *  - HuggingFace 热榜（Next.js 内嵌 JSON，用 `{"id":"2xxx.xxxxx"` 切块）
 *
 * 这类解析器天生脆弱（站点改版就失效），所以：
 *  1. 用宽松正则 + 形状匹配，不用精确的 DOM 路径
 *  2. 解析不出内容返回空数组而不是抛错，让上游按"该源本次 0 条"处理
 */
import type { RawItem, Source } from '../../core/domain/types'
import type { FetchContext, FetchResult, Fetcher } from '../../core/ports/fetcher'
import { httpGet } from '../http/client'
import { cleanHtml } from '../../core/pipeline/text'
import { parseDateLoose } from '../../core/pipeline/dates'
import { parseFeed } from './rss'

const HOUR = 3_600_000

/** Anthropic News：无 RSS，只能解析列表页 */
export function parseAnthropicNews(html: string): RawItem[] {
  const out: RawItem[] = []
  const seen = new Set<string>()
  const re =
    /<time>([^<]{4,30})<\/time>([\s\S]{0,1600}?)href="\/news\/([a-z0-9-]+)"([\s\S]{0,900}?)alt="([^"]{3,200})"/g
  for (const m of html.matchAll(re)) {
    const slug = m[3]!
    if (slug === 'announcements' || slug === 'category' || seen.has(slug)) continue
    seen.add(slug)
    const publishedAt = parseDateLoose(m[1])
    out.push({
      title: m[5]!,
      url: `https://www.anthropic.com/news/${slug}`,
      ...(publishedAt !== undefined ? { publishedAt } : {})
    })
  }
  return out
}

/** Next.js 把内嵌 JSON 的引号转义成 &quot;，不先还原就切不出块 */
function unescapeHtml(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

/** HF 热榜：切块解析，按榜位给分（页面没有 upvotes 字段，实测只有 numComments） */
export function parseHfPapers(raw: string, now: number, keep: number): RawItem[] {
  const text = unescapeHtml(raw)
  const out: RawItem[] = []
  const chunks = text.split(/\{"id":"(2\d{3}\.\d{4,5})"/)
  for (let i = 1; i < chunks.length - 1; i += 2) {
    const pid = chunks[i]!
    const body = (chunks[i + 1] ?? '').slice(0, 1400)
    const mt = /"title":"((?:[^"\\]|\\.){5,400})"/.exec(body)
    if (!mt) continue
    const title = mt[1]!.replace(/\\"/g, '"').replace(/\\u0026/g, '&')
    const mc = /"numComments":(\d+)/.exec(body)
    const comments = mc ? Number(mc[1]) : 0
    const rank = out.length + 1
    out.push({
      title,
      url: `https://huggingface.co/papers/${pid}`,
      // 热榜每天更新，按"今天早些时候"计龄，避免和新发布的新闻抢时效分
      publishedAt: now - 18 * HOUR,
      summary: `HF 热榜第 ${rank} 位 · ${comments} 条评论`,
      type: 'hfpapers',
      points: Math.max(1, 60 - rank * 8),
      comments
    })
    if (out.length >= keep) break
  }
  return out
}

/** 用 arXiv 批量接口给 HF 论文补摘要（一次请求，明显提升简报可用性） */
async function enrichWithAbstracts(items: RawItem[], signal?: AbortSignal): Promise<void> {
  const ids = items.map((i) => i.url.split('/').pop() ?? '').filter(Boolean)
  if (ids.length === 0) return
  const url = `http://export.arxiv.org/api/query?id_list=${ids.join(',')}&max_results=${ids.length}`
  try {
    const res = await httpGet(url, { timeoutMs: 40_000, retries: 1, ...(signal ? { signal } : {}) })
    const entries = parseFeed(res.body, ids.length)
    const byId = new Map<string, string>()
    for (const e of entries) {
      const id = (e.url.split('/').pop() ?? '').replace(/v\d+$/, '')
      if (e.summary) byId.set(id, e.summary)
    }
    for (const it of items) {
      const id = (it.url.split('/').pop() ?? '').replace(/v\d+$/, '')
      const extra = byId.get(id)
      if (extra) it.summary = `${it.summary ?? ''}｜${extra.slice(0, 600)}`
    }
  } catch {
    // 补摘要失败不影响主流程
  }
}

export const anthropicFetcher: Fetcher = {
  kinds: ['html'],
  async fetch(source: Source, ctx: FetchContext): Promise<FetchResult> {
    const started = Date.now()
    if (!source.url) return { ok: false, error: '缺少 url', ms: 0 }
    try {
      const res = await httpGet(source.url, { ...(ctx.signal ? { signal: ctx.signal } : {}) })
      return { ok: true, items: parseAnthropicNews(res.body), ms: Date.now() - started }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e), ms: Date.now() - started }
    }
  }
}

export const hfPapersFetcher: Fetcher = {
  kinds: ['hfpapers'],
  async fetch(source: Source, ctx: FetchContext): Promise<FetchResult> {
    const started = Date.now()
    try {
      const res = await httpGet(source.url ?? 'https://huggingface.co/papers', {
        ...(ctx.signal ? { signal: ctx.signal } : {})
      })
      const items = parseHfPapers(res.body, ctx.now, 8)
      await enrichWithAbstracts(items, ctx.signal)
      return { ok: true, items, ms: Date.now() - started }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e), ms: Date.now() - started }
    }
  }
}

/** 供测试：无网络时的解析结果 */
export const _parseHelpers = { cleanHtml }
