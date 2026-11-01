/**
 * DeepSeek 对话适配器（OpenAI 兼容的 /chat/completions）。
 *
 * 与 compose 用的适配器分开：那边是"素材 → 简报 markdown"，这边是"消息 → 一段回答"。
 * 合并会让 compose 的 prompt/截断/校验逻辑渗进对话，反之亦然。
 */
import type { ChatMessage, ChatModelInfo, ChatProvider, ChatRequest, ChatResult } from '../../core/ports/chat'

export interface DeepSeekChatOptions {
  apiKey: string
  baseUrl?: string
}

/** 模型目录写死在这里：来自 /models 的实测结果（1M 上下文、393k 最大输出） */
export const DEEPSEEK_MODELS: ChatModelInfo[] = [
  {
    id: 'deepseek-flash',
    label: 'DeepSeek Flash',
    provider: 'deepseek',
    contextWindow: 1_048_576,
    tier: 'fast'
  },
  {
    id: 'deepseek-v4-pro',
    label: 'DeepSeek V4 Pro',
    provider: 'deepseek',
    contextWindow: 1_048_576,
    tier: 'deep'
  }
]

interface ChatResponse {
  choices?: Array<{ message?: { content?: string | null } }>
  usage?: { prompt_tokens?: number; completion_tokens?: number }
  error?: { message?: string }
}

function classify(status: number, body: string): { reason: 'rate-limit' | 'context-overflow' | 'provider-error'; detail: string } {
  if (status === 429) return { reason: 'rate-limit', detail: '模型限流（HTTP 429）' }
  if (status === 400 && /context|too long|maximum/i.test(body)) {
    return { reason: 'context-overflow', detail: '上下文超出模型窗口' }
  }
  return { reason: 'provider-error', detail: `HTTP ${status}` }
}

export function createDeepSeekChat(opts: DeepSeekChatOptions): ChatProvider {
  const baseUrl = (opts.baseUrl ?? 'https://api.deepseek.com').replace(/\/$/, '')

  return {
    id: 'deepseek',
    listModels: () => DEEPSEEK_MODELS,

    async chat(request: ChatRequest, signal?: AbortSignal): Promise<ChatResult> {
      if (!opts.apiKey) {
        return { ok: false, reason: 'provider-error', detail: '未配置 API Key' }
      }
      const messages: ChatMessage[] = request.messages
      const body = {
        model: request.model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        temperature: request.temperature ?? 0.4,
        max_tokens: request.maxTokens ?? 4_000,
        stream: false
      }

      let res: Response
      try {
        res = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${opts.apiKey}`
          },
          body: JSON.stringify(body),
          signal: signal ?? AbortSignal.timeout(180_000)
        })
      } catch (e) {
        if (signal?.aborted || (e instanceof Error && e.name === 'AbortError')) {
          return { ok: false, reason: 'aborted', detail: '已取消' }
        }
        return { ok: false, reason: 'provider-error', detail: e instanceof Error ? e.message : String(e) }
      }

      let text: string
      try {
        text = await res.text()
      } catch (e) {
        if (signal?.aborted || (e instanceof Error && e.name === 'AbortError')) {
          return { ok: false, reason: 'aborted', detail: '已取消' }
        }
        return { ok: false, reason: 'provider-error', detail: e instanceof Error ? e.message : String(e) }
      }
      if (!res.ok) {
        const c = classify(res.status, text)
        return { ok: false, reason: c.reason, detail: c.detail }
      }

      let json: ChatResponse
      try {
        json = JSON.parse(text) as ChatResponse
      } catch {
        return { ok: false, reason: 'provider-error', detail: '响应不是合法 JSON' }
      }
      const content = json.choices?.[0]?.message?.content?.trim() ?? ''
      if (!content) {
        return { ok: false, reason: 'empty-output', detail: '模型没有返回正文' }
      }
      return {
        ok: true,
        text: content,
        model: request.model,
        usage: {
          input: json.usage?.prompt_tokens ?? 0,
          output: json.usage?.completion_tokens ?? 0
        }
      }
    }
  }
}
