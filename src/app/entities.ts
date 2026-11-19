/**
 * 实体记忆：公司/人物词表 + 本地倒排，不靠模型自由抽取。
 *
 * 第一版刻意用「固定词表 + 别名」：
 * - 可解释：为什么这条内容归到 OpenAI，能指到具体别名；
 * - 可重复：同样的输入永远得到同样的实体，不会每次模型编一个；
 * - 可扩展：以后可以由用户加实体，而不是只依赖内置名单。
 */
import type { Entity, EntityKind, Item } from '../core/domain/types'
import type { Store } from '../core/ports/store'

const SEEDED_KEY = 'entities.seeded.v1'

interface SeedEntity {
  id: string
  name: string
  kind: EntityKind
  aliases: string[]
}

export const SEED_ENTITIES: SeedEntity[] = [
  { id: 'openai', name: 'OpenAI', kind: 'company', aliases: ['OpenAI', 'Open AI'] },
  { id: 'anthropic', name: 'Anthropic', kind: 'company', aliases: ['Anthropic', 'Claude'] },
  { id: 'google-deepmind', name: 'Google DeepMind', kind: 'company', aliases: ['Google DeepMind', 'DeepMind'] },
  { id: 'google', name: 'Google', kind: 'company', aliases: ['Google', 'Gemini'] },
  { id: 'microsoft', name: 'Microsoft', kind: 'company', aliases: ['Microsoft', 'Azure'] },
  { id: 'nvidia', name: 'NVIDIA', kind: 'company', aliases: ['NVIDIA', 'Nvidia'] },
  { id: 'meta', name: 'Meta', kind: 'company', aliases: ['Meta', 'Llama'] },
  { id: 'xai', name: 'xAI', kind: 'company', aliases: ['xAI', 'Grok'] },
  { id: 'mistral', name: 'Mistral AI', kind: 'company', aliases: ['Mistral', 'Mistral AI'] },
  { id: 'cohere', name: 'Cohere', kind: 'company', aliases: ['Cohere'] },
  { id: 'deepseek', name: 'DeepSeek', kind: 'company', aliases: ['DeepSeek'] },
  { id: 'alibaba', name: 'Alibaba', kind: 'company', aliases: ['Alibaba', 'Qwen', '通义'] },
  { id: 'moonshot', name: 'Moonshot AI', kind: 'company', aliases: ['Moonshot', 'Kimi'] },
  { id: 'minimax', name: 'MiniMax', kind: 'company', aliases: ['MiniMax'] },
  { id: 'perplexity', name: 'Perplexity', kind: 'company', aliases: ['Perplexity'] },
  { id: 'huggingface', name: 'Hugging Face', kind: 'company', aliases: ['Hugging Face', 'HuggingFace'] },
  { id: 'figure', name: 'Figure AI', kind: 'company', aliases: ['Figure AI'] },
  { id: 'tesla', name: 'Tesla', kind: 'company', aliases: ['Tesla'] },
  { id: 'waymo', name: 'Waymo', kind: 'company', aliases: ['Waymo'] },
  { id: 'unitree', name: 'Unitree', kind: 'company', aliases: ['Unitree', '宇树'] },
  { id: 'physical-intelligence', name: 'Physical Intelligence', kind: 'company', aliases: ['Physical Intelligence', 'π0'] },
  { id: 'scale-ai', name: 'Scale AI', kind: 'company', aliases: ['Scale AI'] },
  { id: 'databricks', name: 'Databricks', kind: 'company', aliases: ['Databricks'] },
  { id: 'amazon', name: 'Amazon', kind: 'company', aliases: ['Amazon', 'AWS'] },
  { id: 'sam-altman', name: 'Sam Altman', kind: 'person', aliases: ['Sam Altman'] },
  { id: 'dario-amodei', name: 'Dario Amodei', kind: 'person', aliases: ['Dario Amodei'] },
  { id: 'demis-hassabis', name: 'Demis Hassabis', kind: 'person', aliases: ['Demis Hassabis'] },
  { id: 'jensen-huang', name: 'Jensen Huang', kind: 'person', aliases: ['Jensen Huang', '黄仁勋'] },
  { id: 'elon-musk', name: 'Elon Musk', kind: 'person', aliases: ['Elon Musk', '马斯克'] },
  { id: 'lex-fridman', name: 'Lex Fridman', kind: 'person', aliases: ['Lex Fridman'] },
  { id: 'dwarkesh-patel', name: 'Dwarkesh Patel', kind: 'person', aliases: ['Dwarkesh Patel', 'Dwarkesh'] },
  { id: 'andrej-karpathy', name: 'Andrej Karpathy', kind: 'person', aliases: ['Andrej Karpathy', 'Karpathy'] },
  { id: 'yann-lecun', name: 'Yann LeCun', kind: 'person', aliases: ['Yann LeCun', 'LeCun'] },
  { id: 'ilya-sutskever', name: 'Ilya Sutskever', kind: 'person', aliases: ['Ilya Sutskever'] },
  { id: 'mira-murati', name: 'Mira Murati', kind: 'person', aliases: ['Mira Murati'] },
  { id: 'satya-nadella', name: 'Satya Nadella', kind: 'person', aliases: ['Satya Nadella'] },
  { id: 'mark-zuckerberg', name: 'Mark Zuckerberg', kind: 'person', aliases: ['Mark Zuckerberg'] },
  { id: 'sundar-pichai', name: 'Sundar Pichai', kind: 'person', aliases: ['Sundar Pichai'] },
  { id: 'fei-fei-li', name: 'Fei-Fei Li', kind: 'person', aliases: ['Fei-Fei Li', '李飞飞'] },
  { id: 'andrew-ng', name: 'Andrew Ng', kind: 'person', aliases: ['Andrew Ng', '吴恩达'] }
]

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 纯函数：一段标题/摘要命中哪些实体。ASCII 别名要求词边界，中文按子串。 */
export function matchEntityIds(text: string, entities: Entity[]): string[] {
  const hay = text ?? ''
  const out: string[] = []
  for (const entity of entities) {
    const hit = entity.aliases.some((alias) => {
      const a = alias.trim()
      if (!a) return false
      const ascii = /^[A-Za-z0-9 .+-]+$/.test(a)
      if (!ascii) return hay.includes(a)
      const re = new RegExp(`(?<![A-Za-z0-9])${escapeRe(a)}(?![A-Za-z0-9])`, 'i')
      return re.test(hay)
    })
    if (hit) out.push(entity.id)
  }
  return out
}

