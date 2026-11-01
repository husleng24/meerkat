/**
 * 用「对话供应商」实现「成稿」。
 *
 * 成稿与对话的差别只在提示词与输出处理（一个是素材清单、一个多轮消息），
 * HTTP 那一层完全一样。把这一层抽出来之后，成稿也能用任意已配置的供应商——
 * 只配了 OpenAI key 的机器不会因为没配 DeepSeek 就退化成"仅聚合"。
 */
import { buildUserPrompt, stripFences } from './compose-prompt'
import type { ComposeInput, Composer, ComposeResult } from '../../core/ports/composer'
import type { ChatProvider } from '../../core/ports/chat'

export interface ChatComposerOptions {
  provider: ChatProvider
  model: string
  /** 提示词模板：支持 {date} / {weekday} 占位 */
  systemPrompt: string
  temperature?: number
  maxTokens?: number
}

export function createChatComposer(opts: ChatComposerOptions): Composer {
  const temperature = opts.temperature ?? 0.55
  const maxTokens = opts.maxTokens ?? 16_000

  return {
    model: opts.model,
    async compose(input: ComposeInput, signal?: AbortSignal): Promise<ComposeResult> {
      const user = buildUserPrompt(input)
      const system = opts.systemPrompt
        .replace(/\{date\}/g, input.dateLabel)
        .replace(/\{weekday\}/g, input.weekday)

      const res = await opts.provider.chat(
        {
          model: opts.model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user }
          ],
          temperature,
          maxTokens
        },
        signal
      )

      if (!res.ok) {
        // 供应商层的分类直接映射成成稿层的分类，界面与日志的措辞不变
        const reason =
          res.reason === 'rate-limit'
            ? 'rate-limit'
            : res.reason === 'context-overflow'
              ? 'context-overflow'
              : res.reason === 'empty-output' && res.finishReason === 'length'
                ? 'context-overflow'
                : res.reason === 'aborted'
                  ? 'aborted'
                  : 'provider-error'
        return { ok: false, reason, detail: res.detail }
      }

      const markdown = stripFences(res.text)
      if (!markdown) return { ok: false, reason: 'empty-output', detail: '模型没有返回正文' }

      return {
        ok: true,
        markdown,
        usage: res.usage,
        model: res.model,
        ...(res.finishReason ? { finishReason: res.finishReason } : {})
      }
    }
  }
}

/** 没有任何供应商可用时的兜底：让 composeBrief 走降级路径，而不是抛异常 */
export function createNoopComposer(model = 'none'): Composer {
  return {
    model,
    async compose() {
      return { ok: false, reason: 'no-key', detail: '未配置任何模型 API Key' }
    }
  }
}
