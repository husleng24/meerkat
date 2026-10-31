/**
 * 把「两期简报的 markdown」适配成 core 的对比入参。
 *
 * 解析在渲染层做（parseBrief），判定在 core 做（compareBriefs）；
 * 这里只负责搬运，不放任何判定逻辑。
 */
import {
  compareBriefs as compareEntries,
  type BriefComparison,
  type CompareEntry
} from '../../../core/pipeline/compare'
import type { ParsedBrief } from './parseBrief'

export type { BriefComparison, CompareEntry }

/** 板块标题形如 "① 模型与产品发布"，界面上不再重复序号 */
const SECTION_PREFIX = /^[\u2460-\u2473]\s*/

export function toCompareEntries(brief: ParsedBrief): CompareEntry[] {
  return brief.sections.flatMap((section) =>
    section.items.map((item) => ({
      key: item.key,
      title: item.title,
      urls: item.links.map((l) => l.url),
      section: section.heading.replace(SECTION_PREFIX, '')
    }))
  )
}

export function compareBriefs(today: ParsedBrief, yesterday: ParsedBrief): BriefComparison {
  return compareEntries(toCompareEntries(today), toCompareEntries(yesterday))
}
