/**
 * 排序策略：全部是数据，不是代码（见 ADR-4）。
 *
 * 数值直接来自 Python 原型 radar.py 的实测结果，通过 golden test 校验。
 * 改这里的任何数字都要同时 bump FORMULA_VERSION，否则历史分数无法解释。
 */
import type { Bucket, Source } from '../domain/types'

export const FORMULA_VERSION = 1

/** 来源层级权重 */
export const TIER_WEIGHT: Record<number, number> = { 1: 26, 2: 18, 3: 10 }
export const TIER_WEIGHT_FALLBACK = 12

/** 时效：14 × exp(-ageHours / 20) —— 半衰期约 20 小时 */
export const RECENCY_MAX = 14
export const RECENCY_HALFLIFE_HOURS = 20

/** 互动量：min(12, 3.2 × log10(1 + points)) */
export const ENGAGEMENT_MAX = 12
export const ENGAGEMENT_SCALE = 3.2

export const SIGNAL_STRONG_MAX = 16
export const SIGNAL_STRONG_EACH = 5
export const SIGNAL_WEAK_MAX = 4
export const SIGNAL_WEAK_EACH = 0.8

export const NOISE_PENALTY = 9
export const PAPER_PENALTY = 6 // 论文/热榜不与"新闻"同尺度竞争
export const QUOTING_PENALTY = 12
export const SHORT_TITLE_PENALTY = 4
export const SHORT_TITLE_LEN = 12
export const ARXIV_EXTRA_PENALTY = 2

/** 去重：标题相似度阈值与长度差保护 */
export const DEDUPE_RATIO = 0.86
export const DEDUPE_MAX_LEN_DIFF = 45

export const SIGNAL_STRONG = [
  'announc', 'launch', 'release', 'unveil', 'introduc', 'open-sourc',
  'open sourc', 'sota', 'state-of-the-art', 'beats gpt', 'outperform',
  'general availability', 'breaking', 'acquire', 'raises', '$',
  '发布', '开源', '首发', '超越'
]

export const SIGNAL_WEAK = [
  'benchmark', 'report', 'survey', 'update', 'improve', 'faster',
  'cheaper', 'new', 'first', '突破', '更新'
]

export const NOISE = [
  'webinar', 'sponsor', 'register now', 'join us for', 'job', 'hiring:',
  'how to use', 'tutorial', 'course', 'black friday', 'discount',
  'newsletter is brought', 'advertisement'
]

/** 板块关键词。命中数用于分类打分。 */
export const BUCKET_KEYWORDS: Record<Bucket, string[]> = {
  product: [
    'launch', 'release', 'unveil', 'introduc', 'announc', 'new model',
    'ships', 'now available', 'generally available', 'preview', 'rollout',
    '发布', '上线', '推出', '开源', '版本'
  ],
  agent: [
    'agent', 'agentic', 'mcp', 'tool use', 'tool-calling', 'sdk', 'api',
    'copilot', 'coding', 'cli', 'workflow', 'rag', 'computer use',
    '智能体', '工具调用'
  ],
  research: [
    'paper', 'arxiv', 'benchmark', 'sota', 'we propose', 'empirical',
    'ablations', 'dataset', 'reasoning', 'fine-tun', 'training',
    '论文', '基准', '推理'
  ],
  infra: [
    'gpu', 'tpu', 'h200', 'b200', 'gb200', 'hbm', 'cluster', 'datacenter',
    'data center', 'inference cost', 'latency', 'throughput', 'chip',
    'tsmc', 'nvidia', '算力', '芯片', '推理成本'
  ],
  business: [
    'funding', 'raise', 'series a', 'series b', 'valuation', 'acquire',
    'acquisition', 'acqui-hire', 'ipo', 'revenue', 'arr', 'partnership',
    'hiring', 'layoff', 'resign', 'ceo', '融资', '估值', '收购', '营收'
  ],
  policy: [
    'regulation', 'regulator', 'ban', 'lawsuit', 'court', 'antitrust',
    'safety', 'alignment', 'jailbreak', 'copyright', 'privacy',
    'executive order', 'policy', '监管', '安全', '诉讼'
  ],
  opinion: [
    'interview', 'podcast', 'essay', 'why ', 'how ', 'what ', 'the case for',
    'analysis', 'opinion', 'take', 'reflection', 'lessons', '访谈', '观点'
  ],
  video: ['video', 'episode', 'talk', 'webinar', 'demo'],
  community: ['show hn', 'ask hn', 'i built', 'my', 'weekend project']
}

/**
 * 条目的"类型"由来源种类推导，而不是存进 items 表——它是 source 的函数，
 * 冗余存储会带来不一致风险（见 ARCHITECTURE.md 的稳定性分析）。
 *
 * 映射规则与 Python 抓取器里 `item["type"] = src["type"]` 的效果一致：
 * youtube 的抓取器显式改成 video，github_trending 显式改成 repo，其余沿用来源类型。
 */
export function itemTypeOf(source: Pick<Source, 'kind'>): string {
  switch (source.kind) {
    case 'youtube':
      return 'video'
    case 'github-trending':
      return 'repo'
    case 'rss':
    case 'atom':
    case 'html':
      return 'rss'
    default:
      return source.kind
  }
}
