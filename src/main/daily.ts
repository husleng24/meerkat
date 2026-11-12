/**
 * 「每日一次」的完整流程：采集 → 过滤已推送 → 生成 → 受控落库 → 标记已推送。
 *
 * 依赖通过参数注入（apiKey / promptText），不直接 import electron——
 * 这样端到端脚本可以在普通 Node 里跑完整流程，包括"连跑两天"验证跨天去重。
 *
 * 两条保护性规则都在这里落地：
 *  - 跨天去重（brief-selection）：昨天推过的不再推，但剩得太少时放弃过滤
 *  - 覆盖保护（brief-save）：降级版不得覆盖完整版
 *
 * 另外提供 `recomposeDaily`：不重新抓取，只用库里已有的素材重新成稿。
 * 它和 runDaily 共用 `finishBrief`——"怎么成稿、怎么落库、怎么标记已推送"
 * 只能有一份实现，否则重跑出来的简报和正常跑出来的会慢慢对不上。
 */
import { fetchSource } from '../adapters/sources'
import { createChatComposer, createNoopComposer } from '../adapters/llm/chat-composer'
import { createProviderInstance, type ComposeTarget } from './providers'
import { composeBrief, weekdayOf, type BriefItem, type BriefSourceStats } from '../app/compose-brief'
import { briefTitle } from '../app/brief-identity'
import { runCollect, COLLECT_DEFAULTS, type CollectResult } from '../app/run-collect'
import { citedItemIds, filterAlreadyBriefed } from '../app/brief-selection'
import { decideSave, type SaveDecision } from '../app/brief-save'
import { RunCancelledError, isAbortError } from '../app/run-cancel'
import { log } from './log'
import type { Store } from '../core/ports/store'
import type { Topic } from '../core/domain/types'

export interface DailyDeps {
  /** 成稿用哪家供应商；null = 没配任何 key，简报会降级成"仅聚合" */
  compose: ComposeTarget | null
  promptText: string
}

export interface DailyOutcome {
  /** collect：真的抓了一轮；recompose：只用库里已有素材重新成稿 */
  kind: 'collect' | 'recompose'
  collect: CollectResult
  briefOk: boolean
  degraded: boolean
  title: string
  /** 跨天去重丢掉的条数 */
  droppedAsBriefed: number
  /** 去重被回退（剩太少） */
  filterOverridden: boolean
  /** 落库决策 */
  save: SaveDecision
  /** 本次被标记为已推送的条数 */
  markedBriefed: number
  linkCheck: { good: number; total: number; rate: number }
}

/** 已推送记录保留 90 天，与 Python 原型的口径一致 */
const BRIEFED_TTL_MS = 90 * 86_400_000

export interface RunOptions {
  /** 主题：决定采哪些源、和谁比"昨天"、条目推给谁 */
  topicId: string
  now?: number
  signal?: AbortSignal
}

export async function runDaily(store: Store, deps: DailyDeps, opts: RunOptions): Promise<DailyOutcome> {
  const now = opts.now ?? Date.now()
  const topic = store.topics.get(opts.topicId)
  if (!topic) throw new Error(`主题不存在：${opts.topicId}`)
  const sourceIds = store.topics.sourceIds(topic.id)
  const collect = await runCollect(
    { store, fetchSource },
    { now, sourceIds, ...COLLECT_DEFAULTS, ...(opts.signal ? { signal: opts.signal } : {}) }
  )
  if (opts.signal?.aborted) throw new RunCancelledError('collect')
  log(
    'info',
    `采集完成：${collect.nOk}/${collect.nSources} 源 · ${collect.nRaw} 原始 → ${collect.nKept} 条 · ${(collect.elapsedMs / 1000).toFixed(1)}s`
  )

  // ── 跨天去重 ──────────────────────────────────────────
  // 去重按主题算：A 主题推过的内容，B 主题仍然该看到
  const briefed = store.items.briefedIds(now - BRIEFED_TTL_MS, topic.id)
  const filtered = filterAlreadyBriefed(collect.items, briefed)

  return finishBrief(store, deps, {
    kind: 'collect',
    topic,
    items: filtered.items,
    droppedAsBriefed: filtered.dropped,
    filterOverridden: filtered.overridden,
    sourceStats: collect.sourceStats,
    collect,
    now,
    windowHours: COLLECT_DEFAULTS.windowHours,
    elapsedMs: collect.elapsedMs,
    ...(opts.signal ? { signal: opts.signal } : {})
  })
}

/**
 * 重新成稿：不抓取，直接用库里最近 48 小时的素材再让模型写一遍。
 *
 * 素材范围刻意是"今天还没被推过的 + 今天已经推过的"：
 * 今天推过的必须允许重排（这正是用户想改的那一版），昨天推过的不能再翻出来。
 */
export async function recomposeDaily(
  store: Store,
  deps: DailyDeps,
  opts: { topicId: string; now?: number; signal?: AbortSignal }
): Promise<DailyOutcome> {
  const now = opts.now ?? Date.now()
  const topic = store.topics.get(opts.topicId)
  if (!topic) throw new Error(`主题不存在：${opts.topicId}`)

  const pool = collectReusableItems(store, topic.id, now)
  if (pool.items.length === 0) {
    throw new Error('最近 48 小时没有可用素材，先跑一次「立即采集」')
  }
  log('info', `重新成稿：复用 ${pool.items.length} 条素材（不重新抓取）`)

  const collect: CollectResult = {
    runId: `recompose-${now}`,
    nSources: pool.sourceStats.length,
    nOk: pool.sourceStats.filter((s) => s.ok).length,
    nRaw: pool.items.length,
    nFiltered: 0,
    nKept: pool.items.length,
    items: pool.items,
    sourceStats: pool.sourceStats,
    elapsedMs: 0
  }

  return finishBrief(store, deps, {
    kind: 'recompose',
    topic,
    items: pool.items,
    droppedAsBriefed: 0,
    filterOverridden: false,
    sourceStats: pool.sourceStats,
    collect,
    now,
    windowHours: COLLECT_DEFAULTS.windowHours,
    elapsedMs: 0,
    ...(opts.signal ? { signal: opts.signal } : {})
  })
}

