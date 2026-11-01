import { describe, it, expect } from 'vitest'
import { buildChatContext, clipText, estimateTokens } from '../src/core/chat/context'
import { actionPrompt, visibleActions, CHAT_ACTIONS } from '../src/core/chat/actions'

const brief = `# AI 简报 · 2026-11-01（周日）

> 覆盖最近 48 小时

## 三句话速览

1. 第一条速览
2. 第二条速览

## ① 模型与产品

- **甲事件（10-31）** 甲的正文。[A](https://example.com/a)
- **乙事件（10-31）** 乙的正文。[B](https://example.com/b)
`

const previous = more(3000)

/** 造一段有辨识度的长文本，用来观察裁剪落在哪里 */
function more(chars: number): string {
  return `# 旧简报\n\n${'旧内容'.repeat(Math.ceil(chars / 3))}`
}

describe('上下文预算', () => {
  it('放得下时原样保留', () => {
    const out = buildChatContext([
      { kind: 'brief', label: '今日简报', text: brief, structured: true }
    ])
    expect(out.truncated).toBe(false)
    expect(out.sources).toEqual([{ label: '今日简报', ratio: 1 }])
    expect(out.text).toContain('甲事件')
  })

  it('超出预算时裁剪，并如实报告保留比例', () => {
    const out = buildChatContext(
      [
        { kind: 'brief', label: '今日简报', text: more(5000), structured: true },
        { kind: 'previous', label: '上一期', text: more(5000), structured: true }
      ],
      1000
    )
    expect(out.truncated).toBe(true)
    expect(out.estimatedTokens).toBeLessThanOrEqual(1100)
    // 上一期的份额更小，比例不该高于简报
    const briefRatio = out.sources.find((s) => s.label === '今日简报')!.ratio
    const prevRatio = out.sources.find((s) => s.label === '上一期')!.ratio
    expect(prevRatio).toBeLessThanOrEqual(briefRatio)
  })

  it('没有上一期时，份额让给简报', () => {
    const only = buildChatContext([{ kind: 'brief', label: '今日简报', text: more(6000) }], 1000)
    const withPrev = buildChatContext(
      [
        { kind: 'brief', label: '今日简报', text: more(6000) },
        { kind: 'previous', label: '上一期', text: more(6000) }
      ],
      1000
    )
    const briefOnly = only.sources[0]!.ratio
    const briefWithPrev = withPrev.sources.find((s) => s.label === '今日简报')!.ratio
    expect(briefOnly).toBeGreaterThan(briefWithPrev)
  })

  it('裁剪后的文本带显式标记，用户知道被截过', () => {
    const clipped = clipText(more(2000), 300)
    expect(clipped).toContain('已按预算裁剪')
    expect(clipped.length).toBeLessThanOrEqual(300 + 40)
  })

  it('空上下文不会崩，也不会假装有 token', () => {
    const out = buildChatContext([])
    expect(out.text).toBe('')
    expect(out.estimatedTokens).toBe(0)
    expect(out.truncated).toBe(false)
  })

  it('token 估算按 1.6 字/token 保守计算', () => {
    expect(estimateTokens('中文'.repeat(80))).toBe(100)
    expect(estimateTokens('')).toBe(0)
  })
})

describe('动作', () => {
  it('每个动作都有可读的提示词', () => {
    for (const a of CHAT_ACTIONS) {
      const p = actionPrompt(a.id, { itemTitle: '甲事件' })
      if (a.id === 'ask') continue
      expect(p.length).toBeGreaterThan(10)
    }
  })

  it('why 动作会带上选中的条目名', () => {
    expect(actionPrompt('why', { itemTitle: 'Apple Intelligence 进入中国' })).toContain(
      'Apple Intelligence 进入中国'
    )
  })

  it('重排要求保留原有事实与链接', () => {
    const p = actionPrompt('reorder')
    expect(p).toContain('保留原有事实与链接')
    expect(p).toContain('markdown')
  })

  it('没有上一期时藏起「和昨天比」', () => {
    expect(visibleActions(false).some((a) => a.id === 'compare')).toBe(false)
    expect(visibleActions(true).some((a) => a.id === 'compare')).toBe(true)
  })
})
