/**
 * 抓取端口：接口由 core 拥有，适配器实现（ADR-1）。
 *
 * 关键约定：**失败不抛异常，返回 ok:false**（ADR-3）。
 * 35 个源每次都有 0–2 个失败，这是常态不是异常，用 Result 表达才不会被 try/catch 淹没。
 */
import type { RawItem, Source } from '../domain/types'

export interface FetchContext {
  /** 当前时间（毫秒），用于相对时间换算 */
  now: number
  windowHours: number
  signal?: AbortSignal
}

export type FetchResult =
  | { ok: true; items: RawItem[]; ms: number }
  | { ok: false; error: string; ms: number }

export interface Fetcher {
  /** 该抓取器处理的 kind */
  readonly kinds: readonly string[]
  fetch(source: Source, ctx: FetchContext): Promise<FetchResult>
}
