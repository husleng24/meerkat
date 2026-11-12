/**
 * 领域类型：零依赖，纯数据形状。
 * 这些形状是本系统的稳定核心（见 ARCHITECTURE.md §一），改动需付迁移成本。
 */

/** 九个板块，顺序即简报中的呈现顺序 */
export const BUCKETS = [
  'product',
  'agent',
  'research',
  'infra',
  'business',
  'policy',
  'opinion',
  'video',
  'community'
] as const

export type Bucket = (typeof BUCKETS)[number]

export const BUCKET_LABEL: Record<Bucket, string> = {
  product: '① 模型与产品发布',
  agent: '② Agent 与开发工具',
  research: '③ 研究与论文',
  infra: '④ 算力与基础设施',
  business: '⑤ 商业与组织',
  policy: '⑥ 政策与安全',
  opinion: '⑦ 观点与访谈',
  video: '⑧ 视频与播客',
  community: '⑨ 社区热议'
}

/** 抓取器种类；新增站点优先用声明式（rss/atom），结构特殊才加命令式解析器 */
export type SourceKind =
  | 'rss'
  | 'atom'
  | 'arxiv'
  | 'hn'
  | 'youtube'
  | 'github-trending'
  | 'hfpapers'
  | 'anthropic'
  | 'html'

/** 来源权重：1=一手官方 2=高质量分析 3=社区信号 */
export type Tier = 1 | 2 | 3

export interface Source {
  id: string
  name: string
  kind: SourceKind
  url?: string
  channelId?: string
  tier: Tier
  bucketHint: Bucket
  /** 该源单独的回看窗口（小时），缺省用全局窗口 */
  windowHours?: number
  /** 视频源不做 AI 关键词过滤时为 true */
  alwaysKeep?: boolean
  /** SSL 证书有问题的源 */
  insecure?: boolean
  /** kind=html 时指定命名解析器 */
  parser?: string
  enabled: boolean
  /** 健康度 */
  lastOkAt?: number
  failStreak: number
  lastError?: string
  avgItems?: number
  avgMs?: number
  createdAt?: number
  updatedAt?: number
}

/** 抓取器返回的未归一化条目 */
export interface RawItem {
  title: string
  url: string
  publishedAt?: number
  summary?: string
  author?: string
  points?: number
  comments?: number
  /** 抓取器可以强制指定类型，覆盖 kind */
  type?: string
}

/** 归一化 + 打分后的条目，落库的那个形状 */
export interface Item {
  /** sha1(canonicalUrl + titleKey)，跨天去重的基石 */
  id: string
  sourceId: string
  title: string
  url: string
  author?: string
  publishedAt?: number
  summary: string
  bucket: Bucket
  score: number
  /** 打分公式版本，便于解释历史分数 */
  formulaVersion: number
  points?: number
  comments?: number
  /** 同一事件的其他来源名 */
  alsoIn: string[]
  fetchedAt: number
}

export interface Brief {
  id: string
  date: string
  topicId: string
  markdown: string
  /** 结构化 IR（给界面挂条目 id 用），解析失败可为空 */
  irJson?: string
  model: string
  tokensIn: number
  tokensOut: number
  /** 例如 '38/38' */
  linkCheck?: string
  createdAt: number
}

/** 领域：主题的分组（一个领域下有多个主题） */
export interface Domain {
  id: string
  name: string
  createdAt: number
}

/**
 * 主题：一个主题＝一组源 + 一套排程 + 一条独立简报。
 *
 * 放在 domain 而不是 settings 里，是因为它要参与外键（briefs.topic_id、
 * topic_sources.topic_id）——「主题」是数据模型的一部分，不是一个偏好项。
 */
export interface Topic {
  id: string
  name: string
  /** 所属领域；主题不能没有领域 */
  domainId: string
  enabled: boolean
  /** 本地时间的触发点 */
  hour: number
  minute: number
  createdAt: number
  updatedAt: number
}

export interface ChatThread {
  id: string
  title: string
  topicId: string
  /** 创建时对应的简报日期；作为默认上下文 */
  briefDate?: string
  model: string
  createdAt: number
  updatedAt: number
  archived: boolean
}

export type ChatRole = 'user' | 'assistant'

export interface ChatStoredMessage {
  id: string
  threadId: string
  role: ChatRole
  content: string
  model?: string
  tokensIn?: number
  tokensOut?: number
  /** 引用来源的引用信息（JSON）：{ brief: date, previous: date } */
  contextJson?: string
  createdAt: number
}

/** 单次运行的统计，用于健康度与诊断包 */
export interface RunRecord {
  id: string
  startedAt: number
  finishedAt?: number
  nSources: number
  nRaw: number
  nKept: number
  errorsJson?: string
}

/** 条目的人工状态；用标志位而不是互斥状态，因为一条可以既已读又收藏 */
export interface ItemFlags {
  itemId: string
  isRead: boolean
  isSaved: boolean
  isHidden: boolean
  /** 被写进过简报的时间戳；用于"只给新内容"的增量判定 */
  briefedAt?: number
  notedAt?: number
}
