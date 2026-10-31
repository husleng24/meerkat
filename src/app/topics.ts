/**
 * 主题相关的用例级逻辑。
 *
 * 现在只有一件事：首次运行时把已灌入的源挂到默认主题上。
 * 用 settings 里的标记保证"只做一次"——否则用户从主题里删掉的源，
 * 下次启动又会被默默加回来，等于删不掉。
 */
import type { Store } from '../core/ports/store'

const SEEDED_KEY = 'topics.membershipSeeded'
export const DEFAULT_TOPIC_ID = 'ai'

export function defaultTopicMembershipSeeded(store: Store): boolean {
  return store.settings.get<boolean>(SEEDED_KEY) === true
}

/** 返回挂上去的源数量；已经做过就返回 0 */
export function seedDefaultMembership(store: Store): number {
  if (defaultTopicMembershipSeeded(store)) return 0
  const ids = store.sources.list().map((s) => s.id)
  if (ids.length === 0) return 0
  if (!store.topics.get(DEFAULT_TOPIC_ID)) return 0
  store.topics.setSources(DEFAULT_TOPIC_ID, ids)
  store.settings.set(SEEDED_KEY, true)
  return ids.length
}
