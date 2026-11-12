/**
 * 主进程 IPC：renderer 只能通过这里访问数据与网络。
 *
 * 约定：
 *  - 入参一律在边界校验（renderer 可以被 XSS 影响，不能信任）
 *  - 长任务（全量自检）走事件推送进度，不用轮询
 *  - 所有 handler 都返回 Result 形状，尽量不把异常抛给渲染层
 */
import { BrowserWindow, Notification, app, dialog, ipcMain, net, shell } from 'electron'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import { createStore } from '../adapters/store-sqlite/store'
import { fetchSource } from '../adapters/sources'
import { summarizeProbe, type ProbeResult } from '../app/source-health'
import { isValidSchedule } from '../app/schedule'
import { validateNewSource, validateSourceUpdate } from '../app/source-edit'
import { applyImport, buildPack, parsePack, planImport } from '../app/source-pack'
import { seedSources as seedSourcesFrom } from '../app/seed-sources'
import { seedDefaultMembership } from '../app/topics'
import { topicStats } from '../app/topic-stats'
import { NEW_TOPIC_SOURCE_LIMIT, recommendSources, recommendSourcesForNewTopic } from '../app/source-recommend'
import { setEnabled as setAutoLaunch, state as autoLaunchState } from './autolaunch'
import { lastRunKey, readSchedule, writeSchedule } from './scheduler'
import { copyBriefRichText, exportBrief } from './export'
import { recomposeDaily, runDaily, type DailyDeps } from './daily'
import { checkForUpdate, type UpdateCheckResult } from './update-check'
import {
  chatModels,
  defaultChatModel,
  ensureThread,
  previewContextTokens,
  sendChatMessage,
  threadBriefStale,
  type ChatDeps
} from './chat'
import { composeTarget, modelOverrideKey, readModelOverrides, type ProviderKeys } from './providers'
import { PROVIDERS, providerMeta } from '../core/chat/providers'
import { chatLatch } from './run-control'
import { beginRun, cancelRun, endRun } from './run-control'
import { RunCancelledError } from '../app/run-cancel'
import { resourcePath } from './paths'
import { log } from './log'
import { exportDiagnostic } from './diagnostic'
import { composeFeedback, copyFeedback, saveFeedback } from './feedback'
import { allKeyStatuses, availableProviders, clearApiKey, importFromDsh, keyStatus, setApiKey } from './keystore'
import type { Store } from '../core/ports/store'
import type { Source } from '../core/domain/types'

let store: Store | null = null

