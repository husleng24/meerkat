/**
 * 首次启动的「YouTube 博主」主题。
 *
 * 这是产品预置，不是用户数据迁移：
 * - 只在第一次升级/首启时执行一次，之后用户删主题/删源都不会复活；
 * - 已有同名频道时复用现有源 id，避免把用户已经加过的博主变成重复源；
 * - 新源不自动挂到「AI 综合」，避免默认主题从 35 个源膨胀。
 */
import type { Store } from '../core/ports/store'
import type { Source } from '../core/domain/types'

const SEEDED_KEY = 'topics.videoSeeded'
export const VIDEO_TOPIC_ID = 'youtube'
export const VIDEO_TOPIC_NAME = 'YouTube 博主'
export const VIDEO_TOPIC_FOCUS =
  '只保留 YouTube 访谈、播客和长视频里关于 AI 公司、模型、Agent、创业和研究的实质内容；忽略短视频教程、纯产品宣传和没有信息增量的切片。'

interface SeedSource {
  id: string
  name: string
  channelId: string
  tier: 2 | 3
}

const SOURCES: SeedSource[] = [
  { id: 'yt-openai', name: 'OpenAI (YouTube)', channelId: 'UCXZCJLdBC09xxGZ6gcdrc6A', tier: 2 },
  { id: 'yt-anthropic', name: 'Anthropic (YouTube)', channelId: 'UCrDwWp7EBBv4NwvScIpBDOA', tier: 2 },
  { id: 'yt-deepmind', name: 'DeepMind (YouTube)', channelId: 'UCP7jMXSY2xbc3KCAE0MHQ-A', tier: 2 },
  { id: 'yt-aiexplained', name: 'AI Explained', channelId: 'UCNJ1Ymd5yFuUPtn21xtRbbw', tier: 2 },
  { id: 'yt-2min', name: 'Two Minute Papers', channelId: 'UCbfYPyITQ-7l4upoX8nvctg', tier: 3 },
  { id: 'yt-mberman', name: 'Matthew Berman', channelId: 'UCawZsQWqfGSbCI5yjkdVkTA', tier: 3 },
  { id: 'yt-dwarkesh', name: 'Dwarkesh Patel', channelId: 'UCZa18YV7qayTh-MRIrBhDpA', tier: 2 },
  { id: 'yt-lex', name: 'Lex Fridman', channelId: 'UCJIfeSCssxSC_Dhc5s7woww', tier: 3 },
  { id: 'yt-no-priors', name: 'No Priors', channelId: 'UCSI7h9hydQ40K5MJHnCrQvw', tier: 2 },
  { id: 'yt-latent-space', name: 'Latent Space', channelId: 'UCxBcwypKK-W3GHd_RZ9FZrQ', tier: 2 },
  { id: 'yt-cognitive-revolution', name: 'Cognitive Revolution', channelId: 'UCjNRVMBVI30Sak_p6HRWhIA', tier: 2 },
  { id: 'yt-twiml', name: 'The TWIML AI Podcast', channelId: 'UC7kjWIK1H8tfmFlzZO-wHMw', tier: 2 },
  { id: 'yt-mlst', name: 'Machine Learning Street Talk', channelId: 'UCMLtBahI5DMrt0NPvDSoIRQ', tier: 2 },
  { id: 'yt-all-in', name: 'All-In Podcast', channelId: 'UChJM-mF-4w_61Z6eCyl0eKQ', tier: 2 },
  { id: 'yt-a16z', name: 'a16z', channelId: 'UC9cn0TuPq4dnbTY-CBsm8XA', tier: 2 },
  { id: 'yt-yc', name: 'Y Combinator', channelId: 'UCcefcZRL2oaA_uBNeo5UOWg', tier: 2 },
  { id: 'yt-20vc', name: '20VC', channelId: 'UCf0PBRjhf0rF8fWBIxTuoWA', tier: 2 }
]

export function videoTopicSeeded(store: Store): boolean {
  return store.settings.get<boolean>(SEEDED_KEY) === true
}

/** 返回本次新建并挂到主题的源数量；已执行过返回 0 */
export function seedVideoTopic(store: Store): number {
  if (videoTopicSeeded(store)) return 0
  const existing = store.sources.list()
  const byChannel = new Map(existing.map((s) => [s.channelId, s]))
  const byId = new Map(existing.map((s) => [s.id, s]))
  const now = Date.now()
  const ids: string[] = []
  let created = 0

  for (const def of SOURCES) {
    const hit = byChannel.get(def.channelId) ?? byId.get(def.id)
    if (hit) {
      ids.push(hit.id)
      continue
    }
    const source: Source = {
      id: def.id,
      name: def.name,
      kind: 'youtube',
      channelId: def.channelId,
      tier: def.tier,
      bucketHint: 'video',
      alwaysKeep: true,
      enabled: true,
      failStreak: 0,
      createdAt: now,
      updatedAt: now
    }
    store.sources.upsert(source)
    ids.push(def.id)
    created++
  }

  const domainId = store.domains.get('ai')?.id ?? store.domains.list()[0]?.id
  if (!store.topics.get(VIDEO_TOPIC_ID) && domainId) {
    store.topics.upsert({
      id: VIDEO_TOPIC_ID,
      name: VIDEO_TOPIC_NAME,
      domainId,
      enabled: true,
      hour: 8,
      minute: 30,
      editorialFocus: VIDEO_TOPIC_FOCUS,
      createdAt: now,
      updatedAt: now
    })
    store.topics.setSources(VIDEO_TOPIC_ID, ids)
  }

  store.settings.set(SEEDED_KEY, true)
  return created
}
