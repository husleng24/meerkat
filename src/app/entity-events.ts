/**
 * 实体事件层：把「这家公司最近发生了什么」拆成融资/产品/裁员/监管/安全/研究/合作。
 *
 * 规则分类，不调用模型：
 * - 同样的标题永远得到同一个标签；
 * - 误判可以靠关键词调整，不需要重新跑一遍 LLM；
 * - 先解决「一眼看出结构」，不追求语义完美。
 */
export type EntityEvent =
  | 'funding'
  | 'product'
  | 'layoff'
  | 'regulation'
  | 'security'
  | 'research'
  | 'partnership'
  | 'other'

export const EVENT_TYPES: EntityEvent[] = [
  'funding',
  'product',
  'layoff',
  'regulation',
  'security',
  'research',
  'partnership',
  'other'
]

export const EVENT_LABEL: Record<EntityEvent, string> = {
  funding: '融资',
  product: '产品',
  layoff: '裁员',
  regulation: '监管',
  security: '安全',
  research: '研究',
  partnership: '合作',
  other: '其他'
}

/** 顺序有意义：安全/裁员这类负面事件优先于泛泛的“发布/合作”关键词。 */
export function classifyEntityEvent(title: string, summary = ''): EntityEvent {
  const text = `${title}\n${summary}`.toLowerCase()
  if (/(layoff|layoffs|laid off|lays off|lay off|job cuts|restructur|裁员|离职|缩编)/.test(text)) return 'layoff'
  if (/(breach|hack|hacked|exploit|vulnerab|leak|security|攻击|漏洞|泄露|入侵)/.test(text)) return 'security'
  if (/(lawsuit|sue|sued|regulat|antitrust|investigat|fine|penalt|ban|监管|诉讼|调查|罚款|禁令)/.test(text)) {
    return 'regulation'
  }
  if (/(raises|raised|funding|financing|series [a-z]|valuation|ipo|估值|融资|上市|轮融资)/.test(text)) return 'funding'
  if (/(acquire|acquisition|merger|partner|partnership|收购|合并|合作)/.test(text)) return 'partnership'
  if (/(paper|benchmark|research|study|论文|研究|基准|实验)/.test(text)) return 'research'
  if (/(launch|release|introduc|unveil|announc|发布|上线|推出|更新|升级)/.test(text)) return 'product'
  return 'other'
}

export interface EntityPeriod {
  current: number
  previous: number
  currentByEvent: Record<EntityEvent, number>
  previousByEvent: Record<EntityEvent, number>
}

function emptyByEvent(): Record<EntityEvent, number> {
  return {
    funding: 0,
    product: 0,
    layoff: 0,
    regulation: 0,
    security: 0,
    research: 0,
    partnership: 0,
    other: 0
  }
}

/** 最近 7 天 vs 前 7 天；没有时间戳的内容不进入对比。 */
export function entityPeriods(items: Array<{ at: number; event: EntityEvent }>, now = Date.now()): EntityPeriod {
  const currentByEvent = emptyByEvent()
  const previousByEvent = emptyByEvent()
  const currentStart = now - 7 * 86_400_000
  const previousStart = now - 14 * 86_400_000
  let current = 0
  let previous = 0
  for (const item of items) {
    if (item.at >= currentStart) {
      current++
      currentByEvent[item.event]++
    } else if (item.at >= previousStart) {
      previous++
      previousByEvent[item.event]++
    }
  }
  return { current, previous, currentByEvent, previousByEvent }
}
