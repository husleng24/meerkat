// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { NavRail } from '../src/renderer/src/components/NavRail'

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

afterEach(async () => {
  await act(async () => root?.unmount())
  host?.remove()
  root = null
  host = null
  vi.restoreAllMocks()
})

describe('左侧常驻导航栏', () => {
  it('所有入口直接可见，点击即导航', async () => {
    ;(window as unknown as { meerkat: unknown }).meerkat = {
      update: { latest: async () => null, onAvailable: () => () => {}, open: vi.fn() }
    }
    const onNavigate = vi.fn()
    const el = await render(<NavRail active="today" attentionSources={0} onNavigate={onNavigate} />)
    const labels = [...el.querySelectorAll('nav button')].map((b) => b.getAttribute('aria-label'))
    expect(labels).toEqual(['今日简报', '跟踪', '搜索', '历史简报', '事实源', '视频解读', '周回顾', '实体', '设置'])
    await act(async () => (el.querySelector('button[aria-label="历史简报"]') as HTMLButtonElement).click())
    expect(onNavigate).toHaveBeenCalledWith('timeline')
  })

  it('当前页高亮，事实源告警带红点', async () => {
    ;(window as unknown as { meerkat: unknown }).meerkat = {
      update: { latest: async () => null, onAvailable: () => () => {}, open: vi.fn() }
    }
    const el = await render(<NavRail active="sources" attentionSources={3} onNavigate={vi.fn()} />)
    expect(el.querySelector('button[aria-label="事实源"]')?.getAttribute('aria-current')).toBe('page')
    expect(el.querySelector('[aria-label="3 个事实源需关注"]')).not.toBeNull()
  })

  it('跟踪入口在图标栏里，带进行中数量和很久没进展红点', async () => {
    ;(window as unknown as { meerkat: unknown }).meerkat = {
      update: { latest: async () => null, onAvailable: () => () => {}, open: vi.fn() }
    }
    const onNavigate = vi.fn()
    const el = await render(
      <NavRail active="today" attentionSources={0} tracking={{ active: 2, quiet: 1 }} onNavigate={onNavigate} />
    )
    expect(el.textContent).toContain('2')
    expect(el.querySelector('[aria-label="1 个跟踪很久没有新进展"]')).not.toBeNull()
    await act(async () => (el.querySelector('button[aria-label="跟踪"]') as HTMLButtonElement).click())
    expect(onNavigate).toHaveBeenCalledWith('stories')
  })
})
