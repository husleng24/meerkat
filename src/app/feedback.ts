/**
 * 反馈材料的生成。
 *
 * 设计前提：**不假设有服务器**。没有后端就不该做一个"提交"按钮，
 * 否则按钮点下去只是往虚空里发。
 *
 * 所以做的是"一键生成一份可以直接贴出去的材料"：
 * 用户写好问题描述，程序把环境信息与已脱敏的诊断摘要拼在后面，
 * 用户复制到聊天窗口 / issue / 邮件里都可以。
 *
 * 配合 `diagnostic.ts` 的脱敏，这份材料可以直接给外人看。
 */

export type FeedbackCategory = 'bug' | 'idea' | 'source' | 'other'

import type { DiagnosticBundle } from './diagnostic'

export const CATEGORY_LABEL: Record<FeedbackCategory, string> = {
  bug: '缺陷',
  idea: '功能建议',
  source: '信息源问题',
  other: '其他'
}

export const CATEGORY_TAG: Record<FeedbackCategory, string> = {
  bug: '[Bug]',
  idea: '[Idea]',
  source: '[Source]',
  other: '[Other]'
}

/** 反馈仓库：留空则不显示「在 GitHub 新建 issue」按钮 */
export const FEEDBACK_REPO = ''

export const MAX_MESSAGE = 4000

export interface FeedbackInput {
  category: FeedbackCategory
  message: string
  appVersion: string
  platform: string
  /** 已脱敏的诊断摘要；不附带时传 undefined */
  diagnostics?: string
  now: number
}

export interface FeedbackText {
  title: string
  body: string
  /** 标题截断到 60 字以内，便于当 issue 标题 */
  shortTitle: string
}

export type BuildResult =
  | { ok: true; text: FeedbackText }
  | { ok: false; error: string }

function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

export function buildFeedback(input: FeedbackInput): BuildResult {
  const message = input.message.trim()
  if (message.length === 0) return { ok: false, error: '请先写一句问题描述' }
  if (message.length > MAX_MESSAGE) return { ok: false, error: `描述过长（最多 ${MAX_MESSAGE} 字）` }

  const tag = CATEGORY_TAG[input.category] ?? '[Other]'
  const short = oneLine(message).slice(0, 60)
  const title = `${tag} ${short}`

  const lines: string[] = []
  lines.push(`## ${CATEGORY_LABEL[input.category] ?? '反馈'}`)
  lines.push('')
  lines.push(message)
  lines.push('')
  lines.push('---')
  lines.push('')
  lines.push('### 环境')
  lines.push('')
  lines.push(`- 版本：${input.appVersion}`)
  lines.push(`- 平台：${input.platform}`)
  lines.push(`- 时间：${new Date(input.now).toISOString()}`)
  lines.push('')

  if (input.diagnostics) {
    lines.push('### 诊断信息（已脱敏：密钥/邮箱/用户名已打码）')
    lines.push('')
    lines.push('```')
    lines.push(input.diagnostics.trim())
    lines.push('```')
    lines.push('')
  } else {
    lines.push('_未附带诊断信息。_')
    lines.push('')
  }

  return { ok: true, text: { title, body: lines.join('\n'), shortTitle: short } }
}

/** 把标题与正文拼成 GitHub issue 的预填链接；仓库未配置时返回 undefined */
export function issueUrl(repo: string, text: FeedbackText): string | undefined {
  if (!repo) return undefined
  const q = new URLSearchParams({ title: text.title, body: text.body })
  return `https://github.com/${repo}/issues/new?${q.toString()}`
}

/**
 * 把诊断包压成一段可粘贴的文本。
 *
 * 为什么不用整份 JSON：反馈材料要给人读，不是给机器解析。
 * 摘要 + 失效源 + 最近一次运行 + 日志尾部对定位问题够用，而且短到能贴在聊天窗口里。
 */
export function compactDiagnostics(d: DiagnosticBundle, logTailLines = 30): string {
  const lines: string[] = []
  lines.push(`版本 ${d.app.version}（Electron ${d.app.electron} / Node ${d.app.node}）`)
  lines.push(`平台 ${d.app.platform} · 数据库 schema v${d.db.schemaVersion}`)
  lines.push(`排程 ${String(d.schedule['at'] ?? '—')} · 上次运行 ${String(d.schedule['lastRunAt'] ?? '从未')}`)
  lines.push(`模型 ${d.model}`)
  const s = d.sources
  lines.push(`源 ${s.total} 个：正常 ${s.ok}，不稳定 ${s.degraded}，失效 ${s.failing}`)
  if (s.failing_list.length > 0) {
    lines.push('失效源：')
    for (const f of s.failing_list.slice(0, 8)) {
      lines.push(`  - ${f.name}（${f.kind}）${f.lastError ?? ''}`)
    }
  }
  const lastRun = d.runs[0]
  if (lastRun) {
    lines.push(
      `最近一次运行：${String(lastRun['startedAt'])} · ${String(lastRun['durationMs'] ?? '—')}ms · ` +
        `源 ${String(lastRun['nSources'])} · 原始 ${String(lastRun['nRaw'])} · 入库 ${String(lastRun['nKept'])}`
    )
    if (lastRun['errors']) lines.push(`  错误：${String(lastRun['errors']).slice(0, 300)}`)
  }
  const tail = d.logTail.slice(-logTailLines)
  if (tail.length > 0) {
    lines.push('日志尾部：')
    lines.push(...tail)
  }
  return lines.join('\n')
}
