/**
 * 源配置灌库：抽出来是为了让"纯 Node 自检"也能用同一份逻辑。
 * 规则：库里已有源就什么都不做——不能覆盖用户停用/启用的选择。
 */
import type { Store } from '../core/ports/store'
import type { Source } from '../core/domain/types'

export function seedSources(store: Store, sources: Source[]): number {
  if (store.sources.list().length > 0) return 0
  if (sources.length === 0) return 0
  store.sources.upsertMany(sources)
  return sources.length
}
