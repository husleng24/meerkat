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
import type { DailyOutcome } from './daily'

const CHECK_INTERVAL_MS = 60_000
const LAST_RUN_KEY = 'schedule.lastRunAt'
const SCHEDULE_KEY = 'schedule.config'

export interface SchedulerDeps {
  store: Store
  /** 跑一次采集 + 生成简报；返回值用于日志与通知文案 */
  runOnce: () => Promise<DailyOutcome>
  getWindow: () => BrowserWindow | null
  showWindow: () => void
}

export function readSchedule(store: Store): ScheduleConfig {
  const saved = store.settings.get<ScheduleConfig>(SCHEDULE_KEY)
  return saved ?? { enabled: true, hour: 8, minute: 30 }
}

export function writeSchedule(store: Store, cfg: ScheduleConfig): void {
  store.settings.set(SCHEDULE_KEY, cfg)
}

/** 托盘图标：≤32px 必须用头部剪影，全身图在这个尺寸下认不出（见 BRAND.md） */
function trayImage(): Electron.NativeImage {
  const candidates = ['icon-meerkat-head-32.png', 'icon-meerkat-head-16.png', 'icon-meerkat-32.png']
  for (const name of candidates) {
    const p = brandPath(name)
    if (existsSync(p)) {
      const img = nativeImage.createFromPath(p)
      return img.resize({ width: 16, height: 16 })
    }
  }
  return nativeImage.createEmpty()
}

export class Scheduler {
  private timer: NodeJS.Timeout | null = null
  private tray: Tray | null = null
  private running = false
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

  private async tick(): Promise<void> {
    if (this.running) return
    const cfg = readSchedule(this.deps.store)
    const lastRunAt = this.deps.store.settings.get<number>(LAST_RUN_KEY)
    const decision = decideDue(lastRunAt, Date.now(), cfg)
    this.refreshTray(decision.due ? '准备运行…' : this.lastSummary)

    if (!decision.due) return

    this.running = true
    log('info', `定时触发（${decision.reason}）`)
    try {
      const out = await this.deps.runOnce()
      this.deps.store.settings.set(LAST_RUN_KEY, Date.now())
      this.lastSummary = `${out.degraded ? '已降级' : '已完成'} · ${out.collect.nKept} 条`
      log(
        'info',
        `定时任务完成：${out.collect.nOk}/${out.collect.nSources} 源 · 入库 ${out.collect.nKept} 条 · ` +
          `去重丢弃 ${out.droppedAsBriefed} · 标记已推送 ${out.markedBriefed} · 落库 ${out.save.reason} · ` +
          `链接 ${out.linkCheck.good}/${out.linkCheck.total}`
      )
      this.notify(out.title, out.degraded)
      this.refreshTray(this.lastSummary)
      // 通知界面刷新
      this.deps.getWindow()?.webContents.send('brief:updated')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      this.lastSummary = `失败：${msg}`
      log('error', `定时任务失败: ${msg}`)
      this.refreshTray(this.lastSummary)
      this.notify('采集失败', false, `${msg}。可在「源」页查看详情。`)
    } finally {
      this.running = false
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
    const cfg = readSchedule(this.deps.store)
    const next = describeNext(Date.now(), cfg)
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: status, enabled: false },
        { type: 'separator' },
        { label: `排程：${describeSchedule(cfg)}`, enabled: false },
        { label: `下次：${next}`, enabled: false },
        { type: 'separator' },
        { label: '打开简报', click: () => this.deps.showWindow() },
        { label: '立即采集', click: () => void this.runNow() },
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

  /** 托盘"立即采集"：无论是否到点都跑一次 */
  async runNow(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      const out = await this.deps.runOnce()
      this.deps.store.settings.set(LAST_RUN_KEY, Date.now())
      this.lastSummary = `手动 · ${out.collect.nKept} 条`
      this.notify(out.title, out.degraded)
      this.deps.getWindow()?.webContents.send('brief:updated')
    } finally {
      this.running = false
      this.refreshTray(this.lastSummary)
    }
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
