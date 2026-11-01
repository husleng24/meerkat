/**
 * API Key 的存取（多供应商）。
 *
 * 每个供应商一把 key，来源优先级：
 *   1. Meerkat 自己的加密存储（userData/secret-<provider>.bin；DeepSeek 沿用旧文件名 secret.bin）
 *   2. 该供应商的环境变量（DEEPSEEK_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY）
 *   3. DeepSeek Harness 的 ~/.dsh/.credentials.yaml（只有 DeepSeek 有这一条）
 *
 * 为什么按供应商分文件而不是一个 JSON：单文件要么整份加密（改一个 key 要重写全部），
 * 要么明文分字段（更糟）。分文件后，"删掉某个供应商"就是删一个文件，失败面最小。
 */
import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { KEY_SOURCE_LABEL, maskKey, parseDshCredentials, type KeySource } from '../app/credentials'
import { PROVIDERS, providerMeta, type ProviderId } from '../core/chat/providers'

/** 旧的单 key 文件就是 DeepSeek 的 key：保持向后兼容，不要求用户重新导入 */
function secretFileName(id: ProviderId): string {
  return id === 'deepseek' ? 'secret.bin' : `secret-${id}.bin`
}

function secretPath(id: ProviderId): string {
  return join(app.getPath('userData'), secretFileName(id))
}

export function dshCredentialsPath(): string {
  return join(homedir(), '.dsh', '.credentials.yaml')
}

/** 读加密存储；文件不存在或解不开都返回 undefined */
function readStored(id: ProviderId): string | undefined {
  try {
    const p = secretPath(id)
    if (!existsSync(p)) return undefined
    if (!safeStorage.isEncryptionAvailable()) return undefined
    const buf = readFileSync(p)
    const text = safeStorage.decryptString(buf)
    return text.trim() || undefined
  } catch {
    return undefined
  }
}

export interface KeyStatus {
  provider: ProviderId
  providerLabel: string
  hasKey: boolean
  source: KeySource
  sourceLabel: string
  masked: string
  /** 加密是否可用：不可用时不能保存，只能靠环境变量 */
  canEncrypt: boolean
  /** 只有 DeepSeek 有 DSH 凭据可导入 */
  dshAvailable: boolean
}

function readDsh(): string | undefined {
  try {
    const p = dshCredentialsPath()
    if (!existsSync(p)) return undefined
    return parseDshCredentials(readFileSync(p, 'utf8'))
  } catch {
    return undefined
  }
}

export function keyStatus(providerId: ProviderId = 'deepseek'): KeyStatus {
  const meta = providerMeta(providerId) ?? providerMeta('deepseek')!
  const id = meta.id
  const stored = readStored(id)
  const env = process.env[meta.envVar]?.trim()
  const dshAvailable = id === 'deepseek' && existsSync(dshCredentialsPath())

  let source: KeySource = 'none'
  let key = ''
  if (stored) {
    source = 'store'
    key = stored
  } else if (env) {
    source = 'env'
    key = env
  } else if (dshAvailable) {
    const parsed = readDsh()
    if (parsed) {
      source = 'dsh-file'
      key = parsed
    }
  }

  return {
    provider: id,
    providerLabel: meta.label,
    hasKey: key.length > 0,
    source,
    sourceLabel: source === 'env' ? `来自环境变量 ${meta.envVar}` : KEY_SOURCE_LABEL[source],
    masked: key ? maskKey(key) : '',
    canEncrypt: safeStorage.isEncryptionAvailable(),
    dshAvailable
  }
}

/** 取实际使用的 key（不给 provider 时是 DeepSeek：成稿链路一直是 DeepSeek） */
export function getApiKey(providerId: ProviderId = 'deepseek'): { key: string; source: KeySource } {
  const meta = providerMeta(providerId) ?? providerMeta('deepseek')!
  const stored = readStored(meta.id)
  if (stored) return { key: stored, source: 'store' }
  const env = process.env[meta.envVar]?.trim()
  if (env) return { key: env, source: 'env' }
  if (meta.id === 'deepseek') {
    const dsh = readDsh()
    if (dsh) return { key: dsh, source: 'dsh-file' }
  }
  return { key: '', source: 'none' }
}

export function setApiKey(providerId: ProviderId, raw: string): { ok: boolean; error?: string } {
  const meta = providerMeta(providerId)
  if (!meta) return { ok: false, error: '未知的模型供应商' }
  const key = raw.trim()
  if (!meta.keyPattern.test(key)) {
    return { ok: false, error: `格式不像 ${meta.label} 的 API Key` }
  }
  if (!safeStorage.isEncryptionAvailable()) {
    return { ok: false, error: `系统加密不可用，无法安全保存。请改用环境变量 ${meta.envVar}` }
  }
  try {
    mkdirSync(app.getPath('userData'), { recursive: true })
    writeFileSync(secretPath(meta.id), safeStorage.encryptString(key))
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export function clearApiKey(providerId: ProviderId): { ok: boolean } {
  try {
    const p = secretPath(providerId)
    if (existsSync(p)) unlinkSync(p)
    return { ok: true }
  } catch {
    return { ok: false }
  }
}

/** 从 DSH 凭据文件导入（DSH 只提供 DeepSeek 的 key） */
export function importFromDsh(): { ok: boolean; masked?: string; error?: string } {
  const dsh = readDsh()
  if (!dsh) return { ok: false, error: `未在 ${dshCredentialsPath()} 找到 DEEPSEEK_API_KEY` }
  const r = setApiKey('deepseek', dsh)
  if (!r.ok) return { ok: false, error: r.error }
  return { ok: true, masked: maskKey(dsh) }
}

/** 所有供应商的状态（设置页一次列全） */
export function allKeyStatuses(): KeyStatus[] {
  return PROVIDERS.map((p) => keyStatus(p.id))
}

/** 当前可用的供应商（有 key 的），供聊天选择模型 */
export function availableProviders(): Array<{ id: ProviderId; key: string }> {
  const out: Array<{ id: ProviderId; key: string }> = []
  for (const p of PROVIDERS) {
    const { key } = getApiKey(p.id)
    if (key) out.push({ id: p.id, key })
  }
  return out
}
