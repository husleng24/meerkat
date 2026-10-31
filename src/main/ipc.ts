/**
 * 主进程 IPC：renderer 只能通过这里访问数据与网络。
 *
 * 约定：
 *  - 入参一律在边界校验（renderer 可以被 XSS 影响，不能信任）
 *  - 长任务（全量自检）走事件推送进度，不用轮询
 *  - 所有 handler 都返回 Result 形状，尽量不把异常抛给渲染层
 */
import { app, ipcMain } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { z } from 'zod'
import { createStore } from '../adapters/store-sqlite/store'
import { fetchSource } from '../adapters/sources'
import { summarizeProbe, type ProbeResult } from '../app/source-health'
import { isValidSchedule } from '../app/schedule'
import { validateNewSource, validateSourceUpdate } from '../app/source-edit'
import { seedSources as seedSourcesFrom } from '../app/seed-sources'
import { getApiKey } from './keystore'
import { setEnabled as setAutoLaunch, state as autoLaunchState } from './autolaunch'
import { exportBrief, readSchedule, writeSchedule } from './scheduler'
import { runDaily } from './daily'
import { resourcePath } from './paths'
import { exportDiagnostic } from './diagnostic'
import { composeFeedback, copyFeedback, saveFeedback } from './feedback'
import { clearApiKey, importFromDsh, keyStatus, setApiKey } from './keystore'
import type { Store } from '../core/ports/store'
import type { Source } from '../core/domain/types'

let store: Store | null = null

function requireStore(): Store {
  if (!store) throw new Error('store 尚未初始化')
  return store
}

/**
 * 首次运行：把 sources.json 灌进库。
 * 规则本身在 app/seed-sources.ts（纯函数，自检与脚本共用），这里只负责读文件。
 */
export function seedSources(s: Store): number {
  const file = resourcePath('sources.json')
  if (!existsSync(file)) return 0
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Source[]
    return seedSourcesFrom(s, parsed)
  } catch {
    return 0
  }
}

const toggleSchema = z.object({ id: z.string().min(1), enabled: z.boolean() })
const testOneSchema = z.string().min(1)
const scheduleSchema = z.object({
  enabled: z.boolean(),
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59)
})
const newSourceSchema = z.object({
  name: z.string().min(1).max(80),
  url: z.string().max(500).optional(),
  kind: z.string().min(2).max(30),
  tier: z.number().int(),
  bucketHint: z.string().min(2).max(30)
})
const updateSourceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(80),
  url: z.string().max(500).optional(),
  tier: z.number().int(),
  bucketHint: z.string().min(2).max(30)
})
const feedbackSchema = z.object({
  category: z.enum(['bug', 'idea', 'source', 'other']),
  message: z.string().min(1).max(4000),
  includeDiagnostics: z.boolean()
})
const feedbackTextSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(20_000)
})
const flagsSetSchema = z.object({
  itemId: z.string().min(1),
  patch: z
    .object({
      isRead: z.boolean().optional(),
      isSaved: z.boolean().optional(),
      isHidden: z.boolean().optional()
    })
    .refine((p) => p.isRead !== undefined || p.isSaved !== undefined || p.isHidden !== undefined, {
      message: '至少给一个字段'
    })
})

/** 手动采集与定时任务共用同一份依赖构造 */
export function dailyDeps(): { apiKey: string; promptText: string } {
  let promptText = ''
  try {
    promptText = readFileSync(resourcePath('prompts/compose.zh.md'), 'utf8')
  } catch {
    promptText = '你是一份 AI 行业日报的主编。链接必须逐字复制素材里的 URL。'
  }
  return { apiKey: getApiKey().key, promptText }
}

export function initStore(dbPath: string): Store {
  store = createStore(dbPath)
  seedSources(store)
  return store
}

export function closeStore(): void {
  store?.close()
  store = null
}

