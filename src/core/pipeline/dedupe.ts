/**
 * 去重：有状态的累加器，不是纯函数（见 ADR-7）。
 *
 * 为什么做成累加器：「同批次内合并」与「跨天不重复推送」是同一个机制的两面，
 * 共用一套阈值与状态，才不会出现"今天的重复被合并、昨天的却没有"。
 *
 * 与 radar.py::dedupe 等价：
 *  - 先按分数降序
 *  - URL 相同即重复
 *  - 否则标题指纹长度差 <45 且相似度 >0.86 即重复
 *  - 重复时把对方的来源名记进 alsoIn（同一事件的多来源证据）
 */
import type { Item } from '../domain/types'
import { titleKey } from './text'
import { sequenceRatio } from './similarity'
import { DEDUPE_MAX_LEN_DIFF, DEDUPE_RATIO } from '../policy/ranking'

export interface Sourced {
  item: Item
  sourceName: string
}

/** 去重后仍带来源名，供简报里标注"另见" */
export interface DedupedItem extends Item {
  sourceName: string
}

export interface DedupeState {
  kept: DedupedItem[]
}

export function createDedupeState(): DedupeState {
  return { kept: [] }
}

function isDuplicate(item: Item, key: string, candidate: DedupedItem): boolean {
  if (item.url === candidate.url) return true
  const k2 = titleKey(candidate.title)
  if (!key || !k2) return false
  if (Math.abs(key.length - k2.length) >= DEDUPE_MAX_LEN_DIFF) return false
  return sequenceRatio(key, k2) > DEDUPE_RATIO
}

/**
 * 吸收一条。返回是否被合并（true = 视为重复，未进入 kept）。
 * 纯逻辑但会修改 state，调用方按顺序 feed 即可。
 */
export function absorb(state: DedupeState, entry: Sourced): boolean {
  const key = titleKey(entry.item.title)
  for (const candidate of state.kept) {
    if (!isDuplicate(entry.item, key, candidate)) continue
    if (entry.sourceName !== candidate.sourceName && !candidate.alsoIn.includes(entry.sourceName)) {
      candidate.alsoIn.push(entry.sourceName)
    }
    return true
  }
  state.kept.push({ ...entry.item, alsoIn: [...entry.item.alsoIn], sourceName: entry.sourceName })
  return false
}

/** 批量便捷入口：先按分数降序，再依次 absorb */
export function dedupeAll(entries: Sourced[]): DedupedItem[] {
  const state = createDedupeState()
  const sorted = [...entries].sort((a, b) => b.item.score - a.item.score)
  for (const e of sorted) absorb(state, e)
  return state.kept
}
