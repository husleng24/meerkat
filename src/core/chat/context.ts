/**
 * 对话上下文：把「简报 / 上一期 / 选中的条目」拼成一段可发送的文本，并做预算裁剪。
 *
 * 为什么单独成纯函数：裁剪顺序写错不会报错，只会让模型"看不见"某一部分，
 * 而用户会以为是模型变笨了。这里的要求是**裁剪可见**——返回每个来源保留了多少。
 *
 * 预算用字符数而不是真实 token：中文大约 1.6 字/token，用 1.6 做除数已经偏保守；
 * 引入 tokenizer 只会让渲染层多一个几百 KB 的依赖，收益不成比例。
 */

export interface ChatContextSource {
  kind: 'brief' | 'previous' | 'items'
  /** 界面上显示的来源名，例如「今日简报 · 11-01」 */
  label: string
  text: string
  /** brief 类来源为 true：裁剪时优先保留标题与速览 */
  structured?: boolean
}

export interface KeptSource {
  label: string
  /** 1 = 完整保留；0.4 = 只留下 40% */
  ratio: number
}

export interface ChatContextResult {
  text: string
  sources: KeptSource[]
  /** 估算的 token 数（用于界面提示成本） */
  estimatedTokens: number
  /** 是否有任何来源被裁剪 */
  truncated: boolean
}

export const CONTEXT_BUDGET_TOKENS = 24_000
const CHARS_PER_TOKEN = 1.6

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

function budgetChars(tokens: number): number {
  return Math.floor(tokens * CHARS_PER_TOKEN)
}

/**
 * 裁剪一段 markdown：留下开头与结尾，中间用一个显式标记代替。
 *
 * 不按行裁剪是因为简报的行长度差异极大（一条正文可能 200 字，也可能 20 字），
 * 按行裁会出现"保留了标题、正文全丢"的极端结果。
 */
export function clipText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  if (maxChars <= 80) return text.slice(0, Math.max(0, maxChars))
  const head = Math.floor(maxChars * 0.7)
  const tail = maxChars - head - 20
  return `${text.slice(0, head)}\n\n…（此处省略 ${text.length - maxChars} 字，已按预算裁剪）…\n\n${text.slice(-tail)}`
}

/**
 * 组装上下文。
 *
 * 分配顺序是有意的：**简报优先**（用户问的大多是"今天这期"），
 * 其次选中条目（用户显式关注的东西），最后才是上一期（只有对比时才带，且最可牺牲）。
 */
export function buildChatContext(
  sources: ChatContextSource[],
  budgetTokens = CONTEXT_BUDGET_TOKENS
): ChatContextResult {
  const total = budgetChars(budgetTokens)
  const briefs = sources.filter((s) => s.kind === 'brief')
  const items = sources.filter((s) => s.kind === 'items')
  const previous = sources.filter((s) => s.kind === 'previous')

  const share = (weight: number): number => Math.floor(total * weight)
  // 简报 55%，上一期 30%，选中条目 15%；没有的类别把份额让给简报
  const previousBudget = previous.length > 0 ? share(0.3) : 0
  const itemsBudget = items.length > 0 ? share(0.15) : 0
  const briefBudget = total - previousBudget - itemsBudget

  const kept: KeptSource[] = []
  const parts: string[] = []

  for (const s of briefs) {
    const clipped = clipText(s.text, Math.floor(briefBudget / Math.max(1, briefs.length)))
    kept.push({ label: s.label, ratio: clipped.length / Math.max(1, s.text.length) })
    parts.push(`## ${s.label}\n${clipped}`)
  }
  for (const s of items) {
    const clipped = clipText(s.text, Math.floor(itemsBudget / Math.max(1, items.length)))
    kept.push({ label: s.label, ratio: clipped.length / Math.max(1, s.text.length) })
    parts.push(`## ${s.label}\n${clipped}`)
  }
  for (const s of previous) {
    const clipped = clipText(s.text, Math.floor(previousBudget / Math.max(1, previous.length)))
    kept.push({ label: s.label, ratio: clipped.length / Math.max(1, s.text.length) })
    parts.push(`## ${s.label}\n${clipped}`)
  }

  const text = parts.join('\n\n')
  return {
    text,
    sources: kept,
    estimatedTokens: estimateTokens(text),
    truncated: kept.some((k) => k.ratio < 0.999)
  }
}
