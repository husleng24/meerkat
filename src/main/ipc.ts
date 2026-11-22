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
import { parseBriefTrace } from '../app/brief-trace'
import { seedSources as seedSourcesFrom } from '../app/seed-sources'
import { seedDefaultMembership } from '../app/topics'
import { seedVideoTopic } from '../app/seed-video-topic'
import { grandfatherOnboarding, markOnboardingComplete, onboardingStatus } from '../app/onboarding'
import { bootstrapEntities } from '../app/entities'
import { createEntity, updateEntity, rebuildEntityIndex } from '../app/entities'
import { buildEntityEventClusters, classifyEntityEvent, entityPeriods } from '../app/entity-events'
import type { EntityEvent } from '../app/entity-events'
import { extractKeywords } from '../app/event-timeline'
import { cleanAliases } from '../app/aliases'
import { semanticBindClaims, type SemanticClaim } from '../app/claim-semantic'
import { readAuthConfig, saveAuthConfig, signInEmail, signInGithub, signOut, signUpEmail, status as authStatus } from './auth'
import { topicStats } from '../app/topic-stats'
import { NEW_TOPIC_SOURCE_LIMIT, recommendSources, recommendSourcesForNewTopic } from '../app/source-recommend'
import { setEnabled as setAutoLaunch, state as autoLaunchState } from './autolaunch'
import { lastRunKey, readSchedule, writeSchedule } from './scheduler'
import { copyBriefRichText, exportBrief } from './export'
import { extractBriefSummary } from '../app/brief-summary'
import { loadBuiltinPrompt } from './prompts'
import { resolveSelectionPolicy } from '../app/selection-policy'
import { recomposeDaily, runDaily, type DailyDeps } from './daily'
import { checkForUpdate, type UpdateCheckResult } from './update-check'
import {
  buildPushText,
  detectPlatform,
  isValidWebhook,
  readPushConfig,
  readPushState,
  savePushConfig,
  sendPush,
  type PushPlatform
} from './push'
import {
  readEmailConfig,
  readEmailState,
  saveEmailConfig,
  sendEmail,
  validateEmailConfig,
  type EmailConfig
} from './email'
import { getSmtpPassword, setSmtpPassword } from './email-secret'
import { startShare, stopShare } from './share'
import {
  chatModels,
  defaultChatModel,
  ensureItemThread,
  ensureEventThread,
  ensureThread,
  previewContextTokens,
  sendChatMessage,
  threadBriefStale,
  type ChatDeps
} from './chat'
import { composeTarget, modelOverrideKey, readModelOverrides, type ProviderKeys } from './providers'
import { createProviderInstance } from './providers'
import { fetchCreator, fetchCreatorVideos } from '../adapters/youtube/creator'
import { fetchVideoTranscript, transcriptToMarkdown } from '../adapters/youtube/transcript'
import { renderVideoSummary, summarizeVideo } from '../app/video-summary'
import { markStoryPrompted, setStoryStatus, storiesToReview } from '../app/story-tracking'
import { PROVIDERS, providerMeta } from '../core/chat/providers'
import { chatLatch } from './run-control'
import { beginRun, cancelRun, currentRun, endRun } from './run-control'
import { RunCancelledError } from '../app/run-cancel'
import { resourcePath } from './paths'
import { log } from './log'
import { exportDiagnostic } from './diagnostic'
import { composeFeedback, copyFeedback, saveFeedback } from './feedback'
import { allKeyStatuses, availableProviders, clearApiKey, importFromDsh, keyStatus, setApiKey } from './keystore'
import type { Store } from '../core/ports/store'
import type { Story } from '../core/domain/types'
import type { Source } from '../core/domain/types'

let store: Store | null = null

/** 跑完之后让所有窗口刷新：不依赖窗口是否可见 */
function broadcastBriefUpdated(): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('brief:updated')
  }
}

/** 逐源进度：设置页和首启引导都用它显示 12/35，而不是只转圈 */
function broadcastRunProgress(payload: {
  topicId: string
  done: number
  total: number
  name: string
  ok: boolean
  n: number
}): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('run:progress', payload)
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
const storyStatusSchema = z.enum(['active', 'paused', 'archived'])
const chatEnsureItemSchema = z.object({
  topicId: topicIdSchema,
  itemId: z.string().min(1).max(80),
  model: z.string().max(40).optional()
})
const chatEnsureEventSchema = z.object({
  topicId: topicIdSchema,
  eventKey: z.string().min(1).max(200),
  title: z.string().max(200),
  itemId: z.string().min(1).max(80).optional(),
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
  /** 新主题默认收录的源；不传走推荐源（8 个） */
  sourceIds: z.array(z.string().min(1)).max(200).optional(),
  editorialFocus: z.string().max(200).optional()
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
  enabled: z.boolean().optional(),
  editorialFocus: z.string().max(200).optional(),
  promptProfileId: z.string().max(80).nullable().optional(),
  selectionPolicy: z
    .object({
      windowHours: z.number(),
      maxItems: z.number(),
      targetMin: z.number(),
      targetMax: z.number(),
      buckets: z.array(z.string()).max(20),
      boostKeywords: z.array(z.string()).max(50),
      suppressKeywords: z.array(z.string()).max(50)
    })
    .optional()
})
const onboardingStartSchema = z.object({ topicId: topicIdSchema })
const onboardingCompleteSchema = z.object({ skipped: z.boolean().optional() })
const promptCreateSchema = z.object({
  name: z.string().min(1).max(40),
  systemMd: z.string().min(1).max(200_000)
})
const promptUpdateSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(40).optional(),
  systemMd: z.string().min(1).max(200_000).optional()
})
const promptIdSchema = z.string().min(1).max(80)
const promptRestoreSchema = z.object({ id: z.string().min(1).max(80), version: z.number().int().min(1) })
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
  const promptText = loadBuiltinPrompt()
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

interface RunNowResult {
  ok: boolean
  nKept?: number
  nOk?: number
  nSources?: number
  degraded?: boolean
  noChange?: boolean
  linkGood?: number
  linkTotal?: number
  error?: string
}

