/**
 * 反馈：组装材料、写文件、放剪贴板。
 *
 * 只做"生成材料"这件事，不做"提交"——因为没有服务器。
 * 一个点了没反应的提交按钮比没有按钮更糟。
 */
import { app, clipboard, shell } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { buildDiagnostic } from '../app/diagnostic'
import { buildFeedback, compactDiagnostics, issueUrl, FEEDBACK_REPO, type FeedbackCategory } from '../app/feedback'
import { readSchedule } from './scheduler'
import { readLogTail, log } from './log'
import type { Store } from '../core/ports/store'

export interface ComposeInput {
  category: FeedbackCategory
  message: string
  includeDiagnostics: boolean
}

export interface ComposeOutput {
  ok: boolean
  title?: string
  body?: string
  issueUrl?: string
  error?: string
}

function diagnosticsFor(store: Store): string {
  const now = Date.now()
  const bundle = buildDiagnostic({
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron ?? 'unknown',
    chromeVersion: process.versions.chrome ?? 'unknown',
    nodeVersion: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    dbPath: join(app.getPath('userData'), 'meerkat.db'),
    schemaVersion: store.schemaVersion(),
    homeDir: homedir(),
    userDataDir: app.getPath('userData'),
    schedule: readSchedule(store, store.topics.list()[0]?.id ?? ''),
    lastRunAt: store.settings.get<number>('schedule.lastRunAt') ?? undefined,
    model: 'deepseek-flash',
    runs: store.runs.recent(3).map((r) => ({
      startedAt: r.startedAt,
      ...(r.finishedAt !== undefined ? { finishedAt: r.finishedAt } : {}),
      nSources: r.nSources,
      nRaw: r.nRaw,
      nKept: r.nKept,
      ...(r.errorsJson !== undefined ? { errors: r.errorsJson } : {})
    })),
    sources: store.sources.list(),
    logTail: readLogTail(60),
    now
  })
  return compactDiagnostics(bundle, 30)
}

export function composeFeedback(store: Store, input: ComposeInput): ComposeOutput {
  const result = buildFeedback({
    category: input.category,
    message: input.message,
    appVersion: app.getVersion(),
    platform: `${process.platform} ${process.arch}`,
    ...(input.includeDiagnostics ? { diagnostics: diagnosticsFor(store) } : {}),
    now: Date.now()
  })
  if (!result.ok) return { ok: false, error: result.error }
  const url = issueUrl(FEEDBACK_REPO, result.text)
  return {
    ok: true,
    title: result.text.title,
    body: result.text.body,
    ...(url ? { issueUrl: url } : {})
  }
}

export function saveFeedback(title: string, body: string): { ok: boolean; path?: string; error?: string } {
  try {
    const dir = join(app.getPath('documents'), 'Meerkat')
    mkdirSync(dir, { recursive: true })
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    const file = join(dir, `反馈-${stamp}.md`)
    writeFileSync(file, `# ${title}\n\n${body}\n`, 'utf8')
    shell.showItemInFolder(file)
    log('info', `反馈材料已保存：${file}`)
    return { ok: true, path: file }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export function copyFeedback(text: string): { ok: boolean; error?: string } {
  try {
    clipboard.writeText(text)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** 供界面显示：路径里的用户名不进界面文案 */
export function documentsFeedbackDir(): string {
  return join(dirname(join(app.getPath('documents'), 'Meerkat', 'x')), '')
}
