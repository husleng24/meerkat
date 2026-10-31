/**
 * 极简文件日志。
 *
 * 为什么不引 winston/pino：只需要"能事后看到发生了什么"，
 * 多一个依赖就多一个打包风险（本项目已经在这上面踩过原生模块的坑）。
 *
 * 三个硬要求：
 *  1. 写日志本身绝不抛异常（否则错误处理会把应用搞崩）
 *  2. 单文件超过 2MB 就轮转，只留两份（不无限增长）
 *  3. 崩溃时能把栈写下去，而且能读到日志尾部做诊断包
 */
import { app } from 'electron'
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'

const MAX_BYTES = 2 * 1024 * 1024

let logDir = ''
let logFile = ''

function ensureDir(): string {
  if (logDir) return logDir
  try {
    logDir = join(app.getPath('userData'), 'logs')
    mkdirSync(logDir, { recursive: true })
    logFile = join(logDir, 'main.log')
  } catch {
    logDir = ''
  }
  return logDir
}

function rotateIfNeeded(): void {
  try {
    if (!existsSync(logFile)) return
    if (statSync(logFile).size < MAX_BYTES) return
    const bak = join(logDir, 'main.1.log')
    if (existsSync(bak)) {
      // 直接覆盖旧备份：只保留最近两代
      try {
        renameSync(logFile, bak)
      } catch {
        // 备份失败就继续写原文件，不阻塞
      }
    } else {
      renameSync(logFile, bak)
    }
  } catch {
    // 轮转失败不影响写日志
  }
}

export type LogLevel = 'info' | 'warn' | 'error'

export function log(level: LogLevel, message: string): void {
  const line = `${new Date().toISOString()} [${level}] ${message}\n`
  try {
    if (!ensureDir()) return
    rotateIfNeeded()
    appendFileSync(logFile, line, 'utf8')
  } catch {
    // 绝对不能因为写日志把应用搞崩
  }
  if (level === 'error') console.error(message)
}

export function readLogTail(maxLines = 300): string[] {
  try {
    if (!ensureDir() || !existsSync(logFile)) return []
    const text = readFileSync(logFile, 'utf8')
    const lines = text.split('\n').filter((l) => l.length > 0)
    return lines.slice(-maxLines)
  } catch {
    return []
  }
}

export function logPath(): string {
  ensureDir()
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
