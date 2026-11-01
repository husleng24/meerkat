/**
 * 托盘常驻 + 定时采集 + 完成通知。
 *
 * 这是"不用管它"的核心：窗口关掉不等于退出，应用留在托盘里，
 * 每天到点自己跑一遍，跑完弹一条通知。
 */
import { BrowserWindow, Menu, Notification, Tray, app, nativeImage, shell } from 'electron'
import { log } from './log'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { decideDue, describeNext, describeSchedule, type ScheduleConfig } from '../app/schedule'
import { brandPath } from './paths'
import type { Store } from '../core/ports/store'
import type { Topic } from '../core/domain/types'
import { beginRun, cancelRun, endRun, isRunning } from './run-control'
import type { DailyOutcome } from './daily'

const CHECK_INTERVAL_MS = 60_000
const LAST_RUN_KEY = 'schedule.lastRunAt'

export interface SchedulerDeps {
  store: Store
  /** 跑一个主题的采集 + 简报；返回值用于日志与通知文案 */
  runOnce: (topicId: string, signal?: AbortSignal) => Promise<DailyOutcome>
  getWindow: () => BrowserWindow | null
  showWindow: () => void
}

/** 每个主题的排程就存在自己那一行上，不再是全局设置 */
export function readSchedule(store: Store, topicId: string): ScheduleConfig {
  const topic = store.topics.get(topicId)
  if (!topic) return { enabled: false, hour: 8, minute: 30 }
  return { enabled: topic.enabled, hour: topic.hour, minute: topic.minute }
}

export function writeSchedule(store: Store, topicId: string, cfg: ScheduleConfig): void {
  const topic = store.topics.get(topicId)
  if (!topic) return
  store.topics.upsert({ ...topic, ...cfg, updatedAt: Date.now() })
}

/** 上次运行时间也按主题记：两个主题各自 08:30 互不影响 */
export function lastRunKey(topicId: string): string {
  return `${LAST_RUN_KEY}.${topicId}`
}

/**
 * 托盘图标：优先取 16px 专用字形，而不是把 32px 缩下来。
 * 主标在 16px 会糊成一块，`icon-meerkat-head-16.png` 是为这一档单独画的（见 BRAND.md）。
 */
function trayImage(): Electron.NativeImage {
  const candidates = ['icon-meerkat-head-16.png', 'icon-meerkat-head-32.png', 'icon-meerkat-32.png']
  for (const name of candidates) {
    const p = brandPath(name)
    if (!existsSync(p)) {
      log('warn', `托盘图标候选不存在：${name}`)
      continue
    }
    const img = nativeImage.createFromPath(p)
    if (img.isEmpty()) {
      // 静默返回空图会让托盘变成一个看不见的空位，事后极难排查
      log('warn', `托盘图标解码为空：${p}`)
      continue
    }
    const size = img.getSize()
    log('info', `托盘图标使用 ${name}（${size.width}x${size.height}）`)
    return img.resize({ width: 16, height: 16 })
  }
  log('error', '托盘图标：所有候选都不可用，托盘会是一个空位')
  return nativeImage.createEmpty()
}

export class Scheduler {
  private timer: NodeJS.Timeout | null = null
  private tray: Tray | null = null
  private lastSummary = '尚未运行'

  constructor(private deps: SchedulerDeps) {}

  start(): void {
    this.createTray()
    this.timer = setInterval(() => void this.tick(), CHECK_INTERVAL_MS)
    // 启动时先查一次：处理"关机错过了时间点"的情况
    void this.tick()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.tray?.destroy()
    this.tray = null
  }

