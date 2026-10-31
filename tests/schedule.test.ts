import { describe, it, expect } from 'vitest'
import {
  CATCH_UP_HOURS,
  DEFAULT_SCHEDULE,
  decideDue,
  describeNext,
  describeSchedule,
  isValidSchedule,
  lastOccurrence,
  nextOccurrence,
  occurrenceOn,
  type ScheduleConfig
} from '../src/app/schedule'

/** 本地时间构造，避免测试依赖时区偏移 */
const at = (y: number, m: number, d: number, hh = 0, mm = 0): number =>
  new Date(y, m - 1, d, hh, mm, 0, 0).getTime()

const cfg = (hour: number, minute: number, enabled = true): ScheduleConfig => ({ enabled, hour, minute })
const H = 3_600_000

describe('isValidSchedule', () => {
  it('接受边界值', () => {
    expect(isValidSchedule(cfg(0, 0))).toBe(true)
    expect(isValidSchedule(cfg(23, 59))).toBe(true)
  })
  it('拒绝越界与非整数', () => {
    expect(isValidSchedule(cfg(24, 0))).toBe(false)
    expect(isValidSchedule(cfg(8, 60))).toBe(false)
    expect(isValidSchedule(cfg(8.5, 0))).toBe(false)
  })
})

describe('occurrenceOn / nextOccurrence / lastOccurrence', () => {
  it('当天触发点', () => {
    expect(occurrenceOn(at(2026, 10, 30, 12), cfg(8, 30))).toBe(at(2026, 10, 30, 8, 30))
  })

  it('00:00 触发点属于当天零点，不跨日', () => {
    const now = at(2026, 10, 30, 15)
    expect(occurrenceOn(now, cfg(0, 0))).toBe(at(2026, 10, 30, 0, 0))
  })

  it('nextOccurrence 在到点前返回当天，到点后返回次日', () => {
    expect(nextOccurrence(at(2026, 10, 30, 7), cfg(8, 30))).toBe(at(2026, 10, 30, 8, 30))
    expect(nextOccurrence(at(2026, 10, 30, 9), cfg(8, 30))).toBe(at(2026, 10, 31, 8, 30))
  })

  it('恰好等于触发点时，下一个是次日（严格晚于）', () => {
    expect(nextOccurrence(at(2026, 10, 30, 8, 30), cfg(8, 30))).toBe(at(2026, 10, 31, 8, 30))
  })

  it('跨月与跨年', () => {
    expect(nextOccurrence(at(2026, 10, 31, 12), cfg(8, 30))).toBe(at(2026, 11, 1, 8, 30))
    expect(nextOccurrence(at(2026, 12, 31, 12), cfg(8, 30))).toBe(at(2027, 1, 1, 8, 30))
  })

  it('lastOccurrence 在到点前返回昨天', () => {
    expect(lastOccurrence(at(2026, 10, 30, 7), cfg(8, 30))).toBe(at(2026, 10, 29, 8, 30))
    expect(lastOccurrence(at(2026, 10, 30, 9), cfg(8, 30))).toBe(at(2026, 10, 30, 8, 30))
  })
})

describe('decideDue', () => {
  it('关闭时不触发', () => {
    const d = decideDue(undefined, at(2026, 10, 30, 9), cfg(8, 30, false))
    expect(d.due).toBe(false)
    expect(d.reason).toBe('disabled')
  })

  it('从未跑过且在窗口内 → 立即跑（never-run）', () => {
    const d = decideDue(undefined, at(2026, 10, 30, 9), cfg(8, 30))
    expect(d).toMatchObject({ due: true, reason: 'never-run' })
    expect(d.slot).toBe(at(2026, 10, 30, 8, 30))
  })

  it('从未跑过但已过补跑窗口 → 等下一个点（too-late）', () => {
    const now = at(2026, 10, 30, 8, 30) + (CATCH_UP_HOURS + 1) * H
    const d = decideDue(undefined, now, cfg(8, 30))
    expect(d).toMatchObject({ due: false, reason: 'too-late' })
  })

  it('今天已跑过 → 不重复触发（already-ran）', () => {
    const d = decideDue(at(2026, 10, 30, 8, 31), at(2026, 10, 30, 9), cfg(8, 30))
    expect(d).toMatchObject({ due: false, reason: 'already-ran' })
  })

  it('到点且昨天跑过 → 正常触发（scheduled）', () => {
    const d = decideDue(at(2026, 10, 29, 8, 31), at(2026, 10, 30, 8, 31), cfg(8, 30))
    expect(d).toMatchObject({ due: true, reason: 'scheduled' })
    expect(d.slot).toBe(at(2026, 10, 30, 8, 30))
  })

  it('隔了多天没跑 → 补跑一次（catch-up）', () => {
    const d = decideDue(at(2026, 10, 26, 8, 31), at(2026, 10, 30, 9), cfg(8, 30))
    expect(d).toMatchObject({ due: true, reason: 'catch-up' })
  })

  it('补跑只补最近一个点，不会连补多次', () => {
    const now = at(2026, 10, 30, 9)
    const d = decideDue(at(2026, 10, 26, 8, 31), now, cfg(8, 30))
    // 触发的是"今天 08:30"这一个点，而不是 10/27、10/28、10/29 的
    expect(d.slot).toBe(at(2026, 10, 30, 8, 30))

    // 补跑后再检查，就不该再触发了
    const again = decideDue(d.slot + 1000, now, cfg(8, 30))
    expect(again.due).toBe(false)
  })

  it('错过太久不补跑（too-late）', () => {
    const now = at(2026, 10, 30, 8, 30) + (CATCH_UP_HOURS + 2) * H
    const d = decideDue(at(2026, 10, 26, 8, 31), now, cfg(8, 30))
    expect(d).toMatchObject({ due: false, reason: 'too-late' })
  })

  it('00:00 排程在当天 23:59 已算 too-late（超过 6 小时）', () => {
    const d = decideDue(at(2026, 10, 29, 0, 5), at(2026, 10, 30, 23, 59), cfg(0, 0))
    expect(d.due).toBe(false)
  })
})

describe('文案', () => {
  it('describeSchedule', () => {
    expect(describeSchedule(DEFAULT_SCHEDULE)).toBe('每天 08:30')
    expect(describeSchedule(cfg(0, 5))).toBe('每天 00:05')
    expect(describeSchedule(cfg(8, 30, false))).toBe('已关闭')
  })

  it('describeNext 区分今天/明天', () => {
    expect(describeNext(at(2026, 10, 30, 7), cfg(8, 30))).toBe('今天 08:30')
    expect(describeNext(at(2026, 10, 30, 9), cfg(8, 30))).toBe('明天 08:30')
  })
})
