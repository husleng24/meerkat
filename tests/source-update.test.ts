import { describe, it, expect } from 'vitest'
import { validateSourceUpdate } from '../src/app/source-edit'
import type { Source } from '../src/core/domain/types'

function src(over: Partial<Source> = {}): Source {
  return {
    id: 's1',
    name: '原名称',
    kind: 'rss',
    url: 'https://example.com/feed.xml',
    tier: 2,
    bucketHint: 'product',
    enabled: true,
    failStreak: 0,
    ...over
  }
}

const base = { id: 's1', name: '新名称', url: 'https://example.com/feed2.xml', tier: 1, bucketHint: 'agent' as const }

describe('validateSourceUpdate', () => {
  it('正常编辑：改名/地址/层级/板块', () => {
    const r = validateSourceUpdate(base, src())
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.source.name).toBe('新名称')
      expect(r.source.url).toBe('https://example.com/feed2.xml')
      expect(r.source.tier).toBe(1)
      expect(r.source.bucketHint).toBe('agent')
    }
  })

  it('保留 id、kind 与启用状态', () => {
    const r = validateSourceUpdate(base, src({ id: 'keep-me', enabled: false }))
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.source.id).toBe('keep-me')
      expect(r.source.kind).toBe('rss')
      expect(r.source.enabled).toBe(false)
    }
  })

  it('名称过短/过长被拒', () => {
    expect(validateSourceUpdate({ ...base, name: 'a' }, src()).ok).toBe(false)
    expect(validateSourceUpdate({ ...base, name: 'x'.repeat(61) }, src()).ok).toBe(false)
  })

  it('层级越界被拒', () => {
    expect(validateSourceUpdate({ ...base, tier: 0 }, src()).ok).toBe(false)
    expect(validateSourceUpdate({ ...base, tier: 4 }, src()).ok).toBe(false)
  })

  it('未知板块被拒', () => {
    expect(validateSourceUpdate({ ...base, bucketHint: 'nope' as never }, src()).ok).toBe(false)
  })

  it('RSS 地址必须有协议且合法', () => {
    expect(validateSourceUpdate({ ...base, url: 'example.com/feed' }, src()).ok).toBe(false)
    expect(validateSourceUpdate({ ...base, url: 'https://' }, src()).ok).toBe(false)
  })

  it('YouTube：给新频道地址会更新 channelId', () => {
    const yt = src({ kind: 'youtube', channelId: 'UCaaaaaaaaaaaaaaaaaaaaaa', url: undefined })
    const r = validateSourceUpdate(
      { ...base, url: 'https://www.youtube.com/channel/UCbbbbbbbbbbbbbbbbbbbbbb' },
      yt
    )
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.source.channelId).toBe('UCbbbbbbbbbbbbbbbbbbbbbb')
  })

  it('YouTube：留空地址时保留原 channelId', () => {
    const yt = src({ kind: 'youtube', channelId: 'UCaaaaaaaaaaaaaaaaaaaaaa' })
    const r = validateSourceUpdate({ ...base, url: '' }, yt)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.source.channelId).toBe('UCaaaaaaaaaaaaaaaaaaaaaa')
  })

  it('YouTube：填了非法地址被拒', () => {
    const yt = src({ kind: 'youtube', channelId: 'UCaaaaaaaaaaaaaaaaaaaaaa' })
    expect(validateSourceUpdate({ ...base, url: 'https://youtube.com/@handle' }, yt).ok).toBe(false)
  })

  it('HN 不需要地址也能保存', () => {
    const hn = src({ kind: 'hn', url: undefined })
    const r = validateSourceUpdate({ ...base, url: '' }, hn)
    expect(r.ok).toBe(true)
  })

  it('缺 id 时不崩（由调用方保证）', () => {
    expect(validateSourceUpdate({ ...base, id: '' }, src()).ok).toBe(true)
  })
})
