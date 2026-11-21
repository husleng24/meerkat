/**
 * 账号与认证：Supabase Auth 只放在主进程。
 *
 * 桌面端不内嵌登录页：GitHub OAuth 用系统浏览器 + `meerkat://auth/callback`，
 * session 用 safeStorage 加密后落盘。渲染层只拿到用户信息和登录状态，不碰 token。
 *
 * 这一版只做邮箱注册/登录和 GitHub OAuth；跨设备同步是下一步，不能在 UI 里假装已经同步。
 */
import { app, safeStorage, shell } from 'electron'
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Store } from '../core/ports/store'

export const AUTH_REDIRECT = 'meerkat://auth/callback'
const URL_KEY = 'auth.supabaseUrl'
const KEY_KEY = 'auth.supabaseAnonKey'
const SESSION_FILE = 'auth-session.bin'

export interface AuthUser {
  id: string
  email: string
  provider: string
  createdAt?: string
}

export interface AuthStatus {
  configured: boolean
  signedIn: boolean
  user?: AuthUser
  /** 邮箱注册后需要去邮箱确认 */
  needsConfirmation?: boolean
  message?: string
  error?: string
}

export interface AuthResult extends AuthStatus {
  ok: boolean
}

function configOf(store: Store): { url: string; key: string } {
  return {
    url: (store.settings.get<string>(URL_KEY) ?? process.env.MEERKAT_SUPABASE_URL ?? '').trim(),
    key: (store.settings.get<string>(KEY_KEY) ?? process.env.MEERKAT_SUPABASE_ANON_KEY ?? '').trim()
  }
}

export function readAuthConfig(store: Store): { configured: boolean; url: string; hasKey: boolean } {
  const c = configOf(store)
  return { configured: Boolean(c.url && c.key), url: c.url, hasKey: Boolean(c.key) }
}

function sessionPath(): string {
  return join(app.getPath('userData'), SESSION_FILE)
}

/** Supabase 只存一个 session blob；加密后写单个文件，避免按 key 散落。 */
function readBlob(): string | null {
  try {
    if (!existsSync(sessionPath())) return null
    if (!safeStorage.isEncryptionAvailable()) return null
    return safeStorage.decryptString(readFileSync(sessionPath()))
  } catch {
    return null
  }
}

function writeBlob(value: string): void {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('系统加密不可用，无法保存登录状态')
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(sessionPath(), safeStorage.encryptString(value))
}

function clearBlob(): void {
  try {
    if (existsSync(sessionPath())) writeFileSync(sessionPath(), Buffer.alloc(0))
  } catch {
    /* ignore */
  }
}

const encryptedStorage = {
  getItem: (): string | null => readBlob(),
  setItem: (_key: string, value: string): void => writeBlob(value),
  removeItem: (): void => clearBlob()
}

let client: SupabaseClient | null = null
let clientKey = ''

function getClient(store: Store): SupabaseClient | null {
  const c = configOf(store)
  if (!c.url || !c.key) return null
  const signature = `${c.url}|${c.key}`
  if (client && clientKey === signature) return client
  client = createClient(c.url, c.key, {
    auth: {
      storage: encryptedStorage,
      storageKey: 'meerkat-auth',
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      flowType: 'pkce'
    }
  })
  clientKey = signature
  return client
}

function userOf(session: Session | null): AuthUser | undefined {
  const u = session?.user
  if (!u) return undefined
  return {
    id: u.id,
    email: u.email ?? '',
    provider: (u.app_metadata?.provider as string | undefined) ?? 'email',
    ...(u.created_at ? { createdAt: u.created_at } : {})
  }
}

export function clearAuthClient(): void {
  client = null
  clientKey = ''
}

export async function saveAuthConfig(store: Store, url: string, key: string): Promise<AuthResult> {
  const cleanUrl = url.trim().replace(/\/+$/, '')
  const cleanKey = key.trim()
  if (cleanUrl && !/^https:\/\/[^/\s]+/i.test(cleanUrl)) {
    return { ok: false, configured: false, signedIn: false, error: 'Supabase URL 必须是 https://…' }
  }
  store.settings.set(URL_KEY, cleanUrl)
  store.settings.set(KEY_KEY, cleanKey)
  clearAuthClient()
  return { ...(await status(store)), ok: true, message: '已连接 Supabase' }
}