/**
 * 可复用素材：该主题源在窗口内抓到的条目，且不是"今天之前就推过"的。
 *
 * 为什么用"今天 0 点"而不是"上次运行时间"：重新成稿发生在当天，
 * 当天推过的条目必须能重新参与；而昨天的条目即使今天又抓到一次，
 * 也不该被当成新素材重新成稿（那正是跨天去重要避免的）。
 */
export function collectReusableItems(
  store: Store,
  topicId: string,
  now: number,
  windowHours = COLLECT_DEFAULTS.windowHours
): { items: BriefItem[]; sourceStats: BriefSourceStats[] } {
  const sourceIds = new Set(store.topics.sourceIds(topicId))
  const sources = store.sources.list().filter((s) => sourceIds.has(s.id))
  const byId = new Map(sources.map((s) => [s.id, s.name]))

  const dayStart = new Date(now)
  dayStart.setHours(0, 0, 0, 0)
  const staleIds = store.items.briefedIdsBefore(now - BRIEFED_TTL_MS, dayStart.getTime(), topicId)

  const items: BriefItem[] = store.items
    .since(now - windowHours * 3_600_000, 500)
    .filter((it) => byId.has(it.sourceId) && !staleIds.has(it.id))
    .map((it) => ({ ...it, sourceName: byId.get(it.sourceId) ?? it.sourceId }))

  const counts = new Map<string, number>()
  for (const it of items) counts.set(it.sourceId, (counts.get(it.sourceId) ?? 0) + 1)
  const sourceStats: BriefSourceStats[] = sources
    .filter((s) => (counts.get(s.id) ?? 0) > 0)
    .map((s) => ({ name: s.name, ok: true, n: counts.get(s.id) ?? 0, note: '' }))

  return { items, sourceStats }
}

interface FinishInput {
  kind: 'collect' | 'recompose'
  topic: Topic
  items: BriefItem[]
  droppedAsBriefed: number
  filterOverridden: boolean
  sourceStats: BriefSourceStats[]
  collect: CollectResult
  now: number
  windowHours: number
  elapsedMs: number
  signal?: AbortSignal
}

/** 成稿 + 覆盖保护 + 落库 + 标记已推送。runDaily 与 recomposeDaily 共用这一段。 */
async function finishBrief(store: Store, deps: DailyDeps, input: FinishInput): Promise<DailyOutcome> {
  const { topic, items, now } = input
  const dateLabel = new Date(now).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })
  const target = deps.compose
  const provider = target ? createProviderInstance(target.provider, target.key) : null
  const composer =
    target && provider
      ? createChatComposer({
          provider,
          model: target.model,
          systemPrompt: deps.promptText,
          maxTokens: 32_000
        })
      : createNoopComposer()

  let out
  try {
    out = await composeBrief(
      composer,
      items,
      {
        now,
        windowHours: input.windowHours,
        dateLabel,
        weekday: weekdayOf(now),
        topicName: topic.name,
        sourceStats: input.sourceStats,
        elapsedMs: input.elapsedMs
      },
      input.signal
    )
  } catch (e) {
    if (isAbortError(e)) throw new RunCancelledError('compose')
    throw e
  }
  if (input.signal?.aborted) throw new RunCancelledError('compose')

  // 通知标题与简报 H1 用同一个函数：多主题同一天各跑一次时，用户要能分清是哪一份
  const title = briefTitle(topic.name, dateLabel, weekdayOf(now))
  log(
    'info',
    `简报生成：${out.degraded ? '降级（未接模型）' : out.model} · ${out.markdown.length} 字符 · ` +
      `链接校验 ${out.linkCheck.good}/${out.linkCheck.total}` +
      (out.issues.length > 0 ? ` · 结构问题：${out.issues.join('；')}` : '')
  )

  // ── 覆盖保护 ──────────────────────────────────────────
  const existing = store.briefs.byDate(dateLabel, topic.id)
  const save = decideSave(existing, { degraded: out.degraded })

  let markedBriefed = 0
  if (save.write) {
    store.briefs.save({
      // 同一天每个主题各一条，id 必须带主题，否则后跑的会把先跑的覆盖掉
      id: `${dateLabel}-${topic.id}`,
      date: dateLabel,
      topicId: topic.id,
      markdown: out.markdown,
      model: out.model,
      tokensIn: out.usage.input,
      tokensOut: out.usage.output,
      linkCheck: `${out.linkCheck.good}/${out.linkCheck.total}`,
      createdAt: now
    })

    // 只把成稿里真正引用的条目记为已推送——模型看过但没选的留到明天
    const cited = citedItemIds(out.markdown, items)
    if (cited.length > 0) {
      store.items.markBriefed(cited, now, topic.id)
      markedBriefed = cited.length
    }
  } else {
    log('warn', `未写入简报：${save.detail}`)
  }

  return {
    kind: input.kind,
    collect: input.collect,
    briefOk: !out.degraded,
    degraded: out.degraded,
    title,
    droppedAsBriefed: input.droppedAsBriefed,
    filterOverridden: input.filterOverridden,
    save,
    markedBriefed,
    linkCheck: { good: out.linkCheck.good, total: out.linkCheck.total, rate: out.linkCheck.rate }
  }
}
