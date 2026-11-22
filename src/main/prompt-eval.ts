/**
 * 提示词试跑：用最近素材走一遍成稿，但不落库、不标记已读。
 *
 * 目的是在保存/发布前回答两个问题：
 *  - 这份提示词在这批素材上写出了什么？
 *  - 链接是否都来自素材、引用了多少条、结构是否完整？
 */
import type { Store } from '../core/ports/store'
import type { SelectionPolicy } from '../core/domain/types'
import { applySelectionPolicy, resolveSelectionPolicy } from '../app/selection-policy'
import { promptTextForTopic } from '../app/prompt-profile'
import { extractUrls } from '../app/brief-selection'
import { composeBrief, weekdayOf, type BriefItem, type ComposeBriefContext } from '../app/compose-brief'
import { createChatComposer, createNoopComposer } from '../adapters/llm/chat-composer'
import { createProviderInstance } from './providers'
import { collectReusableItems, type DailyDeps } from './daily'

export interface DryRunInput {
  topicId: string
  systemMd?: string
  profileId: string
  profileName: string
  profileVersion: number
  selectionPolicy?: Partial<SelectionPolicy>
}

export interface DryRunResult {
  markdown: string
  model: string
  degraded: boolean
  issues: string[]
  metrics: Record<string, number>
  profileId: string
  profileName: string
  profileVersion: number
  usedItems: number
}

export async function dryRunPrompt(
  store: Store,
  deps: DailyDeps,
  input: DryRunInput
): Promise<{ ok: true; result: DryRunResult } | { ok: false; error: string }> {
  const topic = store.topics.get(input.topicId)
  if (!topic) return { ok: false, error: '主题不存在' }

  const policy = resolveSelectionPolicy(input.selectionPolicy ?? topic.selectionPolicy)
  const pool = collectReusableItems(store, topic.id, Date.now(), policy.windowHours)
  const items = applySelectionPolicy(pool.items, policy)
  if (items.length === 0) return { ok: false, error: '最近窗口内没有可用素材，先跑一次采集' }

  const target = deps.compose
  const provider = target ? createProviderInstance(target.provider, target.key) : null
  const composer =
    target && provider
      ? createChatComposer({
          provider,
          model: target.model,
          systemPrompt: input.systemMd?.trim() || promptTextForTopic(store, topic, deps.promptText),
          maxTokens: 16_000
        })
      : createNoopComposer()

  const ctx: ComposeBriefContext = {
    now: Date.now(),
    windowHours: policy.windowHours,
    dateLabel: new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }),
    weekday: weekdayOf(Date.now()),
    topicName: topic.name,
    policy,
    ...(topic.editorialFocus ? { editorialFocus: topic.editorialFocus } : {}),
    sourceStats: pool.sourceStats,
    elapsedMs: 0
  }

  try {
    const out = await composeBrief(composer, items, ctx)
    const cited = new Set(extractUrls(out.markdown))
    const citedCount = (items as BriefItem[]).filter((it) => cited.has(it.url)).length
    return {
      ok: true,
      result: {
        markdown: out.markdown,
        model: out.model,
        degraded: out.degraded,
        issues: out.issues,
        metrics: {
          items: items.length,
          cited: citedCount,
          links: out.linkCheck.total,
          linkRate: Math.round(out.linkCheck.rate * 100),
          sections: out.markdown.split('\n').filter((l) => /^##\s/.test(l)).length,
          chars: out.markdown.length,
          truncated: out.truncated ? 1 : 0
        },
        profileId: input.profileId,
        profileName: input.profileName,
        profileVersion: input.profileVersion,
        usedItems: items.length
      }
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
