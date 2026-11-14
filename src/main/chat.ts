/**
 * 对话编排：取上下文 → 组消息 → 调模型 → 落库。
 *
 * 这一层是唯一持有 AbortController 的地方（chatLatch，与采集的闩分开）。
 * 与 runDaily 的区别：那边是"定时跑一整条流水线"，这边是"按需回一句话"，
 * 所以不复用 DailyOutcome 那套结构。
 */
import { actionPrompt, CHAT_SYSTEM_PROMPT, type ChatActionId } from '../core/chat/actions'
import { PROVIDERS, providerMeta, type ProviderId } from '../core/chat/providers'
import {
  createProviderInstance,
  modelCatalog,
  readModelOverrides,
  resolveModel,
  type ProviderKeys
} from './providers'
import { buildChatContext, estimateTokens, type ChatContextSource } from '../core/chat/context'
import { chatLatch } from './run-control'
import { composeItemTimeline } from './item-timeline'
import { collectRelatedItems } from '../app/event-timeline'
import { classifyIntent, hasAgentMention, stripMention } from '../app/agent-intent'
import { createStoryFromItem, setStoryStatus } from '../app/story-tracking'
import { log } from './log'
import type { Store } from '../core/ports/store'
import type { ChatModelInfo, ChatMessage } from '../core/ports/chat'
import type { ChatStoredMessage, ChatThread } from '../core/domain/types'

export interface ChatDeps {
  /** 已配置 key 的供应商；聊天只在这些里面选模型 */
  keys: ProviderKeys
  /** 用户覆盖的模型 id（设置里改） */
  overrides?: Partial<Record<ProviderId, string>>
}

function overridesOf(deps: ChatDeps, store?: Store): Partial<Record<ProviderId, string>> {
  return deps.overrides ?? (store ? readModelOverrides(store) : {})
}

export interface SendInput {
  threadId: string
  text: string
  actionId?: ChatActionId
  model?: string
  /** 是否把上一期简报也带进上下文 */
  includePrevious?: boolean
}

export interface SendResult {
  ok: boolean
  user?: ChatStoredMessage
  assistant?: ChatStoredMessage
  error?: string
  /** 本次上下文估算的 token 数，界面用来显示成本 */
  estimatedTokens?: number
  model?: string
}

/** 默认模型：取第一个有 key 的供应商的第一个（可能被覆盖的）模型 */
export function defaultChatModel(deps: ChatDeps): string {
  const first = modelCatalog(deps.keys, deps.overrides ?? {})[0]
  if (first) return first.model.id
  for (const p of PROVIDERS) {
    if (deps.keys[p.id]) return p.models[0]!.id
  }
  return 'deepseek-flash'
}
/** 历史消息只带最近这么多条：更早的用摘要替代（P2），现在直接截断 */
const HISTORY_LIMIT = 8

/** 只返回已配置 key 的供应商的模型：界面上不该出现"选了也发不出去"的选项 */
export function chatModels(deps: ChatDeps): ChatModelInfo[] {
  return modelCatalog(deps.keys, deps.overrides ?? {}).map((c) => c.model)
}

/** 取这个主题当前的简报（优先线程记录的日期，其次最新一期） */
function resolveBrief(store: Store, thread: ChatThread) {
  const byDate = thread.briefDate ? store.briefs.byDate(thread.briefDate, thread.topicId) : undefined
  return byDate ?? store.briefs.latest(thread.topicId)
}

export function threadContextSources(store: Store, thread: ChatThread, includePrevious: boolean): ChatContextSource[] {
  // 条目评论串：上下文是这条新闻与同一事件的其他报道，而不是某一天的简报
  if (thread.scope === 'item' && thread.itemId) {
    const item = store.items.get(thread.itemId)
    if (!item) return []
    const related = collectRelatedItems(store, { itemId: item.id })
    return related.items.slice(0, 12).map((it) => ({
      kind: 'items' as const,
      label: it.title,
      text: `标题：${it.title}\n摘要：${it.summary}\n链接：${it.url}`
    }))
  }
  const brief = resolveBrief(store, thread)
  if (!brief) return []
  const sources: ChatContextSource[] = [
    { kind: 'brief', label: `今日简报 · ${brief.date}`, text: brief.markdown, structured: true }
  ]
  if (includePrevious) {
    const prev = store.briefs.list(60, thread.topicId).find((b) => b.date < brief.date)
    if (prev) {
      sources.push({ kind: 'previous', label: `上一期简报 · ${prev.date}`, text: prev.markdown, structured: true })
    }
  }
  return sources
}

