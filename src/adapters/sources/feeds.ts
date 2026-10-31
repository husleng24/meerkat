/**
 * arXiv、Hacker News、GitHub Trending 三个结构化抓取器。
 * 放在一个文件里：它们各自只有几十行，拆开反而增加跳转成本（见 ARCHITECTURE 的"不建浅模块"）。
 */
import type { RawItem, Source } from '../../core/domain/types'
import type { FetchContext, FetchResult, Fetcher } from '../../core/ports/fetcher'
import { httpGet, httpGetJson } from '../http/client'
import { parseFeed } from './rss'
import { cleanHtml } from '../../core/pipeline/text'

const hoursAgo = (ms: number): number => Date.now() - ms

/** arXiv：API 只暴露"已公告"论文，公告滞后 1–2 天，所以窗口通常要放宽 */
export const arxivFetcher: Fetcher = {
  kinds: ['arxiv'],
  async fetch(source: Source, ctx: FetchContext): Promise<FetchResult> {
    const started = Date.now()
    const cats = source.parser ? source.parser.split(',') : ['cs.AI', 'cs.CL', 'cs.LG']
    const q = cats.map((c) => `cat:${c.trim()}`).join('+OR+')
    const url = `https://export.arxiv.org/api/query?search_query=${q}&sortBy=submittedDate&sortOrder=descending&max_results=120`
    try {
      const res = await httpGet(url, { timeoutMs: 40_000, retries: 1, ...(ctx.signal ? { signal: ctx.signal } : {}) })
      const items = parseFeed(res.body, 120).map((i) => ({ ...i, type: 'arxiv' }))
      return { ok: true, items, ms: Date.now() - started }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e), ms: Date.now() - started }
    }
  }
}

interface AlgoliaHit {
  title?: string
  url?: string
  story_text?: string
  created_at?: string
  points?: number
  num_comments?: number
  author?: string
  objectID?: string
}

const AI_TERMS = /\b(ai|llm|gpt|claude|gemini|llama|agent|transformer|diffusion|model|neural|inference|training|openai|anthropic|deepseek|qwen|mistral|rag|embedding|prompt|token|multimodal|reasoning)\b/i

/** Hacker News：走 Algolia API（hnrss.org 实测经常 502） */
export const hnFetcher: Fetcher = {
  kinds: ['hn'],
  async fetch(source: Source, ctx: FetchContext): Promise<FetchResult> {
    const started = Date.now()
    const hours = source.windowHours ?? 48
    const since = Math.floor((ctx.now - hours * 3_600_000) / 1000)
    const url = `https://hn.algolia.com/api/v1/search_by_date?tags=story&numericFilters=points%3E60,created_at_i%3E${since}&hitsPerPage=100`
    try {
      const data = await httpGetJson<{ hits?: AlgoliaHit[] }>(url, {
        retries: 3,
        ...(ctx.signal ? { signal: ctx.signal } : {})
      })
      const items: RawItem[] = []
      for (const h of data.hits ?? []) {
        const title = h.title ?? ''
        if (!title || !AI_TERMS.test(title)) continue
        const link = h.url ?? `https://news.ycombinator.com/item?id=${h.objectID ?? ''}`
        const publishedAt = h.created_at ? Date.parse(h.created_at) : undefined
        items.push({
          title,
          url: link,
          ...(publishedAt !== undefined && Number.isFinite(publishedAt) ? { publishedAt } : {}),
          summary: `HN 讨论 · ${h.num_comments ?? 0} 条评论`,
          ...(h.author ? { author: h.author } : {}),
          points: h.points ?? 0,
          comments: h.num_comments ?? 0
        })
      }
      return { ok: true, items, ms: Date.now() - started }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e), ms: Date.now() - started }
    }
  }
}

/**
 * 注意 `\bai\b` 必须带词边界：不加边界时 "jailbreaks"、"email"、"maintain"
 * 里的 "ai" 都会命中，实测会让「紫微斗数排盘引擎」「jailbreaks 合集」这类
 * 仓库混进 AI 榜单并霸占 Top 10。
 */
const REPO_TERMS =
  /(\bai\b|\bllm\b|\bgpt\b|claude|gemini|llama|\bagent\b|\bmcp\b|codex|cursor|prompt|\brag\b|embedding|diffusion|transformer|inference|multimodal|reasoning|deepseek|qwen|mistral|ollama|vibe|copilot|neural|fine-?tun)/i

/** GitHub Trending 日榜：比"新建仓库搜索"干净得多（后者被刷星污染） */
export const githubTrendingFetcher: Fetcher = {
  kinds: ['github-trending'],
  async fetch(_source: Source, ctx: FetchContext): Promise<FetchResult> {
    const started = Date.now()
    try {
      const res = await httpGet('https://github.com/trending?since=daily', {
        ...(ctx.signal ? { signal: ctx.signal } : {})
      })
      const blocks = res.body.split('<article class="Box-row">').slice(1)
      const items: RawItem[] = []
      for (const block of blocks) {
        const m = /<h2[^>]*>\s*<a[^>]*href="\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)"/.exec(block)
        if (!m) continue
        const repo = m[1]!
        const d = /<p class="[^"]*color-fg-muted[^"]*">([\s\S]*?)<\/p>/.exec(block)
        const desc = d ? cleanHtml(d[1]!).slice(0, 300) : ''
        const s = /([\d,]+)\s*stars today/.exec(block)
        const stars = s ? Number(s[1]!.replace(/,/g, '')) : 0
        if (!REPO_TERMS.test(`${repo} ${desc}`)) continue
        items.push({
          title: `${repo} — ${desc.slice(0, 90)}`,
          url: `https://github.com/${repo}`,
          publishedAt: ctx.now,
          summary: `${desc} · 今日 +${stars} star`,
          type: 'repo',
          points: stars
        })
      }
      items.sort((a, b) => (b.points ?? 0) - (a.points ?? 0))
      return { ok: true, items: items.slice(0, 12), ms: Date.now() - started }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e), ms: Date.now() - started }
    }
  }
}

/** 供诊断用：给个源能跑多久 */
export const _debugHoursAgo = hoursAgo
