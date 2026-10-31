/**
 * 把排程拨到 N 分钟后，用来真机验收"到点自动触发"。
 *
 * 为什么要脚本：这条链路的验证必须等定时器自己走到点，
 * 手改数据库既容易改错 key，也没法在验收记录里复现命令。
 *
 * 运行：
 *   pnpm prep-schedule          # 2 分钟后
 *   pnpm prep-schedule 5        # 5 分钟后
 *   pnpm prep-schedule 2 --db ./data/meerkat.db
 *
 * 应用必须处于运行状态（它每分钟读一次排程）；脚本只写 settings，不负责触发。
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { createStore } from '../src/adapters/store-sqlite/store'
import { writeSchedule } from '../src/main/scheduler'

const LAST_RUN_KEY = 'schedule.lastRunAt'

/** 与 Electron 的 app.getPath('userData') 对齐：应用名来自 package.json 的 name */
function defaultDbPath(): string {
  const appName = 'meerkat'
  if (process.platform === 'win32') {
    const appData = process.env['APPDATA'] ?? join(homedir(), 'AppData', 'Roaming')
    return join(appData, appName, 'meerkat.db')
  }
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', appName, 'meerkat.db')
  }
  const xdg = process.env['XDG_CONFIG_HOME'] ?? join(homedir(), '.config')
  return join(xdg, appName, 'meerkat.db')
}

function argValue(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag)
  return i >= 0 ? argv[i + 1] : undefined
}

const argv = process.argv.slice(2)
const minutes = Number(argv.find((a) => !a.startsWith('-') && a !== argValue(argv, '--db')) ?? '2')
if (!Number.isFinite(minutes) || minutes < 1 || minutes > 720) {
  console.error('分钟数要在 1..720 之间，例如：pnpm prep-schedule 2')
  process.exit(1)
}

const dbPath = argValue(argv, '--db') ?? process.env['MEERKAT_DB'] ?? defaultDbPath()
if (!existsSync(dbPath)) {
  console.error(`找不到数据库：${dbPath}\n先启动一次 Meerkat（它会建库并灌源），或用 --db 指定路径。`)
  process.exit(1)
}

const at = new Date(Date.now() + minutes * 60_000)
const cfg = { enabled: true, hour: at.getHours(), minute: at.getMinutes() }

const store = createStore(dbPath)
writeSchedule(store, cfg)
// 手动清掉上次运行时间：否则"今天这个点已经跑过"会让定时器判定为 already-ran
store.settings.set(LAST_RUN_KEY, 0)
store.close()

const hh = String(cfg.hour).padStart(2, '0')
const mm = String(cfg.minute).padStart(2, '0')
console.log(`排程已设为今天 ${hh}:${mm}（${minutes} 分钟后）`)
console.log(`数据库：${dbPath}`)
console.log('提醒：应用要保持运行，定时器每分钟检查一次；到点后看日志或托盘通知。')
