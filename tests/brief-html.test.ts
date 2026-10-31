import { describe, it, expect } from 'vitest'
import { renderBriefDocument } from '../src/renderer/src/lib/briefHtml'
import type { ParsedBrief } from '../src/renderer/src/lib/parseBrief'

function brief(over: Partial<ParsedBrief> = {}): ParsedBrief {
  return {
    title: 'AI 简报 · 2026-10-30（周五）',
    meta: '覆盖最近 48 小时 · 34 个信息源',
    highlights: ['第一条要点'],
    sections: [
      {
        heading: '① 模型与产品发布',
        items: [
          {
            key: 's0-i0',
            title: 'Gemini 4 Carbon 发布',
            body: '前沿能力按信任等级分批开放。',
            links: [{ label: 'Google DeepMind', url: 'https://example.com/gemini' }],
            sectionIndex: 0
          }
        ]
      }
    ],
    punchline: '前沿能力的门槛正在从"能不能用"变成"给不给用"。',
    appendix: '',
    ...over
  }
}

describe('renderBriefDocument：导出用的 HTML', () => {
  const doc = renderBriefDocument(brief(), '2026-10-30')

  it('产出完整文档骨架（可直接 printToPDF）', () => {
    expect(doc.html.startsWith('<!doctype html>')).toBe(true)
    expect(doc.html).toContain('<meta charset="utf-8">')
    expect(doc.html).toContain('2026-10-30')
  })

  it('标题、速览、板块、今日一句都进得去', () => {
    expect(doc.html).toContain('Gemini 4 Carbon 发布')
    expect(doc.html).toContain('第一条要点')
    expect(doc.html).toContain('模型与产品发布')
    expect(doc.html).toContain('前沿能力的门槛正在从')
  })

  it('板块标题里的圈码不带到导出稿里', () => {
    expect(doc.html).not.toContain('① 模型与产品发布')
  })

  it('链接保留为可点的 a 标签', () => {
    expect(doc.html).toContain('href="https://example.com/gemini"')
    expect(doc.html).toContain('Google DeepMind')
  })

  it('HTML 特殊字符被转义，不会破坏结构', () => {
    const risky = renderBriefDocument(
      brief({
        highlights: ['a < b & c > d'],
        sections: [
          {
            heading: '① X',
            items: [{ key: 's0-i0', title: '<script>alert(1)</script>', body: '"q"', links: [], sectionIndex: 0 }]
          }
        ]
      }),
      '2026-10-30'
    )
    expect(risky.html).not.toContain('<script>alert(1)</script>')
    expect(risky.html).toContain('&lt;script&gt;')
    expect(risky.html).toContain('a &lt; b &amp; c &gt; d')
  })

  it('纯文本版本包含标题与链接，供剪贴板 text/plain 回退', () => {
    expect(doc.text).toContain('Gemini 4 Carbon 发布')
    expect(doc.text).toContain('https://example.com/gemini')
    expect(doc.text).toContain('今日一句')
  })
})
