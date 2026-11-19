/**
 * 邮件摘要：SMTP 发送，不经过任何 Meerkat 服务器。
 *
 * 和 webhook 共用「三句话速览」的正文生成；区别只在传输层。
 * 密码在 email-secret.ts 里用 safeStorage 加密，settings 只存主机/账号/收件人。
 */
import nodemailer from 'nodemailer'
import type { Store } from '../core/ports/store'
import { buildPushText } from './push'
import { getSmtpPassword, hasSmtpPassword } from './email-secret'

export interface EmailConfig {
  enabled: boolean
  host: string
  port: number
  secure: boolean
  user: string
  from: string
  to: string
}

export interface EmailState extends EmailConfig {
  hasPassword: boolean
  lastAt?: number
  lastError?: string
}

const KEYS = {
  enabled: 'email.enabled',
  host: 'email.host',
  port: 'email.port',
  secure: 'email.secure',
  user: 'email.user',
  from: 'email.from',
  to: 'email.to',
  lastAt: 'email.lastAt',
  lastError: 'email.lastError'
} as const

export function readEmailConfig(store: Store): EmailConfig {
  return {
    enabled: store.settings.get<boolean>(KEYS.enabled) === true,
    host: store.settings.get<string>(KEYS.host) ?? '',
    port: store.settings.get<number>(KEYS.port) ?? 587,
    secure: store.settings.get<boolean>(KEYS.secure) === true,
    user: store.settings.get<string>(KEYS.user) ?? '',
    from: store.settings.get<string>(KEYS.from) ?? '',
    to: store.settings.get<string>(KEYS.to) ?? ''
  }
}

export function readEmailState(store: Store): EmailState {
  return {
    ...readEmailConfig(store),
    hasPassword: hasSmtpPassword(),
    ...(store.settings.get<number>(KEYS.lastAt) !== undefined ? { lastAt: store.settings.get<number>(KEYS.lastAt) } : {}),
    ...(store.settings.get<string>(KEYS.lastError) ? { lastError: store.settings.get<string>(KEYS.lastError) } : {})
  }
}

export function saveEmailConfig(store: Store, config: EmailConfig): void {
  store.settings.set(KEYS.enabled, config.enabled)
  store.settings.set(KEYS.host, config.host.trim())
  store.settings.set(KEYS.port, config.port)
  store.settings.set(KEYS.secure, config.secure)
  store.settings.set(KEYS.user, config.user.trim())
  store.settings.set(KEYS.from, config.from.trim())
  store.settings.set(KEYS.to, config.to.trim())
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim())
}

export function validateEmailConfig(config: EmailConfig, hasPassword: boolean): { ok: boolean; error?: string } {
  // 允许把未启用的邮件配置完全清空；启用时才要求完整字段
  if (!config.enabled && !config.host && !config.to && !config.user && !config.from) return { ok: true }
  if (!config.host.trim()) return { ok: false, error: 'SMTP 主机不能为空' }
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    return { ok: false, error: '端口必须在 1–65535 之间' }
  }
  if (!isValidEmail(config.to)) return { ok: false, error: '收件人邮箱格式不对' }
  if (!isValidEmail(config.from || config.user)) return { ok: false, error: '发件人邮箱格式不对' }
  if (config.enabled && config.user && !hasPassword) return { ok: false, error: '填写了 SMTP 用户，就需要密码' }
  return { ok: true }
}

export function buildEmailMessage(
  topicName: string,
  date: string,
  markdown: string,
  noChange: boolean
): { subject: string; text: string } {
  const status = noChange ? '无变化' : '简报'
  return {
    subject: `Meerkat · ${topicName} · ${date} · ${status}`,
    text: buildPushText(topicName, date, markdown, noChange)
  }
}

export async function sendEmail(
  config: EmailConfig,
  password: string,
  message: { subject: string; text: string }
): Promise<{ ok: boolean; error?: string }> {
  const invalid = validateEmailConfig(config, Boolean(password))
  if (!invalid.ok) return { ok: false, error: invalid.error }
  try {
    const transport = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      ...(config.user ? { auth: { user: config.user, pass: password } } : {}),
      connectionTimeout: 15_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000
    })
    await transport.sendMail({
      from: config.from || config.user,
      to: config.to,
      subject: message.subject,
      text: message.text
    })
    transport.close()
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** 定时任务落库后调用；失败只记录，不影响简报。 */
export async function deliverBriefEmail(
  store: Store,
  topicName: string,
  date: string,
  markdown: string,
  noChange: boolean
): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  const config = readEmailConfig(store)
  if (!config.enabled || !config.host || !config.to) return { ok: false, skipped: true }
  const result = await sendEmail(config, getSmtpPassword(), buildEmailMessage(topicName, date, markdown, noChange))
  store.settings.set(KEYS.lastAt, Date.now())
  store.settings.set(KEYS.lastError, result.ok ? '' : (result.error ?? '邮件发送失败'))
  return result
}
