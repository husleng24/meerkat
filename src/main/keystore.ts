/**
 * API Key 的存取。
 *
 * 三个来源，按优先级：
 *   1. Meerkat 自己的加密存储（userData/secret.bin，Windows 下走 DPAPI）
 *   2. 环境变量 DEEPSEEK_API_KEY（开发态/脚本用）
 *   3. DeepSeek Harness 的 ~/.dsh/.credentials.yaml（本机现成可用，一键导入）
 *
 * 为什么要有第 3 条：这台机器上 DSH 已经在跑，它的 key 就在那儿。
 * 但直接长期依赖别人的内部文件格式很脆（重装 DSH 就废），
 * 所以它只作为"导入来源"，导入后落到我们自己的加密存储里。
 */
import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  KEY_SOURCE_LABEL,
  looksLikeDeepSeekKey,
  maskKey,
  parseDshCredentials,
  type KeySource
} from '../app/credentials'

const FILE = 'secret.bin'

function secretPath(): string {
  return join(app.getPath('userData'), FILE)
}

export function dshCredentialsPath(): string {
  return join(homedir(), '.dsh', '.credentials.yaml')
}

/** 读加密存储；文件不存在或解不开都返回 undefined */
function readStored(): string | undefined {
  try {
    const p = secretPath()
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
  hasKey: boolean
  source: KeySource
  sourceLabel: string
  masked: string
  /** 加密是否可用：不可用时不能保存，只能靠环境变量/DSH 文件 */
  canEncrypt: boolean
  /** 本机是否检测到 DSH 凭据文件（决定要不要显示"导入"按钮） */
  dshAvailable: boolean
}

export function keyStatus(): KeyStatus {
  const stored = readStored()
  const env = process.env['DEEPSEEK_API_KEY']?.trim()
  const dsh = existsSync(dshCredentialsPath())

  let source: KeySource = 'none'
  let key = ''
  if (stored) {
    source = 'store'
    key = stored
  } else if (env) {
    source = 'env'
    key = env
  } else if (dsh) {
    const parsed = readDsh()
    if (parsed) {
      source = 'dsh-file'
      key = parsed
    }
  }

  return {
    hasKey: key.length > 0,
    source,
    sourceLabel: KEY_SOURCE_LABEL[source],
    masked: key ? maskKey(key) : '',
    canEncrypt: safeStorage.isEncryptionAvailable(),
    dshAvailable: dsh
  }
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

/** 取实际使用的 key（给主进程生成简报用） */
export function getApiKey(): { key: string; source: KeySource } {
  const stored = readStored()
  if (stored) return { key: stored, source: 'store' }
  const env = process.env['DEEPSEEK_API_KEY']?.trim()
  if (env) return { key: env, source: 'env' }
  const dsh = readDsh()
  if (dsh) return { key: dsh, source: 'dsh-file' }
  return { key: '', source: 'none' }
}

export function setApiKey(raw: string): { ok: boolean; error?: string } {
  const key = raw.trim()
  if (!looksLikeDeepSeekKey(key)) return { ok: false, error: '格式不像 DeepSeek API Key（应以 sk- 开头）' }
  if (!safeStorage.isEncryptionAvailable()) {
    return { ok: false, error: '系统加密不可用，无法安全保存。请改用环境变量 DEEPSEEK_API_KEY' }
  }
  try {
    mkdirSync(app.getPath('userData'), { recursive: true })
    writeFileSync(secretPath(), safeStorage.encryptString(key))
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export function clearApiKey(): { ok: boolean } {
  try {
    const p = secretPath()
    if (existsSync(p)) unlinkSync(p)
    return { ok: true }
  } catch {
    return { ok: false }
  }
}

/** 从 DSH 凭据文件导入并保存到本地加密存储 */
export function importFromDsh(): { ok: boolean; masked?: string; error?: string } {
  const dsh = readDsh()
  if (!dsh) return { ok: false, error: `未在 ${dshCredentialsPath()} 找到 DEEPSEEK_API_KEY` }
  const r = setApiKey(dsh)
  if (!r.ok) return { ok: false, error: r.error }
  return { ok: true, masked: maskKey(dsh) }
}
