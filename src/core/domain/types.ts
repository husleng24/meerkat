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

/** 简报里每条内容对应的来源证据；用于回答「为什么给我看这条」 */
export interface BriefTraceEntry {
  itemId: string
  title: string
  /** 主链接；urls 用于匹配简报里出现的链接 */
  url: string
  urls: string[]
  sourceName: string
  /** 1 官方/一手，2 行业媒体，3 社区，4 聚合 */
  tier: number
  publishedAt?: number
  score: number
  /** 同一事件的其他来源名 */
  alsoIn: string[]
}

export interface BriefTrace {
  version: 1
  cited: BriefTraceEntry[]
  /** 进入成稿候选池的条数 */
  candidates: number
  /** 这期实际检查的信息源数；旧 trace 没有 */
  sourceCount?: number
  /** 这期抓取失败的源数；旧 trace 没有 */
  failedSources?: number
  /** 因为「以前推过」被过滤掉的条数 */
  droppedAsBriefed: number
  /** 候选太少时是否放弃了跨天去重 */
  filterOverridden: boolean
  /** 这是一期「今天没有变化」，不是采访/降级 */
  noChange?: boolean
}

/** 用户指定的 YouTube 博主 */
export interface VideoCreator {
  id: string
  channelId: string
  name: string
  /** 用户输入/@handle，便于显示 */
  handle?: string
  createdAt: number
  updatedAt: number
}

/** 一期视频的字幕与解读，按 videoId 缓存 */
export interface VideoReport {
  id: string
  creatorId: string
  videoId: string
  title: string
  url: string
  publishedAt?: number
  durationSec?: number
  /** 字幕语言，例如 en / zh-Hans */
  language?: string
  /** 原始字幕转成的 Markdown，不由模型改写 */
  transcriptMd: string
  /** 总结/章节/值不值得看 */
  summaryMd: string
  model: string
  createdAt: number
  updatedAt: number
}

/** 用户对一条内容的判断；周回顾按它聚合 */
export interface DecisionNote {
  itemId: string
  note: string
  verifyAt?: number
  createdAt: number
  updatedAt: number
}

/** 公司/人物/机构等实体；别名词表用于本地匹配，不靠模型编造 */
export type EntityKind = 'company' | 'person' | 'org' | 'technology'

export interface Entity {
  id: string
  name: string
  kind: EntityKind
  aliases: string[]
  createdAt: number
  updatedAt: number
}

/** 事件页上的判断，按稳定的 eventKey 存 */
export interface EventNote {
  eventKey: string
  note: string
  /** 周回顾用：事件属于哪个实体、标题、类型和时间 */
  entityId?: string
  title?: string
  eventType?: string
  latestAt?: number
  createdAt: number
  updatedAt: number
}

/** 用户手动合并/拆分后的事件；itemIds 覆盖自动聚类 */
export interface ManualEvent {
  id: string
  entityId: string
  title: string
  event: string
  itemIds: string[]
  createdAt: number
  updatedAt: number
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
  /** 这个主题的编辑重点；只影响选题与解读，不改变简报格式 */
  editorialFocus?: string
  /** 绑定的简报 PromptProfile；空 = 内置模板 */
  promptProfileId?: string
  /** 该主题的选材策略；空 = 默认值 */
  selectionPolicy?: SelectionPolicy
  createdAt: number
  updatedAt: number
}

/** 主题级选材策略：窗口、候选数、目标条数、板块与关键词偏置 */
export interface SelectionPolicy {
  windowHours: number
  maxItems: number
  targetMin: number
  targetMax: number
  buckets: Bucket[]
  boostKeywords: string[]
  suppressKeywords: string[]
}

/** 可版本化的简报提示词 */
export interface PromptProfile {
  id: string
  name: string
  version: number
  systemMd: string
  createdAt: number
  updatedAt: number
}

/** 旧版本快照，用于回滚 */
export interface PromptProfileVersion {
  profileId: string
  version: number
  systemMd: string
  createdAt: number
}

/** 一次提示词试跑的评测记录 */
export interface PromptEvaluation {
  id: string
  topicId: string
  profileId: string
  profileName: string
  profileVersion: number
  /** 1–5 星，人工判断 */
  rating: number
  notes?: string
  /** 链接率、引用数、板块数等，key 由发布端定义 */
  metrics: Record<string, number>
  createdAt: number
}

/** 被 agent 持续跟踪的事件 */
export interface Story {
  id: string
  title: string
  /** 原始事件描述（通常是条目标题） */
  query: string
  /** 检索用的实体/别名 */
  aliases: string[]
  topicId: string
  /** 发起跟踪的条目 */
  itemId?: string
  /** 在哪个评论串里发起的 */
  threadId?: string
  status: 'active' | 'paused' | 'archived'
  /** 连续多少次采集没有新命中 */
  missCount: number
  lastMatchAt?: number
  /** 上次弹窗询问"还要继续吗"的时间 */
  lastPromptAt?: number
  createdAt: number
  updatedAt: number
}

export interface ChatThread {
  id: string
  title: string
  topicId: string
  /** brief：当天简报的对话；item：某条新闻的评论串；event：事件页评论串 */
  scope: 'brief' | 'item' | 'event'
  /** scope=item 时指向条目；scope=event 时作为上下文锚点 */
  itemId?: string
  /** scope=event 时指向稳定事件 key */
  eventKey?: string
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
