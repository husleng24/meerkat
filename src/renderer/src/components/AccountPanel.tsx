import { useEffect, useState } from 'react'
import type { AuthStatusPayload } from '../lib/ipc-types'

/**
 * 账号面板：邮箱注册/登录 + GitHub OAuth。
 *
 * 这一版只建立身份，不做数据同步；界面必须说清楚，不能让人以为登录后就备份了。
 */
export function AccountPanel(): React.JSX.Element {
  const [status, setStatus] = useState<AuthStatusPayload | null>(null)
  const [config, setConfig] = useState<{ configured: boolean; url: string; hasKey: boolean } | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [url, setUrl] = useState('')
  const [anonKey, setAnonKey] = useState('')
  const [configOpen, setConfigOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const refresh = async (): Promise<void> => {
    const api = window.meerkat?.auth
    if (!api) return
    const [s, c] = await Promise.all([api.status(), api.config()])
    setStatus(s)
    setConfig(c)
    if (!url) setUrl(c.url)
  }

  useEffect(() => {
    void refresh()
    const off = window.meerkat?.auth?.onChanged((s) => {
      setStatus(s)
      if (s.message) setMsg(s.message)
    })
    return () => off?.()
  }, [])

  const run = async (fn: () => Promise<AuthStatusPayload>): Promise<void> => {
    setBusy(true)
    setMsg('')
    try {
      const r = await fn()
      setStatus(r)
      setMsg(r.error ?? r.message ?? '')
      if (r.ok) setPassword('')
    } finally {
      setBusy(false)
    }
  }

  const saveConfig = async (): Promise<void> => {
    const api = window.meerkat?.auth
    if (!api) return
    setBusy(true)
    try {
      const r = await api.setConfig({ url, key: anonKey })
      setStatus(r)
      setMsg(r.error ?? r.message ?? (r.configured ? '已连接 Supabase' : ''))
      if (r.configured) {
        setConfig({ configured: true, url, hasKey: true })
        setConfigOpen(false)
        setAnonKey('')
      }
    } finally {
      setBusy(false)
    }
  }

  if (!status) return <div className="text-[12px] text-ink-3">检查登录状态…</div>

  if (status.signedIn && status.user) {
    return (
      <div className="card px-5 py-4 text-[12px]">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-accent-soft text-[13px] font-semibold text-accent">
            {status.user.email.slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium text-ink">{status.user.email}</p>
            <p className="mt-0.5 text-[10.5px] text-ink-3">
              已登录 · {status.user.provider === 'github' ? 'GitHub' : '邮箱'} · 本机 session 已加密
            </p>
          </div>
          <button
            onClick={() => void run(() => window.meerkat!.auth!.signOut())}
            className="ml-auto rounded-lg border border-cream px-2.5 py-1 text-[11px] text-ink-2 hover:border-accent"
          >
            退出登录
          </button>
        </div>
        <p className="mt-3 rounded-lg bg-cream/60 px-2.5 py-2 text-[10.5px] leading-4 text-ink-3">
          账号已建立。跨设备同步还没有接入，当前不会把本地简报上传到云端。
        </p>
      </div>
    )
  }

  if (!status.configured) {
    return (
      <div className="card px-5 py-4 text-[12px]">
        <p className="font-medium text-ink">还没有连接 Supabase</p>
        <p className="mt-1 text-[10.5px] leading-4 text-ink-3">
          账号使用 Supabase Auth。填入项目 URL 和 anon key；GitHub 登录还需要在 Supabase 控制台启用
          GitHub provider，并把 <code className="text-ink-2">meerkat://auth/callback</code> 加入 Redirect URLs。
        </p>
        <div className="mt-3 grid gap-2">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://xxxx.supabase.co"
            className="rounded-lg border border-cream bg-white px-3 py-1.5 text-[11.5px] outline-none focus:border-accent"
          />
          <input
            type="password"
            value={anonKey}
            onChange={(e) => setAnonKey(e.target.value)}
            placeholder="Supabase anon key"
            className="rounded-lg border border-cream bg-white px-3 py-1.5 text-[11.5px] outline-none focus:border-accent"
          />
        </div>
        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={() => void saveConfig()}
            disabled={busy || !url.trim() || !anonKey.trim()}
            className="rounded-lg bg-ink px-2.5 py-1.5 text-[11px] text-paper disabled:opacity-40"
          >
            连接并保存
          </button>
          {msg && <span className="text-[10.5px] text-ink-3">{msg}</span>}
        </div>
      </div>
    )
  }

  return (
    <div className="card px-5 py-4 text-[12px]">
      <div className="flex items-start gap-2">
        <div>
          <p className="font-medium text-ink">登录账号</p>
          <p className="mt-1 text-[10.5px] leading-4 text-ink-3">
            注册和登录只建立身份；跨设备同步尚未接入。
          </p>
        </div>
        <button
          onClick={() => setConfigOpen((v) => !v)}
          className="ml-auto shrink-0 text-[10px] text-ink-3 hover:text-accent"
        >
          连接设置
        </button>
      </div>

      {configOpen && (
        <div className="mt-3 rounded-lg border border-rule bg-cream/40 p-3">
          <p className="text-[10.5px] text-ink-3">
            当前：{config?.url || '未配置'} · key：{config?.hasKey ? '已保存' : '未保存'}
          </p>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://xxxx.supabase.co"
            className="mt-2 w-full rounded-lg border border-cream bg-white px-3 py-1.5 text-[11.5px] outline-none focus:border-accent"
          />
          <input
            type="password"
            value={anonKey}
            onChange={(e) => setAnonKey(e.target.value)}
            placeholder="重新填写 anon key"
            className="mt-1.5 w-full rounded-lg border border-cream bg-white px-3 py-1.5 text-[11.5px] outline-none focus:border-accent"
          />
          <button
            onClick={() => void saveConfig()}
            disabled={busy || !url.trim() || !anonKey.trim()}
            className="mt-2 rounded-lg border border-cream px-2.5 py-1 text-[10.5px] text-ink-2 disabled:opacity-40"
          >
            保存连接
          </button>
        </div>
      )}

      <div className="mt-3 grid gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="邮箱"
          autoComplete="email"
          className="rounded-lg border border-cream bg-white px-3 py-1.5 text-[11.5px] outline-none focus:border-accent"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="密码（至少 8 位）"
          autoComplete="current-password"
          className="rounded-lg border border-cream bg-white px-3 py-1.5 text-[11.5px] outline-none focus:border-accent"
        />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          onClick={() => void run(() => window.meerkat!.auth!.signUp({ email, password }))}
          disabled={busy || !email.trim() || password.length < 8}
          className="rounded-lg bg-ink px-2.5 py-1 text-[11px] text-paper disabled:opacity-40"
        >
          注册
        </button>
        <button
          onClick={() => void run(() => window.meerkat!.auth!.signIn({ email, password }))}
          disabled={busy || !email.trim() || !password}
          className="rounded-lg border border-cream px-2.5 py-1 text-[11px] text-ink-2 hover:border-accent disabled:opacity-40"
        >
          登录
        </button>
        <button
          onClick={() => void run(() => window.meerkat!.auth!.github())}
          disabled={busy}
          className="rounded-lg border border-cream px-2.5 py-1 text-[11px] text-ink-2 hover:border-accent disabled:opacity-40"
        >
          使用 GitHub 登录
        </button>
      </div>
      {msg && <p className="mt-2 text-[10.5px] leading-4 text-ink-3">{msg}</p>}
    </div>
  )
}
