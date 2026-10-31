import { describe, it, expect } from 'vitest'
import { compareBriefs, type CompareEntry } from '../src/core/pipeline/compare'

function e(key: string, title: string, urls: string[] = [], section = '模型与产品'): CompareEntry {
  return { key, title, urls, section }
}

describe('compareBriefs：两期简报对账', () => {
  it('链接相同即同一件事（含跟踪参数）', () => {
    const out = compareBriefs(
      [e('t0', 'Gemini 4 Carbon 发布', ['https://example.com/gemini?utm_source=hn'])],
      [e('y0', 'Gemini 4 Carbon 全面开放', ['https://example.com/gemini'])]
    )
    expect(out.carried).toHaveLength(1)
    expect(out.added).toHaveLength(0)
    expect(out.dropped).toHaveLength(0)
    expect(out.carried[0]!.previousTitle).toBe('Gemini 4 Carbon 全面开放')
  })

  it('标题高度相似也算同一件事，并保留上一期的写法', () => {
    const out = compareBriefs(
      [e('t0', 'OpenAI 发布 GPT-5.2')],
      [e('y0', 'OpenAI 发布 GPT-5.2 模型')]
    )
    expect(out.carried).toHaveLength(1)
    expect(out.carried[0]!.title).toBe('OpenAI 发布 GPT-5.2')
    expect(out.carried[0]!.previousTitle).toBe('OpenAI 发布 GPT-5.2 模型')
  })

  it('标题不同且链接不同就是新增', () => {
    const out = compareBriefs(
      [e('t0', 'Mistral 开源万亿参数模型', ['https://example.com/mistral'])],
      [e('y0', 'Gemini 4 Carbon 发布', ['https://example.com/gemini'])]
    )
    expect(out.added.map((x) => x.key)).toEqual(['t0'])
    expect(out.dropped.map((x) => x.key)).toEqual(['y0'])
    expect(out.carried).toHaveLength(0)
  })

  it('上一期有、今天没有再提的进 dropped', () => {
    const out = compareBriefs([], [e('y0', '某条旧闻'), e('y1', '另一条旧闻')])
    expect(out.added).toHaveLength(0)
    expect(out.dropped).toHaveLength(2)
    expect(out.todayTotal).toBe(0)
    expect(out.yesterdayTotal).toBe(2)
  })

  it('首期（上一期为空的）不算对比失败：全部进新增', () => {
    const out = compareBriefs([e('t0', '第一条'), e('t1', '第二条')], [])
    expect(out.added).toHaveLength(2)
    expect(out.carried).toHaveLength(0)
    expect(out.dropped).toHaveLength(0)
    expect(out.yesterdayTotal).toBe(0)
  })

  it('一条昨天的条目不会被今天的两条同时认领', () => {
    const out = compareBriefs(
      [e('t0', 'OpenAI 发布 GPT-5.2'), e('t1', 'OpenAI 发布 GPT-5.2 模型')],
      [e('y0', 'OpenAI 发布 GPT-5.2')]
    )
    expect(out.carried).toHaveLength(1)
    expect(out.added).toHaveLength(1)
    expect(out.carried[0]!.key).toBe('t0')
  })

  it('相似标题有多条候选时取最像的那条', () => {
    const out = compareBriefs(
      [e('t0', 'Gemini 4 Carbon 发布')],
      [
        e('y0', 'Gemini 4 Carbon 发布：能力领先，但只对受信任的防守方开放'),
        e('y1', 'Gemini 4 Carbon 发布')
      ]
    )
    expect(out.carried).toHaveLength(1)
    expect(out.carried[0]!.previousTitle).toBe('Gemini 4 Carbon 发布')
    expect(out.dropped.map((x) => x.key)).toEqual(['y0'])
  })

  it('没有链接的条目仍可凭标题配对', () => {
    const out = compareBriefs([e('t0', 'Anthropic 发布 Claude Opus 5')], [e('y0', 'Anthropic 发布 Claude Opus 5')])
    expect(out.carried).toHaveLength(1)
  })

  it('URL 匹配优先于标题匹配：避免把链接相同的条目让给同名的另一条', () => {
    const out = compareBriefs(
      [e('t0', '同一事件', ['https://example.com/a'])],
      [e('y0', '同一事件', ['https://example.com/b']), e('y1', '另一件事', ['https://example.com/a'])]
    )
    expect(out.carried).toHaveLength(1)
    expect(out.carried[0]!.previousTitle).toBe('另一件事')
    expect(out.dropped.map((x) => x.key)).toEqual(['y0'])
  })
})
