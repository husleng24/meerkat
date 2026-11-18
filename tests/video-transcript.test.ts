import { describe, expect, it } from 'vitest'
import {
  normalizeCues,
  timestamp,
  toParagraphs,
  transcriptToMarkdown,
  type TranscriptCue
} from '../src/adapters/youtube/transcript'

const cue = (text: string, sec: number): TranscriptCue => ({
  text,
  offsetMs: sec * 1000,
  durationMs: 2000,
  lang: 'en'
})

describe('YouTube 字幕规范化', () => {
  it('去掉空 cue 和连续重复', () => {
    const out = normalizeCues([cue('hello', 0), cue('hello', 2), cue('  ', 4), cue('world', 6)])
    expect(out.map((c) => c.text)).toEqual(['hello', 'world'])
  })

  it('合并相邻短 cue，长间隔另起一段', () => {
    const out = toParagraphs([cue('one', 0), cue('two', 2), cue('three', 30)])
    expect(out).toHaveLength(2)
    expect(out[0]?.text).toContain('one two')
    expect(out[1]?.startMs).toBe(30_000)
  })

  it('时间戳支持分钟和小时', () => {
    expect(timestamp(0)).toBe('00:00')
    expect(timestamp(65_000)).toBe('01:05')
    expect(timestamp(3_665_000)).toBe('01:01:05')
  })

  it('Markdown 保留原文、时间戳与来源链接', () => {
    const md = transcriptToMarkdown({
      title: '访谈',
      creatorName: '博主',
      videoId: 'abc123',
      language: 'en',
      paragraphs: [{ startMs: 65_000, text: 'the actual words' }]
    })
    expect(md).toContain('# 访谈 · 完整对话')
    expect(md).toContain('[01:05](https://youtu.be/abc123?t=65)')
    expect(md).toContain('the actual words')
    expect(md).toContain('字幕自动生成')
  })
})