/**
 * 手动采集的唯一实现：设置页 / 今日页的「立即采集」，以及首启引导的 CTA。
 *
 * `onStarted` 在拿到运行锁之后、真正开跑之前调用：首启引导用它写完成标记，
 * 这样「拿到锁了但没跑」不会留下一个假的完成状态。
 */
async function runNowForTopic(topicId: string, opts: { onStarted?: () => void } = {}): Promise<RunNowResult> {
  const handle = beginRun({ kind: 'collect', topicId })
  if (!handle) return { ok: false, error: '正在运行中，先取消或等它跑完' }
  const s = requireStore()
  try {
    opts.onStarted?.()
    const out = await runDaily(s, dailyDeps(), {
      topicId,
      signal: handle.controller.signal,
      onProgress: (p) => broadcastRunProgress({ topicId, ...p })
    })
    // 两个 key 都写：主题自己的用于排程，全局的用于诊断包/反馈材料
    s.settings.set(lastRunKey(topicId), Date.now())
    s.settings.set('schedule.lastRunAt', Date.now())
    broadcastBriefUpdated()
    return {
      ok: true,
      nKept: out.collect.nKept,
      nOk: out.collect.nOk,
      nSources: out.collect.nSources,
      degraded: out.degraded,
      noChange: out.noChange,
      linkGood: out.linkCheck.good,
      linkTotal: out.linkCheck.total
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
}

export function initStore(dbPath: string): Store {
  store = createStore(dbPath)
  seedSources(store)
  // 首次运行：把 35 个源挂到默认主题上（只做一次，用户删掉的不会复活）
  seedDefaultMembership(store)
  // 预置「YouTube 博主」主题；在默认归属之后执行，避免新源被挂进 AI 综合
  seedVideoTopic(store)
  // 老库有使用痕迹就视为已完成首启引导；新库保持待引导
  grandfatherOnboarding(store)
  // 实体词表与倒排：首次启动回填历史条目，之后只有新条目增量索引
  bootstrapEntities(store)
  return store
}

export function getStore(): Store | null {
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
    const trace = parseBriefTrace(b.irJson)
    return {
      date: b.date,
      topicId: b.topicId,
      markdown: b.markdown,
      model: b.model,
      linkCheck: b.linkCheck,
      noChange: b.model === 'no-change' || trace?.noChange === true,
      urlToId,
      trace,
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
    // 同一天可能因为"立即采集"重跑而有多期；列表只展示最新一期，避免日期重复
    const briefs = requireStore().briefs.list(60, parsed.data)
    const latestByDate = new Map<string, (typeof briefs)[number]>()
    for (const b of briefs) {
      const prev = latestByDate.get(b.date)
      if (!prev || b.createdAt > prev.createdAt) latestByDate.set(b.date, b)
    }
    return [...latestByDate.values()]
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((b) => {
        const trace = parseBriefTrace(b.irJson)
        return {
          date: b.date,
          model: b.model,
          noChange: b.model === 'no-change' || trace?.noChange === true,
          linkCheck: b.linkCheck ?? '',
          chars: b.markdown.length,
          summary: extractBriefSummary(b.markdown),
          createdAt: b.createdAt
        }
      })
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

  ipcMain.handle('prompts:list', () => {
    const s = requireStore()
    return [
      {
        id: 'builtin',
        name: '内置 · 通用',
        version: 0,
        systemMd: loadBuiltinPrompt(),
        builtin: true,
        createdAt: 0,
        updatedAt: 0
      },
      ...s.prompts.list().map((p) => ({ ...p, builtin: false }))
    ]
  })

  ipcMain.handle('prompts:create', (_e, raw: unknown) => {
    const parsed = promptCreateSchema.safeParse(raw)
    if (!parsed.success) return { ok: false, error: '参数非法' }
    const s = requireStore()
    const now = Date.now()
    const profile = {
      id: `pp-${now}-${Math.random().toString(36).slice(2, 6)}`,
      name: parsed.data.name.trim(),
      version: 1,
      systemMd: parsed.data.systemMd,
      createdAt: now,
      updatedAt: now
    }
    s.prompts.create(profile)
    return { ok: true, profile }
  })

  ipcMain.handle('prompts:update', (_e, raw: unknown) => {
    const parsed = promptUpdateSchema.safeParse(raw)
    if (!parsed.success) return { ok: false, error: '参数非法' }
    const profile = requireStore().prompts.update(parsed.data.id, {
      ...(parsed.data.name !== undefined ? { name: parsed.data.name.trim() } : {}),
      ...(parsed.data.systemMd !== undefined ? { systemMd: parsed.data.systemMd } : {})
    })
    return profile ? { ok: true, profile } : { ok: false, error: '提示词不存在' }
  })

  ipcMain.handle('prompts:remove', (_e, raw: unknown) => {
    const parsed = promptIdSchema.safeParse(raw)
    if (!parsed.success) return { ok: false, error: '参数非法' }
    requireStore().prompts.remove(parsed.data)
    return { ok: true }
  })

  ipcMain.handle('prompts:versions', (_e, raw: unknown) => {
    const parsed = promptIdSchema.safeParse(raw)
    if (!parsed.success) return []
    return requireStore().prompts.versions(parsed.data)
  })

  ipcMain.handle('prompts:restore', (_e, raw: unknown) => {
    const parsed = promptRestoreSchema.safeParse(raw)
    if (!parsed.success) return { ok: false, error: '参数非法' }
    const profile = requireStore().prompts.restore(parsed.data.id, parsed.data.version)
    return profile ? { ok: true, profile } : { ok: false, error: '版本不存在' }
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
      ...(parsed.data.editorialFocus?.trim()
        ? { editorialFocus: parsed.data.editorialFocus.trim() }
        : {}),
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
    const next = {
      ...topic,
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.enabled !== undefined ? { enabled: parsed.data.enabled } : {}),
      ...(parsed.data.editorialFocus !== undefined
        ? {
            editorialFocus: parsed.data.editorialFocus.trim()
              ? parsed.data.editorialFocus.trim()
              : undefined
          }
        : {}),
      updatedAt: Date.now()
    }
    if (parsed.data.promptProfileId === null) delete next.promptProfileId
    else if (parsed.data.promptProfileId !== undefined) next.promptProfileId = parsed.data.promptProfileId
    if (parsed.data.selectionPolicy !== undefined) {
      next.selectionPolicy = resolveSelectionPolicy(parsed.data.selectionPolicy as never)
    }
    s.topics.upsert(next)
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
    return runNowForTopic(topicId)
  })

  // ── 首启引导 ──────────────────────────────────────────
  ipcMain.handle('onboarding:get', () => onboardingStatus(requireStore()))

  ipcMain.handle('onboarding:complete', (_e, raw: unknown) => {
    const parsed = onboardingCompleteSchema.safeParse(raw ?? {})
    if (!parsed.success) return { ok: false, error: '参数非法' }
    markOnboardingComplete(requireStore(), { skipped: parsed.data.skipped === true })
    log('info', parsed.data.skipped ? '首启引导跳过' : '首启引导标记完成')
    return { ok: true }
  })

  /**
   * 首启引导的「生成第一份简报」。
   *
   * 复用 runNowForTopic，不复制采集逻辑；完成标记只在拿到运行锁之后写，
   * 拿不到锁（已有运行）时返回错误，避免留下“标记完成但没跑”的状态。
   */
  ipcMain.handle('onboarding:start', async (_e, raw: unknown) => {
    const parsed = onboardingStartSchema.safeParse(raw)
    if (!parsed.success) return { ok: false, error: '参数非法' }
    const s = requireStore()
    if (!s.topics.get(parsed.data.topicId)) return { ok: false, error: '主题不存在' }
    return runNowForTopic(parsed.data.topicId, {
      onStarted: () => {
        markOnboardingComplete(s)
        log('info', `首启引导已记录，开始生成「${s.topics.get(parsed.data.topicId)?.name ?? parsed.data.topicId}」`)
      }
    })
  })

  /** 不下网络：用库里最近 48 小时的素材重新成稿 */
  ipcMain.handle('run:compose', async (_e, raw: unknown) => {
    const parsed = briefTopicSchema.safeParse(raw)
    if (!parsed.success) return { ok: false, error: '参数非法' }
    const topicId = resolveTopic(parsed.data)
    if (!topicId) return { ok: false, error: '还没有主题' }
    const handle = beginRun({ kind: 'compose', topicId })
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
        degraded: out.degraded,
        noChange: out.noChange,
        linkGood: out.linkCheck.good,
        linkTotal: out.linkCheck.total
      }
    } catch (e) {
      if (e instanceof RunCancelledError) return { ok: false, error: '已取消' }
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    } finally {
      endRun(handle)
    }
  })

  ipcMain.handle('run:cancel', () => ({ ok: true, cancelled: cancelRun() }))

  ipcMain.handle('run:status', () => {
    const meta = currentRun()
    return meta ? { running: true, ...meta } : { running: false }
  })

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

  ipcMain.handle('chat:ensureItem', (_e, raw: unknown) => {
    const parsed = chatEnsureItemSchema.safeParse(raw)
    if (!parsed.success) return null
    const deps = chatDeps()
    const thread = ensureItemThread(requireStore(), {
      ...parsed.data,
      model: parsed.data.model ?? defaultChatModel(deps)
    })
    if (!thread) return null
    return { ...thread, contextTokens: 0, briefStale: false }
  })

  ipcMain.handle('chat:ensureEvent', (_e, raw: unknown) => {
    const parsed = chatEnsureEventSchema.safeParse(raw)
    if (!parsed.success) return null
    const deps = chatDeps()
    const thread = ensureEventThread(requireStore(), {
      ...parsed.data,
      model: parsed.data.model ?? defaultChatModel(deps)
    })
    if (!thread) return null
    return { ...thread, contextTokens: 0, briefStale: false }
  })

  ipcMain.handle('stories:needsReview', () => {
    const s = requireStore()
    const list = storiesToReview(s)
    // 弹过就记一笔，冷却期内不再重复问
    for (const story of list) markStoryPrompted(s, story.id)
    return list
  })

  ipcMain.handle('stories:timeline', (_e, raw: unknown) => {
    const parsed = z.object({ id: z.string().min(1).max(80) }).safeParse(raw)
    if (!parsed.success) return null
    const store = requireStore()
    const story = store.stories.get(parsed.data.id)
    if (!story?.threadId) return null
    for (const m of [...store.chat.messages(story.threadId)].reverse()) {
      if (!m.contextJson) continue
      try {
        const ctx = JSON.parse(m.contextJson) as { timeline?: unknown }
        if (ctx.timeline) {
          return { timeline: ctx.timeline, storyId: story.id, tracking: story.status === 'active' }
        }
      } catch {
        /* 忽略坏消息 */
      }
    }
    return null
  })

  ipcMain.handle('stories:setStatus', (_e, raw: unknown) => {
    const parsed = z.object({ id: z.string().min(1).max(80), status: storyStatusSchema }).safeParse(raw)
    if (!parsed.success) return null
    return setStoryStatus(requireStore(), parsed.data.id, parsed.data.status) ?? null
  })

  ipcMain.handle('stories:list', () => {
    const store = requireStore()
    return store.stories.list().map((story) => {
      // 时间线节点数从评论串最后一条 timeline 消息里取；没生成过就是 0
      let nodeCount = 0
      let latestEvent: { title: string; date: string } | undefined
      if (story.threadId) {
        for (const m of [...store.chat.messages(story.threadId)].reverse()) {
          if (!m.contextJson) continue
          try {
            const ctx = JSON.parse(m.contextJson) as { timeline?: { phases?: unknown[] } }
            if (Array.isArray(ctx.timeline?.phases)) {
              nodeCount = ctx.timeline.phases.length
              const last = ctx.timeline.phases.at(-1) as { headline?: unknown; date?: unknown } | undefined
              if (typeof last?.headline === 'string') {
                latestEvent = {
                  title: last.headline,
                  date: typeof last.date === 'string' ? last.date : ''
                }
              }
              break
            }
          } catch {
            /* 忽略坏消息 */
          }
        }
      }
      return {
        ...story,
        itemCount: store.stories.itemIds(story.id).length,
        nodeCount,
        latest: store.stories.latestItem(story.id),
        ...(latestEvent ? { latestEvent } : {})
      }
    })
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

  ipcMain.handle('export:richtext', async (_e, raw: unknown) => {
    const parsed = z
      .object({ html: z.string().min(1).max(2_000_000), text: z.string().max(2_000_000) })
      .safeParse(raw)
    if (!parsed.success) return { ok: false, error: '参数非法' }
    await copyBriefRichText(parsed.data.html, parsed.data.text)
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

  // ── 视频解读：指定博主 + 最近 12 条 + 手动选一期 ──────────────
  const videoCreatorSchema = z.object({ input: z.string().min(1).max(300) })
  const videoGenerateSchema = z.object({
    creatorId: z.string().min(1).max(100),
    videoId: z.string().min(5).max(30),
    title: z.string().min(1).max(500),
    url: z.string().url().max(500),
    publishedAt: z.number().optional()
  })

  ipcMain.handle('videos:creators', () => requireStore().videos.listCreators())

  ipcMain.handle('videos:addCreator', async (_e, raw: unknown) => {
    const parsed = videoCreatorSchema.safeParse(raw)
    if (!parsed.success) return { ok: false, error: '请输入博主地址' }
    try {
      const { creator, videos } = await fetchCreator(parsed.data.input)
      const now = Date.now()
      const existing = requireStore().videos.getCreator(creator.channelId)
      const record = {
        id: creator.channelId,
        channelId: creator.channelId,
        name: creator.name,
        ...(creator.handle ? { handle: creator.handle } : {}),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now
      }
      requireStore().videos.upsertCreator(record)
      return { ok: true, creator: record, videos }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('videos:removeCreator', (_e, raw: unknown) => {
    const parsed = z.string().min(1).max(100).safeParse(raw)
    if (!parsed.success) return { ok: false, error: '参数非法' }
    requireStore().videos.removeCreator(parsed.data)
    return { ok: true }
  })

  ipcMain.handle('videos:list', async (_e, raw: unknown) => {
    const parsed = z.string().min(1).max(100).safeParse(raw)
    if (!parsed.success) return { ok: false, error: '参数非法' }
    const creator = requireStore().videos.getCreator(parsed.data)
    if (!creator) return { ok: false, error: '博主不存在' }
    try {
      const videos = await fetchCreatorVideos(creator.channelId)
      const reports = new Set(requireStore().videos.listReports(creator.id).map((r) => r.videoId))
      return { ok: true, creator, videos: videos.map((v) => ({ ...v, hasReport: reports.has(v.videoId) })) }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('videos:getReport', (_e, raw: unknown) => {
    const parsed = z.string().min(5).max(30).safeParse(raw)
    if (!parsed.success) return null
    return requireStore().videos.getReport(parsed.data) ?? null
  })

  ipcMain.handle('videos:export', (_e, raw: unknown) => {
    const parsed = z.string().min(5).max(30).safeParse(raw)
    if (!parsed.success) return { ok: false, error: '参数非法' }
    const report = requireStore().videos.getReport(parsed.data)
    if (!report) return { ok: false, error: '还没有生成这期解读' }
    try {
      const dir = join(app.getPath('documents'), 'Meerkat', '视频解读')
      mkdirSync(dir, { recursive: true })
      const safeTitle = report.title.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
      const file = join(dir, `${safeTitle || 'video'}-${report.videoId}.md`)
      writeFileSync(file, `${report.summaryMd}\n\n---\n\n${report.transcriptMd}\n`, 'utf8')
      shell.showItemInFolder(file)
      return { ok: true, path: file }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('videos:generate', async (_e, raw: unknown) => {
    const parsed = videoGenerateSchema.safeParse(raw)
    if (!parsed.success) return { ok: false, error: '参数非法' }
    const store = requireStore()
    const creator = store.videos.getCreator(parsed.data.creatorId)
    if (!creator) return { ok: false, error: '博主不存在' }
    const cached = store.videos.getReport(parsed.data.videoId)
    if (cached) return { ok: true, report: cached }

    const keys: ProviderKeys = {}
    for (const p of availableProviders()) keys[p.id] = p.key
    const target = composeTarget(keys, readModelOverrides(store))
    if (!target) return { ok: false, error: '还没有配置模型。先到设置 → 模型与密钥配置 DeepSeek 或 OpenAI。' }
    const provider = createProviderInstance(target.provider, target.key)
    if (!provider) return { ok: false, error: '模型供应商不可用' }

    try {
      const transcript = await fetchVideoTranscript(parsed.data.videoId)
      const meta = {
        title: parsed.data.title,
        creatorName: creator.name,
        videoId: parsed.data.videoId,
        url: parsed.data.url,
        ...(parsed.data.publishedAt !== undefined ? { publishedAt: parsed.data.publishedAt } : {}),
        durationSec: transcript.durationSec,
        ...(transcript.language ? { language: transcript.language } : {})
      }
      const { summary } = await summarizeVideo(provider, target.model, meta, transcript.paragraphs)
      const transcriptMd = transcriptToMarkdown({
        title: meta.title,
        creatorName: creator.name,
        videoId: meta.videoId,
        ...(meta.publishedAt !== undefined ? { publishedAt: meta.publishedAt } : {}),
        language: transcript.language,
        paragraphs: transcript.paragraphs
      })
      const summaryMd = renderVideoSummary(summary, meta)
      const now = Date.now()
      const report = {
        id: `video-${parsed.data.videoId}`,
        creatorId: creator.id,
        videoId: parsed.data.videoId,
        title: meta.title,
        url: meta.url,
        ...(meta.publishedAt !== undefined ? { publishedAt: meta.publishedAt } : {}),
        durationSec: transcript.durationSec,
        ...(transcript.language ? { language: transcript.language } : {}),
        transcriptMd,
        summaryMd,
        model: target.model,
        createdAt: now,
        updatedAt: now
      }
      store.videos.saveReport(report)
      return { ok: true, report }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('videos:removeReport', (_e, raw: unknown) => {
    const parsed = z.string().min(5).max(30).safeParse(raw)
    if (!parsed.success) return { ok: false, error: '参数非法' }
    requireStore().videos.removeReport(parsed.data)
    return { ok: true }
  })

  // ── 决策笔记：把「看过」变成「判断过」 ──────────────────────
  const decisionSaveSchema = z.object({
    itemId: z.string().min(1).max(200),
    note: z.string().trim().min(1).max(2000),
    verifyAt: z.number().optional()
  })

  ipcMain.handle('decisions:get', (_e, raw: unknown) => {
    const parsed = z.string().min(1).max(200).safeParse(raw)
    if (!parsed.success) return null
    return requireStore().decisions.get(parsed.data) ?? null
  })

  ipcMain.handle('decisions:list', (_e, raw: unknown) => {
    const parsed = z.array(z.string().min(1).max(200)).max(500).safeParse(raw)
    if (!parsed.success) return []
    return requireStore().decisions.listByIds(parsed.data)
  })

  ipcMain.handle('decisions:recent', (_e, raw: unknown) => {
    const parsed = z.object({ days: z.number().int().min(1).max(30).optional() }).safeParse(raw ?? {})
    if (!parsed.success) return []
    const days = parsed.data.days ?? 7
    const store = requireStore()
    const since = Date.now() - days * 86_400_000
    const sources = new Map(store.sources.list().map((s) => [s.id, s.name]))
    return store.decisions.recent(since).map((d) => {
      const item = store.items.get(d.itemId)
      return {
        ...d,
        ...(item
          ? {
              title: item.title,
              url: item.url,
              sourceName: sources.get(item.sourceId) ?? item.sourceId,
              ...(item.publishedAt !== undefined ? { publishedAt: item.publishedAt } : {})
            }
          : {})
      }
    })
  })

  ipcMain.handle('decisions:save', (_e, raw: unknown) => {
    const parsed = decisionSaveSchema.safeParse(raw)
    if (!parsed.success) return { ok: false, error: '参数非法' }
    const store = requireStore()
    if (!store.items.get(parsed.data.itemId)) return { ok: false, error: '条目不存在' }
    const existing = store.decisions.get(parsed.data.itemId)
    const now = Date.now()
    const decision = {
      itemId: parsed.data.itemId,
      note: parsed.data.note,
      ...(parsed.data.verifyAt !== undefined ? { verifyAt: parsed.data.verifyAt } : {}),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    }
    store.decisions.upsert(decision)
    return { ok: true, decision }
  })

  ipcMain.handle('decisions:remove', (_e, raw: unknown) => {
    const parsed = z.string().min(1).max(200).safeParse(raw)
    if (!parsed.success) return { ok: false, error: '参数非法' }
    requireStore().decisions.remove(parsed.data)
    return { ok: true }
  })

  // ── 推送：每日简报 -> 飞书/Slack/Discord webhook ────────────
  const pushConfigSchema = z.object({
    enabled: z.boolean(),
    webhookUrl: z.string().max(2000),
    platform: z.enum(['feishu', 'slack', 'discord', 'generic'])
  })

  ipcMain.handle('push:get', () => readPushState(requireStore()))

  ipcMain.handle('push:set', (_e, raw: unknown) => {
    const parsed = pushConfigSchema.safeParse(raw)
    if (!parsed.success) return { ok: false, error: '参数非法' }
    if (parsed.data.enabled && !isValidWebhook(parsed.data.webhookUrl)) {
      return { ok: false, error: '请填写 http(s) webhook 地址' }
    }
    savePushConfig(requireStore(), parsed.data)
    return { ok: true }
  })

  ipcMain.handle('push:test', async () => {
    const store = requireStore()
    const config = readPushConfig(store)
    if (!config.webhookUrl) return { ok: false, error: '还没有配置 webhook' }
    const text = `Meerkat 推送测试 · ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}\n连通性正常，今天的简报会在完成后送到这里。`
    const result = await sendPush(config, text)
    store.settings.set('push.lastAt', Date.now())
    store.settings.set('push.lastError', result.ok ? '' : (result.error ?? '推送失败'))
    return result
  })

  ipcMain.handle('push:detect', (_e, raw: unknown) => {
    const parsed = z.string().max(2000).safeParse(raw)
    if (!parsed.success) return { platform: 'generic' as PushPlatform }
    return { platform: detectPlatform(parsed.data) }
  })

  // 供内部/测试：生成一条预览文本，不发送
  ipcMain.handle('push:preview', (_e, raw: unknown) => {
    const parsed = z.object({ topicName: z.string(), date: z.string(), markdown: z.string(), noChange: z.boolean() }).safeParse(raw)
    if (!parsed.success) return ''
    return buildPushText(parsed.data.topicName, parsed.data.date, parsed.data.markdown, parsed.data.noChange)
  })

  // ── 邮件摘要：SMTP 配置与测试发送 ───────────────────────────
  const emailConfigSchema = z.object({
    enabled: z.boolean(),
    host: z.string().max(255),
    port: z.number().int(),
    secure: z.boolean(),
    user: z.string().max(255),
    from: z.string().max(255),
    to: z.string().max(255)
  })

  ipcMain.handle('email:get', () => readEmailState(requireStore()))

  ipcMain.handle('email:set', (_e, raw: unknown) => {
    const parsed = emailConfigSchema.extend({ password: z.string().max(500).optional() }).safeParse(raw)
    if (!parsed.success) return { ok: false, error: '参数非法' }
    const { password, ...config } = parsed.data
    const store = requireStore()
    const willHavePassword = Boolean(password?.trim()) || readEmailState(store).hasPassword
    const check = validateEmailConfig(config as EmailConfig, willHavePassword)
    if (!check.ok) return check
    if (password?.trim()) {
      const saved = setSmtpPassword(password)
      if (!saved.ok) return saved
    }
    saveEmailConfig(store, config as EmailConfig)
    return { ok: true }
  })

  ipcMain.handle('email:test', async () => {
    const store = requireStore()
    const config = readEmailConfig(store)
    const check = validateEmailConfig(config, Boolean(getSmtpPassword()))
    if (!check.ok) return check
    const text = `Meerkat 邮件测试 · ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}\n连通性正常，今天的简报会在完成后送到这里。`
    const result = await sendEmail(config, getSmtpPassword(), {
      subject: 'Meerkat 邮件测试',
      text
    })
    store.settings.set('email.lastAt', Date.now())
    store.settings.set('email.lastError', result.ok ? '' : (result.error ?? '邮件发送失败'))
    return result
  })

  // ── 手机阅读：局域网一次性分享 ──────────────────────────────
  ipcMain.handle('share:start', async (_e, raw: unknown) => {
    const parsed = z.object({ title: z.string().max(500), html: z.string().min(1).max(5_000_000) }).safeParse(raw)
    if (!parsed.success) return { ok: false, error: '参数非法' }
    return startShare(parsed.data)
  })

  ipcMain.handle('share:stop', () => {
    stopShare()
    return { ok: true }
  })

  // ── 实体记忆：公司/人物与内容的倒排 ──────────────────────────
  const timelineFor = (id: string) => {
    const store = requireStore()
    const sources = new Map(store.sources.list().map((s) => [s.id, s.name]))
    return store.entities
      .itemIds(id)
      .slice(0, 1000)
      .map((itemId) => store.items.get(itemId))
      .filter((x): x is NonNullable<typeof x> => Boolean(x))
      .map((i) => {
        const at = i.publishedAt ?? i.fetchedAt
        return {
          id: i.id,
          title: i.title,
          url: i.url,
          summary: i.summary,
          at,
          sourceName: sources.get(i.sourceId) ?? i.sourceId,
          event: classifyEntityEvent(i.title, i.summary)
        }
      })
  }

  const clustersFor = (entityId: string) => {
    const store = requireStore()
    const timeline = timelineFor(entityId)
    const manual = store.manualEvents.list(entityId)
    const claimed = new Set(manual.flatMap((m) => m.itemIds))
    const auto = buildEntityEventClusters(entityId, timeline.filter((i) => !claimed.has(i.id)))
      .filter((c) => c.event !== 'other')
      .map((c) => ({ ...c, manual: false }))
    const manualClusters = manual
      .map((m) => {
        const items = timeline.filter((i) => m.itemIds.includes(i.id))
        if (items.length === 0) return null
        const sources = new Set(items.map((i) => i.sourceName))
        return {
          key: `manual:${m.id}`,
          title: m.title,
          event: (m.event as EntityEvent) ?? 'other',
          items,
          sourceCount: sources.size,
          latestAt: items[0]!.at,
          earliestAt: items[items.length - 1]!.at,
          manual: true
        }
      })
      .filter((c): c is NonNullable<typeof c> => Boolean(c))
    return [...manualClusters, ...auto].sort((a, b) => b.items.length - a.items.length || b.latestAt - a.latestAt)
  }

  ipcMain.handle('entities:list', () => {
    const store = requireStore()
    const counts = new Map(store.entities.counts().map((c) => [c.entityId, c]))
    return store.entities
      .list()
      .map((e) => ({
        ...e,
        count: counts.get(e.id)?.count ?? 0,
        latestAt: counts.get(e.id)?.latestAt ?? 0
      }))
      .sort((a, b) => b.count - a.count || b.latestAt - a.latestAt || a.name.localeCompare(b.name))
  })

  ipcMain.handle('entities:items', (_e, raw: unknown) => {
    const parsed = z.object({ id: z.string().min(1).max(100), limit: z.number().int().min(1).max(200).optional() }).safeParse(raw)
    if (!parsed.success) return []
    const store = requireStore()
    const sources = new Map(store.sources.list().map((s) => [s.id, s.name]))
    return store.entities
      .itemIds(parsed.data.id)
      .slice(0, parsed.data.limit ?? 80)
      .map((id) => store.items.get(id))
      .filter((x): x is NonNullable<typeof x> => Boolean(x))
      .map((i) => ({
        id: i.id,
        title: i.title,
        url: i.url,
        summary: i.summary,
        ...(i.publishedAt !== undefined ? { publishedAt: i.publishedAt } : {}),
        sourceName: sources.get(i.sourceId) ?? i.sourceId
      }))
  })

  ipcMain.handle('entities:rebuild', () => {
    const store = requireStore()
    const n = rebuildEntityIndex(store)
    return { ok: true, linked: n }
  })

  ipcMain.handle('entities:timeline', (_e, raw: unknown) => {
    const parsed = z.object({ id: z.string().min(1).max(100), limit: z.number().int().min(1).max(300).optional() }).safeParse(raw)
    if (!parsed.success) return { items: [], period: entityPeriods([]) }
    const mapped = timelineFor(parsed.data.id)
    return {
      items: mapped.slice(0, parsed.data.limit ?? 120),
      period: entityPeriods(mapped)
    }
  })

  ipcMain.handle('entities:create', (_e, raw: unknown) => {
    const parsed = z
      .object({ name: z.string().min(1).max(80), kind: z.enum(['company', 'person', 'org', 'technology']), aliases: z.array(z.string().max(80)).max(30) })
      .safeParse(raw)
    if (!parsed.success) return { ok: false, error: '参数非法' }
    return createEntity(requireStore(), parsed.data)
  })

  ipcMain.handle('entities:update', (_e, raw: unknown) => {
    const parsed = z
      .object({
        id: z.string().min(1).max(100),
        name: z.string().min(1).max(80),
        kind: z.enum(['company', 'person', 'org', 'technology']),
        aliases: z.array(z.string().max(80)).max(30)
      })
      .safeParse(raw)
    if (!parsed.success) return { ok: false, error: '参数非法' }
    return updateEntity(requireStore(), parsed.data.id, parsed.data)
  })

  ipcMain.handle('entities:remove', (_e, raw: unknown) => {
    const parsed = z.string().min(1).max(100).safeParse(raw)
    if (!parsed.success) return { ok: false, error: '参数非法' }
    const store = requireStore()
    if (!store.entities.get(parsed.data)) return { ok: false, error: '实体不存在' }
    for (const m of store.manualEvents.list(parsed.data)) store.manualEvents.remove(m.id)
    store.entities.remove(parsed.data)
    return { ok: true }
  })

  // ── 事件页：由实体 + 事件类型 + 3 天窗口聚合 ────────────────
  ipcMain.handle('events:list', (_e, raw: unknown) => {
    const parsed = z.object({ entityId: z.string().min(1).max(100) }).safeParse(raw)
    if (!parsed.success) return []
    return clustersFor(parsed.data.entityId)
  })

  ipcMain.handle('events:get', (_e, raw: unknown) => {
    const parsed = z.object({ entityId: z.string().min(1).max(100), key: z.string().min(1).max(200) }).safeParse(raw)
    if (!parsed.success) return null
    const store = requireStore()
    const cluster = clustersFor(parsed.data.entityId).find((c) => c.key === parsed.data.key)
    if (!cluster) return null
    const ids = cluster.items.map((i) => i.id)
    return {
      ...cluster,
      decisions: store.decisions.listByIds(ids),
      note: store.eventNotes.get(cluster.key) ?? null
    }
  })

  ipcMain.handle('events:merge', (_e, raw: unknown) => {
    const parsed = z.object({ entityId: z.string().min(1).max(100), keys: z.array(z.string().min(1).max(200)).min(2).max(20) }).safeParse(raw)
    if (!parsed.success) return { ok: false, error: '至少选择两个事件' }
    const store = requireStore()
    const all = clustersFor(parsed.data.entityId)
    const chosen = parsed.data.keys.map((k) => all.find((c) => c.key === k)).filter((c): c is NonNullable<typeof c> => Boolean(c))
    if (chosen.length < 2) return { ok: false, error: '事件不存在或已被修改' }
    const itemIds = [...new Set(chosen.flatMap((c) => c.items.map((i) => i.id)))]
    const removedManual = parsed.data.keys
      .filter((k) => k.startsWith('manual:'))
      .map((k) => store.manualEvents.get(k.slice('manual:'.length)))
      .filter((x): x is NonNullable<typeof x> => Boolean(x))
    for (const key of parsed.data.keys) {
      if (key.startsWith('manual:')) store.manualEvents.remove(key.slice('manual:'.length))
    }
    const now = Date.now()
    const id = `me-${now}-${Math.random().toString(36).slice(2, 8)}`
    store.manualEvents.upsert({
      id,
      entityId: parsed.data.entityId,
      title: chosen[0]!.title,
      event: chosen[0]!.event,
      itemIds,
      createdAt: now,
      updatedAt: now
    })
    const history = store.settings.get<
      Array<{
        id: string
        entityId: string
        title: string
        newEventId: string
        removed: Array<{ id: string; entityId: string; title: string; event: string; itemIds: string[]; createdAt: number; updatedAt: number }>
        at: number
      }>
    >('events.mergeHistory') ?? []
    history.unshift({
      id: `mh-${now}-${Math.random().toString(36).slice(2, 8)}`,
      entityId: parsed.data.entityId,
      title: chosen[0]!.title,
      newEventId: id,
      removed: removedManual,
      at: now
    })
    store.settings.set('events.mergeHistory', history.slice(0, 20))
    return { ok: true, key: `manual:${id}` }
  })

  ipcMain.handle('events:mergeHistory', () => {
    const history = requireStore().settings.get<
      Array<{ id: string; entityId: string; title: string; newEventId: string; at: number }>
    >('events.mergeHistory') ?? []
    return history.map((h) => ({ id: h.id, entityId: h.entityId, title: h.title, newEventId: h.newEventId, at: h.at }))
  })

  ipcMain.handle('events:undoMerge', () => {
    const store = requireStore()
    const history = store.settings.get<
      Array<{
        id: string
        entityId: string
        title: string
        newEventId: string
        removed: Array<{ id: string; entityId: string; title: string; event: string; itemIds: string[]; createdAt: number; updatedAt: number }>
        at: number
      }>
    >('events.mergeHistory') ?? []
    if (history.length === 0) return { ok: false, error: '没有可撤销的合并' }
    const snapshot = history[0]!
    store.manualEvents.remove(snapshot.newEventId)
    for (const m of snapshot.removed) store.manualEvents.upsert(m)
    store.settings.set('events.mergeHistory', history.slice(1))
    return { ok: true }
  })

  ipcMain.handle('events:split', (_e, raw: unknown) => {
    const parsed = z
      .object({
        entityId: z.string().min(1).max(100),
        key: z.string().min(1).max(200),
        itemIds: z.array(z.string().min(1).max(100)).min(1).max(500),
        title: z.string().max(200).optional()
      })
      .safeParse(raw)
    if (!parsed.success) return { ok: false, error: '参数非法' }
    const store = requireStore()
    const cluster = clustersFor(parsed.data.entityId).find((c) => c.key === parsed.data.key)
    if (!cluster) return { ok: false, error: '事件不存在' }
    const selected = cluster.items.filter((i) => parsed.data.itemIds.includes(i.id))
    if (selected.length === 0) return { ok: false, error: '没有选中事件里的内容' }
    const selectedIds = new Set(selected.map((i) => i.id))
    const now = Date.now()

    if (parsed.data.key.startsWith('manual:')) {
      const oldId = parsed.data.key.slice('manual:'.length)
      const old = store.manualEvents.get(oldId)
      if (old) {
        const remaining = old.itemIds.filter((id) => !selectedIds.has(id))
        if (remaining.length === 0) store.manualEvents.remove(oldId)
        else store.manualEvents.upsert({ ...old, itemIds: remaining, updatedAt: now })
      }
    }

    const id = `me-${now}-${Math.random().toString(36).slice(2, 8)}`
    store.manualEvents.upsert({
      id,
      entityId: parsed.data.entityId,
      title: parsed.data.title?.trim() || selected[0]!.title,
      event: cluster.event,
      itemIds: [...selectedIds],
      createdAt: now,
      updatedAt: now
    })
    return { ok: true, key: `manual:${id}` }
  })

  ipcMain.handle('events:deleteManual', (_e, raw: unknown) => {
    const parsed = z.string().min(1).max(200).safeParse(raw)
    if (!parsed.success || !parsed.data.startsWith('manual:')) return { ok: false, error: '不是手动事件' }
    requireStore().manualEvents.remove(parsed.data.slice('manual:'.length))
    return { ok: true }
  })

  ipcMain.handle('events:toStory', (_e, raw: unknown) => {
    const parsed = z
      .object({ entityId: z.string().min(1).max(100), key: z.string().min(1).max(200), topicId: z.string().min(1).max(80).optional() })
      .safeParse(raw)
    if (!parsed.success) return { ok: false, error: '参数非法' }
    const store = requireStore()
    const cluster = clustersFor(parsed.data.entityId).find((c) => c.key === parsed.data.key)
    if (!cluster || cluster.items.length === 0) return { ok: false, error: '事件不存在' }
    const entity = store.entities.get(parsed.data.entityId)
    const topic = parsed.data.topicId ? store.topics.get(parsed.data.topicId) : store.topics.list()[0]
    if (!topic) return { ok: false, error: '没有可用的主题' }
    const now = Date.now()
    const aliases = cleanAliases([
      ...(entity?.aliases ?? []),
      ...extractKeywords(cluster.title)
    ]).slice(0, 12)
    const story: Story = {
      id: `st-${now}-${Math.random().toString(36).slice(2, 8)}`,
      title: cluster.title.slice(0, 60),
      query: cluster.title,
      aliases: aliases.length > 0 ? aliases : [cluster.title.slice(0, 12)],
      topicId: topic.id,
      itemId: cluster.items[0]!.id,
      status: 'active',
      missCount: 0,
      createdAt: now,
      updatedAt: now
    }
    store.stories.create(story)
    store.stories.addItems(story.id, cluster.items.map((i) => i.id), now)
    store.stories.update(story.id, { lastMatchAt: now, updatedAt: now })
    return { ok: true, storyId: story.id, title: story.title }
  })

  ipcMain.handle('events:noteSave', (_e, raw: unknown) => {
    const parsed = z
      .object({
        eventKey: z.string().min(1).max(200),
        note: z.string().trim().min(1).max(2000),
        entityId: z.string().max(100).optional(),
        title: z.string().max(300).optional(),
        eventType: z.string().max(30).optional(),
        latestAt: z.number().optional()
      })
      .safeParse(raw)
    if (!parsed.success) return { ok: false, error: '参数非法' }
    const store = requireStore()
    const old = store.eventNotes.get(parsed.data.eventKey)
    const now = Date.now()
    const note = {
      eventKey: parsed.data.eventKey,
      note: parsed.data.note,
      ...(parsed.data.entityId ? { entityId: parsed.data.entityId } : old?.entityId ? { entityId: old.entityId } : {}),
      ...(parsed.data.title ? { title: parsed.data.title } : old?.title ? { title: old.title } : {}),
      ...(parsed.data.eventType ? { eventType: parsed.data.eventType } : old?.eventType ? { eventType: old.eventType } : {}),
      latestAt: parsed.data.latestAt ?? old?.latestAt ?? now,
      createdAt: old?.createdAt ?? now,
      updatedAt: now
    }
    store.eventNotes.upsert(note)
    return { ok: true, note }
  })

  ipcMain.handle('events:noteRemove', (_e, raw: unknown) => {
    const parsed = z.string().min(1).max(200).safeParse(raw)
    if (!parsed.success) return { ok: false, error: '参数非法' }
    requireStore().eventNotes.remove(parsed.data)
    return { ok: true }
  })

  ipcMain.handle('events:notesRecent', (_e, raw: unknown) => {
    const parsed = z.object({ days: z.number().int().min(1).max(90).optional() }).safeParse(raw ?? {})
    if (!parsed.success) return []
    return requireStore().eventNotes.recent(Date.now() - (parsed.data.days ?? 7) * 86_400_000)
  })

  // ── 账号：Supabase Auth（主进程持有 session） ──────────────
  ipcMain.handle('auth:status', () => authStatus(requireStore()))
  ipcMain.handle('auth:config', () => readAuthConfig(requireStore()))
  ipcMain.handle('auth:setConfig', (_e, raw: unknown) => {
    const parsed = z.object({ url: z.string().max(500), key: z.string().max(2000) }).safeParse(raw)
    if (!parsed.success) return { ok: false, error: '参数非法' }
    return saveAuthConfig(requireStore(), parsed.data.url, parsed.data.key)
  })
  ipcMain.handle('auth:signUp', (_e, raw: unknown) => {
    const parsed = z.object({ email: z.string().max(300), password: z.string().min(1).max(200) }).safeParse(raw)
    if (!parsed.success) return { ok: false, error: '参数非法' }
    return signUpEmail(requireStore(), parsed.data.email, parsed.data.password)
  })
  ipcMain.handle('auth:signIn', (_e, raw: unknown) => {
    const parsed = z.object({ email: z.string().max(300), password: z.string().min(1).max(200) }).safeParse(raw)
    if (!parsed.success) return { ok: false, error: '参数非法' }
    return signInEmail(requireStore(), parsed.data.email, parsed.data.password)
  })
  ipcMain.handle('auth:github', () => signInGithub(requireStore()))
  ipcMain.handle('auth:signOut', () => signOut(requireStore()))

  // ── Claim → source 语义归因（模型只在候选 URL 里选） ─────────
  ipcMain.handle('claims:semanticBind', async (_e, raw: unknown) => {
    const parsed = z
      .object({
        claims: z
          .array(
            z.object({
              id: z.string().min(1).max(200),
              text: z.string().min(1).max(2000),
              candidates: z.array(z.object({ name: z.string().max(200), url: z.string().url() })).max(8)
            })
          )
          .max(100)
      })
      .safeParse(raw)
    if (!parsed.success) return { ok: false, error: '参数非法' }
    const keys: ProviderKeys = {}
    for (const p of availableProviders()) keys[p.id] = p.key
    const target = composeTarget(keys, readModelOverrides(requireStore()))
    if (!target) return { ok: false, error: '还没有配置模型' }
    const provider = createProviderInstance(target.provider, target.key)
    if (!provider) return { ok: false, error: '模型供应商不可用' }
    try {
      const result = await semanticBindClaims(provider, target.model, parsed.data.claims as SemanticClaim[])
      return result
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
}
