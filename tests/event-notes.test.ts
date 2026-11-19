import { describe, expect, it } from 'vitest'
import { createMemoryStore } from '../src/adapters/store-sqlite/store'

describe('事件判断存储', () => {
  it('按 eventKey 保存、更新和删除', () => {
    const store = createMemoryStore()
    store.eventNotes.upsert({ eventKey: 'openai:product:2026-11-18', note: '先看是否影响 API', createdAt: 1, updatedAt: 1 })
    expect(store.eventNotes.get('openai:product:2026-11-18')?.note).toBe('先看是否影响 API')
    store.eventNotes.upsert({ eventKey: 'openai:product:2026-11-18', note: '更新判断', createdAt: 1, updatedAt: 2 })
    expect(store.eventNotes.get('openai:product:2026-11-18')?.updatedAt).toBe(2)
    store.eventNotes.remove('openai:product:2026-11-18')
    expect(store.eventNotes.get('openai:product:2026-11-18')).toBeUndefined()
    store.close()
  })
})
