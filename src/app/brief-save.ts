/**
 * 简报落库的覆盖策略。
 *
 * 真实场景：上午生成了一份好简报，下午你手滑点了"立即采集"，
 * 恰好模型超时 → 一份"仅聚合"的残缺版把好版本覆盖掉，而且无法恢复。
 *
 * 规则：**降级版不得覆盖非降级版**；同一天再跑出正常版本则可以覆盖。
 * 这条不做成配置项——没有人会希望自己的好数据被坏数据冲掉。
 */
import type { Brief } from '../core/domain/types'

export type SaveReason =
  | 'first' // 当天第一次
  | 'replaced' // 覆盖了旧版（新版不差）
  | 'kept-existing' // 拒绝写入，保留旧版
  | 'upgraded' // 用正常版覆盖了旧的降级版

export interface SaveDecision {
  write: boolean
  reason: SaveReason
  /** 给人看的说明，会进日志/通知 */
  detail: string
}

/** 降级版的特征：没有模型参与，model 记为 none（见 compose-brief） */
export function isDegradedBrief(b: Pick<Brief, 'model'>): boolean {
  return b.model === 'none'
}

export interface IncomingBrief {
  degraded: boolean
  /** 这期是「今天没有变化」，不是正常简报 */
  noChange?: boolean
  /** 引用条数，用于"两份都正常时谁更好"的次要判断 */
  citedCount?: number
}

export function decideSave(existing: Brief | undefined, incoming: IncomingBrief): SaveDecision {
  if (!existing) {
    return { write: true, reason: 'first', detail: '当天第一份简报' }
  }

  const existingDegraded = isDegradedBrief(existing)
  const existingNoChange = existing.model === 'no-change'
  const incomingNoChange = incoming.noChange === true

  // 正常简报永远不能被「今天没有变化」覆盖；反过来，正常版可以替换无变化版
  if (incomingNoChange && !existingNoChange) {
    return {
      write: false,
      reason: 'kept-existing',
      detail: '新版本是「无变化」，已保留当天已有的正常简报'
    }
  }

  // 降级版不能覆盖任何非降级版，包括「今天没有变化」——后者也是明确结论
  if (incoming.degraded && !existingDegraded) {
    return {
      write: false,
      reason: 'kept-existing',
      detail: '新版本是降级（未接模型），已保留原有的完整简报'
    }
  }

  if (!incomingNoChange && existingNoChange) {
    return { write: true, reason: 'upgraded', detail: '用正常简报替换了已有的无变化版' }
  }

  if (!incoming.degraded && existingDegraded) {
    return { write: true, reason: 'upgraded', detail: '用完整版替换了已有的降级版' }
  }

  return { write: true, reason: 'replaced', detail: '覆盖同一天的旧版本' }
}
