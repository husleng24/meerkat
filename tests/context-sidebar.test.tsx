// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ContextSidebar } from '../src/renderer/src/components/ContextSidebar'
import type { StoryPayload } from '../src/renderer/src/lib/ipc-types'

let root: Root | null = null
let host: HTMLDivElement | null = null

async function render(el: React.ReactElement): Promise<HTMLDivElement> {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  await act(async () => {
    root!.render(el)
  })
  return host
}

function story(status: StoryPayload['status']): StoryPayload {
  return {
    id: `st-${status}-${Math.random()}`,
    title: '事件',
    query: '事件',
    aliases: ['事件'],
    topicId: 'ai',
    status,
    missCount: 0,
    createdAt: 1,
    updatedAt: 1,
    itemCount: 1,
    nodeCount: 0
  } as StoryPayload
}

afterEach(async () => {
  await act(async () => root?.unmount())
  host?.remove()
  root = null
  host = null
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('上下文侧栏', () => {
  it('跟踪页显示状态计数，点击切换筛选', async () => {
    ;(window as unknown as { meerkat: unknown }).meerkat = {
      stories: { list: async () => [story('active'), story('active'), story('paused'), story('archived')] }
    }
    const onTab = vi.fn()
    window.addEventListener('meerkat:tracking-tab', onTab)
    const el = await render(<ContextSidebar nav="stories" attentionSources={0} />)
    await act(async () => new Promise((r) => setTimeout(r, 0)))
    expect(el.textContent).toContain('进行中')
    expect(el.textContent).toContain('2')
    expect(el.textContent).not.toContain('AI 综合')
    await act(async () => (el.querySelector('button') as HTMLButtonElement).click())
    expect(onTab).toHaveBeenCalled()
    window.removeEventListener('meerkat:tracking-tab', onTab)
  })

  it('搜索页显示最近搜索，点击回填关键词', async () => {
    localStorage.setItem('meerkat.search.recent', JSON.stringify(['Gemini', 'Agent']))
    const onQuery = vi.fn()
    window.addEventListener('meerkat:search-query', onQuery)
    const el = await render(<ContextSidebar nav="search" attentionSources={0} />)
    expect(el.textContent).toContain('Gemini')
    const gemini = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('Gemini'))!
    await act(async () => gemini.click())
    expect(onQuery).toHaveBeenCalled()
    window.removeEventListener('meerkat:search-query', onQuery)
  })
})
