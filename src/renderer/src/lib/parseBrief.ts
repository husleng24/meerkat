/**
 * 把简报 markdown 解析成结构化数据。
 *
 * 为什么在渲染层解析而不是让模型额外输出 IR：
 * 简报的格式由我们自己的 prompt 规定（见 resources/prompts/compose.zh.md），
 * 是受控子集；多产出一份 IR 只会引入"两份数据可能不一致"的风险。
 * markdown 是唯一真源，界面从它派生。
 *
 * 解析必须容错：模型偶尔会把链接写成别的样子，这时宁可展示纯文本，也不能白屏。
 */

export interface BriefLink {
  label: string
  url: string
}

export interface BriefItem {
  /** 稳定 key，用于键盘导航与已读状态 */
  key: string
  title: string
  /** 标题里的日期，例如 "10-29" */
  dateLabel?: string
  body: string
  links: BriefLink[]
  sectionIndex: number
}

export interface BriefSection {
  /** 板块标题，例如 "① 模型与产品" */
  heading: string
  items: BriefItem[]
}

export interface ParsedBrief {
  title: string
  meta: string
  highlights: string[]
  sections: BriefSection[]
  punchline: string
  /** <details> 里的编辑说明原文，默认折叠 */
  appendix: string
}

const ITEM_RE = /^-\s+\*\*(.+?)\*\*(.*)$/
const LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g
const H2_RE = /^##\s+(.+?)\s*$/

/** 从 "标题（10-29）" 里拆出日期 */
function splitDate(title: string): { title: string; dateLabel?: string } {
  const m = /^(.*?)[（(]\s*(\d{1,2}-\d{1,2})\s*[)）]\s*$/.exec(title)
  if (m && m[1]) return { title: m[1].trim(), dateLabel: m[2]! }
  return { title: title.trim() }
}

function stripEmphasis(s: string): string {
  return s.replace(/^\s*[—-]{1,2}\s*/, '').trim()
}

export function parseBrief(md: string): ParsedBrief {
  const appendixStart = md.indexOf('<details>')
  const appendix = appendixStart >= 0 ? md.slice(appendixStart) : ''
  const body = appendixStart >= 0 ? md.slice(0, appendixStart) : md

  const lines = body.split('\n')
  const out: ParsedBrief = {
    title: '',
    meta: '',
    highlights: [],
    sections: [],
    punchline: '',
    appendix
  }

  let section: BriefSection | null = null
  let item: BriefItem | null = null
  let inHighlights = false
  let inPunchline = false
  let punchBuf: string[] = []
  let sectionIndex = 0

  const flushItem = (): void => {
    if (item && section) {
      item.body = item.body.trim()
      section.items.push(item)
    }
    item = null
  }

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '')

    if (line.startsWith('# ') && !out.title) {
      out.title = line.slice(2).trim()
      continue
    }
    if (line.startsWith('> ') && !out.meta) {
      out.meta = line.slice(2).trim()
      continue
    }

    const h2 = H2_RE.exec(line)
    if (h2) {
      flushItem()
      const heading = h2[1]!
      if (heading.includes('三句话速览')) {
        inHighlights = true
        inPunchline = false
        section = null
        continue
      }
      if (heading.includes('今日一句')) {
        inHighlights = false
        inPunchline = true
        section = null
        continue
      }
      inHighlights = false
      inPunchline = false
      section = { heading, items: [] }
      out.sections.push(section)
      sectionIndex = out.sections.length - 1
      continue
    }

    if (inHighlights) {
      const m = /^\d+\.\s+(.*)$/.exec(line.trim())
      if (m) out.highlights.push(m[1]!.trim())
      continue
    }

    if (inPunchline) {
      if (line.trim() === '---') continue
      punchBuf.push(line)
      continue
    }

    const itemMatch = ITEM_RE.exec(line.trim())
    if (itemMatch && section) {
      flushItem()
      const { title, dateLabel } = splitDate(itemMatch[1]!.trim())
      item = {
        key: `s${sectionIndex}-i${section.items.length}`,
        title,
        body: stripEmphasis(itemMatch[2] ?? ''),
        links: [],
        sectionIndex,
        ...(dateLabel ? { dateLabel } : {})
      }
      // 同一行里也可能已经带了链接
      for (const lm of (itemMatch[2] ?? '').matchAll(LINK_RE)) {
        item.links.push({ label: lm[1]!, url: lm[2]! })
      }
      continue
    }

    if (item) {
      const trimmed = line.trim()
      if (trimmed === '') continue
      // 链接续行：形如 "  [源名](url) · [源名](url)"
      const links = [...trimmed.matchAll(LINK_RE)]
      if (links.length > 0 && /^[[\s]/.test(trimmed)) {
        for (const lm of links) item.links.push({ label: lm[1]!, url: lm[2]! })
        const rest = trimmed.replace(LINK_RE, '').replace(/[·、\s]/g, '')
        if (rest) item.body += ' ' + rest
      } else {
        item.body += (item.body ? ' ' : '') + trimmed
      }
    }
  }
  flushItem()

  // 加粗标记可能跨行（模型常把收尾的 ** 单独放一行），先拼再剥
  out.punchline = punchBuf
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\*\*+/, '')
    .replace(/\*\*+$/, '')
    .trim()
  return out
}
