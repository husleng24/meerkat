// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { VideoPage } from '../src/renderer/src/components/VideoPage'
import type { VideoReportPayload } from '../src/renderer/src/lib/ipc-types'

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

function report(): VideoReportPayload {
  return {
    id: 'r1',
    creatorId: 'c1',
    videoId: 'v1',
    title: '视频一',
    url: 'https://youtube.com/watch?v=v1',
    transcriptMd: '完整字幕',
    summaryMd: '## 总结\n\n这是生成后的解读。',
    model: 'test',
    createdAt: 1,
    updatedAt: 1
  }
}

afterEach(async () => {
  await act(async () => root?.unmount())
  host?.remove()
  root = null
  host = null
  vi.restoreAllMocks()
})

describe('视频解读的生成状态', () => {
  it('点击后先显示生成中，完成后才换成报告', async () => {
    let finish!: (value: { ok: boolean; report: VideoReportPayload }) => void
    const generate = vi.fn(
      () =>
        new Promise<{ ok: boolean; report: VideoReportPayload }>((resolve) => {
          finish = resolve
        })
    )
    ;(window as unknown as { meerkat: unknown }).meerkat = {
      videos: {
        creators: async () => [
          { id: 'c1', channelId: 'ch1', name: '测试博主', createdAt: 1, updatedAt: 1 }
        ],
        addCreator: vi.fn(),
        removeCreator: vi.fn(),
        list: async () => ({
          ok: true,
          videos: [
            { videoId: 'v1', title: '视频一', url: 'https://youtube.com/watch?v=v1', hasReport: false }
          ]
        }),
        getReport: async () => null,
        generate,
        export: vi.fn(),
        removeReport: vi.fn()
      }
    }

    const el = await render(<VideoPage />)
    await act(async () => new Promise((r) => setTimeout(r, 0)))
    const item = [...el.querySelectorAll('button')].find((b) => b.textContent?.includes('视频一'))!
    await act(async () => item.click())

    expect(el.textContent).toContain('正在生成这期视频的解读')
    expect(el.textContent).toContain('生成中…')
    expect(el.textContent).not.toContain('这是生成后的解读')

    await act(async () => finish({ ok: true, report: report() }))
    await act(async () => new Promise((r) => setTimeout(r, 0)))
    expect(el.textContent).toContain('这是生成后的解读')
    expect(el.textContent).not.toContain('正在生成这期视频的解读')
  })
})
