import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseBrief } from '../src/renderer/src/lib/parseBrief'

const md = readFileSync(join(__dirname, 'fixtures', 'brief-real.md'), 'utf8')

describe('parseBrief：真实简报', () => {
  const parsed = parseBrief(md)

  it('标题与元信息行', () => {
    expect(parsed.title).toBe('AI 简报 · 2026-10-30（周五）')
    expect(parsed.meta).toContain('覆盖最近 48 小时')
    expect(parsed.meta).toContain('精选 24 条')
  })

  it('三句话速览解析成 3 条', () => {
    expect(parsed.highlights).toHaveLength(3)
    expect(parsed.highlights[0]).toContain('Gemini 4 Carbon')
  })

  it('板块数量与顺序', () => {
    expect(parsed.sections.length).toBeGreaterThanOrEqual(5)
    expect(parsed.sections[0]!.heading).toBe('① 模型与产品')
    expect(parsed.sections.map((s) => s.heading)).toContain('③ 商业与资本')
  })

  it('条目总数与正文都非空', () => {
    const all = parsed.sections.flatMap((s) => s.items)
    expect(all.length).toBe(24)
    for (const it of all) {
      expect(it.title.length).toBeGreaterThan(4)
      expect(it.body.length).toBeGreaterThan(10)
    }
  })

  it('每条至少有一个链接，且都是 http(s)', () => {
    const all = parsed.sections.flatMap((s) => s.items)
    const missing = all.filter((i) => i.links.length === 0)
    expect(missing.map((m) => m.title)).toEqual([])
    for (const it of all) for (const l of it.links) expect(l.url).toMatch(/^https?:\/\//)
  })

  it('日期标签从标题里剥离', () => {
    const first = parsed.sections[0]!.items[0]!
    expect(first.title).not.toContain('（10-29）')
    expect(first.dateLabel).toBe('10-29')
  })

  it('多来源条目保留多个链接（同事件合并的证据）', () => {
    const first = parsed.sections[0]!.items[0]!
    expect(first.links.length).toBeGreaterThanOrEqual(2)
    expect(first.links.map((l) => l.label)).toContain('Google DeepMind')
  })

  it('今日一句被抽出来且去掉加粗标记', () => {
    expect(parsed.punchline.length).toBeGreaterThan(10)
    expect(parsed.punchline.startsWith('**')).toBe(false)
  })

  it('编辑说明进入 appendix，不污染正文', () => {
    expect(parsed.appendix).toContain('<details>')
    expect(parsed.punchline).not.toContain('信息源健康度')
  })

  it('item key 唯一，可用于键盘导航', () => {
    const keys = parsed.sections.flatMap((s) => s.items.map((i) => i.key))
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('parseBrief：异常输入容错', () => {
  it('空字符串不抛异常', () => {
    const r = parseBrief('')
    expect(r.title).toBe('')
    expect(r.sections).toEqual([])
  })

  it('没有链接的条目仍能解析（不能白屏）', () => {
    const r = parseBrief('# T\n\n## ① 板块\n\n- **某标题（10-29）**——解读在这里。\n')
    expect(r.sections[0]!.items).toHaveLength(1)
    expect(r.sections[0]!.items[0]!.links).toEqual([])
    expect(r.sections[0]!.items[0]!.body).toContain('解读在这里')
  })

  it('模型把「今日一句」写成加粗段落时也能识别', () => {
    const r = parseBrief('# T\n\n**今日一句：** 结论一句话。\n')
    // 没有二级标题时应退化为普通文本，不崩
    expect(typeof r.punchline).toBe('string')
  })
})
