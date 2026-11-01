/**
 * 领域汇总的"素材整理"。
 *
 * 输入是各主题**已经写好的简报**，不是原始条目——这样汇总与主题简报口径一致，
 * 也不会把一次采集变成两次模型调用（只多一次汇总调用）。
 *
 * 纯函数：解析、去重、拼兜底稿、拼提示词，都可以直接测。
 */

export interface TopicBriefInput {
  topicId: string
  topicName: string
  markdown: string
}

export interface RollupItem {
  title: string
  url: string
  sourceLabel: string
  /** 标题里带的 MM-DD */
  dateLabel?: string
  /** 破折号后面的那句解读 */
  interpretation: string
}

export interface RollupSection {
  topicId: string
  topicName: string
  items: RollupItem[]
}

export interface RollupDigest {
  overview: string[]
  sections: RollupSection[]
  total: number
  /** 被跨主题去重掉的条数，用于页面上说明 */
  deduped: number
}

const ITEM_RE = /^-\s+\*\*(.+?)\*\*(.*)$/
const LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/
const OVERVIEW_HEAD_RE = /^##\s*三句话速览/

/** 把一份主题简报拆成「速览」与「条目」 */
export function parseTopicBrief(markdown: string): { overview: string[]; items: RollupItem[] } {
  const lines = markdown.split('\n')
  const overview: string[] = []
  const items: RollupItem[] = []

  let inOverview = false
  let current: { title: string; rest: string[] } | null = null

  const flush = (): void => {
    if (!current) return
    const title = current.title.trim()
    const rest = current.rest.join('\n')
    const dateLabel = /（(\d{2}-\d{2})）/.exec(title)?.[1]
    const cleanTitle = title.replace(/（\d{2}-\d{2}）\s*$/, '').trim()
    const link = LINK_RE.exec(rest)
    const interpretation = (current.rest[0] ?? '').replace(/^——\s*/, '').trim()
    if (link) {
      items.push({
        title: cleanTitle,
        url: link[2]!,
        sourceLabel: link[1]!,
        ...(dateLabel ? { dateLabel } : {}),
        interpretation
      })
    }
    current = null
  }

  for (const line of lines) {
    if (OVERVIEW_HEAD_RE.test(line)) {
      flush()
      inOverview = true
      continue
    }
    if (inOverview) {
      if (/^##\s/.test(line) || /^---\s*$/.test(line)) {
        inOverview = false
      } else {
        const m = /^(?:\d+\.|[-*])\s+(.+)$/.exec(line.trim())
        if (m) overview.push(m[1]!.trim())
        continue
      }
    }
    const item = ITEM_RE.exec(line)
    if (item) {
      flush()
      current = { title: item[1]!, rest: [item[2]!.replace(/^——\s*/, '')] }
      continue
    }
    if (current) {
      // 条目最多跨 3 行：标题行 + 解读续行 + 来源链接行
      if (current.rest.length < 4) current.rest.push(line)
      else flush()
    }
  }
  flush()

  return { overview, items }
}

/** 跨主题去重：同一个 URL 只保留第一次出现（先按主题顺序） */
export function buildRollupDigest(inputs: TopicBriefInput[], perTopicLimit = 6): RollupDigest {
  const seen = new Set<string>()
  const sections: RollupSection[] = []
  let total = 0
  let deduped = 0

  for (const input of inputs) {
    const { items } = parseTopicBrief(input.markdown)
    const kept: RollupItem[] = []
    for (const it of items) {
      if (seen.has(it.url)) {
        deduped += 1
        continue
      }
      seen.add(it.url)
      kept.push(it)
      if (kept.length >= perTopicLimit) break
    }
    if (kept.length > 0) {
      sections.push({ topicId: input.topicId, topicName: input.topicName, items: kept })
      total += kept.length
    }
  }

  return { overview: [], sections, total, deduped }
}

/** 没有模型（或调用失败）时的兜底：不编综述，只把各主题的条目按主题排好 */
export function renderRollupFallback(
  digest: RollupDigest,
  domainName: string,
  date: string,
  topicCount: number
): string {
  const lines: string[] = [
    `# ${domainName} 领域汇总 · ${date}`,
    '',
    '> 这次没有生成综述（未接模型或调用失败），下面是各主题简报的摘录。',
    '',
    `## 今天这个领域在发生什么`,
    '',
    `今天共 ${topicCount} 个主题、${digest.total} 条内容${digest.deduped > 0 ? `（跨主题去重 ${digest.deduped} 条）` : ''}。`,
    ''
  ]
  for (const section of digest.sections) {
    lines.push(`## ${section.topicName}`, '')
    for (const item of section.items) {
      lines.push(`- **${item.title}**——${item.interpretation || '（见原文）'}`)
      lines.push(`  [${item.sourceLabel}](${item.url})`)
    }
    lines.push('')
  }
  return lines.join('\n').trim()
}

const ROLLUP_SYSTEM = `你是一份 AI 行业日报的主编。现在要把同一领域下几个主题今天的简报，合成一份「领域汇总」。

规则：
1. 只使用给定材料里的事实，不得补充材料之外的数字、日期、引述或评价。
2. 链接必须逐字复制材料里给出的 URL。
3. 综述要写"这几个主题共同指向什么"，不要逐条复述；禁止"值得关注""意义重大"这类空话。
4. 按主题分节，每节只保留 3–6 条；跨主题重复的事件只出现一次，归到最相关的主题。
5. 除专有名词外全部用中文。

输出格式（严格遵守，不要用代码块包裹）：

# {domain} 领域汇总 · {date}

## 今天这个领域在发生什么

（3–5 句，跨主题的趋势判断）

## {主题名}（N 条）

- **标题**——一句解读。
  [来源名](url)
`

/** 汇总提示词：输入各主题的速览 + 条目 */
export function buildRollupPrompt(
  inputs: TopicBriefInput[],
  digest: RollupDigest,
  domainName: string,
  date: string
): Array<{ role: 'system' | 'user'; content: string }> {
  const parts: string[] = [`领域：${domainName}`, `日期：${date}`, '']
  for (const input of inputs) {
    const { overview } = parseTopicBrief(input.markdown)
    const section = digest.sections.find((s) => s.topicId === input.topicId)
    if (!section && overview.length === 0) continue
    parts.push(`### 主题：${input.topicName}`)
    if (overview.length > 0) {
      parts.push('速览：')
      overview.forEach((line, i) => parts.push(`${i + 1}. ${line}`))
    }
    if (section) {
      parts.push('条目：')
      for (const it of section.items) {
        parts.push(`- ${it.title}${it.interpretation ? `——${it.interpretation}` : ''}`)
        parts.push(`  链接：${it.url}（来源：${it.sourceLabel}）`)
      }
    }
    parts.push('')
  }
  return [
    { role: 'system', content: ROLLUP_SYSTEM.replace('{domain}', domainName).replace('{date}', date) },
    { role: 'user', content: parts.join('\n') }
  ]
}
