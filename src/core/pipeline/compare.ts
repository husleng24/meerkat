/**
 * 「和昨天比，什么变了」：两期简报的条目对账。
 *
 * 为什么在界面层做而不是让模型写：模型每次都能"写出一段像样的对比"，
 * 但没人能验证它说的是不是真的。这里只做集合运算，结论可复算、可断言。
 *
 * 判定刻意复用跨天去重的那套语义（URL 规范化后相同，或标题指纹相似度
 * 超过 DEDUPE_RATIO），不另立阈值——否则会出现"同一件事采集时算重复、
 * 对比时算新增"的自相矛盾。代价是：标题差异很大的同事件会被记成新增，
 * 宁可漏报也不误报（误报会让"有进展"失去可信度）。
 */
import { canonicalUrl, titleKey } from './text'
import { sequenceRatio } from './similarity'
import { DEDUPE_MAX_LEN_DIFF, DEDUPE_RATIO } from '../policy/ranking'

/** 对比只需要这几个字段，不绑定简报的解析结果 */
export interface CompareEntry {
  /** 在所属那期简报里的位置 key，仅用于界面跳转，不参与匹配 */
  key: string
  title: string
  urls: string[]
  /** 板块标题（已剥掉序号），用于界面分组 */
  section: string
}

export interface CarriedEntry extends CompareEntry {
  /** 上一期里对应条目的标题；与 title 不同才值得展示 */
  previousTitle: string
}

export interface BriefComparison {
  /** 今天出现、上一期没有 */
  added: CompareEntry[]
  /** 上一期提过、今天还在讲 */
  carried: CarriedEntry[]
  /** 上一期提过、今天没再提 */
  dropped: CompareEntry[]
  todayTotal: number
  yesterdayTotal: number
}

/**
 * 对账。两趟匹配：
 *
 * 1. 先按 URL（规范化后）配对——这是硬证据，优先级最高；
 * 2. 剩下的再按标题相似度配对，取相似度最高的一对，避免"先到先得"
 *    把一条强匹配让给一条弱匹配。
 *
 * 复杂度 O(n·m)，两期各几十条，不需要更聪明的做法。
 */
export function compareBriefs(today: CompareEntry[], yesterday: CompareEntry[]): BriefComparison {
  const takenToday = new Set<number>()
  const takenYesterday = new Set<number>()
  /** today 下标 → yesterday 下标 */
  const pairs = new Map<number, number>()

  const urlKeys = (e: CompareEntry): Set<string> => new Set(e.urls.map(canonicalUrl))

  // 第一趟：URL 命中
  for (let i = 0; i < today.length; i += 1) {
    const keys = urlKeys(today[i]!)
    if (keys.size === 0) continue
    for (let j = 0; j < yesterday.length; j += 1) {
      if (takenYesterday.has(j)) continue
      if (yesterday[j]!.urls.some((u) => keys.has(canonicalUrl(u)))) {
        pairs.set(i, j)
        takenToday.add(i)
        takenYesterday.add(j)
        break
      }
    }
  }

  // 第二趟：标题相似度，取最优
  for (let i = 0; i < today.length; i += 1) {
    if (takenToday.has(i)) continue
    let bestJ = -1
    let bestRatio = DEDUPE_RATIO
    for (let j = 0; j < yesterday.length; j += 1) {
      if (takenYesterday.has(j)) continue
      const a = today[i]!.title
      const b = yesterday[j]!.title
      const ka = titleKey(a)
      const kb = titleKey(b)
      if (!ka || !kb) continue
      if (Math.abs(ka.length - kb.length) >= DEDUPE_MAX_LEN_DIFF) continue
      const ratio = sequenceRatio(ka, kb)
      if (ratio > bestRatio) {
        bestRatio = ratio
        bestJ = j
      }
    }
    if (bestJ >= 0) {
      pairs.set(i, bestJ)
      takenToday.add(i)
      takenYesterday.add(bestJ)
    }
  }

  const added: CompareEntry[] = []
  const carried: CarriedEntry[] = []
  today.forEach((entry, i) => {
    const j = pairs.get(i)
    if (j === undefined) {
      added.push(entry)
      return
    }
    carried.push({ ...entry, previousTitle: yesterday[j]!.title })
  })
  const dropped = yesterday.filter((_, j) => !takenYesterday.has(j))

  return { added, carried, dropped, todayTotal: today.length, yesterdayTotal: yesterday.length }
}
