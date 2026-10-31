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
import { seedDefaultMembership } from '../app/topics'
import { getApiKey } from './keystore'
import { setEnabled as setAutoLaunch, state as autoLaunchState } from './autolaunch'
import { exportBrief, lastRunKey, readSchedule, writeSchedule } from './scheduler'
import { copyBriefRichText, exportBriefHtml, exportBriefPdf } from './export'
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
const topicIdSchema = z.string().min(1).max(40)
const topicCreateSchema = z.object({
  id: z.string().min(1).max(40),
  name: z.string().min(1).max(30),
  /** 新主题默认收录的源；不传就是全部 */
  sourceIds: z.array(z.string().min(1)).max(200).optional()
})
const topicUpdateSchema = z.object({
  id: z.string().min(1).max(40),
  name: z.string().min(1).max(30).optional(),
  enabled: z.boolean().optional()
})
const scheduleSetSchema = z.object({
  topicId: z.string().min(1).max(40),
  enabled: z.boolean(),
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59)
})
const exportDocSchema = z.object({
  html: z.string().min(1).max(2_000_000),
  date: z.string().min(1).max(40)
})
const searchSchema = z.object({
  q: z.string().max(200),
  bucket: z.string().max(30).optional(),
  sourceId: z.string().max(80).optional(),
  /** 只搜最近 N 天；不传就是全部 */
  days: z.number().int().min(1).max(3650).optional(),
  sort: z.enum(['score', 'time']).optional()
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
  // 首次运行：把 35 个源挂到默认主题上（只做一次，用户删掉的不会复活）
  seedDefaultMembership(store)
  return store
}

export function closeStore(): void {
  store?.close()
  store = null
}

export function registerIpc(): void {
  ipcMain.handle('app:ping', () => ({ ok: true, version: app.getVersion(), ts: Date.now() }))

  /**
   * 简报正文只有 URL，界面要靠它反查条目 id 才能持久化已读/收藏。
   *
   * previous 一并给出：界面要拿它做「和昨天比」。放在同一个响应里而不是
   * 单开一个 handler，是为了避免两次 IPC 之间库里刚好写了新简报、两期对不上。
   */
  const buildBriefPayload = (b: ReturnType<Store['briefs']['latest']>): unknown => {
    if (!b) return null
    const s = requireStore()
    const urlToId: Record<string, string> = {}
    for (const it of s.items.since(b.createdAt - 7 * 86_400_000, 1000)) urlToId[it.url] = it.id
    // 上一期＝同一主题里日期更早的最近一份；首期没有就是 null
    const prev = s.briefs.list(60, b.topicId).find((x) => x.date < b.date)
    return {
      date: b.date,
      topicId: b.topicId,
      markdown: b.markdown,
      model: b.model,
      linkCheck: b.linkCheck,
      urlToId,
      previous: prev ? { date: prev.date, markdown: prev.markdown } : null
    }
  }

  const briefTopicSchema = z.union([z.undefined(), topicIdSchema])

  ipcMain.handle('brief:latest', (_e, raw: unknown) => {
    const parsed = briefTopicSchema.safeParse(raw)
    if (!parsed.success) return null
    return buildBriefPayload(requireStore().briefs.latest(parsed.data))
  })

  ipcMain.handle('brief:get', (_e, raw: unknown) => {
    // 兼容两种入参：老调用只传日期，新调用带主题
    const legacy = z.string().max(20).safeParse(raw)
    if (legacy.success) return buildBriefPayload(requireStore().briefs.byDate(legacy.data))
    const parsed = z.object({ date: z.string().max(20), topicId: topicIdSchema.optional() }).safeParse(raw)
    if (!parsed.success) return null
    return buildBriefPayload(requireStore().briefs.byDate(parsed.data.date, parsed.data.topicId))
  })

  ipcMain.handle('brief:list', (_e, raw: unknown) => {
    const parsed = briefTopicSchema.safeParse(raw)
    if (!parsed.success) return []
    return requireStore()
      .briefs.list(60, parsed.data)
      .map((b) => ({
        date: b.date,
        model: b.model,
        linkCheck: b.linkCheck ?? '',
        chars: b.markdown.length,
        createdAt: b.createdAt
      }))
  })

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
    const parsed = searchSchema.safeParse(raw)
    if (!parsed.success) return []
    const { q, bucket, sourceId, days, sort } = parsed.data
    const store = requireStore()
    const sourceNameById = new Map(store.sources.list().map((x) => [x.id, x.name]))
    const sinceTs = days === undefined ? undefined : Date.now() - days * 86_400_000
    return store
      .items.search(q, {
        limit: 50,
        ...(bucket ? { bucket } : {}),
        ...(sourceId ? { sourceId } : {}),
        ...(sinceTs !== undefined ? { sinceTs } : {}),
        ...(sort ? { sort } : {})
      })
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

  ipcMain.handle('schedule:get', (_e, raw: unknown) => {
    const parsed = briefTopicSchema.safeParse(raw)
    if (!parsed.success) return { enabled: false, hour: 8, minute: 30, lastRunAt: null }
    const s = requireStore()
    if (!parsed.data) return { enabled: false, hour: 8, minute: 30, lastRunAt: null }
    return {
      ...readSchedule(s, parsed.data),
      lastRunAt: s.settings.get<number>(lastRunKey(parsed.data)) ?? null
    }
  })

  ipcMain.handle('schedule:set', (_e, raw: unknown) => {
    const parsed = scheduleSetSchema.safeParse(raw)
    if (!parsed.success) return { ok: false, error: '参数非法' }
    const { topicId, ...cfg } = parsed.data
    if (!isValidSchedule(cfg)) return { ok: false, error: '时间超出范围' }
    if (!requireStore().topics.get(topicId)) return { ok: false, error: '主题不存在' }
    writeSchedule(requireStore(), topicId, cfg)
    return { ok: true }
  })

  // ── 主题 ──────────────────────────────────────────────
  ipcMain.handle('topics:list', () => {
    const s = requireStore()
    return s.topics.list().map((t) => ({
      ...t,
      sourceCount: s.topics.sourceIds(t.id).length,
      hasBrief: s.briefs.latest(t.id) !== undefined
    }))
  })

  ipcMain.handle('topics:create', (_e, raw: unknown) => {
    const parsed = topicCreateSchema.safeParse(raw)
    if (!parsed.success) return { ok: false, error: '参数非法' }
    const s = requireStore()
    if (s.topics.get(parsed.data.id)) return { ok: false, error: '主题已存在' }
    const now = Date.now()
    s.topics.upsert({
      id: parsed.data.id,
      name: parsed.data.name,
      enabled: true,
      hour: 8,
      minute: 30,
      createdAt: now,
      updatedAt: now
    })
    const ids = parsed.data.sourceIds ?? s.sources.list().map((x) => x.id)
    s.topics.setSources(parsed.data.id, ids)
    return { ok: true, id: parsed.data.id }
  })

  ipcMain.handle('topics:update', (_e, raw: unknown) => {
    const parsed = topicUpdateSchema.safeParse(raw)
    if (!parsed.success) return { ok: false, error: '参数非法' }
    const s = requireStore()
    const topic = s.topics.get(parsed.data.id)
    if (!topic) return { ok: false, error: '主题不存在' }
    s.topics.upsert({
      ...topic,
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.enabled !== undefined ? { enabled: parsed.data.enabled } : {}),
      updatedAt: Date.now()
    })
    return { ok: true }
  })

  ipcMain.handle('topics:remove', (_e, raw: unknown) => {
    const parsed = topicIdSchema.safeParse(raw)
    if (!parsed.success) return { ok: false, error: '参数非法' }
    const s = requireStore()
    if (s.topics.list().length <= 1) return { ok: false, error: '至少要保留一个主题' }
    if (!s.topics.get(parsed.data)) return { ok: false, error: '主题不存在' }
    s.topics.remove(parsed.data)
    return { ok: true }
  })

  ipcMain.handle('topics:setSources', (_e, raw: unknown) => {
    const parsed = z
      .object({ topicId: topicIdSchema, sourceIds: z.array(z.string().min(1)).max(500) })
      .safeParse(raw)
    if (!parsed.success) return { ok: false, error: '参数非法' }
    const s = requireStore()
    if (!s.topics.get(parsed.data.topicId)) return { ok: false, error: '主题不存在' }
    s.topics.setSources(parsed.data.topicId, parsed.data.sourceIds)
    return { ok: true }
  })

  ipcMain.handle('topics:sourceIds', (_e, raw: unknown) => {
    const parsed = topicIdSchema.safeParse(raw)
    if (!parsed.success) return []
    return requireStore().topics.sourceIds(parsed.data)
  })

  /** 手动"立即采集"：走与定时任务完全相同的实现 */
  ipcMain.handle('run:now', async (_e, raw: unknown) => {
    const parsed = briefTopicSchema.safeParse(raw)
    if (!parsed.success) return { ok: false, error: '参数非法' }
    const s = requireStore()
    const topicId = parsed.data ?? s.topics.list()[0]?.id
    if (!topicId) return { ok: false, error: '还没有主题' }
    const out = await runDaily(s, dailyDeps(), { topicId })
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

  ipcMain.handle('export:html', (_e, raw: unknown) => {
    const parsed = exportDocSchema.safeParse(raw)
    if (!parsed.success) return { ok: false, error: '参数非法' }
    try {
      return { ok: true, path: exportBriefHtml(parsed.data.html, parsed.data.date) }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('export:pdf', async (_e, raw: unknown) => {
    const parsed = exportDocSchema.safeParse(raw)
    if (!parsed.success) return { ok: false, error: '参数非法' }
    try {
      return { ok: true, path: await exportBriefPdf(parsed.data.html, parsed.data.date) }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('export:richtext', (_e, raw: unknown) => {
    const parsed = z
      .object({ html: z.string().min(1).max(2_000_000), text: z.string().max(2_000_000) })
      .safeParse(raw)
    if (!parsed.success) return { ok: false, error: '参数非法' }
    copyBriefRichText(parsed.data.html, parsed.data.text)
    return { ok: true }
  })

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
