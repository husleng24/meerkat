/**
 * 抓取器注册表：kind → Fetcher。
 * 加一个站点原则上只改 sources.yaml（声明式）；只有结构特殊的才在这里加命令式解析器。
 */
import type { Source } from '../../core/domain/types'
import type { FetchContext, FetchResult, Fetcher } from '../../core/ports/fetcher'
import { rssFetcher } from './rss'
import { youtubeFetcher } from './youtube'
import { arxivFetcher, githubTrendingFetcher, hnFetcher } from './feeds'
import { anthropicFetcher, hfPapersFetcher } from './html'

const ALL: Fetcher[] = [
  rssFetcher,
  youtubeFetcher,
  arxivFetcher,
  hnFetcher,
  githubTrendingFetcher,
  anthropicFetcher,
  hfPapersFetcher
]

export function fetcherFor(source: Source): Fetcher | undefined {
  return ALL.find((f) => f.kinds.includes(source.kind))
}

export async function fetchSource(source: Source, ctx: FetchContext): Promise<FetchResult> {
  const fetcher = fetcherFor(source)
  if (!fetcher) {
    return { ok: false, error: `没有处理 kind=${source.kind} 的抓取器`, ms: 0 }
  }
  return fetcher.fetch(source, ctx)
}
