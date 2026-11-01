/**
 * 运行开关：同一时刻只允许一轮采集/成稿，且这一轮可以被取消。
 *
 * 为什么单独一层：入口有三个（设置页、托盘、IPC），定时器自己也会触发。
 * 各自维护 `running` 布尔值的结果是"点两下跑了两轮"或者"界面在跑、托盘说没跑"。
 * 这里做成一个模块级状态，所有入口共用。
 */

export interface RunHandle {
  controller: AbortController
}

export interface Latch {
  begin(): RunHandle | null
  end(handle: RunHandle): void
  cancel(): boolean
  isRunning(): boolean
  signal(): AbortSignal | undefined
  reset(): void
}

/**
 * 一把"同一时刻只允许一件事"的闩。
 *
 * 采集与对话各有一把：聊天不该把正在跑的采集取消掉，反之亦然。
 * 但两把闩的语义完全相同，所以只写一份实现。
 */
export function createLatch(): Latch {
  let active: AbortController | null = null
  return {
    begin() {
      if (active) return null
      active = new AbortController()
      return { controller: active }
    },
    end(handle) {
      // 只清理自己那一轮：取消后立刻开始的新一轮不该被旧的 finally 清掉
      if (active === handle.controller) active = null
    },
    cancel() {
      if (!active) return false
      active.abort()
      return true
    },
    isRunning: () => active !== null,
    signal: () => active?.signal,
    reset() {
      active = null
    }
  }
}

/** 采集用的闩（保持原有的函数式 API，测试与调用方都在用） */
const collectLatch = createLatch()

export function beginRun(): RunHandle | null {
  return collectLatch.begin()
}

export function endRun(handle: RunHandle): void {
  collectLatch.end(handle)
}

export function cancelRun(): boolean {
  return collectLatch.cancel()
}

export function isRunning(): boolean {
  return collectLatch.isRunning()
}

export function currentSignal(): AbortSignal | undefined {
  return collectLatch.signal()
}

/** 测试用：把状态清干净 */
export function resetRunControl(): void {
  collectLatch.reset()
}

/** 对话用的闩：与采集互不影响 */
export const chatLatch = createLatch()
