// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { SelectionAgent } from '../src/renderer/src/components/SelectionAgent'

let root: Root | null = null
let host: HTMLDivElement | null = null
let main: HTMLElement | null = null

async function render(): Promise<HTMLDivElement> {
  main = document.createElement('main')
  host = document.createElement('div')
  const para = document.createElement('p')
  para.textContent = '官方 App 的功能被拆成可自由组合调用的接口，垂直 Agent 团队少了一层胶水代码。'
  main.appendChild(para)
  main.appendChild(host)
  document.body.appendChild(main)
  root = createRoot(host)
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  await act(async () => root!.render(<SelectionAgent />))
  return para
}

afterEach(async () => {
  await act(async () => root?.unmount())
  main?.remove()
  main = null
  host = null
  root = null
  vi.restoreAllMocks()
})

describe('选中文字后的 agent 工具条', () => {
  it('选中正文后出现，点击发出预填事件', async () => {
    const para = await render()
    const range = document.createRange()
    range.setStart(para.firstChild!, 0)
    range.setEnd(para.firstChild!, 20)
    range.getBoundingClientRect = () => ({ top: 100, bottom: 120, left: 50, right: 250, width: 200, height: 20, x: 50, y: 100, toJSON: () => ({}) })
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(range)
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    await act(async () => new Promise((r) => setTimeout(r, 10)))

    const bar = document.querySelector('[data-selection-agent]') as HTMLElement
    expect(bar?.textContent).toContain('用 agent 提问')

    const heard = vi.fn()
    window.addEventListener('meerkat:ask-agent', heard as EventListener, { once: true })
    const ask = [...bar.querySelectorAll('button')].find((b) => b.textContent?.includes('提问'))!
    await act(async () => ask.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(heard).toHaveBeenCalled()
    expect((heard.mock.calls[0]![0] as CustomEvent).detail.text).toContain('官方 App')
  })

  it('没有选中内容时不出现', async () => {
    await render()
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    await act(async () => new Promise((r) => setTimeout(r, 10)))
    expect(document.querySelector('[data-selection-agent]')).toBeNull()
  })
})
