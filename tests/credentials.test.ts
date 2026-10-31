import { describe, it, expect } from 'vitest'
import { KEY_SOURCE_LABEL, looksLikeDeepSeekKey, maskKey, parseDshCredentials } from '../src/app/credentials'

/** 与真实文件同构的样例（key 为假值） */
const REAL_SHAPE = `version: 1
records:
  client-connection/browser-session:
    kind: grant
    payload:
      version: 1
      secret: cukEIPLgmMkryjDAgPUY2u8osnl7ZyeTKfXFeUQc3Qk
  deepseek-account-platform/default:
    kind: grant
    payload:
      version: 1
      token: n393MAcheusLFXKJgnv4TSDfRW0waIBIeAElUmoqAYEM2XBlZtWZpR/uStYEmWDD
      issuer: https://platform.deepseek.com
refs:
  DEEPSEEK_API_KEY: sk-test0123456789abcdefghijklmn
`

describe('maskKey：保留可辨识前缀，不外泄整串', () => {
  it('保留前 7 位与后 2 位', () => {
    const out = maskKey('sk-test0123456789abcdefghijklmn')
    expect(out.startsWith('sk-test')).toBe(true)
    expect(out.endsWith('mn')).toBe(true)
    expect(out).toContain('***')
    expect(out).not.toContain('0123456789abcdefghijkl')
  })

  it('过短的输入整体打码', () => {
    expect(maskKey('sk-abc')).toBe('***')
    expect(maskKey('')).toBe('***')
  })
})

describe('parseDshCredentials', () => {
  it('从真实结构里取出 refs.DEEPSEEK_API_KEY', () => {
    expect(parseDshCredentials(REAL_SHAPE)).toBe('sk-test0123456789abcdefghijklmn')
  })

  it('兼容带引号的写法', () => {
    expect(parseDshCredentials('refs:\n  DEEPSEEK_API_KEY: "sk-abcdef0123456789abcd"')).toBe(
      'sk-abcdef0123456789abcd'
    )
    expect(parseDshCredentials("refs:\n  DEEPSEEK_API_KEY: 'sk-abcdef0123456789abcd'")).toBe(
      'sk-abcdef0123456789abcd'
    )
  })

  it('不会把 records 里的 token/secret 误当成 API Key', () => {
    const onlyRecords = `records:
  deepseek-account-platform/default:
    payload:
      token: n393MAcheusLFXKJgnv4TSDfRW0waIBIeAElUmoqAYEM2XBlZtWZpR
`
    expect(parseDshCredentials(onlyRecords)).toBeUndefined()
  })

  it('文件不存在或内容为空时返回 undefined', () => {
    expect(parseDshCredentials('')).toBeUndefined()
    expect(parseDshCredentials('version: 1\nrefs:\n')).toBeUndefined()
  })

  it('只匹配 sk- 前缀，不会捞出别的凭据', () => {
    expect(parseDshCredentials('DEEPSEEK_API_KEY: cukEIPLgmMkryjDAgPUY2u8osnl7ZyeT')).toBeUndefined()
  })
})

describe('looksLikeDeepSeekKey', () => {
  it('接受合法形态', () => {
    expect(looksLikeDeepSeekKey('sk-test0123456789abcdefghijklmn')).toBe(true)
  })
  it('拒绝明显不对的输入', () => {
    expect(looksLikeDeepSeekKey('')).toBe(false)
    expect(looksLikeDeepSeekKey('abc')).toBe(false)
    expect(looksLikeDeepSeekKey('sk-short')).toBe(false)
    expect(looksLikeDeepSeekKey('ghp_0123456789abcdefghijklmn')).toBe(false)
  })
  it('容忍首尾空白', () => {
    expect(looksLikeDeepSeekKey('  sk-test0123456789abcdefghijklmn  ')).toBe(true)
  })
})

describe('来源文案', () => {
  it('四种来源都有中文说明', () => {
    for (const k of ['store', 'env', 'dsh-file', 'none'] as const) {
      expect(KEY_SOURCE_LABEL[k].length).toBeGreaterThan(2)
    }
  })
})
