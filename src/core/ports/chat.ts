/**
 * 对话端口。
 *
 * 为什么不复用 Composer：Composer 的语义是"一次成稿"（输入素材 → 输出 markdown），
 * 对话的语义是"多轮消息 → 输出一段话"。把两者合成一个接口，会让
 * "重排简报"和"回答问题"共享一个无法描述自身意图的入参。
 *
 * 流式（P1）会在这个端口上加 `onDelta`；P0 先用非流式把链路跑通。
 */
export interface ChatModelInfo {
  id: string
  label: string
  provider: string
  /** 上下文窗口（tokens） */
  contextWindow: number
  /** 相对成本档位：fast 用于问答，deep 用于重排/长文 */
  tier: 'fast' | 'deep'
}

export type ChatRole = 'system' | 'user' | 'assistant'

export interface ChatMessage {
  role: ChatRole
  content: string
}

export interface ChatRequest {
  model: string
  messages: ChatMessage[]
  maxTokens?: number
  temperature?: number
}

export type ChatFailureReason = 'rate-limit' | 'context-overflow' | 'provider-error' | 'empty-output' | 'aborted'

export type ChatResult =
  | { ok: true; text: string; model: string; usage: { input: number; output: number } }
  | { ok: false; reason: ChatFailureReason; detail: string }

export interface ChatProvider {
  readonly id: string
  listModels(): ChatModelInfo[]
  chat(request: ChatRequest, signal?: AbortSignal): Promise<ChatResult>
}
