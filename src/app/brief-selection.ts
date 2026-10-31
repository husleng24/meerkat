/**
 * 简报选材：两条容易被忽略、但直接影响体感的规则。
 *
 * 1. **跨天去重**：48 小时窗口天然会重叠，昨天推过的新闻今天不该再推。
 * 2. **引用回填**：只有在成稿里真正被引用的条目才算"已推送"，
 *    模型看了但没选的内容必须留到明天——否则一次没选中就永久消失。
 *
 * 这两条都是纯函数，因为它们的错误不会报错，只会让简报悄悄变差。
 */
import type { DedupedItem } from '../core/pipeline/dedupe'

/**
 * 从 markdown 里抽出所有链接目标。
 *
 * 刻意不只匹配 `](url)` 语法：模型偶尔会直接写裸 URL，
 * 漏掉的话那条内容今天不会被标记，明天又推一遍。
 * 因此统一按 http(s) 扫，再剥掉中英文尾部标点。
 */
export function extractUrls(markdown: string): string[] {
  const out = new Set<string>()
  const re = /https?:\/\/[^\s)\]}>"，。；：、）】]+/g
  for (const m of markdown.matchAll(re)) {
    const cleaned = m[0].replace(/[.,;:]+$/, '')
    if (cleaned.length > 8) out.add(cleaned)
  }
  return [...out]
}

/**
 * 找出成稿里被引用的条目 id。
 *
 * 一个条目可能带多个来源链接（同事件合并），任一链接命中即视为被引用。
 */
export function citedItemIds(markdown: string, items: DedupedItem[]): string[] {
  const cited = new Set(extractUrls(markdown))
  const out: string[] = []
  for (const it of items) {
    if (cited.has(it.url)) {
      out.push(it.id)
      continue
    }
    // 去重时被合并掉的来源，其 url 也可能出现在成稿里
    const merged = (it as DedupedItem & { mergedUrls?: string[] }).mergedUrls
    if (merged && merged.some((u: string) => cited.has(u))) out.push(it.id)
  }
  return out
}

export interface FilterResult {
  items: DedupedItem[]
  /** 被"昨天推送过"过滤掉的条数 */
  dropped: number
  /** 是否因为剩得太少而放弃过滤（保护性回退） */
  overridden: boolean
}

/** 低于这个数量就不做跨天去重了——宁可重复，也不能交一份几乎空的简报 */
export const MIN_AFTER_FILTER = 8

/**
 * 过滤掉已推送过的条目。
 *
 * 注意回退条件用的是"剩余比例与绝对数量"双重判断：
 * 如果今天就是没有新东西，硬撑着只推 3 条会让简报显得残缺，
 * 不如把昨天的再列一遍——用户会认出来，但不会觉得坏了。
 */
export function filterAlreadyBriefed(items: DedupedItem[], briefedIds: Set<string>): FilterResult {
  if (briefedIds.size === 0) return { items, dropped: 0, overridden: false }
  const kept = items.filter((i) => !briefedIds.has(i.id))
  const dropped = items.length - kept.length
  if (dropped === 0) return { items, dropped: 0, overridden: false }

  const floor = Math.max(MIN_AFTER_FILTER, Math.ceil(items.length * 0.3))
  if (kept.length < floor) return { items, dropped: 0, overridden: true }
  return { items: kept, dropped, overridden: false }
}