/** 跑完之后让所有窗口刷新：不依赖窗口是否可见 */
function broadcastBriefUpdated(): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('brief:updated')
  }
}

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
const providerIdSchema = z.enum(['deepseek', 'openai', 'anthropic'])
const chatEnsureSchema = z.object({
  topicId: topicIdSchema,
  briefDate: z.string().max(20).optional(),
  model: z.string().max(40).optional()
})
const chatSendSchema = z.object({
  threadId: z.string().min(1).max(60),
  text: z.string().max(4_000),
  actionId: z.enum(['ask', 'summarize5', 'compare', 'why', 'reorder']).optional(),
  model: z.string().max(40).optional(),
  includePrevious: z.boolean().optional()
})
const topicCreateSchema = z.object({
  id: z.string().min(1).max(40),
  name: z.string().min(1).max(30),
  /** 所属领域；不传落到默认领域 */
  domainId: z.string().min(1).max(40).optional(),
  /** 新主题默认收录的源；不传就是全部 */
  sourceIds: z.array(z.string().min(1)).max(200).optional()
})
const domainCreateSchema = z.object({
  id: z.string().min(1).max(40).optional(),
  name: z.string().min(1).max(30)
})
const domainRenameSchema = z.object({
  id: z.string().min(1).max(40),
  name: z.string().min(1).max(30)
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
const exportRequestSchema = z.discriminatedUnion('format', [
  z.object({
    format: z.literal('md'),
    topicId: topicIdSchema,
    date: z.string().min(1).max(20)
  }),
  z.object({
    format: z.literal('html'),
    topicId: topicIdSchema,
    date: z.string().min(1).max(20),
    html: z.string().min(1).max(2_000_000)
  }),
  z.object({
    format: z.literal('pdf'),
    topicId: topicIdSchema,
    date: z.string().min(1).max(20),
    html: z.string().min(1).max(2_000_000)
  })
])
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

const UPDATE_LAST_KEY = 'update.lastCheckedAt'
const UPDATE_CACHE_KEY = 'update.cached'
const UPDATE_NOTIFIED_KEY = 'update.notified'
const UPDATE_INTERVAL_MS = 24 * 3_600_000

/** 手动与后台共用：查 GitHub 最新 Release，成功才写缓存 */
async function runUpdateCheck(): Promise<UpdateCheckResult> {
  const s = requireStore()
  const r = await checkForUpdate(
    (url, init) => net.fetch(url, init) as never,
    { current: app.getVersion() }
  )
  s.settings.set(UPDATE_LAST_KEY, Date.now())
  // settings 自己会 JSON 序列化，这里直接存对象；再 stringify 会变成双重编码
  if (r.ok) s.settings.set(UPDATE_CACHE_KEY, r)
  return r
}

/**
 * 启动时的后台检查：24 小时内查过就跳过；有新版本才通知，且同一版本只提醒一次。
 * 失败静默——国内访问 api.github.com 经常不通，不该因此弹错误。
 */
export async function checkUpdatesInBackground(): Promise<void> {
  const s = requireStore()
  const last = s.settings.get<number>(UPDATE_LAST_KEY) ?? 0
  if (Date.now() - last < UPDATE_INTERVAL_MS) return
  const r = await runUpdateCheck()
  if (!r.ok || !r.hasUpdate || !r.latest) return
  if (s.settings.get<string>(UPDATE_NOTIFIED_KEY) === r.latest) return
  s.settings.set(UPDATE_NOTIFIED_KEY, r.latest)

  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('update:available', r)
  }
  if (Notification.isSupported()) {
    const n = new Notification({
      title: 'Meerkat 有新版本',
      body: `${r.latest} 可用，点此查看`,
      silent: false
    })
    n.on('click', () => {
      if (r.url) void shell.openExternal(r.url)
    })
    n.show()
  }
}

/** 手动采集与定时任务共用同一份依赖构造 */
export function dailyDeps(): DailyDeps {
  let promptText = ''
  try {
    promptText = readFileSync(resourcePath('prompts/compose.zh.md'), 'utf8')
  } catch {
    promptText = '你是一份 AI 行业日报的主编。链接必须逐字复制素材里的 URL。'
  }
  // 成稿也用同一套供应商：只配了 OpenAI/Anthropic 的机器不该被迫降级
  const keys: ProviderKeys = {}
  for (const p of availableProviders()) keys[p.id] = p.key
  const overrides = store ? readModelOverrides(store) : {}
  return { compose: composeTarget(keys, overrides), promptText }
}

/** 对话的依赖：可用供应商的 key 集合 */
export function chatDeps(): ChatDeps {
  const keys: ProviderKeys = {}
  for (const p of availableProviders()) keys[p.id] = p.key
  return { keys, overrides: store ? readModelOverrides(store) : {} }
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

  ipcMain.handle('sources:exportPack', async (_e, raw: unknown) => {
    const parsed = z
      .object({ scope: z.enum(['all', 'topic']), topicId: z.string().min(1).max(40).optional() })
      .safeParse(raw)
    if (!parsed.success) return { ok: false, error: '参数非法' }
    if (parsed.data.scope === 'topic' && !parsed.data.topicId) return { ok: false, error: '缺少主题 id' }

    let pack
    try {
      pack = buildPack(
        requireStore(),
        parsed.data.scope === 'all'
          ? { kind: 'all' }
          : { kind: 'topic', topicId: parsed.data.topicId! }
      )
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }

    const scopeName = parsed.data.scope === 'all' ? 'all' : parsed.data.topicId!
    const day = new Date().toLocaleDateString('sv-SE')
    const picked = await dialog.showSaveDialog({
      title: '导出源配置',
      defaultPath: join(app.getPath('documents'), 'Meerkat', `meerkat-sources-${scopeName}-${day}.json`),
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (picked.canceled || !picked.filePath) return { ok: false, canceled: true }
    try {
      mkdirSync(dirname(picked.filePath), { recursive: true })
      writeFileSync(picked.filePath, `${JSON.stringify(pack, null, 2)}\n`, 'utf8')
      log('info', `源配置已导出：${picked.filePath}`)
      return { ok: true, path: picked.filePath }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('sources:importPack', async () => {
    const picked = await dialog.showOpenDialog({
      title: '导入源配置',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (picked.canceled || picked.filePaths.length === 0) return { ok: false, canceled: true }
    const file = picked.filePaths[0]!
    try {
      if (statSync(file).size > 2 * 1024 * 1024) return { ok: false, error: '文件超过 2 MB' }
      const pack = parsePack(JSON.parse(readFileSync(file, 'utf8')))
      const plan = planImport(requireStore(), pack)
      return { ok: true, path: file, pack, plan }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('sources:applyPack', (_e, raw: unknown) => {
    try {
      const pack = parsePack(raw)
      const plan = applyImport(requireStore(), pack)
      log(
        'info',
        `源配置已导入：源 +${plan.counts.sources.create}/~${plan.counts.sources.update} · 主题 +${plan.counts.topics.create}/~${plan.counts.topics.update}`
      )
      return { ok: true, plan }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  /** 设置页「数据概览」：全局计数，只读；不是当前简报的局部统计 */
  ipcMain.handle('stats:overview', () => {
    const s = requireStore()
    const sources = s.sources.list()
    return {
      items: s.items.count(),
      briefs: s.briefs.count(),
      read: s.flags.byFlag('isRead', true).length,
      saved: s.flags.byFlag('isSaved', true).length,
      failingSources: sources.filter((x) => x.failStreak >= 3).length,
      totalSources: sources.length,
      schemaVersion: s.schemaVersion()
    }
  })

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
  ipcMain.handle('domains:list', () => {
    const s = requireStore()
    return s.domains.list().map((d) => ({
      ...d,
      topicCount: s.topics.list().filter((t) => t.domainId === d.id).length
    }))
  })

  ipcMain.handle('domains:create', (_e, raw: unknown) => {
    const parsed = domainCreateSchema.safeParse(raw)
    if (!parsed.success) return { ok: false, error: '参数非法' }
    const s = requireStore()
    const id = parsed.data.id ?? `d-${Date.now().toString(36)}`
    if (s.domains.get(id)) return { ok: false, error: '领域已存在' }
    if (s.domains.list().some((d) => d.name === parsed.data.name.trim())) {
      return { ok: false, error: '领域名重复' }
    }
    s.domains.upsert({ id, name: parsed.data.name.trim(), createdAt: Date.now() })
    return { ok: true, id }
  })

  ipcMain.handle('domains:rename', (_e, raw: unknown) => {
    const parsed = domainRenameSchema.safeParse(raw)
    if (!parsed.success) return { ok: false, error: '参数非法' }
    const s = requireStore()
    const d = s.domains.get(parsed.data.id)
    if (!d) return { ok: false, error: '领域不存在' }
    s.domains.upsert({ ...d, name: parsed.data.name.trim() })
    return { ok: true }
  })

  ipcMain.handle('domains:remove', (_e, raw: unknown) => {
    const parsed = z.string().min(1).max(40).safeParse(raw)
    if (!parsed.success) return { ok: false, error: '参数非法' }
    const s = requireStore()
    if (!s.domains.get(parsed.data)) return { ok: false, error: '领域不存在' }
    if (s.topics.list().some((t) => t.domainId === parsed.data)) {
      return { ok: false, error: '领域下还有主题，先移走或删掉它们' }
    }
    if (s.domains.list().length <= 1) return { ok: false, error: '至少要保留一个领域' }
    s.domains.remove(parsed.data)
    return { ok: true }
  })

  ipcMain.handle('topics:list', () => {
    const s = requireStore()
    return s.topics.list().map((t) => {
      const stats = topicStats(s, t.id)
      return {
        ...t,
        sourceCount: s.topics.sourceIds(t.id).length,
        hasBrief: stats.date !== undefined,
        todayCount: stats.todayCount,
        unreadCount: stats.unreadCount
      }
    })
  })

  ipcMain.handle('topics:create', (_e, raw: unknown) => {
    const parsed = topicCreateSchema.safeParse(raw)
    if (!parsed.success) return { ok: false, error: '参数非法' }
    const s = requireStore()
    if (s.topics.get(parsed.data.id)) return { ok: false, error: '主题已存在' }
    const domainId = parsed.data.domainId ?? 'ai'
    if (!s.domains.get(domainId)) return { ok: false, error: '领域不存在' }
    const now = Date.now()
    s.topics.upsert({
      id: parsed.data.id,
      name: parsed.data.name,
      domainId,
      enabled: true,
      hour: 8,
      minute: 30,
      createdAt: now,
      updatedAt: now
    })
    // 新主题默认只带推荐源：全选会让每个主题内容雷同。
    // 显式传入 sourceIds 时以传入为准（脚本/引导页可以要全部）。
    const ids =
      parsed.data.sourceIds ??
      recommendSourcesForNewTopic(s, parsed.data.name, domainId, { limit: NEW_TOPIC_SOURCE_LIMIT }).map((r) => r.id)
    s.topics.setSources(parsed.data.id, ids)
    return { ok: true, id: parsed.data.id, sourceCount: ids.length }
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
  const resolveTopic = (raw: string | undefined): string | undefined => {
    const s = requireStore()
    return raw ?? s.topics.list()[0]?.id
  }

  ipcMain.handle('run:now', async (_e, raw: unknown) => {
    const parsed = briefTopicSchema.safeParse(raw)
    if (!parsed.success) return { ok: false, error: '参数非法' }
    const topicId = resolveTopic(parsed.data)
    if (!topicId) return { ok: false, error: '还没有主题' }
    const handle = beginRun()
    if (!handle) return { ok: false, error: '正在运行中，先取消或等它跑完' }
    const s = requireStore()
    try {
      const out = await runDaily(s, dailyDeps(), { topicId, signal: handle.controller.signal })
      // 两个 key 都写：主题自己的用于排程，全局的用于诊断包/反馈材料
      s.settings.set(lastRunKey(topicId), Date.now())
      s.settings.set('schedule.lastRunAt', Date.now())
      broadcastBriefUpdated()
      return {
        ok: true,
        nKept: out.collect.nKept,
        nOk: out.collect.nOk,
        nSources: out.collect.nSources,
        degraded: out.degraded
      }
    } catch (e) {
      if (e instanceof RunCancelledError) {
        log('info', '手动采集已取消')
        return { ok: false, error: '已取消' }
      }
      log('error', `手动采集失败：${e instanceof Error ? e.message : String(e)}`)
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    } finally {
      endRun(handle)
    }
  })

  /** 不下网络：用库里最近 48 小时的素材重新成稿 */
  ipcMain.handle('run:compose', async (_e, raw: unknown) => {
    const parsed = briefTopicSchema.safeParse(raw)
    if (!parsed.success) return { ok: false, error: '参数非法' }
    const topicId = resolveTopic(parsed.data)
    if (!topicId) return { ok: false, error: '还没有主题' }
    const handle = beginRun()
    if (!handle) return { ok: false, error: '正在运行中，先取消或等它跑完' }
    try {
      const out = await recomposeDaily(requireStore(), dailyDeps(), {
        topicId,
        signal: handle.controller.signal
      })
      broadcastBriefUpdated()
      return {
        ok: true,
        nKept: out.collect.nKept,
        nOk: out.collect.nOk,
        nSources: out.collect.nSources,
        degraded: out.degraded
      }
    } catch (e) {
      if (e instanceof RunCancelledError) return { ok: false, error: '已取消' }
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    } finally {
      endRun(handle)
    }
  })

  ipcMain.handle('run:cancel', () => ({ ok: true, cancelled: cancelRun() }))

  // ── 对话 ──────────────────────────────────────────────
  ipcMain.handle('chat:models', () => chatModels(chatDeps()))

  ipcMain.handle('chat:ensure', (_e, raw: unknown) => {
    const parsed = chatEnsureSchema.safeParse(raw)
    if (!parsed.success) return null
    const deps = chatDeps()
    const thread = ensureThread(requireStore(), {
      ...parsed.data,
      model: parsed.data.model ?? defaultChatModel(deps)
    })
    if (!thread) return null
    const s = requireStore()
    return {
      ...thread,
      contextTokens: previewContextTokens(s, thread.id, false),
      briefStale: threadBriefStale(s, thread)
    }
  })

  ipcMain.handle('chat:messages', (_e, raw: unknown) => {
    const parsed = z.string().min(1).max(60).safeParse(raw)
    if (!parsed.success) return []
    return requireStore().chat.messages(parsed.data)
  })

  ipcMain.handle('chat:send', async (_e, raw: unknown) => {
    const parsed = chatSendSchema.safeParse(raw)
    if (!parsed.success) return { ok: false, error: '参数非法' }
    const res = await sendChatMessage(requireStore(), chatDeps(), parsed.data)
    // 让所有窗口刷新（面板可能开在另一个窗口上，P0 只有主窗口，但不能假设）
    broadcastBriefUpdated()
    return res
  })

  ipcMain.handle('chat:cancel', () => ({ cancelled: chatLatch.cancel() }))

  /** 丢弃当前会话（简报更新后重新开始用） */
  ipcMain.handle('chat:reset', (_e, raw: unknown) => {
    const parsed = z.string().min(1).max(60).safeParse(raw)
    if (!parsed.success) return { ok: false, error: '参数非法' }
    requireStore().chat.remove(parsed.data)
    return { ok: true }
  })

  /** 供应商目录 + 当前覆盖的模型 id：设置页用它渲染"模型 id"输入框 */
  ipcMain.handle('chat:providers', () => {
    const s = requireStore()
    const overrides = readModelOverrides(s)
    const keys: ProviderKeys = {}
    for (const p of availableProviders()) keys[p.id] = p.key
    return PROVIDERS.map((p) => ({
      id: p.id,
      label: p.label,
      protocol: p.protocol,
      defaultModel: p.models[0]!.id,
      override: overrides[p.id] ?? '',
      hasKey: Boolean(keys[p.id])
    }))
  })

  ipcMain.handle('chat:setModel', (_e, raw: unknown) => {
    const parsed = z
      .object({ provider: providerIdSchema, model: z.string().max(80) })
      .safeParse(raw)
    if (!parsed.success) return { ok: false, error: '参数非法' }
    if (!providerMeta(parsed.data.provider)) return { ok: false, error: '未知供应商' }
    // 空串表示"恢复默认"：readModelOverrides 会忽略空值
    requireStore().settings.set(modelOverrideKey(parsed.data.provider), parsed.data.model.trim())
    return { ok: true }
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

  ipcMain.handle('sources:recommend', (_e, raw: unknown) => {
    const parsed = z
      .object({ topicId: z.string().min(1).max(40), limit: z.number().int().min(1).max(10).optional() })
      .safeParse(raw)
    if (!parsed.success) return []
    return recommendSources(requireStore(), parsed.data.topicId, {
      ...(parsed.data.limit !== undefined ? { limit: parsed.data.limit } : {})
    })
  })

  ipcMain.handle('update:current', () => app.getVersion())

  ipcMain.handle('update:latest', () => {
    return requireStore().settings.get<UpdateCheckResult>(UPDATE_CACHE_KEY) ?? null
  })

  ipcMain.handle('update:check', async () => {
    const r = await runUpdateCheck()
    // 手动检查出结果时也推一条，设置页点完 banner 能立刻出现（不用重启）
    if (r.ok && r.hasUpdate) {
      for (const w of BrowserWindow.getAllWindows()) {
        if (!w.isDestroyed()) w.webContents.send('update:available', r)
      }
    }
    return r
  })

  ipcMain.handle('update:open', async (_e, raw: unknown) => {
    const parsed = z.string().url().max(500).safeParse(raw)
    if (!parsed.success) return { ok: false, error: '参数非法' }
    // 只允许打开本仓库的 Release 链接，避免被渲染层当成任意外链通道
    if (!parsed.data.startsWith('https://github.com/husleng24/meerkat/releases/')) {
      return { ok: false, error: '不支持的地址' }
    }
    await shell.openExternal(parsed.data)
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

  ipcMain.handle('key:all', () => allKeyStatuses())

  ipcMain.handle('key:status', (_e, raw: unknown) => {
    const parsed = providerIdSchema.safeParse(raw)
    if (!parsed.success) return keyStatus()
    return keyStatus(parsed.data)
  })

  ipcMain.handle('key:set', (_e, raw: unknown) => {
    const parsed = z
      .object({ provider: providerIdSchema, value: z.string().min(1).max(300) })
      .safeParse(raw)
    if (!parsed.success) return { ok: false, error: '参数非法' }
    return setApiKey(parsed.data.provider, parsed.data.value)
  })

  ipcMain.handle('key:clear', (_e, raw: unknown) => {
    const parsed = providerIdSchema.safeParse(raw)
    if (!parsed.success) return { ok: false, error: '参数非法' }
    return clearApiKey(parsed.data)
  })

  ipcMain.handle('key:importDsh', () => importFromDsh())

  ipcMain.handle('diag:export', () => exportDiagnostic(requireStore()))

  ipcMain.handle('export:richtext', (_e, raw: unknown) => {
    const parsed = z
      .object({ html: z.string().min(1).max(2_000_000), text: z.string().max(2_000_000) })
      .safeParse(raw)
    if (!parsed.success) return { ok: false, error: '参数非法' }
    copyBriefRichText(parsed.data.html, parsed.data.text)
    return { ok: true }
  })

  /**
   * 导出某一期简报（md/html/pdf）。
   *
   * 入参必须带 topicId + date：文件名与归属都由这两个字段决定。
   * 只传日期会让两个主题在同一天悄悄覆盖彼此的文件——这正是要修的那类 bug。
   */
  ipcMain.handle('brief:export', async (_e, raw: unknown) => {
    const parsed = exportRequestSchema.safeParse(raw)
    if (!parsed.success) return { ok: false, error: '参数非法' }
    try {
      return { ok: true, path: await exportBrief(requireStore(), parsed.data) }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
}
