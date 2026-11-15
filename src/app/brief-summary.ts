/**
 * 从简报 Markdown 里取"这一期主要说了什么"。
 *
 * 优先取「三句话速览」的前两条；没有速览时退回首段普通文字。
 * 历史列表只展示摘要，不把正文或字数塞给用户。
 */
export function extractBriefSummary(markdown: string, max = 160): string {
  const lines = markdown.split('\n')
  const start = lines.findIndex((l) => /^##\s*三句话速览/.test(l.trim()))
  const picked: string[] = []

  if (start >= 0) {
    for (let i = start + 1; i < lines.length; i += 1) {
      const line = lines[i]!.trim()
      if (!line) {
        if (picked.length > 0) break
        continue
      }
      if (/^##\s/.test(line) || line === '---') break
      const numbered = line.match(/^\d+[.、)]\s*(.+)$/)
      if (numbered) picked.push(clean(numbered[1]!))
      else if (line.startsWith('- ')) picked.push(clean(line.slice(2)))
      if (picked.length >= 2) break
    }
  }

  if (picked.length === 0) {
    const para = lines.find(
      (l) => l.trim() && !l.startsWith('#') && !l.startsWith('>') && l.trim() !== '---' && !l.trim().startsWith('![')
    )
    if (para) picked.push(clean(para))
  }

  const cleaned = picked
    .filter(Boolean)
    .map((x) => x.replace(/[。；;\s]+$/, ''))
    .filter(Boolean)
  const text = cleaned.length > 0 ? `${cleaned.join('；')}。` : ''
  if (text.length <= max) return text
  return `${text.slice(0, max).replace(/[，、；。\s]+$/, '')}…`
}

function clean(raw: string): string {
  return raw
    .replace(/^[-*]\s+/, '')
    .replace(/^\d+[.、)]\s+/, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[`>#]+/g, '')
    .trim()
}