export function registerIpc(): void {
  ipcMain.handle('app:ping', () => ({ ok: true, version: app.getVersion(), ts: Date.now() }))

  /** 简报正文只有 URL，界面要靠它反查条目 id 才能持久化已读/收藏 */
  const buildBriefPayload = (b: ReturnType<Store['briefs']['latest']>): unknown => {
    if (!b) return null
    const s = requireStore()
    const urlToId: Record<string, string> = {}
    for (const it of s.items.since(b.createdAt - 7 * 86_400_000, 1000)) urlToId[it.url] = it.id
    return { date: b.date, markdown: b.markdown, model: b.model, linkCheck: b.linkCheck, urlToId }
  }

  ipcMain.handle('brief:latest', () => buildBriefPayload(requireStore().briefs.latest()))

  ipcMain.handle('brief:get', (_e, raw: unknown) => {
    const d = z.string().max(20).safeParse(raw)
    if (!d.success) return null
    return buildBriefPayload(requireStore().briefs.byDate(d.data))
  })

  ipcMain.handle('brief:list', () =>
    requireStore()
      .briefs.list(60)
      .map((b) => ({
        date: b.date,
        model: b.model,
        linkCheck: b.linkCheck ?? '',
        chars: b.markdown.length,
        createdAt: b.createdAt
      }))
  )

  ipcMain.handle('flags:get', (_e, raw: unknown) => {
    const ids = z.array(z.string().min(1)).max(500).safeParse(raw)
    if (!ids.success) return {}
    const s = requireStore()
    const out: Record<string, { isRead: boolean; isSaved: boolean; isHidden: boolean }> = {}
    for (const id of ids.data) {
      const f = s.flags.get(id)
      if (f) out[id] = { isRead: f.isRead, isSaved: f.isSaved, isHidden: f.isHidden }
    }
    return out
  })

  ipcMain.handle('flags:set', (_e, raw: unknown) => {
    const parsed = flagsSetSchema.safeParse(raw)
    if (!parsed.success) return { ok: false, error: '参数非法' }
    const s = requireStore()
    if (!s.items.get(parsed.data.itemId)) return { ok: false, error: '条目不存在' }
    s.flags.set(parsed.data.itemId, parsed.data.patch)
    return { ok: true }
  })

  ipcMain.handle('sources:list', () => requireStore().sources.list())

  ipcMain.handle('sources:toggle', (_e, raw: unknown) => {
    const parsed = toggleSchema.safeParse(raw)
    if (!parsed.success) return { ok: false, error: '参数非法' }
    const s = requireStore()
    const existing = s.sources.get(parsed.data.id)
    if (!existing) return { ok: false, error: '源不存在' }
    s.sources.upsert({ ...existing, enabled: parsed.data.enabled })
    return { ok: true }
  })

  ipcMain.handle('sources:test', async (_e, raw: unknown) => {
    const parsed = testOneSchema.safeParse(raw)
    if (!parsed.success) return { ok: false, error: '参数非法' }
    const s = requireStore()
    const source = s.sources.get(parsed.data)
    if (!source) return { ok: false, error: '源不存在' }

    const res = await fetchSource(source, { now: Date.now(), windowHours: source.windowHours ?? 48 })
    if (res.ok) s.sources.recordSuccess(source.id, res.items.length, res.ms)
    else s.sources.recordFailure(source.id, res.error)

    return res.ok
      ? { ok: true, n: res.items.length, ms: res.ms }
      : { ok: false, error: res.error, ms: res.ms }
  })

  /**
   * 全量自检：35 个源并发 6 个跑，每完成一个推一次进度。
   * 用事件而不是让渲染层轮询，是因为自检本身可能 60 秒以上。
   */
  ipcMain.handle('sources:testAll', async (event) => {
    const s = requireStore()
    const sources = s.sources.list().filter((x) => x.enabled)
    const results: ProbeResult[] = []
    const now = Date.now()
    let cursor = 0

    const worker = async (): Promise<void> => {
      for (;;) {
        const i = cursor++
        if (i >= sources.length) return
        const source = sources[i]!
        const res = await fetchSource(source, { now, windowHours: source.windowHours ?? 48 })
        const probe: ProbeResult = res.ok
          ? { id: source.id, ok: true, n: res.items.length, ms: res.ms }
          : { id: source.id, ok: false, n: 0, ms: res.ms, error: res.error }
        results.push(probe)
        if (res.ok) s.sources.recordSuccess(source.id, res.items.length, res.ms)
        else s.sources.recordFailure(source.id, res.error ?? 'unknown')
        if (!event.sender.isDestroyed()) {
          event.sender.send('sources:progress', { ...probe, done: results.length, total: sources.length })
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(6, sources.length) }, worker))
    return { ok: true, summary: summarizeProbe(results), results }
  })

  ipcMain.handle('items:search', (_e, raw: unknown) => {
    const q = z.string().safeParse(raw)
    if (!q.success) return []
    const store = requireStore()
    const sourceNameById = new Map(store.sources.list().map((x) => [x.id, x.name]))
    return store
      .items.search(q.data, { limit: 50 })
      .map((it) => ({
        id: it.id,
        title: it.title,
        url: it.url,
        bucket: it.bucket,
        summary: it.summary,
        score: it.score,
        ...(it.publishedAt !== undefined ? { publishedAt: it.publishedAt } : {}),
        sourceName: sourceNameById.get(it.sourceId) ?? it.sourceId
      }))
  })

  ipcMain.handle('sources:update', (_e, raw: unknown) => {
    const parsed = updateSourceSchema.safeParse(raw)
    if (!parsed.success) return { ok: false, error: '参数非法' }
    const s = requireStore()
    const existing = s.sources.get(parsed.data.id)
    if (!existing) return { ok: false, error: '源不存在' }
    const result = validateSourceUpdate(parsed.data, existing)
    if (!result.ok) return { ok: false, error: result.error }
    s.sources.upsert(result.source)
    return { ok: true }
  })

  ipcMain.handle('schedule:get', () => {
    const s = requireStore()
    return { ...readSchedule(s), lastRunAt: s.settings.get<number>('schedule.lastRunAt') ?? null }
  })

  ipcMain.handle('schedule:set', (_e, raw: unknown) => {
    const parsed = scheduleSchema.safeParse(raw)
    if (!parsed.success) return { ok: false, error: '参数非法' }
    if (!isValidSchedule(parsed.data)) return { ok: false, error: '时间超出范围' }
    writeSchedule(requireStore(), parsed.data)
    return { ok: true }
  })

  /** 手动"立即采集"：走与定时任务完全相同的实现 */
  ipcMain.handle('run:now', async () => {
    const s = requireStore()
    const out = await runDaily(s, dailyDeps())
    s.settings.set('schedule.lastRunAt', Date.now())
    return {
      ok: true,
      nKept: out.collect.nKept,
      nOk: out.collect.nOk,
      nSources: out.collect.nSources,
      degraded: out.degraded
    }
  })

  ipcMain.handle('sources:add', (_e, raw: unknown) => {
    const parsed = newSourceSchema.safeParse(raw)
    if (!parsed.success) return { ok: false, error: '参数非法' }
    const s = requireStore()
    const existing = new Set(s.sources.list().map((x) => x.id))
    const result = validateNewSource(parsed.data, existing)
    if (!result.ok) return { ok: false, error: result.error }
    s.sources.upsert(result.source)
    return { ok: true, id: result.source.id }
  })

  ipcMain.handle('sources:remove', (_e, raw: unknown) => {
    const parsed = z.string().min(1).safeParse(raw)
    if (!parsed.success) return { ok: false, error: '参数非法' }
    const s = requireStore()
    if (!s.sources.get(parsed.data)) return { ok: false, error: '源不存在' }
    s.sources.remove(parsed.data)
    return { ok: true }
  })

  ipcMain.handle('prefs:get', () => ({ autoLaunch: autoLaunchState(requireStore()) }))

  ipcMain.handle('prefs:setAutoLaunch', (_e, raw: unknown) => {
    const v = z.boolean().safeParse(raw)
    if (!v.success) return { ok: false, error: '参数非法' }
    const st = setAutoLaunch(requireStore(), v.data)
    return { ok: true, autoLaunch: st }
  })

  ipcMain.handle('feedback:compose', (_e, raw: unknown) => {
    const parsed = feedbackSchema.safeParse(raw)
    if (!parsed.success) return { ok: false, error: '参数非法' }
    return composeFeedback(requireStore(), parsed.data)
  })

  ipcMain.handle('feedback:save', (_e, raw: unknown) => {
    const parsed = feedbackTextSchema.safeParse(raw)
    if (!parsed.success) return { ok: false, error: '参数非法' }
    return saveFeedback(parsed.data.title, parsed.data.body)
  })

  ipcMain.handle('feedback:copy', (_e, raw: unknown) => {
    const parsed = z.string().max(20_000).safeParse(raw)
    if (!parsed.success) return { ok: false, error: '参数非法' }
    return copyFeedback(parsed.data)
  })

  ipcMain.handle('key:status', () => keyStatus())

  ipcMain.handle('key:set', (_e, raw: unknown) => {
    const parsed = z.string().min(1).max(200).safeParse(raw)
    if (!parsed.success) return { ok: false, error: '参数非法' }
    return setApiKey(parsed.data)
  })

  ipcMain.handle('key:clear', () => clearApiKey())

  ipcMain.handle('key:importDsh', () => importFromDsh())

  ipcMain.handle('diag:export', () => exportDiagnostic(requireStore()))

  ipcMain.handle('brief:export', () => {
    const b = requireStore().briefs.latest()
    if (!b) return { ok: false, error: '还没有简报' }
    try {
      return { ok: true, path: exportBrief(b.markdown, b.date) }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
}
