/**
 * DeepSeek 对话适配器。
 *
 * 它没有任何自己的协议逻辑：DeepSeek 走 OpenAI 兼容的 `/chat/completions`，
 * 所以实现就是 `createOpenAICompatibleChat` 的一次实例化。
 * 保留这个文件是为了让"DeepSeek 是一个供应商"这件事有一个明确的落点，
 * 而不是散落在调用方。
 */
import { createOpenAICompatibleChat } from './openai-compatible'
import { modelsOf, providerMeta } from '../../core/chat/providers'
import type { ChatModelInfo, ChatProvider } from '../../core/ports/chat'

export interface DeepSeekChatOptions {
  apiKey: string
  baseUrl?: string
}

/** 模型目录来自 core/chat/providers，避免两处各写一份 */
export const DEEPSEEK_MODELS: ChatModelInfo[] = modelsOf('deepseek')

export function createDeepSeekChat(opts: DeepSeekChatOptions): ChatProvider {
  const meta = providerMeta('deepseek')!
  return createOpenAICompatibleChat({
    id: 'deepseek',
    baseUrl: opts.baseUrl ?? meta.baseUrl,
    apiKey: opts.apiKey,
    models: DEEPSEEK_MODELS
  })
}
