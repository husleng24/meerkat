import { describe, expect, it } from 'vitest'
import { createMemoryStore } from '../src/adapters/store-sqlite/store'
import type { ManualEvent } from '../src/core/domain/types'

const event: ManualEvent = {
  id: 'me-1',
  entityId: 'openai',
  title: '手动合并事件',
  event: 'product',
  itemIds: ['a', 'b'],
  createdAt: 1,
  updatedAt: 1
}

describe('手动事件存储', () => {
  it('保存、按实体列出、更新和删除', () => {
    const store = createMemoryStore()
    store.manualEvents.upsert(event)
    expect(store.manualEvents.get('me-1')?.itemIds).toEqual(['a', 'b'])
    expect(store.manualEvents.list('openai')).toHaveLength(1)
    expect(store.manualEvents.list('other')).toHaveLength(0)
    store.manualEvents.upsert({ ...event, title: '改名', itemIds: ['a'], updatedAt: 2 })
    expect(store.manualEvents.get('me-1')?.title).toBe('改名')
    store.manualEvents.remove('me-1')
    expect(store.manualEvents.get('me-1')).toBeUndefined()
    store.close()
  })
})
