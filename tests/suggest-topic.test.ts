import { describe, it, expect } from 'vitest'
import { suggestTopic } from '../src/app/suggest-topic'

const topics = [
  { id: 'models', name: '模型与产品' },
  { id: 'chip', name: '芯片与算力' }
]

const names = {
  models: ['OpenAI News', 'Anthropic Blog', 'The Verge AI'],
  chip: ['英伟达博客', 'SemiAnalysis']
}

describe('加源时的主题推荐（规则）', () => {
  it('英文源按已有源的关键词推荐', () => {
    const s = suggestTopic({ name: 'OpenAI Research', url: 'https://openai.com/research' }, topics, names)
    expect(s?.topicId).toBe('models')
    expect(s?.reason).toContain('源')
  })

  it('中文源按二元组重合推荐', () => {
    const s = suggestTopic({ name: '英伟达发布新卡' }, topics, names)
    expect(s?.topicId).toBe('chip')
  })

  it('和主题名重合时优先主题名', () => {
    const s = suggestTopic({ name: '芯片与算力周报' }, topics, names)
    expect(s?.topicId).toBe('chip')
    expect(s?.reason).toContain('主题名')
  })

  it('完全无关时不给建议（宁可空着，也不要瞎猜）', () => {
    expect(suggestTopic({ name: 'Meta 财报解读' }, topics, names)).toBeNull()
    expect(suggestTopic({ name: '' }, topics, names)).toBeNull()
  })
})
