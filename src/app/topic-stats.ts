/**
 * 领域侧栏要显示的两个数字。
 *
 * 为什么单独成纯函数：这两个数都会"悄悄算错"——条数算多了看起来像有新闻，
 * 未读算少了用户会漏读。放进 app 层后可以用内存库直接测。
 *
 * 口径：
 *  - todayCount＝该领域**最新一期简报**里的条目数（与内容区「23 条」同一个来源）
 *  - unreadCount＝这一期里还没被标记已读的条目数（按 URL 反查条目 id）
 */
import type { Store } from '../core/ports/store'
import { extractUrls } from './brief-selection'

export interface TopicStats {
  todayCount: number
  unreadCount: number
  /** 最新一期的日期；没有简报时为 undefined（界面据此显示「—」而不是 0） */
  date?: string
}

/** 简报 markdown 里一条条目的开头是 `- **标题**`，与 parseBrief 的 ITEM_RE 一致 */
export function countBriefItems(markdown: string): number {
  const body = markdown.split('<details>')[0] ?? markdown
  let n = 0
  for (const line of body.split('\n')) {
    if (/^\s*-\s+\*\*.+\*\*/.test(line)) n += 1
  }
  return n
}

export function topicStats(store: Store, topicId: string): TopicStats {
  const brief = store.briefs.latest(topicId)
  if (!brief) return { todayCount: 0, unreadCount: 0 }

  const urls = extractUrls(brief.markdown)
  // 与 brief:latest 的反查窗口一致：条目按 createdAt 前 7 天取，再按 URL 对回 id
  const idByUrl = new Map<string, string>()
  for (const it of store.items.since(brief.createdAt - 7 * 86_400_000, 2_000)) {
    idByUrl.set(it.url, it.id)
  }
  const readIds = new Set(store.flags.byFlag('isRead', true))
  let unread = 0
  for (const url of urls) {
    const id = idByUrl.get(url)
    if (id && !readIds.has(id)) unread += 1
  }

  return { todayCount: countBriefItems(brief.markdown), unreadCount: unread, date: brief.date }
}
