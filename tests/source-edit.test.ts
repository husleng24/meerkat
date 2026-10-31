import { describe, it, expect } from 'vitest'
import { ALLOWED_KINDS, extractChannelId, makeSourceId, validateNewSource } from '../src/app/source-edit'

const noIds = new Set<string>()

describe('makeSourceId', () => {
  it('从域名与路径生成可读 id', () => {
    expect(makeSourceId('https://blog.example.com/feed.xml', noIds)).toBe('example-com-feedxml')
  })

  it('去掉 www 前缀', () => {
    expect(makeSourceId('https://www.theverge.com/rss/ai', noIds)).toBe('theverge-com-rss')
  })

  it('冲突时加序号', () => {
    const existing = new Set(['example-com-feedxml'])
    expect(makeSourceId('https://blog.example.com/feed.xml', existing)).toBe('example-com-feedxml-2')
    const existing2 = new Set(['example-com-feedxml', 'example-com-feedxml-2'])
    expect(makeSourceId('https://blog.example.com/feed.xml', existing2)).toBe('example-com-feedxml-3')
  })

  it('非法 URL 回退到 custom 且不抛异常', () => {
    expect(makeSourceId('::::', new Set(['custom']))).toBe('custom-2')
  })

  it('id 只含小写字母数字与连字符', () => {
    expect(makeSourceId('https://My.Site.com/A_B/C', noIds)).toMatch(/^[a-z0-9-]+$/)
  })
})

describe('extractChannelId', () => {
  it('从频道 URL 里取 UC 开头的 24 位', () => {
    expect(extractChannelId('https://www.youtube.com/channel/UCabc123def456ghi789jklm')).toBe(
      'UCabc123def456ghi789jklm'
    )
  })
  it('也接受裸 channelId', () => {
    expect(extractChannelId('UCabc123def456ghi789jklm')).toBe('UCabc123def456ghi789jklm')
  })
  it('@handle 或普通视频链接取不到', () => {
    expect(extractChannelId('https://www.youtube.com/@OpenAI')).toBeUndefined()
    expect(extractChannelId('https://youtu.be/xyz')).toBeUndefined()
  })
})

describe('validateNewSource', () => {
  const base = { name: '我的博客', url: 'https://blog.example.com/rss', kind: 'rss', tier: 2, bucketHint: 'product' }

  it('合法的 RSS 源通过', () => {
    const r = validateNewSource(base, noIds)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.source.url).toBe(base.url)
      expect(r.source.enabled).toBe(true)
      expect(r.source.failStreak).toBe(0)
      expect(r.source.tier).toBe(2)
    }
  })

  it('名称过短/过长被拒', () => {
    expect(validateNewSource({ ...base, name: 'a' }, noIds).ok).toBe(false)
    expect(validateNewSource({ ...base, name: 'x'.repeat(61) }, noIds).ok).toBe(false)
  })

  it('未知类型被拒', () => {
    const r = validateNewSource({ ...base, kind: 'telegram' }, noIds)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('不支持的类型')
  })

  it('层级越界被拒', () => {
    expect(validateNewSource({ ...base, tier: 0 }, noIds).ok).toBe(false)
    expect(validateNewSource({ ...base, tier: 4 }, noIds).ok).toBe(false)
    expect(validateNewSource({ ...base, tier: 2.5 }, noIds).ok).toBe(false)
  })

  it('未知板块被拒', () => {
    expect(validateNewSource({ ...base, bucketHint: 'gossip' }, noIds).ok).toBe(false)
  })

  it('地址缺少协议被拒', () => {
    const r = validateNewSource({ ...base, url: 'blog.example.com/rss' }, noIds)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('http')
  })

  it('YouTube 源必须给频道地址', () => {
    const r = validateNewSource({ ...base, kind: 'youtube', url: 'https://youtube.com/@foo' }, noIds)
    expect(r.ok).toBe(false)
    const ok = validateNewSource(
      { ...base, kind: 'youtube', url: 'https://www.youtube.com/channel/UCabc123def456ghi789jklm' },
      noIds
    )
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(ok.source.channelId).toBe('UCabc123def456ghi789jklm')
  })

  it('HN 源不需要 url', () => {
    const r = validateNewSource({ name: 'HN 讨论', kind: 'hn', tier: 3, bucketHint: 'community' }, noIds)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.source.url).toBeUndefined()
  })

  it('生成 id 不与已存在的冲突', () => {
    const r = validateNewSource(base, new Set(['example-com-rss']))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.source.id).not.toBe('example-com-rss')
  })

  it('所有允许的类型都能构造出合法源（除必须参数外）', () => {
    for (const kind of ALLOWED_KINDS) {
      const input =
        kind === 'youtube'
          ? { ...base, kind, url: 'https://www.youtube.com/channel/UCabc123def456ghi789jklm' }
          : kind === 'hn'
            ? { ...base, kind, url: '' }
            : { ...base, kind }
      const r = validateNewSource(input, noIds)
      expect(r.ok, `kind=${kind}: ${r.ok ? '' : r.error}`).toBe(true)
    }
  })
})
