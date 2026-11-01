// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { UpdateBanner } from '../src/renderer/src/components/UpdateBanner'
import type { UpdateCheckPayload } from '../src/renderer/src/lib/ipc-types'

let root: Root | null = null
let host: HTMLDivElement | null = null

const info: UpdateCheckPayload = {
  ok: true,
  current: '0.1.1',
  latest: 'v0.1.2',
  hasUpdate: true,
  url: 'https://github.com/husleng24/meerkat/releases/tag/v0.1.2',
  notes: '## 更新\n\n- 修复了升级提示'
}

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
  sessionStorage.clear()
  vi.restoreAllMocks()
})

function mockBridge(payload: UpdateCheckPayload | null): void {
  ;(window as unknown as { meerkat: unknown }).meerkat = {
    update: {
      latest: async () => payload,
      onAvailable: () => () => {},
      open: vi.fn()
    }
  }
}

describe('升级横幅', () => {
  it('显示图标、版本对比与下载入口', async () => {
    mockBridge(info)
    const el = await render(<UpdateBanner />)
    expect(el.querySelector('svg')).not.toBeNull()
    expect(el.textContent).toContain('v0.1.1 → v0.1.2')
    expect(el.textContent).toContain('下载更新')
  })

  it('可以展开 changelog', async () => {
    mockBridge(info)
    const el = await render(<UpdateBanner />)
    const toggle = [...el.querySelectorAll('button')].find((b) => b.textContent === '更新内容')!
    await act(async () => toggle.click())
    expect(el.textContent).toContain('修复了升级提示')
    expect(el.textContent).toContain('收起更新内容')
  })

  it('没有更新时不渲染', async () => {
    mockBridge({ ...info, hasUpdate: false })
    const el = await render(<UpdateBanner />)
    expect(el.textContent).toBe('')
  })

  it('忽略后本次运行不再显示', async () => {
    mockBridge(info)
    const el = await render(<UpdateBanner />)
    const close = el.querySelector('button[aria-label="忽略这个版本的提示"]')!
    await act(async () => (close as HTMLButtonElement).click())
    expect(el.textContent).toBe('')
    expect(sessionStorage.getItem('meerkat.update.dismissed')).toBe('v0.1.2')
  })
})
