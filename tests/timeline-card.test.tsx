// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { TimelineCard } from '../src/renderer/src/components/TimelineCard'
import type { EventTimeline } from '../src/app/event-timeline'

let root: Root | null = null
let host: HTMLDivElement | null = null

const timeline: EventTimeline = {
  title: '黄仁勋辞职与复职请愿',
  range: { from: '2026-11-12', to: '2026-11-15' },
  summary: '11月12日辞职；11月13日同意作证；11月15日联署要求复职，签名超 11.5 万。',
  mode: 'agent',
  gaps: ['11-10 之后有 1 天没有新进展'],
  openQuestions: ['英伟达是否回应请愿？', '继任者是谁？', '调查结论是什么？'],
  items: [
    { id: 'i1', title: 'a', url: 'https://a.com/1', sourceName: 'The Verge', date: '2026-11-12', summary: '' },
    { id: 'i2', title: 'b', url: 'https://b.com/1', sourceName: 'Reuters', date: '2026-11-13', summary: '' },
    { id: 'i3', title: 'c', url: 'https://c.com/1', sourceName: 'TechCrunch', date: '2026-11-15', summary: '' }
  ],
  phases: [
    {
      date: '2026-11-12',
      headline: '辞任 CEO，CFO 临时接任',
      detail: '多家媒体确认辞职与临时继任安排。',
      status: 'reported',
      confidence: 'multi-source',
      sourceItemIds: ['i1']
    },
    {
      date: '2026-11-13',
      headline: '同意赴国会作证',
      detail: '具体日期尚未公布。',
      status: 'reported',
      confidence: 'single-source',
      sourceItemIds: ['i2']
    },
    {
      date: '2026-11-15',
      headline: '联署请愿要求复职',
      detail: '签名超过 11.5 万。',
      status: 'reported',
      confidence: 'single-source',
      sourceItemIds: ['i3']
    }
  ]
}

async function render(): Promise<HTMLDivElement> {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  await act(async () => root!.render(<TimelineCard timeline={timeline} />))
  return host
}

afterEach(async () => {
  await act(async () => root?.unmount())
  host?.remove()
  root = null
  host = null
  localStorage.clear()
})

describe('时间线卡', () => {
  it('先给现在和节点/报道计数，默认最新在上', async () => {
    const el = await render()
    expect(el.textContent).toContain('现在：11月15日联署要求复职')
    expect(el.textContent).toContain('3 个节点')
    expect(el.textContent).toContain('3 篇报道')
    const dates = [...el.querySelectorAll('li')].map((li) => li.textContent?.match(/2026-11-\d\d/)?.[0])
    expect(dates[0]).toBe('2026-11-15')
    expect(dates.at(-1)).toBe('2026-11-12')
  })

  it('切到从头看后顺序反转', async () => {
    const el = await render()
    const btn = [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === '从头看')!
    await act(async () => btn.click())
    const dates = [...el.querySelectorAll('li')].map((li) => li.textContent?.match(/2026-11-\d\d/)?.[0])
    expect(dates[0]).toBe('2026-11-12')
  })

  it('可以打开完整时间线页', async () => {
    const el = await render()
    const heard = vi.fn()
    window.addEventListener('meerkat:open-timeline', heard as EventListener, { once: true })
    const btn = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('展开完整时间线'))!
    await act(async () => btn.click())
    expect(heard).toHaveBeenCalled()
    expect((heard.mock.calls[0]![0] as CustomEvent).detail.timeline.title).toBe('黄仁勋辞职与复职请愿')
  })

  it('缺口与待确认可见，待确认可展开', async () => {
    const el = await render()
    expect(el.textContent).toContain('没有新进展')
    expect(el.textContent).toContain('待确认 3 项')
    const toggle = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('待确认'))!
    await act(async () => toggle.click())
    expect(el.textContent).toContain('调查结论是什么？')
  })
})
