/**
 * 每日摘要的外部交付：先做 webhook，不引入邮件服务器/账号体系。
 *
 * 飞书、Slack、Discord 都是「一个 URL + 一个 JSON POST」；把它放在 main ，
 * 密钥只留在本机 SQLite。这里不碰抓取/成稿，只负责把已经落库的简报送出去。
 */
import type { Store } from '../core/ports/store'

export type PushPlatform = 'feishu' | 'slack' | 'discord' | 'generic'

export interface PushConfig {
  enabled: boolean
  webhookUrl: string
  platform: PushPlatform
}

export interface PushState extends PushConfig {
  lastAt?: number
  lastError?: string
}

const ENABLED_KEY = 'push.enabled'
const URL_KEY = 'push.webhookUrl'
const PLATFORM_KEY = 'push.platform'
const LAST_AT_KEY = 'push.lastAt'
const LAST_ERROR_KEY = 'push.lastError'

const PLATFORMS: PushPlatform[] = ['feishu', 'slack', 'discord', 'generic']

export function detectPlatform(url: string): PushPlatform {
  const host = (() => {
    try {
      return new URL(url).hostname.toLowerCase()
    } catch {
      return ''
    }
  })()
  if (host.includes('feishu.cn') || host.includes('larksuite.com')) return 'feishu'
  if (host === 'hooks.slack.com' || host.endsWith('.slack.com')) return 'slack'
  if (host.includes('discord.com') || host.includes('discordapp.com')) return 'discord'
  return 'generic'
}

export function readPushConfig(store: Store): PushConfig {
  const rawPlatform = store.settings.get<string>(PLATFORM_KEY)
  const platform = PLATFORMS.includes(rawPlatform as PushPlatform)
    ? (rawPlatform as PushPlatform)
    : 'generic'
  return {
    enabled: store.settings.get<boolean>(ENABLED_KEY) === true,
    webhookUrl: store.settings.get<string>(URL_KEY) ?? '',
    platform
  }
}

export function readPushState(store: Store): PushState {
  return {
    ...readPushConfig(store),
    ...(store.settings.get<number>(LAST_AT_KEY) !== undefined
      ? { lastAt: store.settings.get<number>(LAST_AT_KEY) }
      : {}),
    ...(store.settings.get<string>(LAST_ERROR_KEY)
      ? { lastError: store.settings.get<string>(LAST_ERROR_KEY) }
      : {})
  }
}

export function savePushConfig(store: Store, config: PushConfig): void {
  store.settings.set(ENABLED_KEY, config.enabled)
  store.settings.set(URL_KEY, config.webhookUrl.trim())
  store.settings.set(PLATFORM_KEY, config.platform)
}

export function isValidWebhook(url: string): boolean {
  if (!/^https?:\/\//i.test(url.trim())) return false
  try {
    new URL(url)
    return true
  } catch {
    return false
  }
}

/** 生成推送正文；最多带三条速览，避免把整期简报搬进聊天窗口。 */
export function buildPushText(topicName: string, date: string, markdown: string, noChange: boolean): string {
  const header = `Meerkat · ${topicName} · ${date}`
  if (noChange) return `${header}\n今天没有值得改变判断的变化。`

  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const start = lines.findIndex((l) => /^##\s*三句话速览/.test(l.trim()))
  const picked: string[] = []
  if (start >= 0) {
    for (let i = start + 1; i < lines.length && picked.length < 3; i++) {
      const line = lines[i]!.trim()
      if (/^##\s/.test(line) || line === '---') break
      if (!line) continue
      picked.push(line.replace(/^\d+[.)]\s*/, '').replace(/\*\*/g, ''))
    }
  }
  if (picked.length === 0) {
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('>') || trimmed === '---') continue
      picked.push(trimmed.replace(/^[-*]\s*/, '').replace(/\*\*/g, ''))
      if (picked.length >= 3) break
    }
  }
  const body = picked.slice(0, 3).map((l) => `· ${l}`).join('\n')
  return `${header}\n${body || '今天这期简报已更新。'}\n\n打开 Meerkat 看完整简报。`
}

export function buildPushPayload(platform: PushPlatform, text: string): unknown {
  if (platform === 'feishu') return { msg_type: 'text', content: { text } }
  if (platform === 'slack') return { text }
  if (platform === 'discord') return { content: text }
  return { text }
}

export async function sendPush(config: PushConfig, text: string): Promise<{ ok: boolean; error?: string }> {
  if (!isValidWebhook(config.webhookUrl)) return { ok: false, error: 'Webhook 地址无效' }
  try {
    const res = await fetch(config.webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(buildPushPayload(config.platform, text)),
      signal: AbortSignal.timeout(15_000)
    })
    const raw = await res.text()
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}${raw ? `：${raw.slice(0, 160)}` : ''}` }
    if (config.platform === 'feishu') {
      try {
        const json = JSON.parse(raw) as { code?: number; msg?: string }
        if (typeof json.code === 'number' && json.code !== 0) {
          return { ok: false, error: `飞书返回 ${json.code}：${json.msg ?? ''}` }
        }
      } catch {
        // 飞书正常返回 JSON；解析失败不阻断，HTTP 2xx 已说明送达
      }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** 定时任务落库后调用；失败只记录，不影响简报本身。 */
export async function deliverBriefPush(
  store: Store,
  topicName: string,
  date: string,
  markdown: string,
  noChange: boolean
): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  const config = readPushConfig(store)
  if (!config.enabled || !config.webhookUrl) return { ok: false, skipped: true }
  const result = await sendPush(config, buildPushText(topicName, date, markdown, noChange))
  store.settings.set(LAST_AT_KEY, Date.now())
  store.settings.set(LAST_ERROR_KEY, result.ok ? '' : (result.error ?? '推送失败'))
  return result
}
