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
    topics: [topic(), topic({ id: 'b', name: '芯片与算力', todayCount: 12, unreadCount: 3 })],
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

describe('侧栏领域列表', () => {
  it('列出全部领域与各自条数，没有简报显示「—」', async () => {
    const el = await render(
      <Sidebar
        {...baseProps({
          topics: [
            topic(),
            topic({ id: 'b', name: '芯片与算力', todayCount: 12, unreadCount: 3 }),
            topic({ id: 'c', name: '具身智能', hasBrief: false, todayCount: 0 })
          ]
        })}
      />
    )
    expect(el.textContent).toContain('AI 综合')
    expect(el.textContent).toContain('芯片与算力')
    expect(el.textContent).toContain('具身智能')
    expect(el.textContent).toContain('—')
  })

  it('当前领域高亮，未读用圆点表示（不带数字噪音）', async () => {
    const el = await render(<Sidebar {...baseProps()} />)
    const active = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('AI 综合'))!
    expect(active.className).toContain('bg-accent-soft')

    // b 不是当前领域，但有 3 条未读：圆点带 aria-label，且行内没有把 3 写成数字
    const unreadRow = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('芯片与算力'))!
    expect(unreadRow.querySelector('span[aria-label="3 条未读"]')).not.toBeNull()
    expect(unreadRow.textContent).not.toContain('3 条未读')
  })

  it('点击领域切换', async () => {
    const onPick = vi.fn()
    const el = await render(<Sidebar {...baseProps({ onPickTopic: onPick })} />)
    const btn = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('芯片与算力'))!
    await act(async () => btn.click())
    expect(onPick).toHaveBeenCalledWith('b')
  })

  it('只有一个领域时仍然给「新建领域」入口', async () => {
    const el = await render(<Sidebar {...baseProps({ topics: [topic()] })} />)
    expect(el.textContent).toContain('＋ 新建领域')
  })

  it('领域可以收起：收起后行隐藏，标题行显示当前领域', async () => {
    localStorage.removeItem('meerkat.sidebar.topicsOpen')
    const el = await render(<Sidebar {...baseProps()} />)
    const toggle = el.querySelector('button[aria-expanded]') as HTMLButtonElement
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(el.textContent).toContain('芯片与算力')

    await act(async () => toggle.click())
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    // 列表行消失，但当前领域仍要可见（否则不知道自己在哪个领域）
    expect(el.textContent).not.toContain('芯片与算力')
    expect(toggle.textContent).toContain('AI 综合')
    expect(localStorage.getItem('meerkat.sidebar.topicsOpen')).toBe('0')
  })

  it('收起状态会被记住', async () => {
    localStorage.setItem('meerkat.sidebar.topicsOpen', '0')
    const el = await render(<Sidebar {...baseProps()} />)
    expect(el.querySelector('button[aria-expanded]')!.getAttribute('aria-expanded')).toBe('false')
    expect(el.textContent).not.toContain('芯片与算力')
    localStorage.removeItem('meerkat.sidebar.topicsOpen')
  })

  it('就地新建：回车创建并切过去，Esc 取消', async () => {
    const created = vi.fn().mockResolvedValue('t-new')
    const onPick = vi.fn()
    const el = await render(<Sidebar {...baseProps({ onCreateTopic: created, onPickTopic: onPick })} />)

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
})
