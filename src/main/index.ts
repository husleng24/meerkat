import { app, BrowserWindow, Menu, screen, shell } from 'electron'
import { join } from 'node:path'
import { closeStore, dailyDeps, initStore, registerIpc } from './ipc'
import { Scheduler } from './scheduler'
import { runDaily } from './daily'
import { installCrashHandlers, log } from './log'
import { runElectronSelfCheck } from './selfcheck'
import { apply as applyAutoLaunch } from './autolaunch'

const isDev = !app.isPackaged

// Windows 上必须显式设置 AppUserModelID，否则 toast 通知不可用
// （打包版由快捷方式带上，开发态/便携版必须自己设）
if (process.platform === 'win32') app.setAppUserModelId('com.meerkat.daily')

let mainWindow: BrowserWindow | null = null
let scheduler: Scheduler | null = null
let quitting = false

/**
 * 深链：`Meerkat.exe --route=search/Gemini` 直接打开某个页面。
 * 返回**不带 #** 的 hash 片段——`loadFile` 的 hash 选项自己会加 #，
 * 多带一个会变成 `##settings`，路由就认不出来了。（踩过）
 */
function routeHash(): string {
  const arg = process.argv.find((a) => a.startsWith('--route='))
  if (!arg) return ''
  return arg.slice('--route='.length).replace(/^#+/, '')
}

function showWindow(): void {  if (!mainWindow) {
    createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function createWindow(): void {
  // 按可用工作区收敛窗口尺寸：实测 175% 缩放的笔记本上逻辑分辨率只有 ~1045×653，
  // 直接开 1180 宽会超出屏幕，内容被挤压、空状态溢出右边界。
  const work = screen.getPrimaryDisplay().workAreaSize
  const width = Math.max(820, Math.min(1180, work.width - 80))
  const height = Math.max(560, Math.min(820, work.height - 60))

  mainWindow = new BrowserWindow({
    width,
    height,
    minWidth: 720,
    minHeight: 520,
    show: false,
    backgroundColor: '#F6F1E7',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  // 外链一律走系统浏览器，不在应用内开新窗口
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  // 关窗 = 收进托盘，而不是退出。这是"无人值守"的前提
  mainWindow.on('close', (e) => {
    if (quitting) return
    e.preventDefault()
    mainWindow?.hide()
  })

  const hash = routeHash()
  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'] + (hash ? `#${hash}` : ''))
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'), hash ? { hash } : {})
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

/**
 * 自检模式：`Meerkat --verify`
 * 不开窗口、不进 Chromium 初始化，只验证数据层与资源。
 * 这样"应用能不能工作"和"窗口能不能显示"可以分开诊断——
 * 前者出问题是我能修的，后者出问题才需要真机排查。
 */
function runVerifyMode(): void {
  const { checks, ok, reportPath } = runElectronSelfCheck()
  for (const c of checks) console.log(`${c.ok ? '[ OK ]' : '[FAIL]'} ${c.name} — ${c.detail}`)
  console.log(`\n${ok ? '全部通过' : '存在失败项'}｜报告：${reportPath}`)
  app.exit(ok ? 0 : 1)
}

if (process.argv.includes('--verify')) {
  runVerifyMode()
} else {
  // 单实例：第二次启动只唤起已有窗口
  const gotLock = app.requestSingleInstanceLock()
  if (!gotLock) {
    app.quit()
  } else {
    app.on('second-instance', () => showWindow())

    // 默认菜单（File/Edit/View…）对这个应用没有意义，去掉
    Menu.setApplicationMenu(null)

    installCrashHandlers()
    log('info', `启动 Meerkat ${app.getVersion()} / Electron ${process.versions.electron}`)

    void app.whenReady().then(() => {
      // 数据库放在 userData 下，卸载重装不会误删用户数据
      const store = initStore(join(app.getPath('userData'), 'meerkat.db'))
      registerIpc()

      createWindow()

      scheduler = new Scheduler({
        store,
        runOnce: (topicId, signal) =>
          runDaily(store, dailyDeps(), { topicId, ...(signal ? { signal } : {}) }),
        getWindow: () => mainWindow,
        showWindow
      })
      scheduler.start()
      log('info', '托盘与定时任务已启动')

      // 开机自启：默认开启，让「每天自动」在重启后依然成立
      const al = applyAutoLaunch(store)
      log(
        'info',
        al.supported
          ? `开机自启 ${al.enabled ? '已启用' : '未启用'}`
          : `开机自启不可用：${al.reason ?? '未知原因'}`
      )

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow()
        else showWindow()
      })
    })

    // 托盘常驻：关掉所有窗口也不退出（macOS 本来就这样，Windows 需要显式处理）
    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin' && quitting) app.quit()
    })

    app.on('before-quit', () => {
      log('info', '应用退出')
      quitting = true
      scheduler?.stop()
      closeStore()
    })
  }
}
