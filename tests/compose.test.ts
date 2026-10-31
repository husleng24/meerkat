import { describe, it, expect } from 'vitest'
import {
  composeBrief,
  editorialBlock,
  extractLinks,
  normalizeMarkdown,
  renderAggregationBrief,
  validateLinks,
  weekdayOf,
  type BriefItem,
  type ComposeBriefContext
} from '../src/app/compose-brief'
import { buildUserPrompt } from '../src/adapters/llm/deepseek'
import type { Composer, ComposeResult } from '../src/core/ports/composer'

const NOW = Date.parse('2026-10-30T10:00:00Z')

function item(over: Partial<BriefItem> = {}): BriefItem {
  return {
    id: 'i1',
    sourceId: 's1',
    title: 'Gemini 4 Carbon 发布',
    url: 'https://example.com/a',
    summary: 'Google 发布新前沿模型',
    bucket: 'product',
    score: 40,
    formulaVersion: 1,
    alsoIn: [],
    fetchedAt: NOW,
    sourceName: 'DeepMind',
    ...over
  }
}

function ctx(over: Partial<ComposeBriefContext> = {}): ComposeBriefContext {
  return {
    now: NOW,
    windowHours: 48,
    dateLabel: '2026-10-30',
    weekday: '周四',
    sourceStats: [
      { name: 'OpenAI', ok: true, n: 5, note: '' },
      { name: 'Reddit', ok: false, n: 0, note: 'HTTP 429' }
    ],
    ...over
  }
}

function fakeComposer(result: ComposeResult): Composer {
  return { model: 'fake', compose: async () => result }
}

describe('链接校验（防模型编造 URL）', () => {
  it('抽取 markdown 里的链接', () => {
    const md = '- **标题**——解读\n  [源](https://a.com/1) · [源](https://b.com/2)。'
    expect(extractLinks(md)).toEqual(['https://a.com/1', 'https://b.com/2'])
  })

  it('全部命中素材才通过', () => {
    const md = '[a](https://x.com/1) [b](https://x.com/2)'
    const r = validateLinks(md, ['https://x.com/1', 'https://x.com/2'])
    expect(r.passed).toBe(true)
    expect(r.rate).toBe(1)
  })

  it('出现素材外的链接则不通过，并列出可疑项', () => {
    const md = '[a](https://x.com/1) [假](https://fake.com/9)'
    const r = validateLinks(md, ['https://x.com/1'])
    expect(r.passed).toBe(false)
    expect(r.bad).toEqual(['https://fake.com/9'])
  })

  it('命中率低于 85% 不通过（1/3 有效）', () => {
    const md = '[a](https://x.com/1) [b](https://f.com/2) [c](https://f.com/3)'
    const r = validateLinks(md, ['https://x.com/1'])
    expect(r.good).toBe(1)
    expect(r.total).toBe(3)
    expect(r.passed).toBe(false)
  })

  it('一个链接都没有时不算通过（防止模型输出成空壳）', () => {
    expect(validateLinks('没有链接的正文', ['https://x.com/1']).passed).toBe(false)
  })
})

describe('降级：仅聚合简报', () => {
  it('按板块分组并保留来源与链接', () => {
    const items = [
      item(),
      item({ id: 'i2', url: 'https://example.com/b', bucket: 'research', title: 'A paper', sourceName: 'arXiv' })
    ]
    const md = renderAggregationBrief(items, ctx())
    expect(md).toContain('## ① 模型与产品发布')
    expect(md).toContain('## ③ 研究与论文')
    expect(md).toContain('[DeepMind](https://example.com/a)')
    expect(md).toContain('仅聚合模式')
  })

  it('模型失败时仍产出可用简报，并标注原因', async () => {
    const out = await composeBrief(
      fakeComposer({ ok: false, reason: 'no-key', detail: '未配置' }),
      [item()],
      ctx()
    )
    expect(out.degraded).toBe(true)
    expect(out.degradedReason).toContain('no-key')
    expect(out.markdown).toContain('仅聚合模式')
    expect(out.markdown).toContain('编辑说明')
  })
})

describe('编辑说明由程序生成（数字不交给模型）', () => {
  it('包含源数量、成功数与失败提示', () => {
    const block = editorialBlock(ctx())
    expect(block).toContain('抓取 **2** 个源（成功 1 个）')
    expect(block).toContain('HTTP 429')
    expect(block).toContain('| OpenAI | ✅ | 5 |')
    expect(block).toContain('| Reddit | ❌ | 0 | HTTP 429 |')
  })
})

describe('版式归一', () => {
  it('在一级标题后插入元信息行', () => {
    const md = '# AI 简报 · 2026-10-30（周四）\n\n## 三句话速览\n\n1. a\n'
    const out = normalizeMarkdown(md, ctx())
    expect(out).toMatch(/^# AI 简报/)
    expect(out).toContain('> 覆盖最近 48 小时')
  })

  it('把 **今日一句：** 修正为二级标题', () => {
    const out = normalizeMarkdown('# T\n\n**今日一句：** 某句结论。\n', ctx())
    expect(out).toContain('## 今日一句')
    expect(out).not.toContain('**今日一句：**')
  })
})

describe('composeBrief 正常路径', () => {
  it('链接全部命中时不降级，且追加编辑说明', async () => {
    const md = '# AI 简报 · 2026-10-30（周四）\n\n## 三句话速览\n\n1. 某事\n\n- **标题（10-30）**——解读。\n  [DeepMind](https://example.com/a)\n'
    const out = await composeBrief(
      fakeComposer({ ok: true, markdown: md, usage: { input: 100, output: 200 }, model: 'fake' }),
      [item()],
      ctx()
    )
    expect(out.degraded).toBe(false)
    expect(out.linkCheck.passed).toBe(true)
    expect(out.usage.output).toBe(200)
    expect(out.markdown).toContain('编辑说明')
  })
})

describe('用户提示词构建', () => {
  it('包含条数、板块、来源、链接，且摘要被截断', () => {
    const long = 'x'.repeat(500)
    const prompt = buildUserPrompt({
      dateLabel: '2026-10-30',
      weekday: '周四',
      windowHours: 48,
      bucketLabels: { product: '① 模型与产品', agent: '②', business: '③', research: '④', infra: '⑤', policy: '⑥', opinion: '⑦', video: '⑧', community: '⑨' },
      items: [
        {
          title: 'T1',
          url: 'https://e.com/1',
          sourceName: 'S1',
          bucket: 'product',
          summary: long,
          score: 12.34,
          alsoIn: ['HN']
        }
      ]
    })
    expect(prompt).toContain('以下是 1 条候选素材')
    expect(prompt).toContain('① 模型与产品')
    expect(prompt).toContain('链接：https://e.com/1')
    expect(prompt).toContain('另见：HN')
    expect(prompt.length).toBeLessThan(1200)
  })
})

describe('weekdayOf', () => {
  it('返回中文星期', () => {
    expect(weekdayOf(Date.parse('2026-10-30T04:00:00Z'))).toBe('周五')
  })
})
