/**
 * OpenAI 兼容协议的对话适配器。
 *
 * DeepSeek 与 OpenAI 都能用它——两家的 `/chat/completions` 请求形状一致，
 * 差异只在 baseUrl、模型 id 与 key 的格式。协议差异由 `anthropic.ts` 单独处理。
 */
import type { ChatMessage, ChatModelInfo, ChatProvider, ChatRequest, ChatResult } from '../../core/ports/chat'

export interface OpenAICompatibleOptions {
  id: string
  baseUrl: string
  apiKey: string
  models: ChatModelInfo[]
}

interface ChatResponse {
  choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }>
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

export function createOpenAICompatibleChat(opts: OpenAICompatibleOptions): ChatProvider {
  const baseUrl = opts.baseUrl.replace(/\/$/, '')

  return {
    id: opts.id,
    listModels: () => opts.models,

    async chat(request: ChatRequest, signal?: AbortSignal): Promise<ChatResult> {
      if (!opts.apiKey) return { ok: false, reason: 'provider-error', detail: '未配置 API Key' }

      const body = {
        model: request.model,
        messages: request.messages.map((m: ChatMessage) => ({ role: m.role, content: m.content })),
        temperature: request.temperature ?? 0.4,
        max_tokens: request.maxTokens ?? 4_000,
        stream: false
      }

      let res: Response
      let text: string
      try {
        res = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${opts.apiKey}` },
          body: JSON.stringify(body),
          signal: signal ?? AbortSignal.timeout(180_000)
        })
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
      const choice = json.choices?.[0]
      const content = choice?.message?.content?.trim() ?? ''
      if (!content) {
        return {
          ok: false,
          reason: 'empty-output',
          detail: '模型没有返回正文',
          ...(choice?.finish_reason ? { finishReason: choice.finish_reason } : {})
        }
      }

      return {
        ok: true,
        text: content,
        model: request.model,
        usage: { input: json.usage?.prompt_tokens ?? 0, output: json.usage?.completion_tokens ?? 0 },
        ...(choice?.finish_reason ? { finishReason: choice.finish_reason } : {})
      }
    }
  }
}
