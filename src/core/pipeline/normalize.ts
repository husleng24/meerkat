/**
 * 归一化：把抓取器的 RawItem 变成可入库的 Item（含分类与打分）。
 * 与 radar.py::_mk + main() 里"逐条 assign_bucket / score_item"两段等价。
 */
import type { Item, RawItem, Source } from '../domain/types'
import { cleanHtml, canonicalUrl } from './text'
import { itemId } from './item-id'
import { classifyForSource } from './classify'
import { scoreItem, type ScoreContext } from './rank'
import { FORMULA_VERSION, itemTypeOf } from '../policy/ranking'

const TITLE_MAX = 300
const SUMMARY_MAX = 900

export function toItem(raw: RawItem, source: Source, ctx: ScoreContext): Item {
  const title = cleanHtml(raw.title).slice(0, TITLE_MAX)
  const url = canonicalUrl(raw.url)
  const summary = cleanHtml(raw.summary ?? '').slice(0, SUMMARY_MAX)

  const bucket = classifyForSource(source, { title, summary })
  const score = scoreItem(
    {
      title,
      summary,
      tier: source.tier,
      type: raw.type ?? itemTypeOf(source),
      ...(raw.publishedAt !== undefined ? { publishedAt: raw.publishedAt } : {}),
      ...(raw.points !== undefined ? { points: raw.points } : {})
    },
    ctx
  )

  return {
    id: itemId(url, title),
    sourceId: source.id,
    title,
    url,
    summary,
    bucket,
    score,
    formulaVersion: FORMULA_VERSION,
    alsoIn: [],
    fetchedAt: ctx.now,
    ...(raw.author ? { author: raw.author.slice(0, 80) } : {}),
    ...(raw.publishedAt !== undefined ? { publishedAt: raw.publishedAt } : {}),
    ...(raw.points !== undefined ? { points: raw.points } : {}),
    ...(raw.comments !== undefined ? { comments: raw.comments } : {})
  }
}
