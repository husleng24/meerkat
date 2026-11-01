// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Sidebar } from '../src/renderer/src/components/Sidebar'
import type { TopicPayload } from '../src/renderer/src/lib/ipc-types'

function topic(over: Partial<TopicPayload> = {}): TopicPayload {
  return {
    id: 'a',
    name: 'AI 综合',
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
      topic(),
      topic({ id: 'b', name: '芯片与算力', todayCount: 12, unreadCount: 3 }),
      topic({ id: 'c', name: '具身智能', todayCount: 9 })
    ],
    activeTopic: 'a',
    onPickTopic: vi.fn(),
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

describe('侧栏领域切换器', () => {
  it('常驻显示当前领域与未读点，列表默认收起', async () => {
    const el = await render(
      <Sidebar {...baseProps({ topics: [topic({ unreadCount: 23 }), topic({ id: 'b', name: '芯片与算力' })] })} />
    )
    expect(switcher(el).textContent).toContain('AI 综合')
    expect(switcher(el).getAttribute('aria-expanded')).toBe('false')
    expect(switcher(el).querySelector('span[aria-label="23 条未读"]')).not.toBeNull()
    // 未展开时看不到其他领域
    expect(el.textContent).not.toContain('芯片与算力')
  })

  it('点开列出全部领域、条数与快捷键', async () => {
    const el = await render(<Sidebar {...baseProps()} />)
    await act(async () => switcher(el).click())
    expect(switcher(el).getAttribute('aria-expanded')).toBe('true')
    const options = [...el.querySelectorAll('[role="option"]')]
    expect(options).toHaveLength(3)
    expect(options[1]!.textContent).toContain('芯片与算力')
    expect(options[1]!.textContent).toContain('12')
    expect(options[1]!.textContent).toContain('⌘2')
    expect(options[0]!.getAttribute('aria-selected')).toBe('true')
  })

  it('选中一个领域后切过去并收起', async () => {
    const onPick = vi.fn()
    const el = await render(<Sidebar {...baseProps({ onPickTopic: onPick })} />)
    await act(async () => switcher(el).click())
    const option = el.querySelectorAll('[role="option"]')[1] as HTMLButtonElement
    await act(async () => option.click())
    expect(onPick).toHaveBeenCalledWith('b')
    expect(switcher(el).getAttribute('aria-expanded')).toBe('false')
  })

  it('键盘：↓ 移动，Enter 选中', async () => {
    const onPick = vi.fn()
    const el = await render(<Sidebar {...baseProps({ onPickTopic: onPick })} />)
    await act(async () => switcher(el).click())
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    })
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(onPick).toHaveBeenCalledWith('b')
  })

  it('Esc 与点击外部都会关闭', async () => {
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

  it('只有一个领域时仍然能新建', async () => {
    const el = await render(<Sidebar {...baseProps({ topics: [topic()] })} />)
    await act(async () => switcher(el).click())
    expect(el.textContent).toContain('＋ 新建领域')
  })

  it('就地新建：回车创建、收起并切过去', async () => {
    const created = vi.fn().mockResolvedValue('t-new')
    const onPick = vi.fn()
    const el = await render(<Sidebar {...baseProps({ onCreateTopic: created, onPickTopic: onPick })} />)
    await act(async () => switcher(el).click())
    const add = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('新建领域'))!
    await act(async () => add.click())

    const input = el.querySelector('input')!
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => {
      setter.call(input, '机器人')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })

    expect(created).toHaveBeenCalledWith(expect.objectContaining({ name: '机器人' }))
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
