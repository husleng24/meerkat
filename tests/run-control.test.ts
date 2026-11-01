import { describe, it, expect, beforeEach } from 'vitest'
import { beginRun, cancelRun, currentSignal, endRun, isRunning, resetRunControl } from '../src/main/run-control'
import { RunCancelledError, isAbortError } from '../src/app/run-cancel'

describe('运行开关', () => {
  beforeEach(() => resetRunControl())

  it('同一时刻只允许一轮', () => {
    const first = beginRun()
    expect(first).not.toBeNull()
    expect(isRunning()).toBe(true)
    // 第二个入口拿不到运行权——这正是"点两下跑两轮"的防线
    expect(beginRun()).toBeNull()
  })

  it('结束后可以再开一轮', () => {
    const first = beginRun()!
    endRun(first)
    expect(isRunning()).toBe(false)
    expect(beginRun()).not.toBeNull()
  })

  it('取消会把信号置为 aborted', () => {
    const handle = beginRun()!
    expect(currentSignal()?.aborted).toBe(false)
    expect(cancelRun()).toBe(true)
    expect(handle.controller.signal.aborted).toBe(true)
    expect(currentSignal()?.aborted).toBe(true)
  })

  it('没有在跑时取消返回 false', () => {
    expect(cancelRun()).toBe(false)
  })

  it('旧一轮的 finally 不会把新一轮的状态清掉', () => {
    const first = beginRun()!
    cancelRun()
    endRun(first)
    const second = beginRun()!
    expect(isRunning()).toBe(true)
    // 模拟旧的 finally 又跑了一次（异步竞态里真会发生）
    endRun(first)
    expect(isRunning()).toBe(true)
    expect(cancelRun()).toBe(true)
    expect(second.controller.signal.aborted).toBe(true)
  })
})

describe('取消错误的识别', () => {
  it('RunCancelledError 被当成取消而不是失败', () => {
    expect(isAbortError(new RunCancelledError())).toBe(true)
    const abort = new Error('The operation was aborted')
    abort.name = 'AbortError'
    expect(isAbortError(abort)).toBe(true)
    expect(isAbortError(new Error('HTTP 500'))).toBe(false)
    expect(isAbortError('oops')).toBe(false)
  })
})
