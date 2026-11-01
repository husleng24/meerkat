/**
 * 日志文件的命名与保留策略。
 *
 * 单独成文件是为了能测：这部分一旦写错，表现是"日志悄悄丢了"或"磁盘慢慢涨"，
 * 都不会报错，只会在需要排查的那天才发现。
 */

const NAME_RE = /^main-(\d{4})-(\d{2})-(\d{2})(?:\.(\d+))?\.log$/

/** 本地日期（日志按本地天分文件，用户看日志时想的是"上周三"） */
export function dayKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function logFileName(d: Date): string {
  return `main-${dayKey(d)}.log`
}

/** 单日超过 2MB 时的轮转文件：main-2026-11-01.1.log */
export function rotatedFileName(d: Date, index = 1): string {
  return `main-${dayKey(d)}.${index}.log`
}

/** 从文件名解析出日期；不是我们的文件就返回 null（不要误删别的文件） */
export function parseLogDate(file: string): Date | null {
  const m = NAME_RE.exec(file)
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  const date = new Date(y, mo - 1, d)
  // "2026-13-40" 这种能被 Date 正常化成明年，必须按原始字段校验回去
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null
  return date
}

/**
 * 该删哪些文件。
 *
 * @param files 目录里的文件名（不含路径）
 * @param now 当前时间
 * @param keepDays 保留最近多少天（含今天）
 */
export function expiredLogFiles(files: string[], now: Date, keepDays = 7): string[] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const out: string[] = []
  for (const f of files) {
    const d = parseLogDate(f)
    if (!d) continue
    const ageDays = Math.round((today.getTime() - d.getTime()) / 86_400_000)
    if (ageDays >= keepDays) out.push(f)
  }
  return out
}

/** 超过 2MB 就轮转，只留一代备份（同一天内也不无限增长） */
export const MAX_BYTES = 2 * 1024 * 1024

export function shouldRotate(size: number): boolean {
  return size >= MAX_BYTES
}
