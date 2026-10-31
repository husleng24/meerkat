/**
 * 管线编排：一次采集 → 归一 → 去重 → 截断。
 *
 * 与 radar.py::main 的处理段等价，顺序不能改：
 *   1. 逐源按各自窗口过滤（published 早于 cutof�� 丢弃）
 *   2. arXiv 单独按分数取前 N（公告滞后，量大）
 *   3. 归一化（分类 + 打分）
 *   4. 去重（按分数降序吸收）
 *   5. 全局截断
 *
 * 这一步是纯函数：不碰 IO，不发网络请求，全部可单测。
 */
import type { Item, RawItem, Source } from '../domain/types'
import { toItem } from './normalize'
import { dedupeAll, type DedupedItem, type Sourced } from './dedupe'
import { scoreItem, type ScoreContext } from './rank'
import { itemTypeOf } from '../policy/ranking'

export interface SourceBatch {
  source: Source
  items: RawItem[]
}

export interface BuildOptions {
  now: number
  windowHours: number
  maxItems: number
  arxivKeep: number
}

export interface BuildResult {
  items: DedupedItem[]
  /** 进入候选池的原始条数（去重前） */
  nRaw: number
  /** 窗口过滤丢掉的条数 */
  nFiltered: number
}

const HOUR_MS = 3_600_000

/** 单源窗口过滤：源可选 windowHours 覆盖全局值 */
export function withinWindow(item: RawItem, source: Source, now: number, windowHours: number): boolean {
  if (item.publishedAt === undefined) return true
  const hours = source.windowHours ?? windowHours
  return item.publishedAt >= now - hours * HOUR_MS
}

export function buildCandidates(batches: SourceBatch[], opts: BuildOptions): BuildResult {
  const ctx: ScoreContext = { now: opts.now, windowHours: opts.windowHours }
  const sourced: Sourced[] = []
  let nFiltered = 0

  for (const { source, items } of batches) {
    const fresh: RawItem[] = []
    for (const raw of items) {
      if (withinWindow(raw, source, opts.now, opts.windowHours)) fresh.push(raw)
      else nFiltered += 1
    }

    let picked = fresh
    if (source.kind === 'arxiv') {
      // arXiv 量大且公告滞后：按分数取前 N，避免淹没有效信号
      picked = [...fresh]
        .sort(
          (a, b) =>
            scoreItem(
              {
                title: b.title,
                summary: b.summary ?? '',
                tier: source.tier,
                type: itemTypeOf(source),
                ...(b.publishedAt !== undefined ? { publishedAt: b.publishedAt } : {}),
                ...(b.points !== undefined ? { points: b.points } : {})
              },
              ctx
            ) -
            scoreItem(
              {
                title: a.title,
                summary: a.summary ?? '',
                tier: source.tier,
                type: itemTypeOf(source),
                ...(a.publishedAt !== undefined ? { publishedAt: a.publishedAt } : {}),
                ...(a.points !== undefined ? { points: a.points } : {})
              },
              ctx
            )
        )
        .slice(0, opts.arxivKeep)
    }

    for (const raw of picked) {
      const item: Item = toItem(raw, source, ctx)
      sourced.push({ item, sourceName: source.name })
    }
  }

  const deduped = dedupeAll(sourced)
  deduped.sort((a, b) => b.score - a.score)

  return {
    items: deduped.slice(0, opts.maxItems),
    nRaw: sourced.length,
    nFiltered
  }
}
