import { describe, expect, it } from 'vitest'
import { parseVideoSummary, renderVideoSummary, type VideoSummaryMeta } from '../src/app/video-summary'

const meta: VideoSummaryMeta = {
  title: '访谈标题',
  creatorName: 'Lex',
  videoId: 'abc123',
  url: 'https://www.youtube.com/watch?v=abc123',
  durationSec: 3600,
  language: 'en'
}

const valid = {
  verdict: 'worth',
  reason: '有具体的工程细节和数字，不是泛泛而谈。',
  audience: '做 Agent 的工程师',
  notFor: '只想看模型榜单的人',
  tldr: ['第一句', '第二句', '第三句'],
  keyPoints: [{ time: '12:34', text: '关键观点' }],
  chapters: [{ time: '00:00', title: '开场', summary: '介绍背景' }]
}

describe('访谈结构化解读', () => {
  it('解析合法 JSON 并渲染 Markdown', () => {
    const s = parseVideoSummary(JSON.stringify(valid))
    const md = renderVideoSummary(s, meta)
    expect(md).toContain('**值得看**')
    expect(md).toContain('[12:34](https://youtu.be/abc123?t=754)')
    expect(md).toContain('## 完整对话')
  })

  it('剥掉模型常见的 ```json 围栏', () => {
    const s = parseVideoSummary('```json\n' + JSON.stringify(valid) + '\n```')
    expect(s.tldr).toHaveLength(3)
  })

  it('缺字段时拒绝，不把空摘要落库', () => {
    expect(() => parseVideoSummary('{"verdict":"worth"}')).toThrow()
    expect(() => parseVideoSummary('not json')).toThrow()
  })
})
