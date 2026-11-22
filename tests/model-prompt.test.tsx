// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ModelPrompt } from '../src/renderer/src/components/ModelPrompt'

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
})

describe('仅聚合提示', () => {
  it('说清楚缺什么，并把两个动作分开', async () => {
    const onOpenSettings = vi.fn()
    const onDismiss = vi.fn()
    const el = await render(<ModelPrompt onOpenSettings={onOpenSettings} onDismiss={onDismiss} />)
    expect(el.textContent).toContain('仅聚合')
    expect(el.textContent).toContain('三句话速览')

    await act(async () => {
      ;[...el.querySelectorAll('button')].find((b) => b.textContent?.includes('去设置'))!.click()
    })
    expect(onOpenSettings).toHaveBeenCalled()

    await act(async () => {
      ;[...el.querySelectorAll('button')].find((b) => b.textContent?.includes('以后再说'))!.click()
    })
    expect(onDismiss).toHaveBeenCalled()
  })
})
