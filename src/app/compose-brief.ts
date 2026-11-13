/**
 * 用例：生成一份简报。
 *
 * 两道防线（照搬 Python 版实测有效的做法）：
 *  1. **链接校验**：模型输出的每个 URL 必须逐字出现在素材里，命中率 <85% 判失败
 *  2. **统计不交给模型**：源数量、耗时、健康度、精选条数全部由程序追加
 *
 * 还有一条降级路径：没有 key 或模型失败时，仍产出"仅聚合"简报——
 * 没有模型也要能用，这是产品的一等形态（ADR-5），不是容错补丁。
 */
import type { Bucket, Item } from '../core/domain/types'
import { BUCKETS, BUCKET_LABEL } from '../core/domain/types'
import type { ComposeInput, Composer, TokenUsage } from '../core/ports/composer'
import { briefTitle } from './brief-identity'

/** 给模型看的板块名（比内部 label 短，减少 token 且更接近简报里的实际写法） */
export const PROMPT_BUCKET_LABEL: Record<Bucket, string> = {
  product: '① 模型与产品',
  agent: '② Agent 与工程',
  business: '③ 商业与资本',
  research: '④ 研究与论文',
  infra: '⑤ 算力与本地',
  policy: '⑥ 政策与安全',
  opinion: '⑦ 观点与弱信号',
  video: '⑧ 视频与播客',
  community: '⑨ 社区热议'
}

export interface BriefSourceStats {
  name: string
  ok: boolean
  n: number
  note: string
}

export interface ComposeBriefContext {
  now: number
  windowHours: number
  dateLabel: string
  weekday: string
  /** 主题名：决定标题与降级稿归属（多主题下不能写死「AI 简报」） */
  topicName: string
  /** 这个主题的编辑重点；只影响选题与解读，不改变简报格式 */
  editorialFocus?: string
  sourceStats: BriefSourceStats[]
  /** 本次消耗的 wall time，由调用方传 */
  elapsedMs?: number
}

export interface BriefItem extends Item {
  sourceName: string
}

export interface LinkCheck {
  good: number
  total: number
  rate: number
  bad: string[]
  passed: boolean
}

export interface BriefOutcome {
  markdown: string
  degraded: boolean
  degradedReason?: string
  linkCheck: LinkCheck
  usage: TokenUsage
  model: string
  nItems: number
  /** 输出被 max_tokens 截断（正文可能少了结尾） */
  truncated: boolean
  /** 结构性问题，例如缺"今日一句" */
  issues: string[]
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

export function weekdayOf(ms: number): string {
  return WEEKDAYS[new Date(ms).getDay()]!
}

/** 从 markdown 里抽取所有链接目标，去掉尾部的标点 */
export function extractLinks(md: string): string[] {
  const out: string[] = []
  const re = /\]\((https?:\/\/[^)\s]+)\)/g
  for (const m of md.matchAll(re)) out.push(m[1]!.replace(/[.,;:]+$/, ''))
  return out
}

/** 校验链接是否都来自素材；这是防止模型编造 URL 的唯一硬约束 */
export function validateLinks(md: string, allowedUrls: Iterable<string>): LinkCheck {
  const allowed = new Set<string>()
  for (const u of allowedUrls) allowed.add(u)
  const found = extractLinks(md)
  const bad = found.filter((u) => !allowed.has(u))
  const good = found.length - bad.length
  const rate = found.length === 0 ? 0 : good / found.length
  return { good, total: found.length, rate, bad, passed: found.length > 0 && rate >= 0.85 }
}

