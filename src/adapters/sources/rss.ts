/**
 * RSS 2.0 / Atom 抓取器：覆盖 22 个源，是收益最高的一类。
 *
 * 用 fast-xml-parser + removeNSPrefix，让 RSS 的 <dc:creator> 和 Atom 的
 * <atom:link> 都退化成普通标签名，避免为每个命名空间写分支。
 */
import { XMLParser } from 'fast-xml-parser'
import type { RawItem, Source } from '../../core/domain/types'
import type { FetchContext, FetchResult, Fetcher } from '../../core/ports/fetcher'
import { httpGet } from '../http/client'
import { parseDateLoose } from '../../core/pipeline/dates'

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  processEntities: true,
  trimValues: true,
  parseTagValue: false
})

type XmlNode = Record<string, unknown>

const asArray = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v])
const text = (v: unknown): string => {
  if (v === undefined || v === null) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return text(v[0])
  if (typeof v === 'object') {
    const o = v as XmlNode
    if (typeof o['#text'] === 'string') return o['#text']
  }
  return ''
}
const attr = (v: unknown, name: string): string => {
  if (Array.isArray(v)) return attr(v[0], name)
  if (v && typeof v === 'object') {
    const got = (v as XmlNode)[`@_${name}`]
    if (typeof got === 'string') return got
  }
  return ''
}

/** 从 Atom 的多个 <link> 里挑 rel=alternate 或第一个有 href 的 */
function atomLink(node: XmlNode): string {
  const links = asArray(node['link'])
  for (const l of links) {
    const rel = attr(l, 'rel')
    const href = attr(l, 'href')
    if (href && (rel === '' || rel === 'alternate')) return href
  }
  for (const l of links) {
    const href = attr(l, 'href')
    if (href) return href
  }
  return text(node['id'])
}

function mapRssItem(it: XmlNode): RawItem | null {
  const title = text(it['title'])
  const link = text(it['link']) || text(it['guid'])
  if (!title || !link || !/^https?:/i.test(link)) return null
  const summary = text(it['description']) || text(it['encoded']) || text(it['summary'])
  const author = text(it['creator']) || text(it['author'])
  const published = parseDateLoose(text(it['pubDate']) || text(it['date']))
  return {
    title,
    url: link,
    ...(published !== undefined ? { publishedAt: published } : {}),
    ...(summary ? { summary } : {}),
    ...(author ? { author } : {})
  }
}

function mapAtomEntry(e: XmlNode): RawItem | null {
  const title = text(e['title'])
  const link = atomLink(e)
  if (!title || !link || !/^https?:/i.test(link)) return null
  const summary = text(e['summary']) || text(e['content'])
  const authorNode = e['author']
  const author = text(Array.isArray(authorNode) ? authorNode[0] : (authorNode as XmlNode | undefined)?.['name'])
  const published = parseDateLoose(text(e['published']) || text(e['updated']))
  return {
    title,
    url: link,
    ...(published !== undefined ? { publishedAt: published } : {}),
    ...(summary ? { summary } : {}),
    ...(author ? { author } : {})
  }
}

export function parseFeed(xml: string, limit = 60): RawItem[] {
  const doc = parser.parse(xml) as XmlNode
  const out: RawItem[] = []

  const rss = doc['rss'] as XmlNode | undefined
  const channel = rss?.['channel'] as XmlNode | undefined
  if (channel) {
    for (const it of asArray(channel['item']).slice(0, limit)) {
      const mapped = mapRssItem(it as XmlNode)
      if (mapped) out.push(mapped)
    }
    return out
  }

  const feed = doc['feed'] as XmlNode | undefined
  if (feed) {
    for (const e of asArray(feed['entry']).slice(0, limit)) {
      const mapped = mapAtomEntry(e as XmlNode)
      if (mapped) out.push(mapped)
    }
  }
  return out
}

export const rssFetcher: Fetcher = {
  kinds: ['rss', 'atom'],
  async fetch(source: Source, ctx: FetchContext): Promise<FetchResult> {
    const started = Date.now()
    if (!source.url) return { ok: false, error: '缺少 url', ms: 0 }
    try {
      // Reddit 对同 IP 连发限流：实测两个子版并发请求会双双 429
      if (source.url.includes('reddit.com')) {
        await new Promise((resolve) => setTimeout(resolve, 4000))
      }
      const res = await httpGet(source.url, {
        insecure: source.insecure === true,
        ...(ctx.signal ? { signal: ctx.signal } : {})
      })
      const items = parseFeed(res.body)
      return { ok: true, items, ms: Date.now() - started }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e), ms: Date.now() - started }
    }
  }
}