export async function status(store: Store): Promise<AuthStatus> {
  const cfg = readAuthConfig(store)
  if (!cfg.configured) return { configured: false, signedIn: false }
  const supabase = getClient(store)
  if (!supabase) return { configured: false, signedIn: false }
  try {
    const { data } = await supabase.auth.getSession()
    const user = userOf(data.session)
    return { configured: true, signedIn: Boolean(user), ...(user ? { user } : {}) }
  } catch (e) {
    return {
      configured: true,
      signedIn: false,
      error: e instanceof Error ? e.message : String(e)
    }
  }
}

function fail(message: string, base?: AuthStatus): AuthResult {
  return {
    ok: false,
    configured: base?.configured ?? true,
    signedIn: false,
    error: message
  }
}

export async function signUpEmail(store: Store, email: string, password: string): Promise<AuthResult> {
  const supabase = getClient(store)
  if (!supabase) return fail('还没有配置 Supabase')
  const e = email.trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return fail('邮箱格式不对')
  if (password.length < 8) return fail('密码至少 8 位')
  const { data, error } = await supabase.auth.signUp({
    email: e,
    password,
    options: { emailRedirectTo: AUTH_REDIRECT }
  })
  if (error) return fail(error.message)
  if (data.session) {
    return { ...(await status(store)), ok: true, message: '注册成功，已登录' }
  }
  return {
    ...(await status(store)),
    ok: true,
    needsConfirmation: true,
    message: '注册成功。请去邮箱点确认链接，再回来登录。'
  }
}

export async function signInEmail(store: Store, email: string, password: string): Promise<AuthResult> {
  const supabase = getClient(store)
  if (!supabase) return fail('还没有配置 Supabase')
  const e = email.trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return fail('邮箱格式不对')
  const { error } = await supabase.auth.signInWithPassword({ email: e, password })
  if (error) return fail(error.message)
  return { ...(await status(store)), ok: true, message: '登录成功' }
}

export async function signInGithub(store: Store): Promise<AuthResult> {
  const supabase = getClient(store)
  if (!supabase) return fail('还没有配置 Supabase')
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'github',
    options: { redirectTo: AUTH_REDIRECT, skipBrowserRedirect: true }
  })
  if (error) return fail(error.message)
  if (!data.url) return fail('没有拿到 GitHub 授权地址')
  await shell.openExternal(data.url)
  return {
    ok: true,
    configured: true,
    signedIn: false,
    message: '已在系统浏览器打开 GitHub 授权，完成后会回到 Meerkat。'
  }
}

export async function signOut(store: Store): Promise<AuthResult> {
  const supabase = getClient(store)
  if (!supabase) return fail('还没有配置 Supabase')
  await supabase.auth.signOut()
  return { ...(await status(store)), ok: true, message: '已退出登录' }
}

/** deep link 回调：meerkat://auth/callback?code=… 或带 fragment 的 token。 */
export async function handleAuthCallback(store: Store, rawUrl: string): Promise<AuthResult> {
  const supabase = getClient(store)
  if (!supabase) return fail('还没有配置 Supabase')
  try {
    const url = new URL(rawUrl)
    const errorDescription = url.searchParams.get('error_description') ?? url.searchParams.get('error')
    if (errorDescription) return fail(decodeURIComponent(errorDescription))
    const code = url.searchParams.get('code')
    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code)
      if (error) return fail(error.message)
      return { ...(await status(store)), ok: true, message: 'GitHub 登录成功' }
    }
    const hash = new URLSearchParams(url.hash.replace(/^#/, ''))
    const accessToken = hash.get('access_token')
    const refreshToken = hash.get('refresh_token')
    if (accessToken && refreshToken) {
      const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
      if (error) return fail(error.message)
      return { ...(await status(store)), ok: true, message: '登录成功' }
    }
    return fail('回调里没有 code 或 token')
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e))
  }
}

/** 供主进程判断当前是否已配置（不需要展示错误给用户）。 */
export function authConfigured(store: Store): boolean {
  return readAuthConfig(store).configured
}
