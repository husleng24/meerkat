/**
 * 极简文件日志。
 *
 * 为什么不引 winston/pino：只需要"能事后看到发生了什么"，
 * 多一个依赖就多一个打包风险（本项目已经在这上面踩过原生模块的坑）。
 *
 * 三个硬要求：
 *  1. 写日志本身绝不抛异常（否则错误处理会把应用搞崩）
 *  2. 按天分文件、保留 7 天；单日超过 2MB 再轮转一份（不无限增长）
 *  3. 崩溃时能把栈写下去，而且能读到日志尾部做诊断包
 */
import { app } from 'electron'
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { expiredLogFiles, logFileName, rotatedFileName, shouldRotate } from './log-files'

// 没有终端时 stdout/stderr 可能随时 EPIPE；挂个空处理器，避免 uncaughtException。
for (const stream of [process.stdout, process.stderr]) {
  try {
    stream?.on('error', () => {})
  } catch {
    /* 忽略 */
  }
}

/** 保留最近 7 天：排查"上周三那次失败"时还在 */
const KEEP_DAYS = 7

let logDir = ''
/** 当前正在写的文件 */
let logFile = ''
let pruned = false

function ensureDir(): string {
  if (logDir) return logDir
  try {
    logDir = join(app.getPath('userData'), 'logs')
    mkdirSync(logDir, { recursive: true })
    switchToToday()
  } catch {
    logDir = ''
  }
  return logDir
}

/** 跨天时换文件；顺便在每天第一次写入时清理过期日志 */
function switchToToday(): void {
  const now = new Date()
  const name = logFileName(now)
  if (logFile.endsWith(name)) return
  logFile = join(logDir, name)
  if (!pruned) {
    pruned = true
    pruneOld()
  }
}

function pruneOld(): void {
  try {
    const files = readdirSync(logDir)
    for (const f of expiredLogFiles(files, new Date(), KEEP_DAYS)) {
      try {
        unlinkSync(join(logDir, f))
      } catch {
        /* 单个文件删不掉不影响其余 */
      }
    }
    // 旧版本留下的 main.log：新逻辑不读它，不清理就会永远躺在那儿
    const legacy = join(logDir, 'main.log')
    if (existsSync(legacy) && Date.now() - statSync(legacy).mtimeMs > KEEP_DAYS * 86_400_000) {
      try {
        unlinkSync(legacy)
      } catch {
        /* 忽略 */
      }
    }
  } catch {
    // 清理失败不该影响写日志
  }
}

function rotateIfNeeded(): void {
  try {
    if (!existsSync(logFile)) return
    if (!shouldRotate(statSync(logFile).size)) return
    const bak = join(logDir, rotatedFileName(new Date(), 1))
    renameSync(logFile, bak)
  } catch {
    // 轮转失败不影响写日志
  }
}

export type LogLevel = 'info' | 'warn' | 'error'

export function log(level: LogLevel, message: string): void {
  const line = `${new Date().toISOString()} [${level}] ${message}\n`
  try {
    if (!ensureDir()) return
    switchToToday()
    rotateIfNeeded()
    appendFileSync(logFile, line, 'utf8')
  } catch {
    // 绝对不能因为写日志把应用搞崩
  }
  // 从 Finder / .command 启动时 stdout 可能是个已关闭的管道；console.error 会抛 EPIPE。
  // 写日志绝不能反过来把应用搞崩，所以这里必须吞掉。
  if (level === 'error') {
    try {
      console.error(message)
    } catch {
      /* stdout 已关闭 */
    }
  }
}

/**
 * 读日志尾部。先读今天，不够再往前读——跨天后的第一份诊断包
 * 仍然应该看得到昨夜失败的那几行。
 */
export function readLogTail(maxLines = 300): string[] {
  try {
    if (!ensureDir()) return []
    const names = readdirSync(logDir)
      .filter((f) => f.startsWith('main-') && f.endsWith('.log'))
      .sort()
      .reverse()
    const collected: string[] = []
    for (const name of names) {
      if (collected.length >= maxLines) break
      const text = readFileSync(join(logDir, name), 'utf8')
      const lines = text.split('\n').filter((l) => l.length > 0)
      collected.unshift(...lines)
    }
    return collected.slice(-maxLines)
  } catch {
    return []
  }
}

export function logPath(): string {
  ensureDir()
  switchToToday()
  return logFile
}

/** 装全局崩溃钩子。返回卸载函数（测试里用得上） */
export function installCrashHandlers(): () => void {
  const onException = (e: Error): void => {
    log('error', `uncaughtException: ${e.stack ?? e.message}`)
  }
  const onRejection = (reason: unknown): void => {
    const msg = reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)
    log('error', `unhandledRejection: ${msg}`)
  }

  process.on('uncaughtException', onException)
  process.on('unhandledRejection', onRejection)

  app.on('render-process-gone', (_e, _wc, details) => {
    log('error', `render-process-gone: reason=${details.reason} exitCode=${details.exitCode}`)
  })
  app.on('child-process-gone', (_e, details) => {
    log('error', `child-process-gone: type=${details.type} reason=${details.reason}`)
  })

  return () => {
    process.off('uncaughtException', onException)
    process.off('unhandledRejection', onRejection)
  }
}
