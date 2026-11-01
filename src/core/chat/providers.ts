/**
 * 模型供应商目录。
 *
 * 三个供应商，两种协议：
 *  - DeepSeek / OpenAI 走 OpenAI 兼容的 `/chat/completions`
 *  - Anthropic 走 `/v1/messages`（header 用 x-api-key、system 是顶层字段、内容是 block 数组）
 *
 * 模型 id 写死在这里是刻意的：它们是**协议细节**，不是用户设置。
 * 供应商下线模型时改这里一行即可——比在设置里塞一个自由输入框更不容易出事
 * （自由输入框最常见的结局是拼错一个字母，然后得到 404）。
 */
import type { ChatModelInfo } from '../ports/chat'

export type ProviderId = 'deepseek' | 'openai' | 'anthropic'
export type ProviderProtocol = 'openai-compatible' | 'anthropic'

export interface ProviderMeta {
  id: ProviderId
  label: string
  protocol: ProviderProtocol
  baseUrl: string
  /** 环境变量名：没在应用里存 key 时读它 */
  envVar: string
  /** 只做防呆：挡住明显不是 key 的粘贴内容，不校验真实性 */
  keyPattern: RegExp
  models: ChatModelInfo[]
}

export const PROVIDERS: ProviderMeta[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    protocol: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com',
    envVar: 'DEEPSEEK_API_KEY',
    keyPattern: /^sk-[A-Za-z0-9_-]{16,}$/,
    models: [
      { id: 'deepseek-flash', label: 'DeepSeek Flash', provider: 'deepseek', contextWindow: 1_048_576, tier: 'fast' },
      { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', provider: 'deepseek', contextWindow: 1_048_576, tier: 'deep' }
    ]
  },
  {
    id: 'openai',
    label: 'OpenAI',
    protocol: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    envVar: 'OPENAI_API_KEY',
    keyPattern: /^sk-[A-Za-z0-9_-]{16,}$/,
    models: [{ id: 'gpt-4o', label: 'GPT-4o', provider: 'openai', contextWindow: 128_000, tier: 'deep' }]
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    protocol: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    envVar: 'ANTHROPIC_API_KEY',
    keyPattern: /^sk-ant-[A-Za-z0-9_-]{16,}$/,
    models: [
      { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5', provider: 'anthropic', contextWindow: 200_000, tier: 'deep' }
    ]
  }
]

export function providerMeta(id: string): ProviderMeta | undefined {
  return PROVIDERS.find((p) => p.id === id)
}

/** 模型 id → 供应商：同一套会话里可以轮换不同厂商的模型 */
export function providerForModel(modelId: string): ProviderMeta | undefined {
  return PROVIDERS.find((p) => p.models.some((m) => m.id === modelId))
}

export function modelsOf(providerId: string): ChatModelInfo[] {
  return providerMeta(providerId)?.models ?? []
}
