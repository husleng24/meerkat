/**
 * Anthropic Messages 协议的对话适配器。
 *
 * 与 OpenAI 兼容协议的三处硬差异（这就是"协议差异"具体长什么样）：
 *  1. 鉴权是 `x-api-key` + 强制 `anthropic-version`，不是 `Authorization: Bearer`
 *  2. `system` 是**顶层字段**，不能塞进 messages 里
 *  3. 响应正文是 `content: [{type:'text', text}]` 数组，不是 `choices[0].message.content`
 *
 * 另外 `max_tokens` 是必填项——不传会被直接拒绝，所以这里给默认值兜底。
 */
import type { ChatModelInfo, ChatProvider, ChatRequest, ChatResult } from '../../core/ports/chat'

export interface AnthropicOptions {
  apiKey: string
  baseUrl?: string
  models: ChatModelInfo[]
  /** 便于测试替换；默认 2023-06-01 */
  version?: string
}

interface AnthropicResponse {
  stop_reason?: string
  content?: Array<{ type?: string; text?: string }>
  usage?: { input_tokens?: number; output_tokens?: number }
  error?: { message?: string; type?: string }
}

const DEFAULT_MAX_TOKENS = 4_000

export function createAnthropicChat(opts: AnthropicOptions): ChatProvider {
  const baseUrl = (opts.baseUrl ?? 'https://api.anthropic.com').replace(/\/$/, '')
  const version = opts.version ?? '2023-06-01'

  return {
    id: 'anthropic',
    listModels: () => opts.models,

    async chat(request: ChatRequest, signal?: AbortSignal): Promise<ChatResult> {
      if (!opts.apiKey) return { ok: false, reason: 'provider-error', detail: '未配置 API Key' }

      // system 抽到顶层；剩下的消息里如果出现相邻同角色，Anthropic 会拒绝，这里合并
      const system = request.messages
        .filter((m) => m.role === 'system')
        .map((m) => m.content)
        .join('\n\n')
      const merged: Array<{ role: 'user' | 'assistant'; content: string }> = []
      for (const m of request.messages) {
        if (m.role === 'system') continue
        const role = m.role === 'assistant' ? 'assistant' : 'user'
        const last = merged[merged.length - 1]
        if (last && last.role === role) last.content += `\n\n${m.content}`
        else merged.push({ role, content: m.content })
      }

      const body: Record<string, unknown> = {
        model: request.model,
        max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
        messages: merged
      }
      if (system) body['system'] = system
      if (request.temperature !== undefined) body['temperature'] = request.temperature

      let res: Response
      let text: string
      try {
        res = await fetch(`${baseUrl}/v1/messages`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': opts.apiKey,
            'anthropic-version': version
          },
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
        if (res.status === 429) return { ok: false, reason: 'rate-limit', detail: '模型限流（HTTP 429）' }
        if (res.status === 400 && /context|too long|maximum/i.test(text)) {
          return { ok: false, reason: 'context-overflow', detail: '上下文超出模型窗口' }
        }
        let detail = `HTTP ${res.status}`
        try {
          const err = JSON.parse(text) as AnthropicResponse
          if (err.error?.message) detail = err.error.message
        } catch {
          /* 保持状态码 */
        }
        return { ok: false, reason: 'provider-error', detail }
      }

      let json: AnthropicResponse
      try {
        json = JSON.parse(text) as AnthropicResponse
      } catch {
        return { ok: false, reason: 'provider-error', detail: '响应不是合法 JSON' }
      }
      const content = (json.content ?? [])
        .filter((b) => b.type === 'text' || b.type === undefined)
        .map((b) => b.text ?? '')
        .join('')
        .trim()
      if (!content) {
        return {
          ok: false,
          reason: 'empty-output',
          detail: '模型没有返回正文',
          ...(json.stop_reason ? { finishReason: json.stop_reason } : {})
        }
      }

      return {
        ok: true,
        text: content,
        model: request.model,
        usage: { input: json.usage?.input_tokens ?? 0, output: json.usage?.output_tokens ?? 0 },
        ...(json.stop_reason ? { finishReason: json.stop_reason } : {})
      }
    }
  }
}
