/**
 * 定时排程：纯函数，不碰 Electron、不碰定时器。
 *
 * 这样做的理由很实际：定时逻辑的错误（差一小时、跨夜算错、休眠后重复触发）
 * 在真机上极难复现，但写成纯函数后可以穷举测出来。
 *
 * 三个必须处理好的场景：
 *  1. 正常每分钟检查一次，到点触发
 *  2. 机器休眠/关机错过时间点 → 开机后在补跑窗口内补一次，不要连补多次
 *  3. 时钟回拨/跨时区 → 不做任何"聪明"处理，按本地时间算，避免更奇怪的行为
 */

export interface ScheduleConfig {
  enabled: boolean
  /** 0–23，本地时间 */
  hour: number
  /** 0–59 */
  minute: number
}

/** 错过多久之内还值得补跑。超过就等下一个点，避免开机时突然跑一堆 */
export const CATCH_UP_HOURS = 6

export const DEFAULT_SCHEDULE: ScheduleConfig = { enabled: true, hour: 8, minute: 30 }

export function isValidSchedule(cfg: ScheduleConfig): boolean {
  return (
    Number.isInteger(cfg.hour) &&
    Number.isInteger(cfg.minute) &&
    cfg.hour >= 0 &&
    cfg.hour <= 23 &&
    cfg.minute >= 0 &&
    cfg.minute <= 59
  )
}

/** 某个时刻所在"当天"的 hh:mm（本地时间），可能已经过去也可能还没到 */
export function occurrenceOn(dayMs: number, cfg: ScheduleConfig): number {
  const d = new Date(dayMs)
  d.setHours(cfg.hour, cfg.minute, 0, 0)
  return d.getTime()
}

/** 严格晚于 now 的下一个触发点 */
export function nextOccurrence(now: number, cfg: ScheduleConfig): number {
  const today = occurrenceOn(now, cfg)
  if (today > now) return today
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  return occurrenceOn(tomorrow.getTime(), cfg)
}

/** 不晚于 now 的最近一个触发点 */
export function lastOccurrence(now: number, cfg: ScheduleConfig): number {
  const today = occurrenceOn(now, cfg)
  if (today <= now) return today
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  return occurrenceOn(yesterday.getTime(), cfg)
}

export interface DueDecision {
  due: boolean
  /** 触发的是哪个时间点（用于日志与去重） */
  slot: number
  reason: 'never-run' | 'scheduled' | 'catch-up' | 'already-ran' | 'too-late' | 'disabled'
}

/**
 * 判断此刻是否该跑。
 *
 * @param lastRunAt 上次成功跑的时间戳；undefined 表示从未跑过
 */
export function decideDue(lastRunAt: number | undefined, now: number, cfg: ScheduleConfig): DueDecision {
  if (!cfg.enabled || !isValidSchedule(cfg)) {
    return { due: false, slot: 0, reason: 'disabled' }
  }

  const slot = lastOccurrence(now, cfg)

  if (lastRunAt === undefined) {
    // 从未跑过：只要今天这个点已过且没过补跑窗口就跑，否则等下一个点
    return now - slot <= CATCH_UP_HOURS * 3_600_000
      ? { due: true, slot, reason: 'never-run' }
      : { due: false, slot, reason: 'too-late' }
  }

  if (lastRunAt >= slot) {
    return { due: false, slot, reason: 'already-ran' }
  }

  // 本时间点还没跑过；但离得太远就别追了
  if (now - slot > CATCH_UP_HOURS * 3_600_000) {
    return { due: false, slot, reason: 'too-late' }
  }

  // 上次跑在"昨天的点"之后 → 这是正常到点触发；否则是补跑
  const prevSlot = lastOccurrence(slot - 1000, cfg)
  return lastRunAt >= prevSlot
    ? { due: true, slot, reason: 'scheduled' }
    : { due: true, slot, reason: 'catch-up' }
}

/** 给界面用的人话描述 */
export function describeSchedule(cfg: ScheduleConfig): string {
  if (!cfg.enabled) return '已关闭'
  const hh = String(cfg.hour).padStart(2, '0')
  const mm = String(cfg.minute).padStart(2, '0')
  return `每天 ${hh}:${mm}`
}

/** 下一次触发的相对描述，例如 "今天 08:30" / "明天 08:30" */
export function describeNext(now: number, cfg: ScheduleConfig): string {
  if (!cfg.enabled) return '—'
  const next = nextOccurrence(now, cfg)
  const sameDay = new Date(next).toDateString() === new Date(now).toDateString()
  const hh = String(cfg.hour).padStart(2, '0')
  const mm = String(cfg.minute).padStart(2, '0')
  return `${sameDay ? '今天' : '明天'} ${hh}:${mm}`
}
