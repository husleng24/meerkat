/**
 * 简报生成端口。
 *
 * 信息隐藏的关键：`ComposeInput` 里**不含 prompt**——prompt 由适配器从磁盘读取。
 * 核心只知道"要一份 markdown"，不知道模型、温度、协议（见 ARCHITECTURE.md 接缝②）。
 *
 * 这条设计让"编辑方针可改"成为可能：prompt 是内容文件，改了不需要重新编译。
 */
import type { Bucket } from '../domain/types'

export interface ComposeItem {
  title: string
  url: string
  sourceName: string
  bucket: Bucket
  publishedAt?: number
  summary: string
  score: number
  alsoIn: string[]
}

export interface ComposeInput {
  /** 例如 "2026-10-30" */
  dateLabel: string
  /** 例如 "周四" */
  weekday: string
  windowHours: number
  items: ComposeItem[]
  /** 传给适配器做模板替换，例如板块名映射 */
  bucketLabels: Record<Bucket, string>
}

export interface TokenUsage {
  input: number
  output: number
}

export type ComposeFailureReason =
  | 'no-key'
  | 'rate-limit'
  | 'context-overflow'
  | 'provider-error'
  | 'empty-output'
  | 'aborted'

export type ComposeResult =
  | { ok: true; markdown: string; usage: TokenUsage; model: string; finishReason?: string }
  | { ok: false; reason: ComposeFailureReason; detail: string }

export interface Composer {
  readonly model: string
  compose(input: ComposeInput, signal?: AbortSignal): Promise<ComposeResult>
}