  /** 当前到点、该跑的主题。多个主题可能同时到点，按顺序跑 */
  private dueTopics(now: number): Array<{ topic: Topic; reason: string }> {
    const out: Array<{ topic: Topic; reason: string }> = []
    for (const topic of this.deps.store.topics.list()) {
      if (!topic.enabled) continue
      const cfg = readSchedule(this.deps.store, topic.id)
      const lastRunAt = this.deps.store.settings.get<number>(lastRunKey(topic.id))
      const decision = decideDue(lastRunAt, now, cfg)
      if (decision.due) out.push({ topic, reason: decision.reason })
    }
    return out
  }

  private async tick(): Promise<void> {
    if (isRunning()) return
    const due = this.dueTopics(Date.now())
    this.refreshTray(due.length > 0 ? '准备运行…' : this.lastSummary)
    if (due.length === 0) return

    const handle = beginRun()
    if (!handle) return
    try {
      for (const { topic, reason } of due) {
        if (handle.controller.signal.aborted) break
        log('info', `定时触发（${topic.name} · ${reason}）`)
        await this.runTopic(topic, handle.controller.signal)
      }
    } finally {
      endRun(handle)
      this.refreshTray(this.lastSummary)
    }
  }

  private async runTopic(topic: Topic, signal?: AbortSignal): Promise<void> {
    try {
      const out = await this.deps.runOnce(topic.id, signal)
      this.deps.store.settings.set(lastRunKey(topic.id), Date.now())
      this.deps.store.settings.set(LAST_RUN_KEY, Date.now())
      this.lastSummary = `${topic.name} · ${out.degraded ? '已降级' : '已完成'} · ${out.collect.nKept} 条`
      log(
        'info',
        `定时任务完成（${topic.name}）：${out.collect.nOk}/${out.collect.nSources} 源 · 入库 ${out.collect.nKept} 条 · ` +
          `去重丢弃 ${out.droppedAsBriefed} · 标记已推送 ${out.markedBriefed} · 落库 ${out.save.reason} · ` +
          `链接 ${out.linkCheck.good}/${out.linkCheck.total}`
      )
      this.notify(out.title, out.degraded)
      this.deps.getWindow()?.webContents.send('brief:updated')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (e instanceof Error && e.name === 'RunCancelledError') {
        this.lastSummary = `${topic.name} · 已取消`
        log('info', `已取消（${topic.name}）`)
        return
      }
      this.lastSummary = `${topic.name} 失败：${msg}`
      log('error', `定时任务失败（${topic.name}）: ${msg}`)
      this.notify('采集失败', false, `${msg}。可在「源」页查看详情。`)
    }
  }

  private notify(title: string, degraded: boolean, body?: string): void {
    if (!Notification.isSupported()) return
    const n = new Notification({
      title: degraded ? `${title}（未接模型）` : title,
      body: body ?? this.lastSummary,
      silent: false
    })
    n.on('click', () => this.deps.showWindow())
    n.show()
  }

  private createTray(): void {
    if (this.tray) return
    const img = trayImage()
    this.tray = new Tray(img)
    this.tray.setToolTip('Meerkat · 替你盯着')
    // 记下托盘图标的实际位置：非零说明它真的进了通知区，而不只是对象创建成功
    try {
      const b = this.tray.getBounds()
      const supported = Notification.isSupported()
      log('info', `托盘图标已创建 bounds=${b.x},${b.y},${b.width}x${b.height}｜通知可用=${supported}`)
    } catch (e) {
      log('warn', '托盘图标创建异常: ' + (e instanceof Error ? e.message : String(e)))
    }
    this.tray.on('click', () => this.deps.showWindow())
    // 通知区布局是异步的，稍后再看一次真实位置
    setTimeout(() => {
      try {
        const b2 = this.tray?.getBounds()
        if (b2) {
          log('info', `托盘图标 3 秒后 bounds=${b2.x},${b2.y},${b2.width}x${b2.height}`)
        }
      } catch {
        /* 忽略 */
      }
    }, 3000)
    this.refreshTray(this.lastSummary)
  }

