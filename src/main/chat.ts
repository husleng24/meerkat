/**
 * 对话编排：取上下文 → 组消息 → 调模型 → 落库。
 *
 * 这一层是唯一持有 AbortController 的地方（chatLatch，与采集的闩分开）。
 * 与 runDaily 的区别：那边是"定时跑一整条流水线"，这边是"按需回一句话"，
 * 所以不复用 DailyOutcome 那套结构。
 */
import { createDeepSeekChat, DEEPSEEK_MODELS } from '../adapters/llm/deepseek-chat'
import { actionPrompt, CHAT_SYSTEM_PROMPT, type ChatActionId } from '../core/chat/actions'
import { buildChatContext, estimateTokens, type ChatContextSource } from '../core/chat/context'
import { chatLatch } from './run-control'
import { log } from './log'
import type { Store } from '../core/ports/store'
import type { ChatModelInfo, ChatMessage } from '../core/ports/chat'
import type { ChatStoredMessage, ChatThread } from '../core/domain/types'

export interface ChatDeps {
  apiKey: string
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

export const DEFAULT_CHAT_MODEL = 'deepseek-flash'
/** 历史消息只带最近这么多条：更早的用摘要替代（P2），现在直接截断 */
const HISTORY_LIMIT = 8

export function chatModels(): ChatModelInfo[] {
  return DEEPSEEK_MODELS
}

/** 取这个主题当前的简报（优先线程记录的日期，其次最新一期） */
function resolveBrief(store: Store, thread: ChatThread) {
  const byDate = thread.briefDate ? store.briefs.byDate(thread.briefDate, thread.topicId) : undefined
  return byDate ?? store.briefs.latest(thread.topicId)
}

export function threadContextSources(store: Store, thread: ChatThread, includePrevious: boolean): ChatContextSource[] {
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
    const brief = resolveBrief(store, thread)
    const sources = threadContextSources(store, thread, input.includePrevious === true)
    if (sources.length === 0) return { ok: false, error: '还没有简报可以作为上下文' }

    const context = buildChatContext(sources)
    const text = input.text.trim() || (input.actionId ? actionPrompt(input.actionId) : '')
    if (!text) return { ok: false, error: '消息是空的' }

    const model = input.model ?? thread.model ?? DEFAULT_CHAT_MODEL
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

    const provider = createDeepSeekChat({ apiKey: deps.apiKey })
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
    id: `ct-${now}`,
    title: '新对话',
    topicId: topic.id,
    ...(date ? { briefDate: date } : {}),
    model: input.model ?? DEFAULT_CHAT_MODEL,
    createdAt: now,
    updatedAt: now,
    archived: false
  }
  store.chat.create(thread)
  return thread
}

/** 界面显示"上下文 6.2k tokens"用 */
export function previewContextTokens(store: Store, threadId: string, includePrevious: boolean): number {
  const thread = store.chat.get(threadId)
  if (!thread) return 0
  const sources = threadContextSources(store, thread, includePrevious)
  if (sources.length === 0) return 0
  return estimateTokens(buildChatContext(sources).text)
}
