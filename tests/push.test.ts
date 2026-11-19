import { describe, expect, it } from 'vitest'
import { createMemoryStore } from '../src/adapters/store-sqlite/store'
import {
  buildPushPayload,
  buildPushText,
  detectPlatform,
  deliverBriefPush,
  readPushConfig,
  savePushConfig,
  sendPush
} from '../src/main/push'

describe('推送', () => {
  it('按域名识别平台', () => {
    expect(detectPlatform('https://open.feishu.cn/open-apis/bot/v2/hook/x')).toBe('feishu')
    expect(detectPlatform('https://hooks.slack.com/services/x')).toBe('slack')
    expect(detectPlatform('https://discord.com/api/webhooks/x')).toBe('discord')
    expect(detectPlatform('https://example.com/hook')).toBe('generic')
  })

  it('从简报提取三条速览，不把整期搬进聊天窗口', () => {
    const md = [
      '# 简报',
      '',
      '## 三句话速览',
      '',
      '1. 第一件事',
      '2. 第二件事',
      '3. 第三件事',
      '4. 第四件事',
      '',
      '---',
      '## 正文'
    ].join('\n')
    const text = buildPushText('AI 综合', '2026-11-19', md, false)
    expect(text).toContain('Meerkat · AI 综合 · 2026-11-19')
    expect(text).toContain('· 第一件事')
    expect(text).toContain('· 第三件事')
    expect(text).not.toContain('第四件事')
    expect(text).toContain('打开 Meerkat')
  })

  it('no-change 推送只发一句结论', () => {
    const text = buildPushText('机器人', '2026-11-19', '# x', true)
    expect(text).toContain('今天没有值得改变判断的变化')
    expect(text).not.toContain('三句话')
  })

  it('生成各平台 payload', () => {
    expect(buildPushPayload('feishu', 'hi')).toEqual({ msg_type: 'text', content: { text: 'hi' } })
    expect(buildPushPayload('slack', 'hi')).toEqual({ text: 'hi' })
    expect(buildPushPayload('discord', 'hi')).toEqual({ content: 'hi' })
    expect(buildPushPayload('generic', 'hi')).toEqual({ text: 'hi' })
  })

  it('配置只存本机 settings，非法 URL 直接失败', async () => {
    const store = createMemoryStore()
    expect(readPushConfig(store)).toEqual({ enabled: false, webhookUrl: '', platform: 'generic' })
    savePushConfig(store, { enabled: true, webhookUrl: 'https://open.feishu.cn/x', platform: 'feishu' })
    expect(readPushConfig(store)).toEqual({ enabled: true, webhookUrl: 'https://open.feishu.cn/x', platform: 'feishu' })
    expect(await sendPush({ ...readPushConfig(store), webhookUrl: 'not-a-url' }, 'hi')).toEqual({ ok: false, error: 'Webhook 地址无效' })
    store.close()
  })

  it('未启用时定时推送直接跳过', async () => {
    const store = createMemoryStore()
    expect(await deliverBriefPush(store, 'AI', '2026-11-19', '# x', false)).toEqual({ ok: false, skipped: true })
    store.close()
  })
})
