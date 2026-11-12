/**
 * 侧栏分组：把全部主题按领域排成一段扁平列表。
 *
 * 领域不再是导航层级——不需要「先选领域」——但仍是分组标签与汇总范围。
 * 所以这里只做展示分组，不产生任何选择状态：点主题就够，领域由主题推导。
 *
 * 纯函数，便于测「只有一个领域时不显示小标题」这类规则。
 */

export interface TopicGroup<T> {
  domainId: string
  domainName: string
  topics: T[]
}

/**
 * @param topics  全部主题，保持调用方给出的顺序（store 已按创建时间排好）
 * @param domains 全部领域，决定分组的先后顺序
 */
export function groupTopicsByDomain<T extends { domainId: string }>(
  topics: T[],
  domains: Array<{ id: string; name: string }>
): TopicGroup<T>[] {
  const byDomain = new Map<string, T[]>()
  for (const t of topics) {
    const list = byDomain.get(t.domainId)
    if (list) list.push(t)
    else byDomain.set(t.domainId, [t])
  }

  const groups: TopicGroup<T>[] = []
  for (const d of domains) {
    const list = byDomain.get(d.id)
    if (!list || list.length === 0) continue
    groups.push({ domainId: d.id, domainName: d.name, topics: list })
    byDomain.delete(d.id)
  }

  // 领域表里没有归属的主题（历史脏数据）也要显示，不能凭空消失
  for (const [domainId, list] of byDomain) {
    groups.push({ domainId, domainName: domainId, topics: list })
  }
  return groups
}