/** 仅聚合简报：无模型时的降级产物，按板块列条目 */
export function renderAggregationBrief(items: BriefItem[], ctx: ComposeBriefContext): string {
  const grouped = new Map<Bucket, BriefItem[]>()
  for (const it of items) {
    const list = grouped.get(it.bucket) ?? []
    list.push(it)
    grouped.set(it.bucket, list)
  }

  const lines: string[] = [`# ${briefTitle(ctx.topicName, ctx.dateLabel, ctx.weekday)}`, '']
  lines.push(`> 覆盖最近 ${ctx.windowHours} 小时 · 仅聚合模式（未调用模型）`, '')
  lines.push('---', '')

  for (const bucket of BUCKETS) {
    const rows = grouped.get(bucket)
    if (!rows || rows.length === 0) continue
    lines.push(`## ${BUCKET_LABEL[bucket]}`, '')
    for (const it of rows.slice(0, 10)) {
      const also = it.alsoIn.length > 0 ? `（另见 ${it.alsoIn.join('、')}）` : ''
      const summary = it.summary ? `——${it.summary.slice(0, 110)}` : ''
      lines.push(`- **${it.title}**${summary}${also}`)
      lines.push(`  [${it.sourceName}](${it.url})`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

/** 程序生成的编辑说明：数字一律不由模型写 */
export function editorialBlock(ctx: ComposeBriefContext): string {
  const okCount = ctx.sourceStats.filter((s) => s.ok).length
  const bad = ctx.sourceStats.filter((s) => !s.ok)
  const rows = ctx.sourceStats
    .map((s) => `| ${s.name} | ${s.ok ? '✅' : '❌'} | ${s.n} | ${s.note || '—'} |`)
    .join('\n')

  const lines = [
    '',
    '---',
    '',
    '<details>',
    '<summary>编辑说明与信息源健康度</summary>',
    '',
    `回看窗口 **${ctx.windowHours} 小时**，抓取 **${ctx.sourceStats.length}** 个源（成功 ${okCount} 个）。`,
    ...(ctx.elapsedMs !== undefined ? [`本次采集耗时 ${(ctx.elapsedMs / 1000).toFixed(1)} 秒。`] : []),
    ...(bad.length > 0 ? ['', `> ⚠️ 失败源：${bad.map((b) => `${b.name}（${b.note}）`).join('；')}`] : []),
    '',
    '| 源 | 状态 | 条数 | 备注 |',
    '|---|---|---|---|',
    rows,
    '',
    '**筛选口径**：抓取 → 归一化 → 去重（URL 规范化 + 标题相似度 >0.86）→ 分板块 →',
    '按"来源权重 + 时效 + 互动量 + 强信号词"打分 → 由模型按信息增量取舍。',
    '',
    '</details>'
  ]
  return lines.join('\n')
}

function toComposeInput(items: BriefItem[], ctx: ComposeBriefContext): ComposeInput {
  return {
    dateLabel: ctx.dateLabel,
    weekday: ctx.weekday,
    topicName: ctx.topicName,
    ...(ctx.editorialFocus ? { editorialFocus: ctx.editorialFocus } : {}),
    windowHours: ctx.windowHours,
    bucketLabels: PROMPT_BUCKET_LABEL,
    items: items.map((it) => ({
      title: it.title,
      url: it.url,
      sourceName: it.sourceName,
      bucket: it.bucket,
      ...(it.publishedAt !== undefined ? { publishedAt: it.publishedAt } : {}),
      summary: it.summary,
      score: it.score,
      alsoIn: it.alsoIn
    }))
  }
}

export async function composeBrief(
  composer: Composer,
  items: BriefItem[],
  ctx: ComposeBriefContext,
  signal?: AbortSignal
): Promise<BriefOutcome> {
  const input = toComposeInput(items, ctx)
  const allowed = items.map((i) => i.url)

  const res = await composer.compose(input, signal)

  if (!res.ok) {
    return {
      markdown: renderAggregationBrief(items, ctx) + editorialBlock(ctx),
      degraded: true,
      degradedReason: `${res.reason}: ${res.detail}`,
      linkCheck: { good: 0, total: 0, rate: 0, bad: [], passed: false },
      usage: { input: 0, output: 0 },
      model: 'none',
      nItems: items.length,
      truncated: false,
      issues: []
    }
  }

  const linkCheck = validateLinks(res.markdown, allowed)
  const body = normalizeMarkdown(res.markdown, ctx)
  const truncated = res.finishReason === 'length'

  // 结构性校验：模型偶尔会漏掉结尾段（实测被 max_tokens 截断时最容易发生）
  const issues: string[] = []
  if (truncated) issues.push('输出被 max_tokens 截断，正文可能不完整')
  if (!/今日一句/.test(body)) issues.push('缺少「今日一句」段')
  if (!/三句话速览/.test(body)) issues.push('缺少「三句话速览」段')

  return {
    markdown: body + editorialBlock(ctx),
    degraded: false,
    linkCheck,
    usage: res.usage,
    model: res.model,
    nItems: items.length,
    truncated,
    issues
  }
}

/** 统一版式：标题由程序生成、补元信息行、修正「今日一句」的标题层级 */
export function normalizeMarkdown(md: string, ctx: ComposeBriefContext): string {
  const lines = md.split('\n')
  const title = `# ${briefTitle(ctx.topicName, ctx.dateLabel, ctx.weekday)}`
  const picked = (md.split('<details>')[0]!.match(/^- \*\*/gm) ?? []).length

  // 模型偶尔会在正文前寒暄一句；有 H1 时把 H1 之前的内容整段丢掉，没有 H1 时补一个。
  // 两种情况下都必须满足同一个不变量：第一行是规范标题。
  const h1 = lines.findIndex((line) => line.startsWith('# '))
  const body = h1 >= 0 ? lines.slice(h1 + 1) : lines

  const d = new Date(ctx.now)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const meta =
    `> 覆盖最近 ${ctx.windowHours} 小时 · ` +
    `${ctx.sourceStats.filter((s) => s.ok).length} 个信息源 · ` +
    `精选 ${picked} 条 · ${ctx.dateLabel} ${hh}:${mm}`

  let text = [title, '', meta, ...body].join('\n')
  text = text.replace(/^\s*\*\*今日一句[：:]\*\*\s*/gm, '## 今日一句\n\n')
  text = text.replace(/\n{3,}/g, '\n\n')
  return text.trim()
}
