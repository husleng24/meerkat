// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { UpdateNotice } from '../src/renderer/src/components/UpdateNotice'
import type { UpdateCheckPayload } from '../src/renderer/src/lib/ipc-types'

let root: Root | null = null
let host: HTMLDivElement | null = null

const info: UpdateCheckPayload = {
  ok: true,
  current: '0.1.1',
  latest: 'v0.1.2',
  hasUpdate: true,
  url: 'https://github.com/husleng24/meerkat/releases/tag/v0.1.2'
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
  vi.restoreAllMocks()
})

describe('侧栏升级提示', () => {
  it('有新版本时显示下载图标与版本号', async () => {
    const open = vi.fn()
    ;(window as unknown as { meerkat: unknown }).meerkat = {
      update: { latest: async () => info, onAvailable: () => () => {}, open }
    }
    const el = await render(<UpdateNotice />)
    expect(el.querySelector('svg')).not.toBeNull()
    expect(el.textContent).toContain('新版本 v0.1.2')
    expect(el.textContent).toContain('下载')
    await act(async () => (el.querySelector('button') as HTMLButtonElement).click())
    expect(open).toHaveBeenCalledWith('https://github.com/husleng24/meerkat/releases/tag/v0.1.2')
  })

  it('没有更新时不渲染', async () => {
    ;(window as unknown as { meerkat: unknown }).meerkat = {
      update: { latest: async () => ({ ...info, hasUpdate: false }), onAvailable: () => () => {}, open: vi.fn() }
    }
    const el = await render(<UpdateNotice />)
    expect(el.textContent).toBe('')
  })
})
