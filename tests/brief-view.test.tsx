// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, useMemo, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { parseBrief, type ParsedBrief } from '../src/renderer/src/lib/parseBrief'
import { BriefView } from '../src/renderer/src/components/BriefView'
import type { FlagsApi, ItemFlagState } from '../src/renderer/src/lib/useFlags'

/**
 * 阅读界面的键盘模型。
 *
 * 这部分以前只有截图验证——截图能证明"画出来了"，证明不了
 * "按 j 到底有没有越界"。键盘模型是纯状态机，用 DOM 断言成本很低。
 */

const MD = `# AI 简报 · 2026-10-30（周五）

> 覆盖最近 48 小时 · 34 个信息源 · 精选 3 条

## 三句话速览

1. 第一条速览

## ① 模型与产品发布

- **甲事件（10-29）** 甲的正文。[A](https://example.com/a)

- **乙事件（10-29）** 乙的正文。[B](https://example.com/b)

## ② Agent 与开发工具

- **丙事件（10-28）** 丙的正文。[C](https://example.com/c)
`

const brief: ParsedBrief = parseBrief(MD)

const BLANK: ItemFlagState = { isRead: false, isSaved: false, isHidden: false }

/** 记录 toggle/markRead 的调用，断言"按 j 之后操作的是哪一条" */
let calls: Array<[string, string]> = []

function Harness(): React.JSX.Element {
  const [state, setState] = useState<Record<string, ItemFlagState>>({})

  const api = useMemo<FlagsApi>(() => {
    const write = (id: string | undefined, field: keyof ItemFlagState, value: boolean): void => {
      if (!id) return
      calls.push([id, field])
      setState((prev) => ({ ...prev, [id]: { ...(prev[id] ?? BLANK), [field]: value } }))
    }
    return {
      idOf: (key) => `id-${key}`,
      of: (id) => (id ? (state[id] ?? BLANK) : BLANK),
      toggle: (id, field) => write(id, field, !(id ? (state[id] ?? BLANK)[field] : false)),
      markRead: (id) => write(id, 'isRead', true),
      counts: { read: 0, saved: 0, hidden: 0 }
    }
  }, [state])

  return <BriefView brief={brief} flags={api} comparison={null} previousDate="" />
}

let container: HTMLDivElement
let root: Root

async function key(k: string): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }))
  })
}

beforeEach(async () => {
  calls = []
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  // jsdom 没有实现滚动与开窗，界面会调用它们（不能让测试因为环境缺能力而失败）
  Element.prototype.scrollIntoView = (): void => {}
  window.open = vi.fn() as unknown as typeof window.open
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  await act(async () => {
    root.render(<Harness />)
  })
})

afterEach(async () => {
  await act(async () => {
    root.unmount()
  })
  container.remove()
})

describe('BriefView 键盘模型', () => {
  it('渲染出全部条目', () => {
    expect(container.querySelectorAll('article')).toHaveLength(3)
  })

  it('s 收藏当前条目', async () => {
    await key('s')
    expect(calls).toEqual([['id-s0-i0', 'isSaved']])
  })

  it('j 移到下一条，s 操作的是下一条', async () => {
    await key('j')
    await key('s')
    expect(calls).toEqual([['id-s0-i1', 'isSaved']])
  })

  it('k 在第一条上不越界', async () => {
    await key('k')
    await key('s')
    expect(calls[0]![0]).toBe('id-s0-i0')
  })

  it('j 到最后一条后不再移动', async () => {
    // key 是「板块序号-板块内序号」：第三条是第二板块的第一条 → s1-i0
    for (let i = 0; i < 5; i += 1) await key('j')
    await key('s')
    expect(calls).toEqual([['id-s1-i0', 'isSaved']])
  })

  it('G 跳到末条、g 回到首条', async () => {
    await key('G')
    await key('s')
    await key('g')
    await key('s')
    expect(calls).toEqual([
      ['id-s1-i0', 'isSaved'],
      ['id-s0-i0', 'isSaved']
    ])
  })

  it('h 隐藏当前条目，再按一次恢复', async () => {
    expect(container.querySelector('#item-s0-i0')).not.toBeNull()
    await key('h')
    expect(container.querySelector('#item-s0-i0')).toBeNull()
    await key('h')
    expect(container.querySelector('#item-s0-i0')).not.toBeNull()
  })

  it('o 打开原文并标记已读', async () => {
    await key('o')
    expect(window.open).toHaveBeenCalledWith('https://example.com/a', '_blank', 'noopener,noreferrer')
    expect(calls).toEqual([['id-s0-i0', 'isRead']])
  })

  it('输入框聚焦时快捷键不生效（中文输入法要能正常打字）', async () => {
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true }))
    })
    expect(calls).toEqual([])
    input.remove()
  })
})
