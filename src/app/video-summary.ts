/**
 * 访谈视频的结构化解读。
 *
 * 模型只看到字幕文本，输出 JSON；完整对话记录由字幕本地生成，
 * 避免模型“复述”时改掉原话。
 */
import type { ChatProvider } from '../core/ports/chat'

export interface VideoSummary {
  verdict: 'worth' | 'clips' | 'skip'
  reason: string
  audience: string
  notFor: string
  tldr: string[]
  keyPoints: Array<{ time: string; text: string }>
  chapters: Array<{ time: string; title: string; summary: string }>
}

export interface VideoSummaryMeta {
  title: string
  creatorName: string
  videoId: string
  url: string
  publishedAt?: number
  durationSec?: number
  language?: string
}

function stripFence(s: string): string {
  const t = s.trim()
  const m = /^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(t)
  return m ? m[1]!.trim() : t
}

export function parseVideoSummary(raw: string): VideoSummary {
  let parsed: unknown
  try {
    parsed = JSON.parse(stripFence(raw))
  } catch {
    throw new Error('模型没有返回可解析的 JSON')
  }
  const p = parsed as Partial<VideoSummary>
  const verdict =
    p.verdict === 'worth' || p.verdict === 'clips' || p.verdict === 'skip' ? p.verdict : 'clips'
  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
  const tldr = Array.isArray(p.tldr) ? p.tldr.map(str).filter(Boolean).slice(0, 3) : []
  const keyPoints = Array.isArray(p.keyPoints)
    ? p.keyPoints
        .filter((x): x is { time: string; text: string } => Boolean(x) && typeof x.time === 'string' && typeof x.text === 'string')
        .map((x) => ({ time: x.time.trim(), text: x.text.trim() }))
        .filter((x) => x.text)
        .slice(0, 8)
    : []
  const chapters = Array.isArray(p.chapters)
    ? p.chapters
        .filter(
          (x): x is { time: string; title: string; summary: string } =>
            Boolean(x) && typeof x.time === 'string' && typeof x.title === 'string' && typeof x.summary === 'string'
        )
        .map((x) => ({ time: x.time.trim(), title: x.title.trim(), summary: x.summary.trim() }))
        .filter((x) => x.title)
        .slice(0, 12)
    : []
  if (!str(p.reason) || tldr.length === 0) throw new Error('模型返回的解读内容不完整')
  return {
    verdict,
    reason: str(p.reason),
    audience: str(p.audience),
    notFor: str(p.notFor),
    tldr,
    keyPoints,
    chapters
  }
}

export function buildVideoSummaryPrompt(
  meta: VideoSummaryMeta,
  paragraphs: Array<{ startMs: number; text: string }>,
  maxChars = 120_000
): { system: string; user: string } {
  const lines: string[] = []
  let used = 0
  for (const p of paragraphs) {
    const line = `[${timestampFor(p.startMs)}] ${p.text}`
    if (used + line.length > maxChars) break
    lines.push(line)
    used += line.length + 1
  }
  const transcript = lines.join('\n')
  const system = [
    '你是访谈视频编辑。读者想知道这期视频讲了什么、值不值得看，而不是读一篇泛泛的摘要。',
    '只使用字幕里的事实；不得补充字幕之外的信息、数字或引述。',
    '字幕可能有识别错误；不确定的专有名词/数字要保留原样，不要猜。',
    '用中文输出，返回一个 JSON 对象，不要代码块，不要额外解释。',
    '',
    'JSON 字段：',
    '{',
    '  "verdict": "worth" | "clips" | "skip",  // 整期值得看 / 只看片段 / 不值得',
    '  "reason": "为什么要这样判断，一两句",',
    '  "audience": "适合谁看",',
    '  "notFor": "不适合谁看",',
    '  "tldr": ["三句话总结，每条独立成立"],',
    '  "keyPoints": [{"time":"12:34","text":"核心观点/数字/反直觉结论"}],',
    '  "chapters": [{"time":"00:00","title":"章节名","summary":"这一章讲什么"}]',
    '}',
    '时间戳必须来自字幕里出现过的 [mm:ss]；不要编时间。'
  ].join('\n')
  const user = [
    `节目标题：${meta.title}`,
    `博主：${meta.creatorName}`,
    meta.durationSec ? `时长：${Math.round(meta.durationSec / 60)} 分钟` : '',
    meta.language ? `字幕语言：${meta.language}` : '',
    '',
    '以下是带时间戳的字幕：',
    transcript
  ]
    .filter(Boolean)
    .join('\n')
  return { system, user }
}

function timestampFor(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  return h > 0
    ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function linkAt(meta: VideoSummaryMeta, time: string): string {
  const parts = time.split(':').map(Number)
  const sec = parts.length === 3 ? parts[0]! * 3600 + parts[1]! * 60 + parts[2]! : parts.length === 2 ? parts[0]! * 60 + parts[1]! : 0
  return `https://youtu.be/${meta.videoId}?t=${Math.max(0, sec)}`
}

export function renderVideoSummary(summary: VideoSummary, meta: VideoSummaryMeta): string {
  const verdictLabel =
    summary.verdict === 'worth' ? '值得看' : summary.verdict === 'skip' ? '不值得看' : '只看片段'
  const when = meta.publishedAt
    ? new Date(meta.publishedAt).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })
    : ''
  const lines = [
    `# ${meta.title}`,
    '',
    [meta.creatorName, when, meta.durationSec ? `${Math.round(meta.durationSec / 60)} 分钟` : '', meta.language ? `字幕：${meta.language}` : '']
      .filter(Boolean)
      .join(' · '),
    '',
    '## 值不值得看',
    '',
    `**${verdictLabel}** —— ${summary.reason}`,
    '',
    summary.audience ? `- 适合：${summary.audience}` : '',
    summary.notFor ? `- 不适合：${summary.notFor}` : '',
    '',
    '## 三句话总结',
    '',
    ...summary.tldr.map((x, i) => `${i + 1}. ${x}`),
    '',
    '## 核心观点',
    ''
  ]
  for (const p of summary.keyPoints) {
    lines.push(`- [${p.time}](${linkAt(meta, p.time)}) —— ${p.text}`)
  }
  lines.push('', '## 章节', '')
  for (const c of summary.chapters) {
    lines.push(`- [${c.time}](${linkAt(meta, c.time)}) · ${c.title} —— ${c.summary}`)
  }
  lines.push('', '## 完整对话', '', `见下方字幕记录。原视频：[${meta.url}](${meta.url})`, '')
  return lines.filter((x) => x !== undefined).join('\n')
}

export async function summarizeVideo(
  provider: ChatProvider,
  model: string,
  meta: VideoSummaryMeta,
  paragraphs: Array<{ startMs: number; text: string }>
): Promise<{ summary: VideoSummary; raw: string }> {
  const prompt = buildVideoSummaryPrompt(meta, paragraphs)
  let lastError: unknown
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await provider.chat({
      model,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user }
      ],
      temperature: 0.3,
      maxTokens: 8_000
    })
    if (!res.ok) throw new Error(`模型调用失败：${res.detail}`)
    try {
      return { summary: parseVideoSummary(res.text), raw: res.text }
    } catch (e) {
      lastError = e
    }
  }
  throw lastError instanceof Error ? lastError : new Error('模型没有返回可解析的解读')
}
