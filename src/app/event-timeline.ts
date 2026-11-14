/**
 * 事件时间线的「检索 + 整理」。
 *
 * 纯逻辑与提示词都放这里，主进程只负责取模型和落库：
 *  - 从一条新闻的标题/评论里抽关键词（实体词），去本地库里找相关条目
 *  - 合并同事件的不同报道（同一 URL / 标题高度相似）
 *  - 没模型时给一个确定性的按天时间线，模型不可用也不能白屏
 *  - 解析模型输出时做引用校验：只允许引用传入的条目
 */
import type { Store } from '../core/ports/store'
import type { Item } from '../core/domain/types'
import type { ChatMessage } from '../core/ports/chat'
import { overlap, tokenize } from './text-match'

export interface TimelineItemRef {
  id: string
  title: string
  url: string
  sourceName: string
  /** YYYY-MM-DD */
  date: string
  summary: string
}

export interface TimelinePhase {
  date: string
  headline: string
  detail?: string
  status: 'confirmed' | 'reported' | 'rumor'
  confidence: 'single-source' | 'multi-source'
  sourceItemIds: string[]
}

export interface EventTimeline {
  title: string
  range: { from: string; to: string }
  summary?: string
  phases: TimelinePhase[]
  gaps: string[]
  openQuestions: string[]
  mode: 'agent' | 'deterministic'
  /** deterministic 模式下说明原因（未接模型 / 调用失败） */
  note?: string
  /** 渲染来源标签用：id → 标题/链接/来源名 */
  items?: TimelineItemRef[]
}

/** 事件后缀：抽实体时从段落尾部剥掉，避免拿"黄仁勋辞职"去匹配 */
const EVENT_SUFFIXES = [
  '辞职', '离职', '卸任', '换帅', '接任', '上任',
  '发布', '宣布', '回应', '确认', '否认', '辟谣',
  '融资', '收购', '裁员', '调查', '道歉', '起诉', '上市', '退市',
  '蒸发', '大涨', '大跌', '暴涨', '暴跌', '涨停', '跌停', '停牌'
]

const DAY = 86_400_000

const dateOf = (ts: number | undefined): string =>
  new Date(ts ?? Date.now()).toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })

