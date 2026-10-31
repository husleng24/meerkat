/**
 * 「每日一次」的完整流程：采集 → 过滤已推送 → 生成 → 受控落库 → 标记已推送。
 *
 * 依赖通过参数注入（apiKey / promptText），不直接 import electron——
 * 这样端到端脚本可以在普通 Node 里跑完整流程，包括"连跑两天"验证跨天去重。
 *
 * 两条保护性规则都在这里落地：
 *  - 跨天去重（brief-selection）：昨天推过的不再推，但剩得太少时放弃过滤
 *  - 覆盖保护（brief-save）：降级版不得覆盖完整版
 */
import { fetchSource } from '../adapters/sources'
import { createDeepSeekComposer } from '../adapters/llm/deepseek'
import { composeBrief, weekdayOf } from '../app/compose-brief'
import { runCollect, COLLECT_DEFAULTS, type CollectResult } from '../app/run-collect'
import { citedItemIds, filterAlreadyBriefed } from '../app/brief-selection'
import { decideSave, type SaveDecision } from '../app/brief-save'
import { log } from './log'
import type { Store } from '../core/ports/store'

export interface DailyDeps {
  apiKey: string
  promptText: string
}

export interface DailyOutcome {
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

export async function runDaily(store: Store, deps: DailyDeps, now = Date.now()): Promise<DailyOutcome> {
  const collect = await runCollect({ store, fetchSource }, { now, ...COLLECT_DEFAULTS })
  log(
    'info',
    `采集完成：${collect.nOk}/${collect.nSources} 源 · ${collect.nRaw} 原始 → ${collect.nKept} 条 · ${(collect.elapsedMs / 1000).toFixed(1)}s`
  )

  // ── 跨天去重 ──────────────────────────────────────────
  const briefed = store.items.briefedIds(now - BRIEFED_TTL_MS)
  const filtered = filterAlreadyBriefed(collect.items, briefed)

  const dateLabel = new Date(now).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })
  const composer = createDeepSeekComposer({
    apiKey: deps.apiKey,
    systemPrompt: deps.promptText,
    maxTokens: 32_000
  })

  const out = await composeBrief(composer, filtered.items, {
    now,
    windowHours: COLLECT_DEFAULTS.windowHours,
    dateLabel,
    weekday: weekdayOf(now),
    sourceStats: collect.sourceStats,
    elapsedMs: collect.elapsedMs
  })

  const title = `AI 简报 · ${dateLabel}（${weekdayOf(now)}）`
  log(
    'info',
    `简报生成：${out.degraded ? '降级（未接模型）' : out.model} · ${out.markdown.length} 字符 · ` +
      `链接校验 ${out.linkCheck.good}/${out.linkCheck.total}` +
      (out.issues.length > 0 ? ` · 结构问题：${out.issues.join('；')}` : '')
  )

  // ── 覆盖保护 ──────────────────────────────────────────
  const existing = store.briefs.byDate(dateLabel)
  const save = decideSave(existing, { degraded: out.degraded })

  let markedBriefed = 0
  if (save.write) {
    store.briefs.save({
      id: dateLabel,
      date: dateLabel,
      topicId: 'default',
      markdown: out.markdown,
      model: out.model,
      tokensIn: out.usage.input,
      tokensOut: out.usage.output,
      linkCheck: `${out.linkCheck.good}/${out.linkCheck.total}`,
      createdAt: now
    })

    // 只把成稿里真正引用的条目记为已推送——模型看过但没选的留到明天
    const cited = citedItemIds(out.markdown, filtered.items)
    if (cited.length > 0) {
      store.items.markBriefed(cited, now)
      markedBriefed = cited.length
    }
  } else {
    log('warn', `未写入简报：${save.detail}`)
  }

  return {
    collect,
    briefOk: !out.degraded,
    degraded: out.degraded,
    title,
    droppedAsBriefed: filtered.dropped,
    filterOverridden: filtered.overridden,
    save,
    markedBriefed,
    linkCheck: { good: out.linkCheck.good, total: out.linkCheck.total, rate: out.linkCheck.rate }
  }
}
