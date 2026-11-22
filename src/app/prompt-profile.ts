/**
 * 主题 → 实际使用的提示词。
 *
 * 内置模板仍放 resources/prompts；自定义 profile 存 DB 并带版本。
 * 这里只做解析与变量渲染，不读文件、不碰 Electron。
 */
import type { Store } from '../core/ports/store'
import type { Topic } from '../core/domain/types'

export const BUILTIN_PROMPT_ID = 'builtin'

export const PROMPT_VARIABLES = ['{topic}', '{date}', '{weekday}', '{editorialFocus}'] as const

export interface PromptVars {
  topic: string
  date: string
  weekday: string
  editorialFocus?: string
}

export function promptTextForTopic(store: Store, topic: Topic, fallback: string): string {
  if (!topic.promptProfileId) return fallback
  return store.prompts.get(topic.promptProfileId)?.systemMd ?? fallback
}

/** 预览用：把变量替换成示例值 */
export function renderPromptTemplate(md: string, vars: PromptVars): string {
  return md
    .replace(/\{topic\}/g, vars.topic)
    .replace(/\{date\}/g, vars.date)
    .replace(/\{weekday\}/g, vars.weekday)
    .replace(/\{editorialFocus\}/g, vars.editorialFocus?.trim() || '（未设置，按通用编辑标准）')
}

/** 保存前的轻量检查；不阻止保存，只给提示 */
export function promptWarnings(md: string): string[] {
  const out: string[] = []
  if (!md.trim()) out.push('提示词不能为空')
  if (!md.includes('{topic}')) out.push('缺少 {topic}，标题不会带主题名')
  if (!md.includes('{editorialFocus}')) out.push('缺少 {editorialFocus}，主题的编辑重点不会生效')
  if (!/三句话速览/.test(md)) out.push('没有要求「三句话速览」，简报结构可能不完整')
  if (!/链接/.test(md)) out.push('没有链接约束，模型可能编造 URL（代码仍会校验）')
  return out
}
