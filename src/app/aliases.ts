/**
 * 事件别名：让"辞职"也能匹配到"卸任 / resign"，让"黄仁勋"也能匹配 Jensen Huang。
 *
 * 规则先给一份保底（标题里的实体词），模型只做增强；模型不可用/输出不合法时
 * 绝不能阻断跟踪。别名会直接用于 FTS 检索，所以必须过滤掉指令词和过长的句子。
 */
import type { ChatMessage } from '../core/ports/chat'
import { extractKeywords } from './event-timeline'

const MAX_ALIASES = 10
const MIN_LEN = 2
const MAX_LEN = 40

/** 评论/指令里的词不是实体，混进别名会误匹配 */
const NOISE = /(agent|meerkat|跟踪|追踪|盯着|关注|告诉|提醒|整理|时间线|进展|帮我|这件事|一下)/i
/** 模型偶尔把标题里的通用动词也当别名，单独过滤掉 */
const GENERIC = /^(introducing|announcing|launches|launch|new|update|live|breaking|the|a|an|and|with|other|tech|execs|sign|calling|says|said|report)$/i

export function cleanAliases(values: string[]): string[] {
  const out: string[] = []
  for (const raw of values) {
    const v = raw.trim().replace(/^["'“”]+|["'“”]+$/g, '')
    if (v.length < MIN_LEN || v.length > MAX_LEN) continue
    if (NOISE.test(v) || GENERIC.test(v)) continue
    // 单个英文词（Elon / Musk / other）太容易误匹配：要么是 5 字母以上的实体，要么保留全名短语
    if (/^[\x20-\x7E]+$/.test(v) && !v.includes(' ') && v.length < 5) continue
    if (!out.includes(v)) out.push(v)
  }
  return out.slice(0, MAX_ALIASES)
}

export function fallbackAliases(title: string): string[] {
  return cleanAliases(extractKeywords(title))
}

/** 把标题实体和模型给的别名合并去重，实体词优先 */
export function mergeAliases(base: string[], extra: string[]): string[] {
  return cleanAliases([...base, ...extra])
}

const ALIAS_SYSTEM = `你在为一个新闻跟踪功能生成检索别名。只输出 JSON 字符串数组，不要解释。
要求：
1. 覆盖同一事件的不同说法（如 辞职/卸任/离职/resign）。
2. 人名、公司名给出中英文写法（如 黄仁勋 / Jensen Huang；英伟达 / NVIDIA）。
3. 每条 2-40 个字符，最多 8 条。
4. 英文只给完整人名/公司名或事件短语，不要给 other / tech / execs / sign 这类单个通用词。
5. 不要包含"跟踪""帮我盯着"这类指令词。`

export function buildAliasPrompt(title: string, summary: string): ChatMessage[] {
  return [
    { role: 'system', content: ALIAS_SYSTEM },
    { role: 'user', content: `标题：${title}\n摘要：${summary.slice(0, 200)}` }
  ]
}

export function parseAliasesJson(raw: string): string[] {
  const text = raw.trim().replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```$/, '')
  try {
    const data: unknown = JSON.parse(text)
    if (!Array.isArray(data)) return []
    return cleanAliases(data.filter((x): x is string => typeof x === 'string'))
  } catch {
    return []
  }
}
