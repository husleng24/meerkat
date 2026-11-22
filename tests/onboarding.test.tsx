// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Onboarding } from '../src/renderer/src/components/Onboarding'
import type { RunNowPayload, RunProgressPayload, TopicPayload } from '../src/renderer/src/lib/ipc-types'

function topic(over: Partial<TopicPayload> = {}): TopicPayload {
  return {
    id: 'ai',
    name: 'AI 综合',
    domainId: 'ai',
    enabled: true,
    hour: 8,
    minute: 30,
    sourceCount: 35,
    hasBrief: false,
    todayCount: 0,
    unreadCount: 0,
    ...over
  }
}

const okPayload: RunNowPayload = {
  ok: true,
  nKept: 24,
  nOk: 34,
  nSources: 35,
  degraded: false,
  noChange: false,
  linkGood: 23,
  linkTotal: 24
}

function baseProps(
  over: Partial<React.ComponentProps<typeof Onboarding>> = {}
): React.ComponentProps<typeof Onboarding> {
  return {
    mode: 'first-run',
    topics: [topic()],
    topicsAvailable: true,
    activeDomain: 'ai',
    createTopic: vi.fn().mockResolvedValue('chip'),
    onPickTopic: vi.fn(),
    startRun: vi.fn().mockResolvedValue(okPayload),
    complete: vi.fn().mockResolvedValue(true),
    onDone: vi.fn(),
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

function buttonByText(el: HTMLElement, text: string): HTMLButtonElement {
  const hit = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes(text))
  if (!hit) throw new Error(`找不到按钮：${text}`)
  return hit as HTMLButtonElement
}

async function click(el: HTMLElement, text: string): Promise<void> {
  await act(async () => {
    buttonByText(el, text).click()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

afterEach(async () => {
  await act(async () => root?.unmount())
  host?.remove()
  root = null
  host = null
  delete (window as unknown as { meerkat?: unknown }).meerkat
  vi.restoreAllMocks()
})

describe('首启引导：选方向', () => {
  it('AI 综合默认选中，已有主题显示真实源数', async () => {
    const el = await render(<Onboarding {...baseProps()} />)
    const ai = buttonByText(el, 'AI 综合')
    expect(ai.getAttribute('aria-pressed')).toBe('true')
    expect(el.textContent).toContain('35 个源')
    expect(el.textContent).toContain('推荐约 8 个源')
    expect(el.textContent).toContain('生成第一份简报')
  })

  it('取消全部方向后主按钮禁用', async () => {
    const el = await render(<Onboarding {...baseProps()} />)
    await click(el, 'AI 综合')
    expect(buttonByText(el, '生成第一份简报').disabled).toBe(true)
  })

  it('选芯片时只创建缺失主题，并把首跑切过去', async () => {
    const props = baseProps()
    const el = await render(<Onboarding {...props} />)

    // 先取消默认的 AI，只留芯片
    await click(el, 'AI 综合')
    await click(el, '芯片与算力')
    await click(el, '生成第一份简报')

    expect(props.createTopic).toHaveBeenCalledTimes(1)
    expect(props.createTopic).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'chip',
        name: '芯片与算力',
        domainId: 'ai',
        editorialFocus: expect.stringContaining('半导体')
      })
    )
    expect(props.onPickTopic).toHaveBeenCalledWith('chip')
    expect(props.startRun).toHaveBeenCalledWith('chip')
    expect(el.textContent).toContain('第一份简报好了')
  })

  it('已有 AI 主题时不会重复创建', async () => {
    const props = baseProps()
    const el = await render(<Onboarding {...props} />)
    await click(el, '生成第一份简报')

    expect(props.createTopic).not.toHaveBeenCalled()
    expect(props.startRun).toHaveBeenCalledWith('ai')
  })
})

describe('首启引导：运行 / 完成 / 失败', () => {
  it('完成后显示源数、条数和链接校验', async () => {
    const props = baseProps()
    const el = await render(<Onboarding {...props} />)
    await click(el, '生成第一份简报')

    expect(el.textContent).toContain('第一份简报好了')
    expect(el.textContent).toContain('34/35')
    expect(el.textContent).toContain('24')
    expect(el.textContent).toContain('23/24')
  })

  it('运行态显示逐源进度，而不是只转圈', async () => {
    let resolveRun!: (value: RunNowPayload) => void
    const startRun = vi.fn(
      () => new Promise<RunNowPayload>((resolve) => {
        resolveRun = resolve
      })
    )
    let progressCb: ((p: RunProgressPayload) => void) | null = null
    ;(window as unknown as { meerkat: unknown }).meerkat = {
      onRunProgress: (cb: (p: RunProgressPayload) => void) => {
        progressCb = cb
        return () => {
          progressCb = null
        }
      },
      cancelRun: vi.fn().mockResolvedValue({ ok: true, cancelled: true })
    }

    const props = baseProps({ startRun })
    const el = await render(<Onboarding {...props} />)
    await click(el, '生成第一份简报')
    expect(el.textContent).toContain('正在生成第一份简报')

    await act(async () => {
      progressCb?.({ topicId: 'ai', done: 12, total: 35, name: 'OpenAI', ok: true, n: 3 })
    })
    expect(el.textContent).toContain('12/35')
    expect(el.textContent).toContain('OpenAI')

    await act(async () => {
      resolveRun(okPayload)
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  })

  it('降级时明确标出仅聚合', async () => {
    const props = baseProps({
      startRun: vi.fn().mockResolvedValue({ ...okPayload, degraded: true })
    })
    const el = await render(<Onboarding {...props} />)
    await click(el, '生成第一份简报')
    expect(el.textContent).toContain('仅聚合')
    expect(el.textContent).toContain('这次没接模型')
  })

  it('失败时给可读原因和重试入口', async () => {
    const props = baseProps({
      startRun: vi.fn().mockResolvedValue({ ok: false, error: '网络连接失败' })
    })
    const el = await render(<Onboarding {...props} />)
    await click(el, '生成第一份简报')
    expect(el.textContent).toContain('这次没跑完')
    expect(el.textContent).toContain('网络连接失败')
    expect(el.textContent).toContain('重试')
    expect(el.textContent).toContain('跳过，先进入')
  })

  it('取消后回到选方向，并调用 cancelRun', async () => {
    let resolveRun!: (value: RunNowPayload) => void
    const startRun = vi.fn(
      () => new Promise<RunNowPayload>((resolve) => {
        resolveRun = resolve
      })
    )
    const cancelRun = vi.fn().mockResolvedValue({ ok: true, cancelled: true })
    ;(window as unknown as { meerkat: unknown }).meerkat = { cancelRun }

    const props = baseProps({ startRun })
    const el = await render(<Onboarding {...props} />)
    await click(el, '生成第一份简报')
    expect(el.textContent).toContain('正在生成第一份简报')

    await click(el, '取消')
    expect(cancelRun).toHaveBeenCalled()

    await act(async () => {
      resolveRun({ ok: false, error: '已取消' })
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(el.textContent).toContain('先盯哪些方向？')
  })

  it('跳过只写完成标记，不跑采集', async () => {
    const props = baseProps()
    const el = await render(<Onboarding {...props} />)
    await click(el, '跳过，先进入')

    expect(props.complete).toHaveBeenCalledWith({ skipped: true })
    expect(props.startRun).not.toHaveBeenCalled()
    expect(props.onDone).toHaveBeenCalled()
  })
})

describe('首启引导：回看模式', () => {
  it('回看不写状态、不建主题、不跑采集', async () => {
    const props = baseProps({ mode: 'replay' })
    const el = await render(<Onboarding {...props} />)
    expect(el.textContent).toContain('这是引导预览')
    expect(el.textContent).toContain('关闭预览')

    await click(el, '关闭预览')
    expect(props.onDone).toHaveBeenCalled()
    expect(props.createTopic).not.toHaveBeenCalled()
    expect(props.startRun).not.toHaveBeenCalled()
    expect(props.complete).not.toHaveBeenCalled()
  })

  it('浏览器预览里源数显示示例，不冒充真实数据', async () => {
    const props = baseProps({ topicsAvailable: false })
    const el = await render(<Onboarding {...props} />)
    expect(el.textContent).toContain('示例')
    expect(el.textContent).not.toContain('35 个源')
  })
})
