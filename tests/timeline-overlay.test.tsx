// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { TimelineOverlay } from '../src/renderer/src/components/TimelineOverlay'
import type { EventTimeline } from '../src/app/event-timeline'

let root: Root | null = null
let host: HTMLDivElement | null = null

const timeline: EventTimeline = {
  title: '黄仁勋辞职与复职请愿',
  range: { from: '2026-11-12', to: '2026-11-15' },
  summary: '11月12日辞职；11月15日联署要求复职，签名超 11.5 万。',
  mode: 'agent',
  gaps: ['11-10 之后有 1 天没有新进展'],
  openQuestions: ['英伟达是否回应请愿？'],
  items: [
    { id: 'i1', title: 'a', url: 'https://a.com/1', sourceName: 'The Verge', date: '2026-11-12', summary: '' },
    { id: 'i2', title: 'b', url: 'https://b.com/1', sourceName: 'The Verge', date: '2026-11-15', summary: '' }
  ],
  phases: [
    {
      date: '2026-11-12',
      headline: '辞任 CEO',
      detail: '临时继任安排。',
      status: 'reported',
      confidence: 'single-source',
      sourceItemIds: ['i1']
    },
    {
      date: '2026-11-15',
      headline: '联署要求复职',
      detail: '签名超过 11.5 万。',
      status: 'reported',
      confidence: 'multi-source',
      sourceItemIds: ['i2']
    }
  ]
}

async function render(): Promise<HTMLDivElement> {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  await act(async () => root!.render(<TimelineOverlay />))
  return host
}

afterEach(async () => {
  await act(async () => root?.unmount())
  host?.remove()
  root = null
  host = null
  vi.restoreAllMocks()
})

describe('完整时间线页', () => {
  it('打开后显示全部节点、来源与缺口', async () => {
    const el = await render()
    expect(el.textContent).toBe('')
    await act(async () => {
      window.dispatchEvent(new CustomEvent('meerkat:open-timeline', { detail: { timeline } }))
    })
    expect(el.textContent).toContain('黄仁勋辞职与复职请愿')
    expect(el.textContent).toContain('现在：11月15日联署要求复职')
    expect(el.textContent).toContain('辞任 CEO')
    expect(el.textContent).toContain('联署要求复职')
    expect(el.textContent).toContain('The Verge')
    expect(el.textContent).toContain('×2')
    expect(el.textContent).toContain('时间线缺口')
    expect(el.textContent).toContain('英伟达是否回应请愿？')
  })

  it('返回后关闭', async () => {
    const el = await render()
    await act(async () => {
      window.dispatchEvent(new CustomEvent('meerkat:open-timeline', { detail: { timeline } }))
    })
    const back = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('返回'))!
    await act(async () => back.click())
    expect(el.textContent).toBe('')
  })
})
