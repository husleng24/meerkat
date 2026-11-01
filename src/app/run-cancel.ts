/**
 * 采集被取消：不是故障，调用方要能把它和"跑失败了"区分开。
 *
 * 放在 app 层是因为它跨越采集与成稿两个阶段——两处都必须能把
 * AbortError 翻译成"这次是用户取消的"，否则会被当成抓取失败写进源健康度。
 */
export class RunCancelledError extends Error {
  constructor(stage: 'collect' | 'compose' = 'collect') {
    super(stage === 'collect' ? '采集已取消' : '成稿已取消')
    this.name = 'RunCancelledError'
  }
}

export function isAbortError(e: unknown): boolean {
  return e instanceof Error && (e.name === 'AbortError' || e.name === 'RunCancelledError')
}
