/**
 * 信任层的一版「可解释启发式」，不假装是事实核查。
 *
 * - 事实/推断/传闻：按措辞分类，标签会错，但同一个标题永远得到同一个结果；
 * - 来源多样性：统计来源数与最大单源占比；
 * - 无依据：没有 trace 来源证据的条目占比，是「无引用」而不是语义上的真假判断。
 *
 * 这些指标用于发现风险，不用于替代人工核实。
 */
export type ClaimKind = 'fact' | 'inference' | 'rumor'

export const CLAIM_LABEL: Record<ClaimKind, string> = {
  fact: '事实',
  inference: '推断',
  rumor: '传闻'
}

const RUMOR = [
  'rumor', 'rumour', 'reportedly', 'allegedly', 'unconfirmed', 'sources say', 'it is said',
  '传闻', '据说', '据称', '网传', '未确认', '未经证实', '有小道消息'
]

const INFERENCE = [
  'may ', 'might ', 'could ', 'likely', 'probably', 'expect', 'forecast', 'predict', 'estimate',
  '可能', '预计', '或许', '有望', '看起来', '分析认为', '我认为', '判断', '推测', '似乎'
]

/** 顺序：传闻 > 推断 > 事实；「事实」只表示有来源报道，不表示已被独立验证。 */
export function classifyClaim(title: string, body = ''): ClaimKind {
  const text = `${title}\n${body}`.toLowerCase()
  if (RUMOR.some((k) => text.includes(k))) return 'rumor'
  if (INFERENCE.some((k) => text.includes(k))) return 'inference'
  return 'fact'
}

export interface TrustItem {
  title: string
  body: string
  /** trace 里的 sourceName + alsoIn；没有 trace 的旧简报为空 */
  sourceNames: string[]
  hasTrace: boolean
}

export interface TrustAudit {
  total: number
  fact: number
  inference: number
  rumor: number
  sources: number
  topSource: string
  /** 最大单源占比，0–100 */
  topShare: number
  /** 没有来源证据的条目数；trace 不可用时为 null */
  unsupported: number | null
  /** 无依据率，0–100；trace 不可用时 null */
  unsupportedRate: number | null
  traceAvailable: boolean
}

export function auditTrust(items: TrustItem[]): TrustAudit {
  let fact = 0
  let inference = 0
  let rumor = 0
  let unsupported = 0
  let withTrace = 0
  const sourceCount = new Map<string, number>()
  let traceAvailable = false

  for (const item of items) {
    const claim = classifyClaim(item.title, item.body)
    if (claim === 'fact') fact++
    else if (claim === 'inference') inference++
    else rumor++

    if (item.hasTrace) {
      traceAvailable = true
      withTrace++
    } else {
      unsupported++
    }
    for (const name of new Set(item.sourceNames.filter(Boolean))) {
      sourceCount.set(name, (sourceCount.get(name) ?? 0) + 1)
    }
  }

  const total = items.length
  const ranked = [...sourceCount.entries()].sort((a, b) => b[1] - a[1])
  const top = ranked[0]
  return {
    total,
    fact,
    inference,
    rumor,
    sources: sourceCount.size,
    topSource: top?.[0] ?? '',
    topShare: total > 0 && top ? Math.round((top[1] / total) * 100) : 0,
    unsupported: traceAvailable ? unsupported : null,
    unsupportedRate: traceAvailable && total > 0 ? Math.round((unsupported / total) * 100) : null,
    traceAvailable
  }
}
