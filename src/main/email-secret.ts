/**
 * SMTP 密码单独加密存储，和模型 API Key 一样走 safeStorage。
 * 不把密码塞进 settings：导出诊断包/备份数据库时不应该带出 SMTP 凭据。
 */
import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const FILE = 'secret-smtp.bin'

function path(): string {
  return join(app.getPath('userData'), FILE)
}

export function hasSmtpPassword(): boolean {
  return existsSync(path())
}

export function getSmtpPassword(): string {
  try {
    if (!existsSync(path()) || !safeStorage.isEncryptionAvailable()) return ''
    return safeStorage.decryptString(readFileSync(path())).trim()
  } catch {
    return ''
  }
}

export function setSmtpPassword(raw: string): { ok: boolean; error?: string } {
  const password = raw.trim()
  if (!password) {
    clearSmtpPassword()
    return { ok: true }
  }
  if (!safeStorage.isEncryptionAvailable()) {
    return { ok: false, error: '系统加密不可用，无法安全保存 SMTP 密码' }
  }
  try {
    mkdirSync(app.getPath('userData'), { recursive: true })
    writeFileSync(path(), safeStorage.encryptString(password))
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export function clearSmtpPassword(): void {
  try {
    if (existsSync(path())) unlinkSync(path())
  } catch {
    /* 删不掉也不影响下一次覆盖写 */
  }
}
