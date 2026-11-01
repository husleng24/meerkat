/**
 * DeepSeek 成稿适配器。
 *
 * 现在是「DeepSeek 供应商 + 通用成稿组合器」的组合——DeepSeek 的协议就是 OpenAI 兼容，
 * 没必要为它单独维护一套请求代码。保留这个文件是为了让 `resolveApiKey()` 与
 * `DEEPSEEK_MODELS` 有一个明确的归属。
 */
import { createOpenAICompatibleChat } from './openai-compatible'
import { createChatComposer } from './chat-composer'
import { modelsOf, providerMeta } from '../../core/chat/providers'
import type { Composer } from '../../core/ports/composer'
import type { ChatModelInfo } from '../../core/ports/chat'

export { buildUserPrompt } from './compose-prompt'

export interface DeepSeekOptions {
  apiKey: string
  /** 外部注入的 prompt 文本（来自 resources/prompts/compose.zh.md） */
  systemPrompt: string
  baseUrl?: string
  model?: string
  temperature?: number
  maxTokens?: number
}

/** 模型目录来自 core/chat/providers，避免两处各写一份 */
export const DEEPSEEK_MODELS: ChatModelInfo[] = modelsOf('deepseek')

export function createDeepSeekComposer(opts: DeepSeekOptions): Composer {
  const meta = providerMeta('deepseek')!
  const provider = createOpenAICompatibleChat({
    id: 'deepseek',
    baseUrl: opts.baseUrl ?? meta.baseUrl,
    apiKey: opts.apiKey,
    models: DEEPSEEK_MODELS
  })
  return createChatComposer({
    provider,
    model: opts.model ?? 'deepseek-flash',
    systemPrompt: opts.systemPrompt,
    ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
    ...(opts.maxTokens !== undefined ? { maxTokens: opts.maxTokens } : {})
  })
}

/** 从环境变量或 ~/.dsh/.credentials.yaml 取 key（与 Python 版一致的两级兜底） */
export function resolveApiKey(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env['DEEPSEEK_API_KEY']?.trim()
  if (fromEnv) return fromEnv
  try {
    // 延迟 require，避免在渲染进程/测试环境里强依赖 fs
    const { readFileSync } = require('node:fs') as typeof import('node:fs')
    const { homedir } = require('node:os') as typeof import('node:os')
    const { join } = require('node:path') as typeof import('node:path')
    const p = join(homedir(), '.dsh', '.credentials.yaml')
    const txt = readFileSync(p, 'utf8')
    const m = /DEEPSEEK_API_KEY\s*:\s*['"]?(sk-[A-Za-z0-9_-]+)/.exec(txt)
    return m ? m[1]! : ''
  } catch {
    return ''
  }
}
