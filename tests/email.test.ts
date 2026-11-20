import { describe, expect, it, vi } from 'vitest'

// email-secret 会 import electron；Node 测试环境里必须 mock，否则模块加载会挂住
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/meerkat-email-test' },
  safeStorage: { isEncryptionAvailable: () => false }
}))
import { createMemoryStore } from '../src/adapters/store-sqlite/store'
import {
  buildEmailMessage,
  deliverBriefEmail,
  readEmailConfig,
  saveEmailConfig,
  sendEmail,
  validateEmailConfig
} from '../src/main/email'

const base = {
  enabled: true,
  host: 'smtp.example.com',
  port: 587,
  secure: false,
  user: 'me@example.com',
  from: '',
  to: 'to@example.com'
}

describe('邮件摘要', () => {
  it('校验主机、端口、收件人和密码', () => {
    expect(validateEmailConfig(base, true)).toEqual({ ok: true })
    expect(validateEmailConfig({ ...base, host: '' }, true).ok).toBe(false)
    expect(validateEmailConfig({ ...base, port: 0 }, true).ok).toBe(false)
    expect(validateEmailConfig({ ...base, to: 'bad' }, true).ok).toBe(false)
    expect(validateEmailConfig(base, false).error).toContain('密码')
  })

  it('邮件主题区分有无变化', () => {
    expect(buildEmailMessage('AI 综合', '2026-11-19', '## 三句话速览\n1. 一条', false).subject).toContain('简报')
    expect(buildEmailMessage('AI 综合', '2026-11-19', '', true).subject).toContain('无变化')
    expect(buildEmailMessage('AI 综合', '2026-11-19', '', true).text).toContain('今天没有值得改变判断的变化')
  })

  it('配置存本机 settings，未启用时定时发送直接跳过', async () => {
    const store = createMemoryStore()
    expect(readEmailConfig(store)).toMatchObject({ enabled: false, port: 587 })
    saveEmailConfig(store, base)
    expect(readEmailConfig(store)).toMatchObject({ host: 'smtp.example.com', to: 'to@example.com' })
    const disabled = { ...base, enabled: false }
    saveEmailConfig(store, disabled)
    expect(await deliverBriefEmail(store, 'AI', '2026-11-19', '# x', false)).toEqual({ ok: false, skipped: true })
    store.close()
  })

  it('非法收件人不进入 SMTP', async () => {
    expect(await sendEmail({ ...base, to: 'bad' }, '', { subject: 'x', text: 'x' })).toEqual({
      ok: false,
      error: '收件人邮箱格式不对'
    })
  })
})
