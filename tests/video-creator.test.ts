import { describe, expect, it } from 'vitest'
import { normalizeCreatorUrl } from '../src/adapters/youtube/creator'

describe('YouTube 博主地址', () => {
  it('接受 @handle', () => {
    expect(normalizeCreatorUrl('@lexfridman')).toEqual({
      url: 'https://www.youtube.com/@lexfridman/videos',
      handle: '@lexfridman'
    })
  })

  it('接受完整频道 URL 并补 /videos', () => {
    expect(normalizeCreatorUrl('https://www.youtube.com/@OpenAI')).toMatchObject({
      url: 'https://www.youtube.com/@OpenAI/videos'
    })
    expect(normalizeCreatorUrl('https://www.youtube.com/channel/UCXZCJLdBC09xxGZ6gcdrc6A')).toMatchObject({
      url: 'https://www.youtube.com/channel/UCXZCJLdBC09xxGZ6gcdrc6A/videos'
    })
  })

  it('拒绝视频链接，避免把“博主”和“单期视频”混为一谈', () => {
    expect(() => normalizeCreatorUrl('https://www.youtube.com/watch?v=abc')).toThrow()
  })
})
