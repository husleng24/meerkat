/** 内置成稿提示词的加载与缓存；自定义 profile 由 store 提供 */
import { readFileSync } from 'node:fs'
import { resourcePath } from './paths'

let cached: string | null = null

export function loadBuiltinPrompt(): string {
  if (cached !== null) return cached
  try {
    cached = readFileSync(resourcePath('prompts/compose.zh.md'), 'utf8')
  } catch {
    cached = '你是一份行业日报的主编。只使用素材里的事实，链接必须逐字复制素材里的 URL。'
  }
  return cached
}
