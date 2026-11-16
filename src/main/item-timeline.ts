/**
 * 把一条新闻变成时间线：检索 → 聚类 → 模型整理（失败则确定性时间线）。
 *
 * 模型只做"整理"，检索与引用校验都在本地；模型输出不可信时退回确定性版本。
 */
import type { Store } from '../core/ports/store'
import type { ChatProvider } from '../core/ports/chat'
import {
  buildDeterministicTimeline,
  buildTimelinePrompt,
  collectRelatedItems,
  parseTimelineJson,
  toTimelineRefs,
  type EventTimeline
} from '../app/event-timeline'
import { createProviderInstance, modelCatalog, resolveModel, type ProviderKeys } from './providers'
import { log } from './log'
import type { ProviderId } from '../core/chat/providers'

export interface TimelineDeps {
  keys: ProviderKeys
  overrides?: Partial<Record<ProviderId, string>>
}

function pickModel(
  deps: TimelineDeps,
  preferred?: string
): { provider: ChatProvider; model: string } | null {
  if (preferred) {
    const resolved = resolveModel(preferred, deps.keys, deps.overrides ?? {})
    if (resolved) {
      const provider = createProviderInstance(resolved.provider, resolved.key)
      if (provider) return { provider, model: preferred }
    }
  }
  const first = modelCatalog(deps.keys, deps.overrides ?? {})[0]
  if (!first) return null
  const provider = createProviderInstance(first.provider, deps.keys[first.provider] ?? '')
  return provider ? { provider, model: first.model.id } : null
}

export interface TimelineOutcome {
  timeline: EventTimeline
  model?: string
}

export async function composeItemTimeline(
  store: Store,
  deps: TimelineDeps,
  input: { itemId: string; text?: string; aliases?: string[]; model?: string; signal?: AbortSignal }
): Promise<TimelineOutcome | null> {
  const item = store.items.get(input.itemId)
  if (!item) return null

  const related = collectRelatedItems(store, {
    itemId: item.id,
    text: input.text ?? '',
    ...(input.aliases ? { aliases: input.aliases } : {}),
    limit: 40
  })
  if (related.groups.length === 0) return null

  const fallback = buildDeterministicTimeline(store, related.groups, item.title)
  const chat = pickModel(deps, input.model)
  if (!chat) return { timeline: { ...fallback, note: '未配置模型，先给你按报道日期整理的时间线' } }

  const refs = toTimelineRefs(store, related.groups.map((g) => g.main))
  const validIds = new Set(related.groups.flatMap((g) => g.ids))

  // 第一次给足上下文；模型返回空/无法校验时，用更少素材重试一次。
  // 素材太多时模型容易直接空输出，缩到 12 条通常能稳定出结果。
  const attempts = [refs.slice(0, 25), refs.slice(0, 12)]
  for (const [index, subset] of attempts.entries()) {
    const messages = buildTimelinePrompt(subset, related.keywords, item.title)
    try {
      const r = await chat.provider.chat(
        { model: chat.model, messages, maxTokens: 6000, temperature: 0.3 },
        input.signal
      )
      if (!r.ok || !r.text.trim()) {
        log('warn', `时间线整理失败（第 ${index + 1} 次）：${r.ok ? '空输出' : `${r.reason} ${r.detail}`}`)
        continue
      }
      const parsed = parseTimelineJson(r.text, validIds, item.title)
      if (!parsed) {
        log('warn', `时间线输出无法校验（第 ${index + 1} 次）：${r.text.slice(0, 400)}`)
        continue
      }
      return { timeline: { ...parsed, items: refs }, model: r.model }
    } catch {
      log('warn', `时间线整理异常（第 ${index + 1} 次）`)
    }
  }
  return { timeline: { ...fallback, note: '模型没有返回可用内容，先给你按日期整理的版本' } }
}
