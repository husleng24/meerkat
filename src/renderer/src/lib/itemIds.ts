/**
 * 把解析出来的简报条目映射到数据库条目 id。
 *
 * 为什么需要这一步：简报正文里只有 URL，没有 id。而"已读/收藏"要持久化到
 * items 表对应的行上，就必须先反查。
 *
 * 用**第一个能对上源的链接**做匹配，因为模型常把同一事件的多条素材合并成一条
 * （官方博客 + HN 讨论），任一链接能命中就说明是同一条。
 */
import type { ParsedBrief } from './parseBrief'

export function resolveItemIds(brief: ParsedBrief | null, urlToId: Record<string, string>): Map<string, string> {
  const map = new Map<string, string>()
  if (!brief) return map
  for (const section of brief.sections) {
    for (const item of section.items) {
      for (const link of item.links) {
        const id = urlToId[link.url]
        if (id) {
          map.set(item.key, id)
          break
        }
      }
    }
  }
  return map
}
