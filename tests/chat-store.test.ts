import { describe, it, expect, beforeEach } from 'vitest'
import { createMemoryStore } from '../src/adapters/store-sqlite/store'
import type { Store } from '../src/core/ports/store'
import type { ChatThread } from '../src/core/domain/types'

const T = 1_761_000_000_000

function thread(id: string, over: Partial<ChatThread> = {}): ChatThread {
  return {
    id,
    title: '新对话',
    topicId: 'ai',
    briefDate: '2026-11-01',
    model: 'deepseek-flash',
    createdAt: T,
    updatedAt: T,
    archived: false,
    ...over
  }
}

describe('对话仓储', () => {
  let s: Store
  beforeEach(() => {
    s = createMemoryStore()
  })

  it('创建、读取、按主题+日期定位', () => {
    s.chat.create(thread('ct1'))
    expect(s.chat.get('ct1')!.title).toBe('新对话')
    expect(s.chat.findByDate('ai', '2026-11-01')!.id).toBe('ct1')
    expect(s.chat.findByDate('ai', '2026-10-31')).toBeUndefined()
    expect(s.chat.threads('ai')).toHaveLength(1)
  })

  it('更新标题与模型，updatedAt 跟着变', () => {
    s.chat.create(thread('ct1'))
    s.chat.update('ct1', { title: '这期讲了什么', model: 'deepseek-v4-pro', updatedAt: T + 1000 })
    const t = s.chat.get('ct1')!
    expect(t.title).toBe('这期讲了什么')
    expect(t.model).toBe('deepseek-v4-pro')
    expect(t.updatedAt).toBe(T + 1000)
  })

  it('消息按时间顺序返回', () => {
    s.chat.create(thread('ct1'))
    s.chat.addMessage({ id: 'm2', threadId: 'ct1', role: 'assistant', content: '回答', createdAt: T + 2 })
    s.chat.addMessage({ id: 'm1', threadId: 'ct1', role: 'user', content: '问题', createdAt: T + 1 })
    expect(s.chat.messages('ct1').map((m) => m.id)).toEqual(['m1', 'm2'])
  })

  it('删除会话级联删除消息', () => {
    s.chat.create(thread('ct1'))
    s.chat.addMessage({ id: 'm1', threadId: 'ct1', role: 'user', content: '问题', createdAt: T })
    s.chat.remove('ct1')
    expect(s.chat.get('ct1')).toBeUndefined()
    expect(s.chat.messages('ct1')).toEqual([])
  })

  it('删除主题会带走它的会话', () => {
    s.topics.upsert({ ...s.topics.get('ai')!, id: 'chip', name: '芯片' })
    s.chat.create(thread('ct2', { topicId: 'chip' }))
    s.topics.remove('chip')
    expect(s.chat.get('ct2')).toBeUndefined()
  })
})