/** "黄仁勋辞职，英伟达33年首换帅" → ["黄仁勋", "英伟达33年首"] */
export function extractKeywords(title: string, extra = ''): string[] {
  const out: string[] = []
  for (const raw of `${title} ${extra}`.split(/[，,。.!！?？：:；;、\s/|（）()【】\[\]"“”'']+/)) {
    let seg = raw.trim()
    if (seg.length < 2) continue
    // 反复剥掉尾部事件词："黄仁勋辞职" → "黄仁勋"
    let changed = true
    while (changed) {
      changed = false
      for (const suffix of EVENT_SUFFIXES) {
        if (seg.length > suffix.length + 1 && seg.endsWith(suffix)) {
          seg = seg.slice(0, -suffix.length)
          changed = true
        }
      }
    }
    // 去掉尾部纯数字/年份，保留"英伟达"这种实体
    seg = seg.replace(/[\d０-９]+年?$/g, '').trim()
    if (seg.length >= 2) out.push(seg)
  }
  return [...new Set(out)].slice(0, 6)
}

/** 合并同事件报道：先按 URL 去重，再按标题相似度聚类 */
export function mergeDuplicates(items: Item[]): Array<{ main: Item; ids: string[] }> {
  const groups: Array<{ main: Item; ids: string[]; urls: Set<string>; tokens: Set<string> }> = []
  for (const item of items) {
    const tokens = tokenize(item.title)
    const found = groups.find((g) => {
      if (g.urls.has(item.url)) return true
      const shared = overlap(tokens, g.tokens)
      const denom = Math.max(1, Math.min(tokens.size, g.tokens.size))
      return shared / denom >= 0.55
    })
    if (found) {
      found.ids.push(item.id)
      found.urls.add(item.url)
    } else {
      groups.push({ main: item, ids: [item.id], urls: new Set([item.url]), tokens })
    }
  }
  return groups.map((g) => ({ main: g.main, ids: g.ids }))
}

export interface RelatedResult {
  items: Item[]
  keywords: string[]
  /** 时间线素材（合并后的代表条目 + 同事件的其他 id） */
  groups: Array<{ main: Item; ids: string[] }>
}

/** 用实体词在本地全量条目里找相关新闻；目标条目始终排在最前 */
export function collectRelatedItems(
  store: Store,
  input: { itemId: string; text?: string; limit?: number }
): RelatedResult {
  const target = store.items.get(input.itemId)
  if (!target) return { items: [], keywords: [], groups: [] }

  const keywords = extractKeywords(target.title, input.text ?? '')
  const byId = new Map<string, Item>([[target.id, target]])
  for (const kw of keywords) {
    // 关键词至少 3 字才走 FTS，短词由 store 退化为 LIKE
    for (const hit of store.items.search(kw, { limit: 50, sort: 'time' })) {
      if (!byId.has(hit.id)) byId.set(hit.id, hit)
    }
  }

  const items = [...byId.values()]
    .sort((a, b) => (b.publishedAt ?? b.fetchedAt) - (a.publishedAt ?? a.fetchedAt))
    .slice(0, input.limit ?? 60)

  return { items, keywords, groups: mergeDuplicates(items) }
}

function refOf(item: Item, store: Store): TimelineItemRef {
  return {
    id: item.id,
    title: item.title,
    url: item.url,
    sourceName: store.sources.get(item.sourceId)?.name ?? item.sourceId,
    date: dateOf(item.publishedAt ?? item.fetchedAt),
    summary: item.summary.slice(0, 240)
  }
}

export function toTimelineRefs(store: Store, items: Item[]): TimelineItemRef[] {
  return items.map((it) => refOf(it, store))
}

/** 没有模型时的确定性时间线：按天分组，多来源标注，不编造 */
export function buildDeterministicTimeline(
  store: Store,
  groups: Array<{ main: Item; ids: string[] }>,
  title: string,
  note?: string
): EventTimeline {
  const refs = groups.map((g) => ({
    date: dateOf(g.main.publishedAt ?? g.main.fetchedAt),
    ref: refOf(g.main, store),
    ids: g.ids
  }))
  refs.sort((a, b) => a.date.localeCompare(b.date))

  const phases: TimelinePhase[] = []
  for (const r of refs) {
    const last = phases.at(-1)
    if (last && last.date === r.date) {
      last.sourceItemIds.push(...r.ids)
      last.confidence = last.sourceItemIds.length > 1 ? 'multi-source' : 'single-source'
      continue
    }
    phases.push({
      date: r.date,
      headline: r.ref.title,
      detail: r.ref.summary,
      status: 'reported',
      confidence: r.ids.length > 1 ? 'multi-source' : 'single-source',
      sourceItemIds: [...r.ids]
    })
  }

  return {
    title,
    range: { from: refs[0]?.date ?? '', to: refs.at(-1)?.date ?? '' },
    phases,
    gaps: findGaps(phases.map((p) => p.date)),
    openQuestions: [],
    mode: 'deterministic',
    ...(note ? { note } : {}),
    items: refs.map((r) => r.ref)
  }
}

/** 相邻两个日期之间空出来的整天 */
export function findGaps(dates: string[]): string[] {
  if (dates.length < 2) return []
  const gaps: string[] = []
  for (let i = 1; i < dates.length; i += 1) {
    const prev = new Date(`${dates[i - 1]}T00:00:00+08:00`).getTime()
    const cur = new Date(`${dates[i]}T00:00:00+08:00`).getTime()
    if (!Number.isFinite(prev) || !Number.isFinite(cur)) continue
    const missing = Math.round((cur - prev) / DAY) - 1
    if (missing > 0) gaps.push(`${dates[i - 1]} 之后有 ${missing} 天没有新进展`)
  }
  return gaps
}

const TIMELINE_SYSTEM = `你是新闻编辑，要基于给定素材整理一条事件时间线。

硬性规则：
1. 只使用给定素材，不得补充素材之外的数字、日期、引述。
2. 每条必须引用素材 id；没有素材支撑的句子不要写。
3. 单来源的条目标 confidence 为 "single-source"，多来源为 "multi-source"。
4. 官方/一手来源标 status="confirmed"；媒体报道标 "reported"；未证实爆料标 "rumor"。
5. 不要脑补缺失：时间上断档写进 gaps，未解问题写进 openQuestions。
6. 除专有名词外全部用中文。

只输出 JSON，不要代码块，结构：
{
  "title": "事件名",
  "range": {"from": "YYYY-MM-DD", "to": "YYYY-MM-DD"},
  "summary": "2-3 句",
  "phases": [{"date":"YYYY-MM-DD","headline":"...","detail":"...","status":"reported","confidence":"single-source","sourceItemIds":["id"]}],
  "gaps": ["..."],
  "openQuestions": ["..."]
}`

export function buildTimelinePrompt(
  refs: TimelineItemRef[],
  keywords: string[],
  title: string
): ChatMessage[] {
  const lines = [
    `事件：${title}`,
    `检索词：${keywords.join('、') || '（无）'}`,
    '',
    `素材（共 ${refs.length} 条）：`
  ]
  for (const r of refs) {
    lines.push(`- id=${r.id} | ${r.date} | ${r.sourceName} | ${r.title}`)
    if (r.summary) lines.push(`  摘要：${r.summary.replace(/\s+/g, ' ').slice(0, 160)}`)
  }
  return [
    { role: 'system', content: TIMELINE_SYSTEM },
    { role: 'user', content: lines.join('\n') }
  ]
}

/** 解析并校验模型输出：引用不存在、日期非法、没有来源的阶段一律丢弃 */
export function parseTimelineJson(raw: string, validIds: Set<string>, fallbackTitle: string): EventTimeline | null {
  const text = raw.trim().replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```$/, '')
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof data !== 'object' || data === null) return null
  const d = data as Record<string, unknown>
  const phasesRaw = Array.isArray(d['phases']) ? d['phases'] : []
  const phases: TimelinePhase[] = []
  for (const p of phasesRaw) {
    if (typeof p !== 'object' || p === null) continue
    const r = p as Record<string, unknown>
    const date = typeof r['date'] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r['date']) ? r['date'] : null
    const headline = typeof r['headline'] === 'string' ? r['headline'].trim() : ''
    const ids = Array.isArray(r['sourceItemIds'])
      ? r['sourceItemIds'].filter((x): x is string => typeof x === 'string' && validIds.has(x))
      : []
    if (!date || !headline || ids.length === 0) continue
    phases.push({
      date,
      headline,
      ...(typeof r['detail'] === 'string' ? { detail: r['detail'] } : {}),
      status: r['status'] === 'confirmed' || r['status'] === 'rumor' ? r['status'] : 'reported',
      confidence: ids.length > 1 ? 'multi-source' : 'single-source',
      sourceItemIds: [...new Set(ids)]
    })
  }
  if (phases.length === 0) return null
  phases.sort((a, b) => a.date.localeCompare(b.date))
  const dates = phases.map((p) => p.date)
  return {
    title: typeof d['title'] === 'string' && d['title'].trim() ? d['title'].trim() : fallbackTitle,
    range: { from: dates[0]!, to: dates.at(-1)! },
    ...(typeof d['summary'] === 'string' ? { summary: d['summary'] } : {}),
    phases,
    gaps: Array.isArray(d['gaps']) ? d['gaps'].filter((x): x is string => typeof x === 'string').slice(0, 6) : findGaps(dates),
    openQuestions: Array.isArray(d['openQuestions'])
      ? d['openQuestions'].filter((x): x is string => typeof x === 'string').slice(0, 6)
      : [],
    mode: 'agent'
  }
}
