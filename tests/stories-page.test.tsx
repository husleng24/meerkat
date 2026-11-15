// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { StoriesPage } from '../src/renderer/src/components/StoriesPage'
import type { StoryPayload } from '../src/renderer/src/lib/ipc-types'

let root: Root | null = null
let host: HTMLDivElement | null = null

const story = (over: Partial<StoryPayload>): StoryPayload => ({
  id: 'st-1',
  title: '黄仁勋辞职',
  query: '黄仁勋辞职',
  aliases: ['黄仁勋', 'Jensen Huang'],
  topicId: 'ai',
  itemId: 'i1',
  threadId: 'ct-1',
  status: 'active',
  missCount: 0,
  createdAt: Date.now() - 86_400_000,
  updatedAt: Date.now(),
  itemCount: 3,
  nodeCount: 4,
  latest: { title: '联署要求复职，签名超 11.5 万', at: Date.now() - 7_200_000 },
  latestEvent: { title: '联署要求复职，签名超 11.5 万', date: '2026-11-15' },
  lastMatchAt: Date.now() - 3_600_000,
  ...over
})

async function render(el: React.ReactElement): Promise<HTMLDivElement> {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  await act(async () => root!.render(el))
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
  return host
}

afterEach(async () => {
  await act(async () => root?.unmount())
  host?.remove()
  root = null
  host = null
  vi.restoreAllMocks()
})

describe('跟踪总览', () => {
  it('列出跟踪中的事件和素材数', async () => {
    ;(window as unknown as { meerkat: unknown }).meerkat = {
      stories: { list: async () => [story({ missCount: 3 })], setStatus: vi.fn(), onReview: () => () => {} }
    }
    const el = await render(<StoriesPage onOpen={vi.fn()} />)
    expect(el.textContent).toContain('黄仁勋辞职')
    expect(el.textContent).toContain('联署要求复职')
    expect(el.textContent).toContain('4 个节点')
    expect(el.textContent).toContain('3 篇报道')
    expect(el.textContent).toContain('连续 3 次无新进展')
  })

  it('暂停、继续、放弃都会调用状态接口', async () => {
    const setStatus = vi.fn(async () => null)
    ;(window as unknown as { meerkat: unknown }).meerkat = {
      stories: {
        list: async () => [story({}), story({ id: 'st-2', title: '旧事件', status: 'archived' })],
        setStatus,
        onReview: () => () => {}
      }
    }
    const el = await render(<StoriesPage onOpen={vi.fn()} />)
    const click = async (label: string): Promise<void> => {
      const btn = [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)
      await act(async () => (btn as HTMLButtonElement).click())
    }
    await click('暂停')
    expect(setStatus).toHaveBeenCalledWith({ id: 'st-1', status: 'paused' })
    await click('放弃')
    expect(setStatus).toHaveBeenCalledWith({ id: 'st-1', status: 'archived' })
  })

  it('点标题打开评论串', async () => {
    const onOpen = vi.fn()
    ;(window as unknown as { meerkat: unknown }).meerkat = {
      stories: { list: async () => [story({})], setStatus: vi.fn(), onReview: () => () => {} }
    }
    const el = await render(<StoriesPage onOpen={onOpen} />)
    const title = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('黄仁勋辞职'))
    await act(async () => (title as HTMLButtonElement).click())
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'st-1' }))
  })
})