export function seedEntities(store: Store): number {
  if (store.settings.get<boolean>(SEEDED_KEY) === true) return 0
  const now = Date.now()
  for (const def of SEED_ENTITIES) {
    store.entities.upsert({
      id: def.id,
      name: def.name,
      kind: def.kind,
      aliases: def.aliases,
      createdAt: now,
      updatedAt: now
    })
  }
  store.settings.set(SEEDED_KEY, true)
  return SEED_ENTITIES.length
}

/** 给一批条目建倒排；不传 ids 则全量。返回新建的关系数。 */
export function indexEntityItems(store: Store, itemIds?: string[]): number {
  const entities = store.entities.list()
  if (entities.length === 0) return 0
  const items = itemIds
    ? itemIds.map((id) => store.items.get(id)).filter((x): x is Item => Boolean(x))
    : store.items.all()
  let linked = 0
  for (const item of items) {
    const ids = matchEntityIds(`${item.title}\n${item.summary}`, entities)
    if (ids.length === 0) continue
    for (const id of ids) {
      store.entities.link(id, [item.id])
      linked++
    }
  }
  return linked
}

export function rebuildEntityIndex(store: Store): number {
  store.entities.clearLinks()
  return indexEntityItems(store)
}

/** 启动时：首次建词表 + 已有条目回填；已有倒排就不重复扫全库。 */
export function bootstrapEntities(store: Store): number {
  const added = seedEntities(store)
  if (added > 0 || store.entities.linkCount() === 0) rebuildEntityIndex(store)
  return added
}
