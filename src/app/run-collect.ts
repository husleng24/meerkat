/**
 * 用例：跑一次采集。
 *
 * 手动"立即采集"、定时任务、以及脚本都走这一个实现——
 * 两套实现必然漂移，而漂移出来的差异最难查（一边修好了另一边还是坏的）。
 */
import type { Source } from '../core/domain/types'
import type { Store } from '../core/ports/store'
import type { FetchContext, FetchResult } from '../core/ports/fetcher'
import { buildCandidates, type SourceBatch } from '../core/pipeline/run'
import type { DedupedItem } from '../core/pipeline/dedupe'
import type { BriefSourceStats } from './compose-brief'

export interface CollectDeps {
  store: Store
  fetchSource: (source: Source, ctx: FetchContext) => Promise<FetchResult>
}

export interface CollectOptions {
  now: number
  /** 只采这些源（按主题收录）；不传就是全部启用的源 */
  sourceIds?: string[]
  windowHours: number
  maxItems: number
  arxivKeep: number
  concurrency: number
  onProgress?: (p: { done: number; total: number; name: string; ok: boolean; n: number }) => void
}

export interface CollectResult {
  runId: string
  nSources: number
  nOk: number
  nRaw: number
  nFiltered: number
  nKept: number
  items: DedupedItem[]
  sourceStats: BriefSourceStats[]
  elapsedMs: number
}

const DEFAULTS = { windowHours: 48, maxItems: 80, arxivKeep: 6, concurrency: 6 } as const

export async function runCollect(deps: CollectDeps, opts: CollectOptions): Promise<CollectResult> {
  const { store, fetchSource } = deps
  const started = opts.now
  const allowed = opts.sourceIds ? new Set(opts.sourceIds) : null
  const sources = store.sources.list().filter((s) => s.enabled && (allowed === null || allowed.has(s.id)))
  const runId = `run-${opts.now}`

  store.runs.start({ id: runId, startedAt: started, nSources: sources.length, nRaw: 0, nKept: 0 })

  const batches: SourceBatch[] = []
  const stats: BriefSourceStats[] = []
  let done = 0
  let cursor = 0

  const worker = async (): Promise<void> => {
    for (;;) {
      const i = cursor++
      if (i >= sources.length) return
      const source = sources[i]!
      let res: FetchResult
      try {
        res = await fetchSource(source, {
          now: opts.now,
          windowHours: source.windowHours ?? opts.windowHours
        })
      } catch (e) {
        res = { ok: false, error: e instanceof Error ? e.message : String(e), ms: 0 }
      }

      if (res.ok) {
        store.sources.recordSuccess(source.id, res.items.length, res.ms)
        batches.push({ source, items: res.items })
        stats.push({ name: source.name, ok: true, n: res.items.length, note: '' })
      } else {
        store.sources.recordFailure(source.id, res.error)
        stats.push({ name: source.name, ok: false, n: 0, note: res.error.slice(0, 80) })
      }

      done += 1
      opts.onProgress?.({ done, total: sources.length, name: source.name, ok: res.ok, n: res.ok ? res.items.length : 0 })
    }
  }

  await Promise.all(Array.from({ length: Math.min(opts.concurrency, sources.length) }, worker))

  const built = buildCandidates(batches, {
    now: opts.now,
    windowHours: opts.windowHours,
    maxItems: opts.maxItems,
    arxivKeep: opts.arxivKeep
  })

  store.items.upsertMany(    built.items.map((it) => ({
      id: it.id,
      sourceId: it.sourceId,
      title: it.title,
      url: it.url,
      ...(it.author !== undefined ? { author: it.author } : {}),
      ...(it.publishedAt !== undefined ? { publishedAt: it.publishedAt } : {}),
      summary: it.summary,
      bucket: it.bucket,
      score: it.score,
      formulaVersion: it.formulaVersion,
      ...(it.points !== undefined ? { points: it.points } : {}),
      ...(it.comments !== undefined ? { comments: it.comments } : {}),
      alsoIn: it.alsoIn,
      fetchedAt: it.fetchedAt
    }))
  )
  // sourceName 由 buildCandidates 从 source.name 带出，这里不需要再补
  const errors = stats.filter((s) => !s.ok).map((s) => `${s.name}: ${s.note}`)
  store.runs.finish(runId, {
    finishedAt: Date.now(),
    nRaw: built.nRaw,
    nKept: built.items.length,
    errorsJson: JSON.stringify(errors)
  })

  return {
    runId,
    nSources: sources.length,
    nOk: stats.filter((s) => s.ok).length,
    nRaw: built.nRaw,
    nFiltered: built.nFiltered,
    nKept: built.items.length,
    items: built.items,
    sourceStats: stats,
    elapsedMs: Date.now() - opts.now
  }
}

export const COLLECT_DEFAULTS = DEFAULTS
