import { describe, it, expect } from 'vitest'
import {
  buildDiagnostic,
  redact,
  redactPath,
  summarizeDiagnostic,
  type DiagnosticInput
} from '../src/app/diagnostic'
import type { Source } from '../src/core/domain/types'

const HOME = 'C:\\Users\\zhangsan'

function src(over: Partial<Source> = {}): Source {
  return {
    id: 's1',
    name: 'OpenAI',
    kind: 'rss',
    tier: 1,
    bucketHint: 'product',
    enabled: true,
    failStreak: 0,
    lastOkAt: 1,
    ...over
  }
}

function input(over: Partial<DiagnosticInput> = {}): DiagnosticInput {
  return {
    appVersion: '0.0.1',
    electronVersion: '45.1.0',
    chromeVersion: '156.0.0',
    nodeVersion: '24.22.1',
    platform: 'win32',
    arch: 'x64',
    dbPath: `${HOME}\\AppData\\Roaming\\Meerkat\\meerkat.db`,
    schemaVersion: 1,
    homeDir: HOME,
    userDataDir: `${HOME}\\AppData\\Roaming\\Meerkat`,
    schedule: { enabled: true, hour: 8, minute: 30 },
    lastRunAt: Date.parse('2026-10-30T00:30:00Z'),
    model: 'deepseek-flash',
    runs: [
      { startedAt: Date.parse('2026-10-30T00:30:00Z'), finishedAt: Date.parse('2026-10-30T00:30:31Z'), nSources: 35, nRaw: 170, nKept: 80 },
      { startedAt: Date.parse('2026-10-29T00:30:00Z'), finishedAt: Date.parse('2026-10-29T00:30:40Z'), nSources: 35, nRaw: 0, nKept: 0, errors: 'Reddit: HTTP 429' }
    ],
    sources: [src(), src({ id: 's2', name: 'Reddit', failStreak: 4, lastError: 'HTTP 429 https://www.reddit.com/r/x/.rss' }), src({ id: 's3', name: 'BAIR', failStreak: 1 })],
    logTail: ['[info] start', '[error] failed with sk-abcdef1234567890'],
    now: Date.parse('2026-10-30T01:00:00Z'),
    ...over
  }
}

describe('redact：密钥绝不外泄', () => {
  it('sk- 开头的密钥被打掉', () => {
    const out = redact('调用失败 key=sk-abcdef1234567890xyz tail')
    expect(out).not.toContain('sk-abcdef1234567890xyz')
    expect(out).toContain('REDACTED')
  })

  it('Bearer token 被打掉但保留前缀', () => {
    const out = redact('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9abc')
    expect(out).not.toContain('eyJhbGciOiJIUzI1NiJ9abc')
    expect(out).toContain('Bearer')
  })

  it('api_key/token/secret/password 形式都被打掉', () => {
    for (const s of ['api_key=abcd1234efgh', 'token: "abcd1234efgh"', 'secret=abcd1234efgh', 'password: abcd1234efgh']) {
      const out = redact(`配置 ${s} 结束`)
      expect(out, s).not.toContain('abcd1234efgh')
    }
  })

  it('邮箱被打码', () => {
    expect(redact('联系 zhangsan@example.com')).toBe('联系 ***@***')
  })

  it('长十六进制串被打码（可能是 token 或哈希）', () => {
    expect(redact('id=deadbeefdeadbeefdeadbeefdeadbeef')).toContain('***HASH***')
  })

  it('普通文本不受影响', () => {
    const s = '抓取 35 个源，成功 34 个，耗时 30.6s'
    expect(redact(s)).toBe(s)
  })
})

describe('redactPath：不暴露用户名', () => {
  it('主目录被替换成 ~', () => {
    expect(redactPath(`${HOME}\\AppData\\Meerkat\\meerkat.db`, HOME)).toBe('~/AppData/Meerkat/meerkat.db')
  })

  it('主目录之外保持原样', () => {
    expect(redactPath('D:\\data\\meerkat.db', HOME)).toBe('D:\\data\\meerkat.db')
  })

  it('大小写不敏感', () => {
    expect(redactPath('c:\\users\\ZhangSan\\x.db', HOME)).toBe('~/x.db')
  })

  it('homeDir 为空时不崩', () => {
    expect(redactPath('C:\\a\\b', '')).toBe('C:\\a\\b')
  })
})

describe('buildDiagnostic', () => {
  const b = buildDiagnostic(input())

  it('路径已脱敏，不含用户名', () => {
    expect(b.db.path).not.toContain('zhangsan')
    expect(b.db.path).toContain('~')
  })

  it('日志尾部已脱敏', () => {
    const joined = b.logTail.join('\n')
    expect(joined).not.toContain('sk-abcdef1234567890')
  })

  it('源健康度分类正确', () => {
    expect(b.sources).toMatchObject({ total: 3, ok: 1, degraded: 1, failing: 1 })
    expect(b.sources.failing_list[0]!.name).toBe('Reddit')
  })

  it('排程被格式化成 HH:mm', () => {
    expect(b.schedule['at']).toBe('08:30')
    expect(b.schedule['enabled']).toBe(true)
  })

  it('run 时长被算出来，缺失结束时间时为 null', () => {
    expect(b.runs[0]!['durationMs']).toBe(31_000)
    const open = buildDiagnostic(
      input({ runs: [{ startedAt: 1000, nSources: 1, nRaw: 0, nKept: 0 }] })
    )
    expect(open.runs[0]!['durationMs']).toBeNull()
  })

  it('run 的 errors 字段也脱敏', () => {
    const withSecret = buildDiagnostic(
      input({ runs: [{ startedAt: 1, nSources: 1, nRaw: 0, nKept: 0, errors: 'token=abcd1234efgh' }] })
    )
    expect(JSON.stringify(withSecret)).not.toContain('abcd1234efgh')
  })

  it('整个包里搜不到任何密钥形态', () => {
    const withSecrets = buildDiagnostic(
      input({ logTail: ['sk-zzzzzzzzzzzzzzzzzzzz', 'Authorization: Bearer abcdefghijklmnop'] })
    )
    const text = JSON.stringify(withSecrets)
    expect(text).not.toMatch(/sk-[A-Za-z0-9]{8,}/)
    expect(text).not.toContain('abcdefghijklmnop')
  })

  it('可 JSON 序列化（能被写成文件）', () => {
    expect(() => JSON.stringify(b)).not.toThrow()
  })
})

describe('summarizeDiagnostic', () => {
  it('第一屏就能看出问题在哪', () => {
    const s = summarizeDiagnostic(buildDiagnostic(input()))
    expect(s).toContain('版本 0.0.1')
    expect(s).toContain('正常 1')
    expect(s).toContain('失效源：Reddit')
  })
})
