import { describe, it, expect } from 'vitest'
import {
  buildRollupDigest,
  buildRollupPrompt,
  parseTopicBrief,
  renderRollupFallback
} from '../src/app/domain-rollup'

const BRIEF_A = `# AI 简报 · 2026-11-01（周日）

## 三句话速览

1. Apple Intelligence 进入中国。
2. Claude 放宽用量限制。
3. 英伟达开源 4K 视频增强。

---

## ① 模型与产品

- **Apple Intelligence 进入中国（10-31）**——系统级入口的竞争开始。
  [The Verge](https://example.com/apple)
- **Claude 取消 5 小时限制（10-31）**——长任务终于不用被掐断。
  [量子位](https://example.com/claude)

## ② 算力与本地

- **英伟达开源视频增强（10-30）**——4K 重生成进入消费级。
  [量子位](https://example.com/nvidia)

## 今日一句

**入口之争重新开始。**
`

const BRIEF_B = `# AI 简报 · 2026-11-01（周日）

## 三句话速览

1. 浏览器里的 Agent 开始普及。

## ① Agent 与工程

- **Apple Intelligence 进入中国（10-31）**——同一条事件，重复出现。
  [The Verge](https://example.com/apple)
- **Chrome 内置 Agent（11-01）**——网页操作变成基础能力。
  [HN](https://example.com/chrome)
`

describe('主题简报解析', () => {
  it('拆出速览与条目（标题、日期、链接、解读）', () => {
    const { overview, items } = parseTopicBrief(BRIEF_A)
    expect(overview).toEqual([
      'Apple Intelligence 进入中国。',
      'Claude 放宽用量限制。',
      '英伟达开源 4K 视频增强。'
    ])
    expect(items).toHaveLength(3)
    expect(items[0]).toMatchObject({
      title: 'Apple Intelligence 进入中国',
      dateLabel: '10-31',
      url: 'https://example.com/apple',
      sourceLabel: 'The Verge',
      interpretation: '系统级入口的竞争开始。'
    })
  })

  it('没有条目时返回空数组，不抛异常', () => {
    expect(parseTopicBrief('# 空\n')).toEqual({ overview: [], items: [] })
  })
})

describe('领域汇总素材', () => {
  it('跨主题按 URL 去重，并统计去重数量', () => {
    const digest = buildRollupDigest([
      { topicId: 'a', topicName: '模型与产品', markdown: BRIEF_A },
      { topicId: 'b', topicName: 'Agent 与工具', markdown: BRIEF_B }
    ])
    expect(digest.total).toBe(4)
    expect(digest.deduped).toBe(1)
    expect(digest.sections.map((s) => s.topicName)).toEqual(['模型与产品', 'Agent 与工具'])
    expect(digest.sections[1]!.items.map((i) => i.url)).toEqual(['https://example.com/chrome'])
  })

  it('每个主题的条目数有上限', () => {
    const digest = buildRollupDigest([{ topicId: 'a', topicName: 'A', markdown: BRIEF_A }], 2)
    expect(digest.sections[0]!.items).toHaveLength(2)
  })

  it('兜底稿保留主题分节与链接，并明说没有综述', () => {
    const digest = buildRollupDigest([{ topicId: 'a', topicName: '模型与产品', markdown: BRIEF_A }])
    const md = renderRollupFallback(digest, 'AI', '2026-11-01', 1)
    expect(md).toContain('# AI 领域汇总 · 2026-11-01')
    expect(md).toContain('没有生成综述')
    expect(md).toContain('## 模型与产品')
    expect(md).toContain('[The Verge](https://example.com/apple)')
  })

  it('提示词带上速览与条目，链接逐字保留', () => {
    const digest = buildRollupDigest([{ topicId: 'a', topicName: '模型与产品', markdown: BRIEF_A }])
    const messages = buildRollupPrompt(
      [{ topicId: 'a', topicName: '模型与产品', markdown: BRIEF_A }],
      digest,
      'AI',
      '2026-11-01'
    )
    expect(messages[0]!.role).toBe('system')
    expect(messages[0]!.content).toContain('AI 领域汇总 · 2026-11-01')
    expect(messages[1]!.content).toContain('Apple Intelligence 进入中国')
    expect(messages[1]!.content).toContain('https://example.com/apple')
    expect(messages[1]!.content).toContain('1. Apple Intelligence 进入中国。')
  })
})
