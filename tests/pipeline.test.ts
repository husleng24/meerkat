import { describe, it, expect } from 'vitest'
import { cleanHtml, canonicalUrl, titleKey } from '../src/core/pipeline/text'
import { itemId } from '../src/core/pipeline/item-id'
import { sequenceRatio } from '../src/core/pipeline/similarity'
import { classifyBucket } from '../src/core/pipeline/classify'
import { scoreItem } from '../src/core/pipeline/rank'
import { dedupeAll, createDedupeState, absorb } from '../src/core/pipeline/dedupe'
import { buildCandidates } from '../src/core/pipeline/run'
import type { Item, RawItem, Source } from '../src/core/domain/types'

const T = 1_761_000_000_000
const HOUR = 3_600_000

function src(over: Partial<Source> = {}): Source {
  return {
    id: 's1',
    name: 'Source One',
    kind: 'rss',
    tier: 1,
    bucketHint: 'product',
    enabled: true,
    failStreak: 0,
    ...over
  }
}

function item(over: Partial<Item> = {}): Item {
  return {
    id: 'x',
    sourceId: 's1',
    title: 'Some title here',
    url: 'https://example.com/a',
    summary: '',
    bucket: 'product',
    score: 10,
    formulaVersion: 1,
    alsoIn: [],
    fetchedAt: T,
    ...over
  }
}

describe('text', () => {
  it('cleanHtml 去标签、解实体、压空白', () => {
    expect(cleanHtml('<p>Hello&nbsp;<b>World</b></p>')).toBe('Hello World')
    expect(cleanHtml('<script>bad()</script>ok')).toBe('ok')
    expect(cleanHtml('a &amp; b &#39;c&#39;')).toBe("a & b 'c'")
    expect(cleanHtml(null)).toBe('')
  })

  it('canonicalUrl 去跟踪参数与尾斜杠', () => {
    expect(canonicalUrl('https://Example.com/a/b/?utm_source=x&id=1#frag')).toBe(
      'https://example.com/a/b?id=1'
    )
    expect(canonicalUrl('https://example.com/')).toBe('https://example.com/')
    expect(canonicalUrl('not a url')).toBe('not a url')
  })

  it('titleKey 去停用词、保留 CJK', () => {
    expect(titleKey('The Future of AI')).toBe('future ai')
    expect(titleKey('Qwen4 支持 1M 上下文')).toBe('qwen4 支持 1m 上下文')
  })

  it('itemId 对同一内容的 URL 变体稳定', () => {
    const a = itemId('https://example.com/x?utm_source=a', 'Hello World')
    const b = itemId('https://example.com/x', 'Hello World')
    expect(a).toBe(b)
    expect(itemId('https://example.com/y', 'Hello World')).not.toBe(a)
  })
})

describe('similarity（等价 difflib）', () => {
  it('完全相同为 1，完全不同为 0', () => {
    expect(sequenceRatio('abc', 'abc')).toBe(1)
    expect(sequenceRatio('abc', 'xyz')).toBe(0)
  })
  it('部分重合介于 0 和 1 之间且单调', () => {
    const low = sequenceRatio('gemini 4 carbon', 'anthropic filing')
    const high = sequenceRatio('gemini 4 carbon launch', 'gemini 4 carbon release')
    expect(low).toBeLessThan(0.5)
    expect(high).toBeGreaterThan(0.7)
  })
})

describe('classify', () => {
  const base = { summary: '', sourceId: 's1', tier: 2, bucketHint: 'product' as const, type: 'rss' }

  it('论文类型直接归 research', () => {
    expect(classifyBucket({ ...base, title: '随便写', type: 'arxiv' })).toBe('research')
    expect(classifyBucket({ ...base, title: '随便写', type: 'hfpapers' })).toBe('research')
  })

  it('一手厂商的发布类标题归 product', () => {
    expect(
      classifyBucket({ ...base, tier: 1, title: 'OpenAI announces GPT-6' })
    ).toBe('product')
  })

  it('一手厂商的观点文章归 opinion', () => {
    expect(classifyBucket({ ...base, tier: 1, title: 'The future of the firm' })).toBe('opinion')
  })

  it('视频源归 video', () => {
    expect(
      classifyBucket({ ...base, title: 'Some random talk', sourceId: 'yt-x', type: 'video' })
    ).toBe('video')
  })

  it('无关键词时回落到 bucketHint', () => {
    expect(
      classifyBucket({ ...base, title: 'zzz', bucketHint: 'policy' })
    ).toBe('policy')
  })
})

describe('rank', () => {
  const ctx = { now: T, windowHours: 48 }
  const base = { title: 'Neutral headline', summary: '', tier: 2, type: 'rss' }

  it('层级权重生效：tier1 > tier2 > tier3', () => {
    const s1 = scoreItem({ ...base, tier: 1 }, ctx)
    const s2 = scoreItem({ ...base, tier: 2 }, ctx)
    const s3 = scoreItem({ ...base, tier: 3 }, ctx)
    expect(s1).toBeGreaterThan(s2)
    expect(s2).toBeGreaterThan(s3)
    expect(s1 - s2).toBeCloseTo(8, 2)
  })

  it('越新分越高', () => {
    const fresh = scoreItem({ ...base, publishedAt: T }, ctx)
    const old = scoreItem({ ...base, publishedAt: T - 40 * HOUR }, ctx)
    expect(fresh).toBeGreaterThan(old)
  })

  it('互动量按对数增长并封顶', () => {
    const p0 = scoreItem({ ...base, points: 0 }, ctx)
    const p100 = scoreItem({ ...base, points: 100 }, ctx)
    const p100k = scoreItem({ ...base, points: 100_000 }, ctx)
    expect(p100).toBeGreaterThan(p0)
    expect(p100k - p0).toBeLessThanOrEqual(12.01)
  })

  it('噪声词与论文惩罚生效', () => {
    const plain = scoreItem({ ...base, title: 'Gemini launches new model' }, ctx)
    const noisy = scoreItem({ ...base, title: 'Webinar: Gemini launches new model' }, ctx)
    expect(noisy).toBeLessThan(plain)
    const paper = scoreItem({ ...base, title: 'Gemini launches new model', type: 'hfpapers' }, ctx)
    expect(paper).toBeLessThan(plain)
  })

  it('过短标题被惩罚', () => {
    expect(scoreItem({ ...base, title: 'Tiny' }, ctx)).toBeLessThan(
      scoreItem({ ...base, title: 'Completely neutral descriptive phrasing here' }, ctx)
    )
  })
})

