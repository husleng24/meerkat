/**
 * 「今天没有变化」也是简报的一种结论。
 *
 * 以前候选不足时仍然逼模型写 15–24 条，结果是把同一天的旧闻、
 * 低信号内容重新排版一遍。宁可明确告诉用户「今天没有值得改变判断的变化」，
 * 也不要制造一份看起来完整、实际没有信息增量的日报。
 */
import { briefTitle } from './brief-identity'

/** 少于这个条数就不调用模型，直接出「无变化」 */
export const NO_CHANGE_MIN_ITEMS = 3

export interface NoChangeContext {
  topicName: string
  dateLabel: string
  weekday: string
  windowHours: number
  sourceCount: number
  /** 这轮抓取失败的源数量；0 表示全部成功 */
  failedSources: number
  candidates: number
  droppedAsBriefed: number
}

/** 全部源都失败时不能下「今天没有变化」的结论；调用方应走失败提示 */
export function allSourcesFailed(sourceStats: Array<{ ok: boolean }>): boolean {
  return sourceStats.length > 0 && sourceStats.every((s) => !s.ok)
}

/** 少于这个条数就不调用模型，直接出「无变化」 */

export function shouldSkipBrief(items: { length: number }): boolean {
  return items.length < NO_CHANGE_MIN_ITEMS
}

/** 给用户看的版本：不装成一篇正常日报，也不留空文件 */
export function renderNoChangeBrief(ctx: NoChangeContext): string {
  const heading = ctx.failedSources > 0 ? '今天没有足够的新变化' : '今天没有值得改变判断的变化'
  const failure =
    ctx.failedSources > 0
      ? `其中 ${ctx.failedSources} 个信息源抓取失败，不能完全排除是抓取问题；请先打开「来源」确认。`
      : ''
  const dropped =
    ctx.droppedAsBriefed > 0
      ? `另有 ${ctx.droppedAsBriefed} 条此前已经推送过，没有重复计入。`
      : ''
  const lines = [
    `# ${briefTitle(ctx.topicName, ctx.dateLabel, ctx.weekday)}`,
    '',
    `> 覆盖最近 ${ctx.windowHours} 小时 · ${ctx.sourceCount} 个信息源`,
    '',
    `## ${heading}`,
    '',
    `本期检查了 ${ctx.sourceCount} 个信息源；去重后有 ${ctx.candidates} 条新候选，` +
      `不足 ${NO_CHANGE_MIN_ITEMS} 条值得展开的内容。`,
    '',
    failure || dropped || '这不是抓取失败，只是今天没有出现足以改变判断的新事实。',
    ...(failure && dropped ? ['', dropped] : []),
    '',
    '你可以明天再看，或直接打开「来源」检查本期采集。'
  ]
  return lines.join('\n')
}
