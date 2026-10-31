/**
 * 日期解析：兼容 RSS 的 RFC822、Atom 的 ISO8601、以及 "Oct 18, 2026" 这类写法。
 * 与 radar.py::parse_date 等价（Python 用 email.utils + fromisoformat + strptime 三段）。
 */
export function parseDateLoose(input: string | undefined | null): number | undefined {
  if (!input) return undefined
  const s = input.trim()
  if (!s) return undefined

  // RFC822（RSS pubDate）与 ISO8601 都由 Date.parse 覆盖
  const direct = Date.parse(s)
  if (Number.isFinite(direct)) return direct

  // "Oct 18, 2026" 之类：V8 通常能解析，兜底手动映射月份
  const m = /^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/.exec(s)
  if (m) {
    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
    const idx = months.indexOf(m[1]!.slice(0, 3).toLowerCase())
    if (idx >= 0) return Date.UTC(Number(m[3]), idx, Number(m[2]))
  }
  return undefined
}

const REL_UNITS: Record<string, number> = {
  second: 1 / 3600,
  minute: 1 / 60,
  hour: 1,
  day: 24,
  week: 168,
  month: 720,
  year: 8760
}

const UNIT_TOKENS: Record<string, string> = {
  s: 'second', sec: 'second', secs: 'second', second: 'second', seconds: 'second',
  m: 'minute', min: 'minute', mins: 'minute', minute: 'minute', minutes: 'minute',
  h: 'hour', hr: 'hour', hrs: 'hour', hour: 'hour', hours: 'hour',
  d: 'day', day: 'day', days: 'day',
  w: 'week', wk: 'week', week: 'week', weeks: 'week',
  mo: 'month', month: 'month', months: 'month',
  y: 'year', yr: 'year', year: 'year', years: 'year'
}

/**
 * YouTube 的相对时间："6h ago" / "2 days ago" / "1 month ago"。
 * 注意 "6h" 里数字与单位之间没有空格，不能用 " h " 这种判断。
 */
export function parseRelAge(input: string, now: number): number | undefined {
  if (!input || !input.toLowerCase().includes('ago')) return undefined
  const m = /(\d+)\s*([a-z]+)/.exec(input.toLowerCase())
  if (!m) return undefined
  const unit = UNIT_TOKENS[m[2]!]
  if (!unit) return undefined
  return now - Number(m[1]) * REL_UNITS[unit]! * 3_600_000
}
