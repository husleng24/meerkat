import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  dayKey,
  expiredLogFiles,
  logFileName,
  parseLogDate,
  rotatedFileName,
  shouldRotate
} from '../src/main/log-files'

// 目录在 beforeAll 里建；vi.mock 的工厂是惰性的，用到 electron 时才求值
let logDir = ''
vi.mock('electron', () => ({ app: { getPath: () => logDir } }))

beforeAll(() => {
  logDir = mkdtempSync(join(tmpdir(), 'meerkat-log-'))
})

afterAll(() => {
  rmSync(logDir, { recursive: true, force: true })
})

describe('日志文件名', () => {
  it('按本地日期命名', () => {
    expect(dayKey(new Date(2026, 10, 1, 23, 59))).toBe('2026-11-01')
    expect(logFileName(new Date(2026, 0, 5))).toBe('main-2026-01-05.log')
    expect(rotatedFileName(new Date(2026, 0, 5))).toBe('main-2026-01-05.1.log')
  })

  it('能解析回来，也能拒绝不属于自己的文件', () => {
    const d = parseLogDate('main-2026-10-20.log')
    expect(d?.getFullYear()).toBe(2026)
    expect(d?.getDate()).toBe(20)
    expect(parseLogDate('main-2026-10-20.1.log')).not.toBeNull()
    expect(parseLogDate('main.log')).toBeNull()
    expect(parseLogDate('notes.txt')).toBeNull()
    expect(parseLogDate('main-2026-13-40.log')).toBeNull()
  })
})

describe('保留策略', () => {
  const now = new Date(2026, 10, 1)

  it('保留最近 7 天（含今天），更早的删掉', () => {
    const files = [
      'main-2026-11-01.log', // 今天
      'main-2026-10-30.log', // 2 天前
      'main-2026-10-26.log', // 6 天前，保留
      'main-2026-10-25.log', // 7 天前，删
      'main-2026-10-01.log' // 一个月前，删
    ]
    expect(expiredLogFiles(files, now).sort()).toEqual(['main-2026-10-01.log', 'main-2026-10-25.log'])
  })

  it('轮转出来的同日备份按同一天算', () => {
    expect(expiredLogFiles(['main-2026-10-25.1.log'], now)).toEqual(['main-2026-10-25.1.log'])
    expect(expiredLogFiles(['main-2026-10-28.1.log'], now)).toEqual([])
  })

  it('不认识的文��不碰', () => {
    expect(expiredLogFiles(['notes.txt', 'main.log', 'main-2026-10-01.log'], now)).toEqual([
      'main-2026-10-01.log'
    ])
  })

  it('2MB 才轮转', () => {
    expect(shouldRotate(1024)).toBe(false)
    expect(shouldRotate(2 * 1024 * 1024)).toBe(true)
  })
})

describe('log() 落盘', () => {
  it('写到当天文件，读尾能读回来', async () => {
    const { log, readLogTail, logPath } = await import('../src/main/log')
    log('info', '第一条')
    log('error', '第二条')

    const name = logFileName(new Date())
    const dir = join(logDir, 'logs')
    expect(readdirSync(dir)).toContain(name)
    expect(logPath()).toContain(name)
    expect(readFileSync(join(dir, name), 'utf8')).toContain('第一条')

    const tail = readLogTail(10)
    expect(tail.some((l) => l.includes('第二条'))).toBe(true)
  })

  it('读尾跨天时会接着读前一天', async () => {
    const { readLogTail } = await import('../src/main/log')
    // 造一个昨天的文件（不用改系统时间：直接按真实昨天命名）
    const y = new Date()
    y.setDate(y.getDate() - 1)
    const name = logFileName(y)
    writeFileSync(join(logDir, 'logs', name), '2026-10-31T00:00:00.000Z [error] 昨天失败\n', 'utf8')

    const tail = readLogTail(5)
    expect(tail.some((l) => l.includes('昨天失败'))).toBe(true)
  })
})
