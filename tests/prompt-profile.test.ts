import { describe, it, expect } from 'vitest'
import { createMemoryStore } from '../src/adapters/store-sqlite/store'
import {
  promptTextForTopic,
  promptWarnings,
  renderPromptTemplate
} from '../src/app/prompt-profile'
import type { PromptProfile } from '../src/core/domain/types'

const NOW = Date.now()

function profile(over: Partial<PromptProfile> = {}): PromptProfile {
  return {
    id: 'pp-1',
    name: '时装简报',
    version: 1,
    systemMd: '你是{fashion}主编，主题 {topic}，日期 {date}。\n{editorialFocus}\n三句话速览\n链接必须来自素材',
    createdAt: NOW,
    updatedAt: NOW,
    ...over
  }
}

describe('主题提示词解析', () => {
  it('未绑定主题时用内置模板', () => {
    const store = createMemoryStore()
    const topic = store.topics.get('ai')!
    expect(promptTextForTopic(store, topic, 'BUILTIN')).toBe('BUILTIN')
  })

  it('绑定后使用自定义提示词', () => {
    const store = createMemoryStore()
    const topic = store.topics.get('ai')!
    store.prompts.create(profile())
    store.topics.upsert({ ...topic, promptProfileId: 'pp-1' })
    expect(promptTextForTopic(store, store.topics.get('ai')!, 'BUILTIN')).toContain('{fashion}')
  })
})

describe('版本历史', () => {
  it('保存新版本会归档旧内容，可恢复', () => {
    const store = createMemoryStore()
    store.prompts.create(profile({ systemMd: 'v1' }))
    const updated = store.prompts.update('pp-1', { systemMd: 'v2' })
    expect(updated?.version).toBe(2)
    expect(store.prompts.versions('pp-1')).toEqual([
      expect.objectContaining({ version: 1, systemMd: 'v1' })
    ])
    const restored = store.prompts.restore('pp-1', 1)
    expect(restored?.version).toBe(3)
    expect(restored?.systemMd).toBe('v1')
  })

  it('删除 profile 后主题退回内置模板', () => {
    const store = createMemoryStore()
    const topic = store.topics.get('ai')!
    store.prompts.create(profile())
    store.topics.upsert({ ...topic, promptProfileId: 'pp-1' })
    store.prompts.remove('pp-1')
    expect(promptTextForTopic(store, store.topics.get('ai')!, 'BUILTIN')).toBe('BUILTIN')
  })
})

describe('变量与提示', () => {
  it('渲染四个变量', () => {
    const out = renderPromptTemplate('{topic} {date} {weekday} {editorialFocus}', {
      topic: '时装',
      date: '2026-11-22',
      weekday: '周日',
      editorialFocus: '关注供应链'
    })
    expect(out).toBe('时装 2026-11-22 周日 关注供应链')
  })

  it('缺少关键占位符会提示', () => {
    const w = promptWarnings('随便写')
    expect(w.join('')).toContain('{topic}')
    expect(w.join('')).toContain('三句话速览')
    expect(promptWarnings('')).toContain('提示词不能为空')
  })
})
