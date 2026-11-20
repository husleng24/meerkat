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
  url: 'https://github.com/husleng24/meerkat/releases/tag/v0.1.2',
  notes: '## 新版本\n\n- 侧栏升级入口'
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
  it('有更新时显示紧凑图标，点击展开版本卡片', async () => {
    const open = vi.fn()
    ;(window as unknown as { meerkat: unknown }).meerkat = {
      update: { latest: async () => info, onAvailable: () => () => {}, open }
    }
    const el = await render(<UpdateNotice />)
    const icon = el.querySelector('button') as HTMLButtonElement
    expect(icon.getAttribute('aria-label')).toContain('有新版本 v0.1.2')
    expect(el.querySelector('svg')).not.toBeNull()
    expect(el.textContent).not.toContain('发现新版本')

    await act(async () => icon.click())
    expect(el.textContent).toContain('发现新版本 v0.1.2')
    expect(el.textContent).toContain('下载安装包')
    expect(el.textContent).toContain('查看完整说明')

    const download = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('下载安装包')) as HTMLButtonElement
    await act(async () => download.click())
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
