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
 * 模型只看到主 URL；同事件的其他来源名只用于证据展示，不参与引用匹配。
 */
export function citedItemIds(markdown: string, items: DedupedItem[]): string[] {
  const cited = new Set(extractUrls(markdown))
  const out: string[] = []
  for (const it of items) {
    if (cited.has(it.url)) out.push(it.id)
  }
  return out
}

export interface FilterResult {
  items: DedupedItem[]
  /** 被"此前推送过"过滤掉的条数 */
  dropped: number
  /** kept 低于下限；仅用于说明这期偏薄，不再改变 items */
  overridden: boolean
}

/**
 * 低于这个数量时标记 overridden。以前调用方会把旧闻重新摆一遍；
 * 现在交给「今天没有变化」处理，绝不为了凑条数重复推送。
 */
export const MIN_AFTER_FILTER = 8

/**
 * 过滤掉已推送过的条目。
 *
 * 「只剩很少」不再回退到完整列表：那会把昨天/今天早些时候推过的内容
 * 重新摆上来，正是 no-change 要消灭的假日报。调用方拿到 kept 后再决定
 * 是正常成稿还是「今天没有变化」。
 */
export function filterAlreadyBriefed(items: DedupedItem[], briefedIds: Set<string>): FilterResult {
  if (briefedIds.size === 0) return { items, dropped: 0, overridden: false }
  const kept = items.filter((i) => !briefedIds.has(i.id))
  const dropped = items.length - kept.length
  if (dropped === 0) return { items, dropped: 0, overridden: false }

  const floor = Math.max(MIN_AFTER_FILTER, Math.ceil(items.length * 0.3))
  return { items: kept, dropped, overridden: kept.length < floor }
}
