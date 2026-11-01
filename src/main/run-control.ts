/**
 * 运行开关：同一时刻只允许一轮采集/成稿，且这一轮可以被取消。
 *
 * 为什么单独一层：入口有三个（设置页、托盘、IPC），定时器自己也会触发。
 * 各自维护 `running` 布尔值的结果是"点两下跑了两轮"或者"界面在跑、托盘说没跑"。
 * 这里做成一个模块级状态，所有入口共用。
 */

let active: AbortController | null = null

export interface RunHandle {
  controller: AbortController
}

/** 拿到一轮运行权；已有运行在进行时返回 null（调用方应当据此拒绝新请求） */
export function beginRun(): RunHandle | null {
  if (active) return null
  active = new AbortController()
  return { controller: active }
}

export function endRun(handle: RunHandle): void {
  // 只清理自己那一轮：取消后立刻开始的新一轮不该被旧的 finally 清掉
  if (active === handle.controller) active = null
}

/** 取消当前运行；没有在跑就返回 false */
export function cancelRun(): boolean {
  if (!active) return false
  active.abort()
  return true
}

export function isRunning(): boolean {
  return active !== null
}

export function currentSignal(): AbortSignal | undefined {
  return active?.signal
}

/** 测试用：把状态清干净 */
export function resetRunControl(): void {
  active = null
}