describe('dedupe', () => {
  it('URL 相同即合并，并记录来源', () => {
    const state = createDedupeState()
    absorb(state, { item: item({ id: 'a', url: 'https://x.com/1', score: 30 }), sourceName: 'OpenAI' })
    absorb(state, { item: item({ id: 'b', url: 'https://x.com/1', score: 20 }), sourceName: 'The Verge' })
    expect(state.kept).toHaveLength(1)
    expect(state.kept[0]!.alsoIn).toEqual(['The Verge'])
  })

  it('标题高度相似也会合并', () => {
    const state = createDedupeState()
    absorb(state, {
      item: item({ id: 'a', url: 'https://a.com/1', title: 'Gemini 4 Carbon launches today widely', score: 30 }),
      sourceName: 'DeepMind'
    })
    absorb(state, {
      item: item({ id: 'b', url: 'https://b.com/2', title: 'Gemini 4 Carbon launches today', score: 20 }),
      sourceName: 'HN'
    })
    expect(state.kept).toHaveLength(1)
  })

  it('不相关标题不会误合并', () => {
    const state = createDedupeState()
    absorb(state, { item: item({ id: 'a', url: 'https://one.com/a', title: 'Gemini 4 Carbon launches', score: 30 }), sourceName: 'A' })
    absorb(state, { item: item({ id: 'b', url: 'https://other.com/b', title: 'Anthropic files for IPO', score: 20 }), sourceName: 'B' })
    expect(state.kept).toHaveLength(2)
  })

  it('分数高的先被保留', () => {
    const out = dedupeAll([
      { item: item({ id: 'low', url: 'https://x.com/1', score: 5 }), sourceName: 'A' },
      { item: item({ id: 'high', url: 'https://x.com/1', score: 50 }), sourceName: 'B' }
    ])
    expect(out).toHaveLength(1)
    expect(out[0]!.id).toBe('high')
  })
})

describe('run 编排', () => {
  // 注意：标题必须彼此差异明显，否则会被 dedupe 正确合并，测不到编排逻辑
  const DISTINCT = [
    'Zephyr quantum annealing breakthrough announced',
    'Marlin underwater robotics fleet expands',
    'Tundra silicon wafer shortage eases',
    'Comet regulatory framework takes effect',
    'Basalt acoustic model reaches production',
    'Cobalt battery chemistry improves yield',
    'Granite mountain dataset released publicly',
    'Lumen optical interconnect doubles bandwidth',
    'Vertex compiler cuts kernel launch overhead',
    'Harbor logistics network automates routing',
    'Onyx security audit finds no critical flaws',
    'Willow streaming pipeline handles peak load'
  ]

  const raw = (over: Partial<RawItem> = {}, idx = 0): RawItem => ({
    title: DISTINCT[idx % DISTINCT.length]!,
    url: `https://example.com/${idx}`,
    publishedAt: T,
    ...over
  })

  it('按源窗口过滤掉过期条目', () => {
    const r = buildCandidates(
      [
        {
          source: src({ id: 's1', name: 'S1' }),
          items: [raw({}, 0), raw({ url: 'https://example.com/old', publishedAt: T - 100 * HOUR }, 1)]
        }
      ],
      { now: T, windowHours: 48, maxItems: 80, arxivKeep: 6 }
    )
    expect(r.items).toHaveLength(1)
    expect(r.nFiltered).toBe(1)
  })

  it('源级 windowHours 覆盖全局', () => {
    const r = buildCandidates(
      [
        {
          source: src({ id: 's1', name: 'S1', windowHours: 96 }),
          items: [raw({ url: 'https://example.com/mid', publishedAt: T - 72 * HOUR }, 2)]
        }
      ],
      { now: T, windowHours: 48, maxItems: 80, arxivKeep: 6 }
    )
    expect(r.items).toHaveLength(1)
  })

  it('arXiv 只保留指定条数', () => {
    const items = Array.from({ length: 10 }, (_, i) => raw({}, i))
    const r = buildCandidates(
      [{ source: src({ id: 'arxiv', name: 'arXiv', kind: 'arxiv', tier: 2 }), items }],
      { now: T, windowHours: 48, maxItems: 80, arxivKeep: 3 }
    )
    expect(r.items).toHaveLength(3)
  })

  it('全局截断生效且按分数降序', () => {
    const items = Array.from({ length: 5 }, (_, i) => raw({}, i))
    const r = buildCandidates(
      [{ source: src({ id: 's1', name: 'S1' }), items }],
      { now: T, windowHours: 48, maxItems: 2, arxivKeep: 6 }
    )
    expect(r.items).toHaveLength(2)
    expect(r.items[0]!.score).toBeGreaterThanOrEqual(r.items[1]!.score)
  })
})
