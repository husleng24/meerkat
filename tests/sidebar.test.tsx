// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Sidebar } from '../src/renderer/src/components/Sidebar'
import type { DomainPayload, TopicPayload } from '../src/renderer/src/lib/ipc-types'

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

function domain(over: Partial<DomainPayload> = {}): DomainPayload {
  return { id: 'ai', name: 'AI', createdAt: 1, topicCount: 3, ...over }
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
      topic({ id: 'b', name: '芯片与算力', todayCount: 12 })
    ],
    activeTopic: 'a',
    onPickTopic: vi.fn(),
    domains: [domain(), domain({ id: 'robot', name: '机器人', topicCount: 2 })],
    activeDomain: 'ai',
    onPickDomain: vi.fn(),
    onCreateDomain: vi.fn().mockResolvedValue(null),
    onCreateTopic: vi.fn().mockResolvedValue(null),
    topicsAvailable: true,
    onNavigate: vi.fn(),
    itemCount: 23,
    savedCount: 0,
    readCount: 0,
    attentionSources: 15,
    origin: 'ipc',
    bridgeAvailable: true,
    dateLabel: '2026-11-01',
    ...over
  }
}

const switcher = (el: HTMLElement): HTMLButtonElement => el.querySelector('button[aria-haspopup="listbox"]')!

describe('侧栏：领域切换器 + 主题列表', () => {
  it('常驻显示当前领域，下面列出该领域的主题', async () => {
    const el = await render(<Sidebar {...baseProps()} />)
    expect(switcher(el).textContent).toContain('AI')
    expect(el.textContent).toContain('模型与产品')
    expect(el.textContent).toContain('芯片与算力')
    // 另一个领域的主题不出现
    expect(el.textContent).not.toContain('人形机器人')
  })

  it('点开列出全部领域与主题数', async () => {
    const el = await render(<Sidebar {...baseProps()} />)
    await act(async () => switcher(el).click())
    const options = [...el.querySelectorAll('[role="option"]')]
    expect(options.map((o) => o.textContent)).toEqual(['AI3', '机器人2'])
    expect(options[0]!.getAttribute('aria-selected')).toBe('true')
  })

  it('切换领域交给上层，并收起弹层', async () => {
    const onPickDomain = vi.fn()
    const el = await render(<Sidebar {...baseProps({ onPickDomain })} />)
    await act(async () => switcher(el).click())
    const robot = [...el.querySelectorAll('[role="option"]')][1] as HTMLButtonElement
    await act(async () => robot.click())
    expect(onPickDomain).toHaveBeenCalledWith('robot')
    expect(switcher(el).getAttribute('aria-expanded')).toBe('false')
  })

  it('点主题切换', async () => {
    const onPick = vi.fn()
    const el = await render(<Sidebar {...baseProps({ onPickTopic: onPick })} />)
    const chip = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('芯片与算力'))!
    await act(async () => chip.click())
    expect(onPick).toHaveBeenCalledWith('b')
  })

  it('未读点只出现在有未读的主题上', async () => {
    const el = await render(<Sidebar {...baseProps()} />)
    const withUnread = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('模型与产品'))!
    expect(withUnread.querySelector('span[aria-label="2 条未读"]')).not.toBeNull()
    const noUnread = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('芯片与算力'))!
    expect(noUnread.querySelector('span[aria-label]')).toBeNull()
  })

  it('Esc 与点击外部都会关闭弹层', async () => {
    const el = await render(<Sidebar {...baseProps()} />)
    await act(async () => switcher(el).click())
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(switcher(el).getAttribute('aria-expanded')).toBe('false')

    await act(async () => switcher(el).click())
    await act(async () => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    expect(switcher(el).getAttribute('aria-expanded')).toBe('false')
  })

  it('存在「新建领域」与「新建主题」入口', async () => {
    const el = await render(<Sidebar {...baseProps()} />)
    expect(el.textContent).toContain('＋ 新建主题')
    await act(async () => switcher(el).click())
    expect(el.textContent).toContain('＋ 新建领域')
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

  it('「管理领域…」跳到设置页', async () => {
    const onNavigate = vi.fn()
    const el = await render(<Sidebar {...baseProps({ onNavigate })} />)
    await act(async () => switcher(el).click())
    const manage = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('管理领域'))!
    await act(async () => manage.click())
    expect(onNavigate).toHaveBeenCalledWith('settings')
  })
})
