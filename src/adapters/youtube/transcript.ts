/**
 * YouTube 字幕 → 可读的 Markdown 对话记录。
 *
 * 只处理有字幕的视频；没有字幕时明确报错，不做 ASR 兜底。
 * 字幕原文不交给模型改写，模型只基于它做摘要。
 */
import { YoutubeTranscript } from 'youtube-transcript'

export interface TranscriptCue {
  text: string
  offsetMs: number
  durationMs: number
  lang?: string
}

export interface TranscriptParagraph {
  startMs: number
  text: string
}

export interface VideoTranscript {
  videoId: string
  language: string
  cues: TranscriptCue[]
  paragraphs: TranscriptParagraph[]
  durationSec: number
}

const LANG_ORDER = ['en', 'en-US', 'zh-Hans', 'zh-CN', 'zh']

function clean(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

export function normalizeCues(cues: TranscriptCue[]): TranscriptCue[] {
  const out: TranscriptCue[] = []
  for (const cue of cues) {
    const text = clean(cue.text)
    if (!text) continue
    const prev = out[out.length - 1]
    if (prev && prev.text === text) continue
    out.push({ ...cue, text })
  }
  return out
}

/** 合并短 cue：相邻 4 秒内、且段落不超过约 700 字 */
export function toParagraphs(cues: TranscriptCue[]): TranscriptParagraph[] {
  const out: TranscriptParagraph[] = []
  let current: TranscriptParagraph | null = null
  let currentEnd = 0
  for (const cue of cues) {
    const start = cue.offsetMs
    if (!current) {
      current = { startMs: start, text: cue.text }
      currentEnd = start + cue.durationMs
      continue
    }
    const gap = start - currentEnd
    const tooLong = current.text.length + cue.text.length > 700
    if (gap > 4_000 || tooLong) {
      out.push(current)
      current = { startMs: start, text: cue.text }
    } else {
      current.text = `${current.text} ${cue.text}`
    }
    currentEnd = start + cue.durationMs
  }
  if (current) out.push(current)
  return out
}

export function timestamp(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  return h > 0
    ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export async function fetchVideoTranscript(videoId: string): Promise<VideoTranscript> {
  let cues: TranscriptCue[] | null = null
  let lastError = ''
  // 第一次请求偶尔会被 YouTube 抗爬/瞬时限流；重试一轮再放弃。
  for (let attempt = 0; attempt < 2 && !cues; attempt++) {
    for (const lang of LANG_ORDER) {
      try {
        const list = await YoutubeTranscript.fetchTranscript(videoId, { lang })
        if (list.length > 0) {
          cues = list.map((c) => ({
            text: c.text,
            offsetMs: c.offset,
            durationMs: c.duration,
            ...(c.lang ? { lang: c.lang } : {})
          }))
          break
        }
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e)
      }
    }
    if (!cues && attempt === 0) await new Promise((r) => setTimeout(r, 600))
  }
  if (!cues || cues.length === 0) {
    throw new Error(lastError ? `没有可用字幕：${lastError}` : '这个视频没有可用字幕')
  }
  const normalized = normalizeCues(cues)
  const paragraphs = toParagraphs(normalized)
  const durationSec = Math.ceil((normalized[normalized.length - 1]!.offsetMs + normalized[normalized.length - 1]!.durationMs) / 1000)
  return {
    videoId,
    language: normalized.find((c) => c.lang)?.lang ?? '',
    cues: normalized,
    paragraphs,
    durationSec
  }
}

export interface TranscriptMarkdownInput {
  title: string
  creatorName: string
  videoId: string
  publishedAt?: number
  language: string
  paragraphs: TranscriptParagraph[]
}

export function transcriptToMarkdown(input: TranscriptMarkdownInput): string {
  const when = input.publishedAt
    ? new Date(input.publishedAt).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })
    : ''
  const meta = [input.creatorName, when, input.language ? `字幕：${input.language}` : '']
    .filter(Boolean)
    .join(' · ')
  const lines = [
    `# ${input.title} · 完整对话`,
    '',
    meta,
    '',
    '字幕自动生成，未逐字校对。',
    '',
    '## 完整对话',
    ''
  ]
  for (const p of input.paragraphs) {
    const stamp = timestamp(p.startMs)
    const sec = Math.floor(p.startMs / 1000)
    lines.push(`### [${stamp}](https://youtu.be/${input.videoId}?t=${sec})`, '', p.text, '')
  }
  return lines.join('\n')
}
