/**
 * 成稿的提示词拼装与清洗。
 *
 * 从 deepseek.ts 里拆出来，是因为「素材 → 用户提示词」与「用哪家模型发请求」是两件事：
 * 前者是产品逻辑（决定模型看到什么），后者是协议细节。拆开之后，换供应商不用动提示词。
 */
import type { ComposeInput } from '../../core/ports/composer'

/** 素材 → 用户提示词。与 Python 版 build_user_prompt 等价 */
export function buildUserPrompt(input: ComposeInput, maxSummary = 240): string {
  const lines: string[] = [`以下是 ${input.items.length} 条候选素材（已按重要度排序）：`, '']
  input.items.forEach((it, i) => {
    const when = it.publishedAt
      ? new Date(it.publishedAt).toLocaleString('zh-CN', {
          timeZone: 'Asia/Shanghai',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit'
        })
      : '时间未知'
    const extra = it.alsoIn.length > 0 ? `（另见：${it.alsoIn.join('、')}）` : ''
    lines.push(
      `### 素材 ${i + 1}｜${input.bucketLabels[it.bucket]}｜${it.sourceName}｜${when}｜分数 ${it.score.toFixed(2)}${extra}`
    )
    lines.push(`标题：${it.title}`)
    if (it.summary) lines.push(`摘要：${it.summary.slice(0, maxSummary).replace(/\s+/g, ' ')}`)
    lines.push(`链接：${it.url}`)
    lines.push('')
  })
  return lines.join('\n')
}

/** 模型偶尔把整篇简报包在 ```markdown 里 */
export function stripFences(md: string): string {
  const t = md.trim()
  const m = /^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/.exec(t)
  return m ? m[1]!.trim() : t
}
