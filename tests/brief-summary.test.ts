import { describe, it, expect } from 'vitest'
import { extractBriefSummary } from '../src/app/brief-summary'

const md = `# AI 综合 简报 · 2026-11-15（周日）

> 覆盖最近 48 小时 · 18 个信息源 · 精选 19 条

## 三句话速览

1. 黄仁勋辞去 Nvidia CEO，马斯克等科技高管联署请愿要求复职。
2. DeepSeek 把官方 App 的能力开放为可自由组合调用的 API。
3. Anthropic 把 Claude Code Projects 升级为可并行运行多个 AI worker。

---

## ① 模型与产品

- **某条新闻**——不重要的正文。
`

describe('简报摘要', () => {
  it('取速览前两条，去掉编号和 Markdown', () => {
    const s = extractBriefSummary(md)
    expect(s).toContain('黄仁勋辞去 Nvidia CEO')
    expect(s).toContain('DeepSeek 把官方 App')
    expect(s).not.toContain('Anthropic')
    expect(s).not.toContain('**')
    expect(s).not.toContain('。；')
    expect(s.endsWith('。')).toBe(true)
  })

  it('没有速览时退回首段，并截断', () => {
    const s = extractBriefSummary('# 标题\n\n> 引用\n\n这是正文第一段，'.padEnd(200, '很长'))
    expect(s.startsWith('这是正文第一段')).toBe(true)
    expect(s.startsWith('- ')).toBe(false)
    expect(s.endsWith('…')).toBe(true)
  })

  it('空内容返回空串', () => {
    expect(extractBriefSummary('')).toBe('')
  })
})