  private refreshTray(status: string): void {
    if (!this.tray) return
    const now = Date.now()
    const topics = this.deps.store.topics.list().filter((t) => t.enabled)
    const scheduleLines = topics.map((t) => {
      const cfg = readSchedule(this.deps.store, t.id)
      return { label: `${t.name}：${describeSchedule(cfg)} · 下次 ${describeNext(now, cfg)}`, enabled: false }
    })
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: status, enabled: false },
        { type: 'separator' },
        ...(scheduleLines.length > 0 ? scheduleLines : [{ label: '排程：未启用任何主题', enabled: false }]),
        { type: 'separator' },
        { label: '打开简报', click: () => this.deps.showWindow() },
        isRunning()
          ? { label: '取消当前运行', click: () => this.cancelCurrent() }
          : { label: '立即采集', click: () => void this.runNow() },
        { type: 'separator' },
        { label: '导出今日简报', click: () => this.exportLatest() },
        { type: 'separator' },
        { label: '退出', click: () => app.quit() }
      ])
    )
  }

  /**
   * 托盘「导出今日简报」。
   *
   * 早期实现是往渲染层发事件，但渲染层从没监听那个事件——一个点了没反应的死按钮。
   * 现在直接在主进程执行：不依赖窗口是否打开、是否可见。
   */
  private exportLatest(): void {
    const b = this.deps.store.briefs.latest()
    if (!b) {
      this.lastSummary = '还没有简报可导出'
      this.refreshTray(this.lastSummary)
      this.notify('还没有简报', false, '先在设置页点一次「立即采集」')
      return
    }
    try {
      const p = exportBrief(b.markdown, b.date)
      this.lastSummary = `已导出 ${b.date}`
      this.refreshTray(this.lastSummary)
      this.notify('已导出今日简报', false, p)
    } catch (e) {
      this.lastSummary = '导出失败'
      this.refreshTray(this.lastSummary)
      this.notify('导出失败', false, e instanceof Error ? e.message : String(e))
    }
  }

  /** 托盘"立即采集"：不带主题就跑全部启用的主题 */
  async runNow(topicId?: string): Promise<void> {
    if (isRunning()) return
    const handle = beginRun()
    if (!handle) return
    try {
      const topics = topicId
        ? [this.deps.store.topics.get(topicId)].filter((t): t is Topic => t !== undefined)
        : this.deps.store.topics.list().filter((t) => t.enabled)
      for (const topic of topics) {
        if (handle.controller.signal.aborted) break
        const out = await this.deps.runOnce(topic.id, handle.controller.signal)
        this.deps.store.settings.set(lastRunKey(topic.id), Date.now())
        this.deps.store.settings.set(LAST_RUN_KEY, Date.now())
        this.lastSummary = `${topic.name} · 手动 · ${out.collect.nKept} 条`
        this.notify(out.title, out.degraded)
      }
      this.deps.getWindow()?.webContents.send('brief:updated')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      this.lastSummary = e instanceof Error && e.name === 'RunCancelledError' ? '手动 · 已取消' : `手动失败：${msg}`
      if (e instanceof Error && e.name !== 'RunCancelledError') log('error', `手动运行失败: ${msg}`)
    } finally {
      endRun(handle)
      this.refreshTray(this.lastSummary)
    }
  }

  /** 托盘/界面共用：取消正在进行的那一轮 */
  cancelCurrent(): boolean {
    const cancelled = cancelRun()
    if (cancelled) this.lastSummary = '取消中…'
    this.refreshTray(this.lastSummary)
    return cancelled
  }
}

/** 导出：写到 用户文档/Meerkat/，并在系统文件管理器里定位 */
export function exportBrief(markdown: string, dateLabel: string): string {
  const dir = join(app.getPath('documents'), 'Meerkat')
  const { mkdirSync, writeFileSync } = require('node:fs') as typeof import('node:fs')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `AI简报-${dateLabel}.md`)
  writeFileSync(file, markdown, 'utf8')
  shell.showItemInFolder(file)
  return file
}
