// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Sidebar } from '../src/renderer/src/components/Sidebar'
import type { TopicPayload } from '../src/renderer/src/lib/ipc-types'

function topic(over: Partial<TopicPayload> = {}): TopicPayload {
  return {
    id: 'a',
    name: '模型与产品',
    domainId: 'ai',
    enabled: true,
    hour: 8,
    minute: 30,
    sourceCount: 35,
    hasBrief: true,
    todayCount: 23,
    unreadCount: 0,
    ...over
  }
}

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

function baseProps(over: Partial<React.ComponentProps<typeof Sidebar>> = {}): React.ComponentProps<typeof Sidebar> {
  return {
    active: 'today',
    topics: [
      topic({ id: 'a', name: '模型与产品', todayCount: 23, unreadCount: 2 }),
      topic({ id: 'b', name: '芯片与算力', todayCount: 12 }),
      topic({ id: 'c', name: '具身智能', domainId: 'robot', todayCount: 4 })
    ],
    activeTopic: 'a',
    onPickTopic: vi.fn(),
    topicsAvailable: true,
    onCreateTopic: vi.fn().mockResolvedValue(null),
    onNavigate: vi.fn(),
    attentionSources: 15,
    dateLabel: '2026-11-12',
    ...over
  }
}

const topicButton = (el: HTMLElement, name: string): HTMLButtonElement =>
  [...el.querySelectorAll('button')].find((b) => b.textContent?.includes(name)) as HTMLButtonElement

describe('侧栏：扁平主题列表', () => {
  it('全部主题平铺显示，不再有领域标签', async () => {
    const el = await render(<Sidebar {...baseProps()} />)
    expect(el.textContent).toContain('模型与产品')
    expect(el.textContent).toContain('芯片与算力')
    expect(el.textContent).toContain('具身智能')
    expect(el.textContent).not.toContain('机器人')
  })

  it('没有领域切换器', async () => {
    const el = await render(<Sidebar {...baseProps()} />)
    expect(el.querySelector('button[aria-haspopup="listbox"]')).toBeNull()
  })

  it('点主题直接切换', async () => {
    const onPick = vi.fn()
    const el = await render(<Sidebar {...baseProps({ onPickTopic: onPick })} />)
    await act(async () => topicButton(el, '具身智能').click())
    expect(onPick).toHaveBeenCalledWith('c')
  })

  it('当前主题高亮，其余不高亮', async () => {
    const el = await render(<Sidebar {...baseProps()} />)
    expect(topicButton(el, '模型与产品').getAttribute('aria-current')).toBe('true')
    expect(topicButton(el, '芯片与算力').getAttribute('aria-current')).toBeNull()
  })

  it('未读点只出现在有未读的主题上', async () => {
    const el = await render(<Sidebar {...baseProps()} />)
    expect(topicButton(el, '模型与产品').querySelector('span[aria-label="2 条未读"]')).not.toBeNull()
    expect(topicButton(el, '芯片与算力').querySelector('span[aria-label]')).toBeNull()
  })

  it('没有「新建领域 / 管理领域」入口（领域管理已收进设置页）', async () => {
    const el = await render(<Sidebar {...baseProps()} />)
    expect(el.textContent).not.toContain('新建领域')
    expect(el.textContent).not.toContain('管理领域')
  })

  it('就地新建主题：回车创建并切过去', async () => {
    const created = vi.fn().mockResolvedValue('t-new')
    const onPick = vi.fn()
    const el = await render(<Sidebar {...baseProps({ onCreateTopic: created, onPickTopic: onPick })} />)
    const add = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('新建主题'))!
    await act(async () => add.click())

    const input = el.querySelector('input')!
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => {
      setter.call(input, 'Agent 与工具')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })

    expect(created).toHaveBeenCalledWith(expect.objectContaining({ name: 'Agent 与工具' }))
    expect(onPick).toHaveBeenCalledWith('t-new')
  })

  it('没有今日导航，也没有数据来源文案', async () => {
    const el = await render(<Sidebar {...baseProps()} />)
    const navLabels = [...el.querySelectorAll('nav button')].map((b) => b.textContent?.trim() ?? '')
    expect(navLabels.some((x) => x.startsWith('今日'))).toBe(false)
    expect(el.textContent).not.toContain('数据来源')
  })

  it('底部导航按钮打开全局菜单，事实源告警带数量', async () => {
    const onNavigate = vi.fn()
    const el = await render(<Sidebar {...baseProps({ onNavigate })} />)
    const trigger = el.querySelector('button[aria-haspopup="menu"]') as HTMLButtonElement
    await act(async () => trigger.click())

    const items = [...el.querySelectorAll('[role="menuitem"]')]
    const labels = items.map((i) => i.textContent ?? '')
    expect(labels.some((x) => x.includes('搜索'))).toBe(true)
    expect(labels.some((x) => x.includes('时间线'))).toBe(true)
    expect(labels.some((x) => x.includes('设置'))).toBe(true)
    expect(labels.find((x) => x.includes('事实源'))).toContain('15')

    await act(async () => items.find((i) => i.textContent?.includes('时间线'))!.click())
    expect(onNavigate).toHaveBeenCalledWith('timeline')
  })
})