export async function sendChatMessage(store: Store, deps: ChatDeps, input: SendInput): Promise<SendResult> {
  const thread = store.chat.get(input.threadId)
  if (!thread) return { ok: false, error: '会话不存在' }

  const handle = chatLatch.begin()
  if (!handle) return { ok: false, error: '上一条还在回复中' }

  try {
    let text = input.text.trim() || (input.actionId ? actionPrompt(input.actionId) : '')
    if (!text) return { ok: false, error: '消息是空的' }

    // 条目评论里 @agent：先分意图，再决定是问答 / 一次性时间线 / 持续跟踪
    if (thread.scope === 'item' && thread.itemId && hasAgentMention(text)) {
      const intent = classifyIntent(text)

      // 只是提问：剥掉 mention，走普通问答，不落 story
      if (intent === 'ask') {
        text = stripMention(text)
        if (!text) return { ok: false, error: '想问什么？' }
      } else {
        const now0 = Date.now()
        const userMessage: ChatStoredMessage = {
          id: `cm-${now0}-u`,
          threadId: thread.id,
          role: 'user',
          content: text,
          contextJson: JSON.stringify({ itemId: thread.itemId, intent }),
          createdAt: now0
        }
        store.chat.addMessage(userMessage)

        if (intent === 'untrack') {
          const story = store.stories.byThread(thread.id)
          if (story) setStoryStatus(store, story.id, 'archived')
          const stopped: ChatStoredMessage = {
            id: `cm-${Date.now()}-a`,
            threadId: thread.id,
            role: 'assistant',
            content: story ? `已停止跟踪「${story.title}」。之后不会再检查新进展。` : '这个评论串目前没有在跟踪的事件。',
            contextJson: JSON.stringify({ tracking: 'stopped', ...(story ? { storyId: story.id } : {}) }),
            createdAt: Date.now()
          }
          store.chat.addMessage(stopped)
          return { ok: true, user: userMessage, assistant: stopped, estimatedTokens: 0 }
        }

        // track：没有就建；已有就复用，顺带刷新一次时间线
        let story = store.stories.byThread(thread.id)
        if (intent === 'track' && !story) {
          const created = createStoryFromItem(store, {
            itemId: thread.itemId,
            threadId: thread.id,
            topicId: thread.topicId,
            text
          })
          if (created) {
            store.stories.create(created)
            store.stories.addItems(created.id, [thread.itemId], now0)
            story = store.stories.get(created.id)
          }
        }

        const outcome = await composeItemTimeline(store, deps, {
          itemId: thread.itemId,
          text,
          model: input.model ?? thread.model,
          ...(handle.controller.signal ? { signal: handle.controller.signal } : {})
        })
        if (!outcome) return { ok: false, error: '找不到这条新闻，无法整理时间线' }

        const now = Date.now()
        const tracking = intent === 'track' && story ? 'active' : undefined
        const content =
          (outcome.timeline.summary ??
            `已整理「${outcome.timeline.title}」的时间线，共 ${outcome.timeline.phases.length} 个节点。`) +
          (tracking ? ' 已开始跟踪这件事，有新进展会追加到这个评论串。' : '')
        const assistant: ChatStoredMessage = {
          id: `cm-${now}-a`,
          threadId: thread.id,
          role: 'assistant',
          content,
          ...(outcome.model ? { model: outcome.model } : {}),
          contextJson: JSON.stringify({
            timeline: outcome.timeline,
            ...(story ? { storyId: story.id } : {}),
            ...(tracking ? { tracking } : {})
          }),
          createdAt: now
        }
        store.chat.addMessage(assistant)
        store.chat.update(thread.id, {
          ...(outcome.timeline.title ? { title: outcome.timeline.title.slice(0, 20) } : {}),
          updatedAt: now
        })
        return { ok: true, user: userMessage, assistant, estimatedTokens: 0, ...(outcome.model ? { model: outcome.model } : {}) }
      }
    }

    const brief = resolveBrief(store, thread)
    const sources = threadContextSources(store, thread, input.includePrevious === true)
    if (sources.length === 0) {
      return { ok: false, error: thread.scope === 'item' ? '这条新闻还没有可用于问答的素材' : '还没有简报可以作为上下文' }
    }

    const context = buildChatContext(sources)

    const model = input.model ?? thread.model ?? defaultChatModel(deps)
    const now = Date.now()
    const userMessage: ChatStoredMessage = {
      id: `cm-${now}-u`,
      threadId: thread.id,
      role: 'user',
      content: text,
      contextJson: JSON.stringify({
        brief: brief?.date,
        sources: context.sources.map((s) => s.label)
      }),
      createdAt: now
    }
    store.chat.addMessage(userMessage)
    if (store.chat.messages(thread.id).length === 1) {
      // 第一条消息顺便给会话起名，列表里能认出来
      store.chat.update(thread.id, { title: text.slice(0, 16), model, updatedAt: now })
    } else {
      store.chat.update(thread.id, { model, updatedAt: now })
    }

    const history = store.chat
      .messages(thread.id)
      .slice(0, -1)
      .slice(-HISTORY_LIMIT)
      .map<ChatMessage>((m) => ({ role: m.role, content: m.content }))

    const messages: ChatMessage[] = [
      { role: 'system', content: CHAT_SYSTEM_PROMPT },
      { role: 'system', content: `以下是用户正在阅读的简报内容：\n\n${context.text}` },
      ...history,
      { role: 'user', content: text }
    ]

    const resolved = resolveModel(model, deps.keys, overridesOf(deps, store))
    if (!resolved) {
      const meta = providerMeta(model.split('-')[0] ?? '')
      return {
        ok: false,
        error: meta ? `${meta.label} 还没有配置 API Key` : `未知模型：${model}`
      }
    }
    const provider = createProviderInstance(resolved.provider, resolved.key)
    if (!provider) return { ok: false, error: `${resolved.provider} 适配器不可用` }
    const result = await provider.chat(
      {
        model,
        messages,
        // 重排要吐出整篇简报，给足输出；问答不需要那么长
        maxTokens: input.actionId === 'reorder' ? 8_000 : 2_000,
        temperature: input.actionId === 'reorder' ? 0.3 : 0.5
      },
      handle.controller.signal
    )

    if (!result.ok) {
      log('warn', `对话失败：${result.reason} ${result.detail}`)
      return {
        ok: false,
        error: result.reason === 'aborted' ? '已取消' : result.detail,
        estimatedTokens: context.estimatedTokens
      }
    }

    const assistant: ChatStoredMessage = {
      id: `cm-${Date.now()}-a`,
      threadId: thread.id,
      role: 'assistant',
      content: result.text,
      model: result.model,
      tokensIn: result.usage.input,
      tokensOut: result.usage.output,
      createdAt: Date.now()
    }
    store.chat.addMessage(assistant)
    store.chat.update(thread.id, { model: result.model, updatedAt: assistant.createdAt })

    return {
      ok: true,
      user: userMessage,
      assistant,
      estimatedTokens: context.estimatedTokens,
      model: result.model
    }
  } catch (e) {
    // 取消可能在 fetch 之外的地方冒出来（例如读 body 时被 abort）
    if (handle.controller.signal.aborted || (e instanceof Error && e.name === 'AbortError')) {
      return { ok: false, error: '已取消' }
    }
    const detail = e instanceof Error ? e.message : String(e)
    log('error', `对话异常：${detail}`)
    return { ok: false, error: detail }
  } finally {
    chatLatch.end(handle)
  }
}

