import { describe, it, expect } from 'vitest'
import { groupTopicsByDomain } from '../src/app/topic-groups'

const t = (id: string, domainId: string): { id: string; domainId: string } => ({ id, domainId })

describe('侧栏分组：领域只是标签，不是选择状态', () => {
  it('按领域顺序分组，主题保持原顺序', () => {
    const groups = groupTopicsByDomain(
      [t('a', 'ai'), t('b', 'chip'), t('c', 'ai')],
      [
        { id: 'ai', name: 'AI' },
        { id: 'chip', name: '芯片' }
      ]
    )
    expect(groups.map((g) => g.domainName)).toEqual(['AI', '芯片'])
    expect(groups[0]!.topics.map((x) => x.id)).toEqual(['a', 'c'])
    expect(groups[1]!.topics.map((x) => x.id)).toEqual(['b'])
  })

  it('没有主题的领域不产生空分组（不占侧栏高度）', () => {
    const groups = groupTopicsByDomain([t('a', 'ai')], [
      { id: 'ai', name: 'AI' },
      { id: 'empty', name: '空领域' }
    ])
    expect(groups.map((g) => g.domainId)).toEqual(['ai'])
  })

  it('单个领域仍是分组（由界面决定是否显示小标题）', () => {
    const groups = groupTopicsByDomain([t('a', 'ai'), t('b', 'ai')], [{ id: 'ai', name: 'AI' }])
    expect(groups).toHaveLength(1)
    expect(groups[0]!.topics).toHaveLength(2)
  })

  it('领域表里找不到归属的主题也要显示，不能凭空消失', () => {
    const groups = groupTopicsByDomain([t('a', 'legacy')], [])
    expect(groups).toHaveLength(1)
    expect(groups[0]!.domainId).toBe('legacy')
    expect(groups[0]!.topics.map((x) => x.id)).toEqual(['a'])
  })
})
