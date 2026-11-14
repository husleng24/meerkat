/**
 * 持续跟踪：命中新条目、判断"是不是很久没动静了"。
 *
 * 纯逻辑，不碰 Electron；主进程负责把结果写回评论串和通知。
 */
import type { Store } from '../core/ports/store'
import type { Item, Story } from '../core/domain/types'
import { extractKeywords } from './event-timeline'

/** 连续多少次采集没有新进展就问一句 */
export const STALE_AFTER_MISSES = 3
/** 同一事件两次询问之间至少隔这么久，避免天天弹 */
const PROMPT_COOLDOWN = 7 * 86_400_000

export function createStoryFromItem(
  store: Store,
  input: { itemId: string; threadId: string; topicId: string; text?: string; now?: number }
): Story | null {
  const item = store.items.get(input.itemId)
  if (!item) return null
  const now = input.now ?? Date.now()
  // 别名只从新闻标题取：评论里的"帮我盯着"不是实体，混进去会误匹配
  const aliases = extractKeywords(item.title)
  const story: Story = {
    id: `st-${now}-${Math.random().toString(36).slice(2, 8)}`,
    title: item.title.slice(0, 60),
    query: item.title,
    aliases: aliases.length > 0 ? aliases : [item.title.slice(0, 12)],
    topicId: input.topicId,
    itemId: item.id,
    threadId: input.threadId,
    status: 'active',
    missCount: 0,
    createdAt: now,
    updatedAt: now
  }
  return story
}

/** 这条 story 自上次检查以来命中的新条目（不含已挂上的） */
export function newStoryItems(store: Store, story: Story): Item[] {
  const since = story.lastMatchAt ?? story.createdAt
  const known = new Set(store.stories.itemIds(story.id))
  const byId = new Map<string, Item>()
  for (const alias of story.aliases) {
    if (alias.trim().length < 2) continue
    for (const item of store.items.search(alias, { sinceTs: since, limit: 30, sort: 'time' })) {
      if (!known.has(item.id)) byId.set(item.id, item)
    }
  }
  return [...byId.values()].sort((a, b) => (a.publishedAt ?? a.fetchedAt) - (b.publishedAt ?? b.fetchedAt))
}

export interface StoryRefresh {
  story: Story
  added: Item[]
  /** 连续无进展的次数（本次更新后） */
  missCount: number
}

/** 每轮采集后调用：追加新命中，连续空跑就累计 missCount */
export function refreshStories(store: Store, now = Date.now()): StoryRefresh[] {
  const out: StoryRefresh[] = []
  for (const story of store.stories.list('active')) {
    const added = newStoryItems(store, story)
    if (added.length > 0) store.stories.addItems(story.id, added.map((i) => i.id), now)
    const missCount = added.length > 0 ? 0 : story.missCount + 1
    store.stories.update(story.id, { missCount, lastMatchAt: now, updatedAt: now })
    out.push({ story: store.stories.get(story.id)!, added, missCount })
  }
  return out
}

/** 需要询问"还要继续吗"的跟踪：连续空跑 ≥ 阈值，且不在冷却期 */
export function storiesToReview(store: Store, now = Date.now()): Story[] {
  return store.stories.list('active').filter((s) => {
    if (s.missCount < STALE_AFTER_MISSES) return false
    if (s.lastPromptAt && now - s.lastPromptAt < PROMPT_COOLDOWN) return false
    return true
  })
}

/** 弹过窗就先记一笔，避免每次启动都问 */
export function markStoryPrompted(store: Store, id: string, now = Date.now()): void {
  store.stories.update(id, { lastPromptAt: now, updatedAt: now })
}

export function setStoryStatus(store: Store, id: string, status: Story['status']): Story | undefined {
  const story = store.stories.get(id)
  if (!story) return undefined
  store.stories.update(id, {
    status,
    ...(status === 'active' ? { missCount: 0, lastPromptAt: Date.now() } : {}),
    updatedAt: Date.now()
  })
  return store.stories.get(id)
}