/** 打开面板时用：确保这个主题今天就一段会话 */
export function ensureThread(
  store: Store,
  input: { topicId: string; briefDate?: string; model?: string }
): ChatThread | null {
  const topic = store.topics.get(input.topicId)
  if (!topic) return null
  const brief = input.briefDate ? store.briefs.byDate(input.briefDate, topic.id) : store.briefs.latest(topic.id)
  const date = brief?.date ?? input.briefDate ?? ''
  const existing = date ? store.chat.findByDate(topic.id, date) : undefined
  if (existing) return existing

  const now = Date.now()
  const thread: ChatThread = {
    // 同一毫秒内建两段会话时 id 不能撞：加一小段随机后缀
    id: `ct-${now}-${Math.random().toString(36).slice(2, 8)}`,
    title: '新对话',
    topicId: topic.id,
    scope: 'brief',
    ...(date ? { briefDate: date } : {}),
    model: input.model ?? defaultChatModel({ keys: {} }),
    createdAt: now,
    updatedAt: now,
    archived: false
  }
  store.chat.create(thread)
  return thread
}

/**
 * 某条新闻的评论串。一个条目一段，和当天的简报对话分开。
 * 没有条目就直接返回 null——评论必须挂在真实条目上。
 */
export function ensureItemThread(
  store: Store,
  input: { topicId: string; itemId: string; model?: string }
): ChatThread | null {
  const topic = store.topics.get(input.topicId)
  const item = store.items.get(input.itemId)
  if (!topic || !item) return null

  const existing = store.chat.findByItem(topic.id, item.id)
  if (existing) return existing

  const now = Date.now()
  const thread: ChatThread = {
    id: `ct-${now}-${Math.random().toString(36).slice(2, 8)}`,
    title: item.title.slice(0, 20),
    topicId: topic.id,
    scope: 'item',
    itemId: item.id,
    model: input.model ?? defaultChatModel({ keys: {} }),
    createdAt: now,
    updatedAt: now,
    archived: false
  }
  store.chat.create(thread)
  return thread
}

/**
 * 会话是否基于旧版简报。
 *
 * 简报可以在对话之后被"立即采集 / 重新成稿"覆盖，而历史消息里的结论是针对旧内容的。
 * 静默不管会让用户拿着过期的回答当依据——所以界面要能看见这个事实。
 */
export function threadBriefStale(store: Store, thread: ChatThread): boolean {
  const brief = resolveBrief(store, thread)
  if (!brief) return false
  return brief.createdAt > thread.createdAt
}

/** 界面显示"上下文 6.2k tokens"用 */
export function previewContextTokens(store: Store, threadId: string, includePrevious: boolean): number {
  const thread = store.chat.get(threadId)
  if (!thread) return 0
  const sources = threadContextSources(store, thread, includePrevious)
  if (sources.length === 0) return 0
  return estimateTokens(buildChatContext(sources).text)
}
