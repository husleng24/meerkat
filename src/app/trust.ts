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

export interface ClaimCoverage {
  claims: number
  cited: number
  /** 0–100 */
  rate: number
}

export interface ClaimCitation {
  text: string
  /** 直接命中来源名，还是继承整条内容的链接 */
  direct: boolean
  sources: Array<{ name: string; url: string }>
}

/**
 * 把一条内容的句子绑定到具体来源。
 *
 * 判定顺序：
 * 1. 句子里出现某个来源名（如 TechCrunch）→ 只绑定这个来源，标记 direct；
 * 2. 没有命中 → 继承条目的全部链接，标记 inherited（不是逐句语义匹配）；
 * 3. 条目没有链接 → sources 为空。
 */
export function bindClaimCitations(input: {
  title: string
  body: string
  links: Array<{ label: string; url: string }>
}): ClaimCitation[] {
  const claims = splitClaims(input.body || input.title)
  return claims.map((text) => {
    const lower = text.toLowerCase()
    const direct = input.links.filter((l) => l.label.trim().length >= 2 && lower.includes(l.label.toLowerCase()))
    const sources = (direct.length > 0 ? direct : input.links).map((l) => ({ name: l.label, url: l.url }))
    return { text, direct: direct.length > 0, sources }
  })
}

/** 把正文拆成可核查的句子；太短的口号/标题不算。 */
export function splitClaims(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .split(/(?<=[。！？!?；;])|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8)
}

/**
 * 句子级引用覆盖率的诚实定义：
 * - 一个条目只要挂了来源链接，就视为该条目的正文句子都有出处；
 * - 三句话速览是模型综合句，没有直接链接，因此按「未直接引用」计入；
 * - 这不是语义验证，只是「有没有链接可点」。
 */
export function auditClaimCoverage(
  items: Array<{ text: string; hasLink: boolean }>,
  highlights: string[] = []
): ClaimCoverage {
  let claims = 0
  let cited = 0
  for (const item of items) {
    const sentences = splitClaims(item.text)
    const n = sentences.length > 0 ? sentences.length : 1
    claims += n
    if (item.hasLink) cited += n
  }
  for (const h of highlights) {
    if (h.trim().length === 0) continue
    claims += 1
    // 速览句没有逐条链接：不假装它被直接引用
  }
  return { claims, cited, rate: claims > 0 ? Math.round((cited / claims) * 100) : 0 }
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
