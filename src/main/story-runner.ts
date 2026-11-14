/**
 * 采集结束后刷新所有跟踪中的事件，并把结果写回发起跟踪的评论串。
 *
 * 只追加"有变化"和"刚好连续空跑到达阈值"两种消息，避免每个评论串被每天
 * 的"没有新进展"刷屏。
 */
import type { Store } from '../core/ports/store'
import { STALE_AFTER_MISSES, refreshStories } from '../app/story-tracking'
import { log } from './log'

export interface StoryRunSummary {
  storyId: string
  title: string
  added: number
  missCount: number
  prompted: boolean
}

export function runStoriesAfterCollect(store: Store, now = Date.now()): StoryRunSummary[] {
  const results = refreshStories(store, now)
  const out: StoryRunSummary[] = []

  for (const r of results) {
    const thread = r.story.threadId ? store.chat.get(r.story.threadId) : undefined
    let prompted = false

    if (r.added.length > 0 && thread) {
      const lines = r.added.slice(0, 4).map((i) => `· ${i.title}`)
      store.chat.addMessage({
        id: `cm-${now}-story-${r.story.id}`,
        threadId: thread.id,
        role: 'assistant',
        content: `跟踪更新：新增 ${r.added.length} 条进展\n${lines.join('\n')}`,
        contextJson: JSON.stringify({
          storyUpdate: { storyId: r.story.id, count: r.added.length, itemIds: r.added.map((i) => i.id) }
        }),
        createdAt: now
      })
      store.chat.update(thread.id, { updatedAt: now })
    }

    if (r.missCount === STALE_AFTER_MISSES && thread) {
      prompted = true
      store.chat.addMessage({
        id: `cm-${now}-story-review-${r.story.id}`,
        threadId: thread.id,
        role: 'assistant',
        content: `「${r.story.title}」连续 ${STALE_AFTER_MISSES} 次采集没有新进展了。还要继续跟踪吗？`,
        contextJson: JSON.stringify({ storyReview: { storyId: r.story.id, missCount: r.missCount } }),
        createdAt: now
      })
      store.chat.update(thread.id, { updatedAt: now })
    }

    out.push({
      storyId: r.story.id,
      title: r.story.title,
      added: r.added.length,
      missCount: r.missCount,
      prompted
    })
    if (r.added.length > 0) {
      log('info', `跟踪「${r.story.title}」新增 ${r.added.length} 条`)
    }
  }
  return out
}
