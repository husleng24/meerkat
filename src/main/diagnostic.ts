/**
 * 导出诊断包：把 buildDiagnostic 的纯函数结果落成一个 JSON 文件。
 * 文件路径与内容都经过脱敏（见 src/app/diagnostic.ts 的测试）。
 */
import { app } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { buildDiagnostic, summarizeDiagnostic } from '../app/diagnostic'
import { readSchedule } from './scheduler'
import { readLogTail } from './log'
import type { Store } from '../core/ports/store'

export interface DiagnosticExport {
  ok: boolean
  path?: string
  summary?: string
  error?: string
}

export function exportDiagnostic(store: Store): DiagnosticExport {
  try {
    const now = Date.now()
    const cfg = readSchedule(store, store.topics.list()[0]?.id ?? '')
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
      schedule: cfg,
      lastRunAt: store.settings.get<number>('schedule.lastRunAt') ?? undefined,
      model: 'deepseek-flash',
      runs: store.runs.recent(5).map((r) => ({
        startedAt: r.startedAt,
        ...(r.finishedAt !== undefined ? { finishedAt: r.finishedAt } : {}),
        nSources: r.nSources,
        nRaw: r.nRaw,
        nKept: r.nKept,
        ...(r.errorsJson !== undefined ? { errors: r.errorsJson } : {})
      })),
      sources: store.sources.list(),
      logTail: readLogTail(300),
      now
    })

    const dir = join(app.getPath('documents'), 'Meerkat')
    mkdirSync(dir, { recursive: true })
    const stamp = new Date(now).toISOString().slice(0, 19).replace(/[:T]/g, '-')
    const file = join(dir, `Meerkat-诊断-${stamp}.json`)
    writeFileSync(file, JSON.stringify(bundle, null, 2), 'utf8')
    return { ok: true, path: file, summary: summarizeDiagnostic(bundle) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
