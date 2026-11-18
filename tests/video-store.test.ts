import { describe, expect, it } from 'vitest'
import { createMemoryStore } from '../src/adapters/store-sqlite/store'
import type { VideoCreator, VideoReport } from '../src/core/domain/types'

const creator: VideoCreator = {
  id: 'UCtestchannel0000000000000',
  channelId: 'UCtestchannel0000000000000',
  name: '测试博主',
  handle: '@test',
  createdAt: 1,
  updatedAt: 1
}

const report: VideoReport = {
  id: 'video-abc123',
  creatorId: creator.id,
  videoId: 'abc123',
  title: '测试访谈',
  url: 'https://www.youtube.com/watch?v=abc123',
  language: 'en',
  transcriptMd: '# 完整对话',
  summaryMd: '# 摘要',
  model: 'deepseek-flash',
  createdAt: 1,
  updatedAt: 1
}

describe('视频解读存储', () => {
  it('保存博主与报告，按 videoId 读取', () => {
    const store = createMemoryStore()
    store.videos.upsertCreator(creator)
    store.videos.saveReport(report)
    expect(store.videos.getCreator(creator.id)?.name).toBe('测试博主')
    expect(store.videos.getReport('abc123')?.summaryMd).toBe('# 摘要')
    expect(store.videos.listReports(creator.id)).toHaveLength(1)
    store.close()
  })

  it('移除博主会级联删除报告', () => {
    const store = createMemoryStore()
    store.videos.upsertCreator(creator)
    store.videos.saveReport(report)
    store.videos.removeCreator(creator.id)
    expect(store.videos.getReport('abc123')).toBeUndefined()
    store.close()
  })
})
