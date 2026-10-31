/**
 * 诊断包：出问题时用户点一下，得到一个能贴给开发者的文件。
 *
 * 核心约束是**脱敏**：诊断包会被贴进聊天窗口、issue、邮件里。
 * 任何密钥、路径里的用户名、邮箱都不能出现，否则用户下一次就不敢点了。
 *
 * 这份逻辑做成纯函数，就是为了能用测试穷举泄露场景——
 * 一旦泄露一次，这个功能就永久失去信任。
 */
import type { Source } from '../core/domain/types'

export interface RunSummary {
  startedAt: number
  finishedAt?: number
  nSources: number
  nRaw: number
  nKept: number
  errors?: string
}

export interface DiagnosticInput {
  appVersion: string
  electronVersion: string
  chromeVersion: string
  nodeVersion: string
  platform: string
  arch: string
  dbPath: string
  schemaVersion: number
  homeDir: string
  userDataDir: string
  schedule: { enabled: boolean; hour: number; minute: number }
  lastRunAt?: number
  model: string
  runs: RunSummary[]
  sources: Source[]
  logTail: string[]
  now: number
}

export interface DiagnosticBundle {
  generatedAt: string
  app: Record<string, string>
  db: { path: string; schemaVersion: number; itemCount?: number }
  schedule: Record<string, unknown>
  model: string
  runs: Array<Record<string, unknown>>
  sources: {
    total: number
    ok: number
    degraded: number
    failing: number
    failing_list: Array<{ name: string; kind: string; lastError?: string }>
  }
  logTail: string[]
}

/** 密钥形态：sk-xxx、以及常见的 Bearer / key= 形式 */
const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/sk-[A-Za-z0-9_-]{8,}/g, 'sk-***REDACTED***'],
  [/(Bearer\s+)[A-Za-z0-9._-]{8,}/gi, '$1***REDACTED***'],
  [/((?:api[_-]?key|token|secret|password)\s*[=:]\s*)["']?[A-Za-z0-9._-]{8,}/gi, '$1***REDACTED***'],
  // 保留认证类型（Bearer/Basic/Token），只打掉凭证本体——排查时这个前缀有用
  [/(authorization["']?\s*[:=]\s*)((?:Bearer|Basic|Token)\s+)?["']?[^"',\s}]+/gi, '$1$2***REDACTED***'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '***@***'],
  [/[a-f0-9]{32,}/gi, '***HASH***']
]

/** 脱敏：密钥、邮箱、长十六进制串一律打掉 */
export function redact(text: string): string {
  let out = text
  for (const [re, replacement] of SECRET_PATTERNS) out = out.replace(re, replacement)
  return out
}

/** 路径脱敏：把用户主目录换成 ~，避免暴露真实用户名 */
export function redactPath(p: string, homeDir: string): string {
  if (!homeDir) return redact(p)
  const normalizedHome = homeDir.replace(/\\/g, '/').replace(/\/$/, '')
  const normalized = p.replace(/\\/g, '/')
  if (normalized.toLowerCase().startsWith(normalizedHome.toLowerCase())) {
    return '~' + normalized.slice(normalizedHome.length)
  }
  return redact(p)
}

export function buildDiagnostic(input: DiagnosticInput): DiagnosticBundle {
  const failing = input.sources.filter((s) => s.failStreak >= 3)
  const degraded = input.sources.filter((s) => s.failStreak > 0 && s.failStreak < 3)
  const ok = input.sources.filter((s) => s.failStreak === 0 && s.lastOkAt !== undefined)

  return {
    generatedAt: new Date(input.now).toISOString(),
    app: {
      version: input.appVersion,
      electron: input.electronVersion,
      chrome: input.chromeVersion,
      node: input.nodeVersion,
      platform: `${input.platform} ${input.arch}`
    },
    db: {
      path: redactPath(input.dbPath, input.homeDir),
      schemaVersion: input.schemaVersion
    },
    schedule: {
      enabled: input.schedule.enabled,
      at: `${String(input.schedule.hour).padStart(2, '0')}:${String(input.schedule.minute).padStart(2, '0')}`,
      lastRunAt: input.lastRunAt ? new Date(input.lastRunAt).toISOString() : null
    },
    model: input.model,
    runs: input.runs.map((r) => ({
      startedAt: new Date(r.startedAt).toISOString(),
      durationMs: r.finishedAt ? r.finishedAt - r.startedAt : null,
      nSources: r.nSources,
      nRaw: r.nRaw,
      nKept: r.nKept,
      errors: r.errors ? redact(r.errors).slice(0, 500) : undefined
    })),
    sources: {
      total: input.sources.length,
      ok: ok.length,
      degraded: degraded.length,
      failing: failing.length,
      failing_list: failing.map((s) => ({
        name: s.name,
        kind: s.kind,
        ...(s.lastError ? { lastError: redact(s.lastError).slice(0, 200) } : {})
      }))
    },
    // 日志尾部是泄露重灾区：整段脱敏后再截断
    logTail: input.logTail.slice(-300).map((line) => redact(line))
  }
}

/** 人类可读的摘要，用于诊断包的第一屏 */
export function summarizeDiagnostic(b: DiagnosticBundle): string {
  const s = b.sources
  return [
    `版本 ${b.app.version}（Electron ${b.app.electron} / Node ${b.app.node}）`,
    `数据库 schema v${b.db.schemaVersion}`,
    `源 ${s.total} 个：正常 ${s.ok}，不稳定 ${s.degraded}，失效 ${s.failing}`,
    s.failing_list.length > 0 ? `失效源：${s.failing_list.map((f) => f.name).join('、')}` : '没有失效源'
  ].join('\n')
}
