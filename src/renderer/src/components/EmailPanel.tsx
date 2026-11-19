import { useEffect, useState } from 'react'
import type { EmailConfigPayload, EmailStatePayload } from '../lib/ipc-types'

/** SMTP 邮件摘要配置。密码只在保存时传一次，回读只给 hasPassword。 */
export function EmailPanel(): React.JSX.Element {
  const [config, setConfig] = useState<EmailConfigPayload>({
    enabled: false,
    host: '',
    port: 587,
    secure: false,
    user: '',
    from: '',
    to: ''
  })
  const [password, setPassword] = useState('')
  const [state, setState] = useState<EmailStatePayload | null>(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const api = window.meerkat?.email
    if (!api) return
    void api
      .get()
      .then((s) => {
        setState(s)
        setConfig({
          enabled: s.enabled,
          host: s.host,
          port: s.port,
          secure: s.secure,
          user: s.user,
          from: s.from,
          to: s.to
        })
      })
      .catch(() => undefined)
  }, [])

  const update = <K extends keyof EmailConfigPayload>(key: K, value: EmailConfigPayload[K]): void => {
    setConfig((prev) => ({ ...prev, [key]: value }))
  }

  const save = async (): Promise<boolean> => {
    const api = window.meerkat?.email
    if (!api) return false
    const r = await api.set({ ...config, ...(password ? { password } : {}) })
    if (!r.ok) {
      setMsg(r.error ?? '保存失败')
      return false
    }
    setPassword('')
    setState((prev) => (prev ? { ...prev, ...config, hasPassword: prev.hasPassword || Boolean(password) } : prev))
    setMsg('已保存')
    return true
  }

  const test = async (): Promise<void> => {
    const api = window.meerkat?.email
    if (!api) return
    setBusy(true)
    setMsg('')
    try {
      if (!(await save())) return
      const r = await api.test()
      setMsg(r.ok ? '测试邮件已发送' : (r.error ?? '发送失败'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card px-5 py-4 text-[12px]">
      <label className="flex cursor-pointer items-center gap-2">
        <input type="checkbox" checked={config.enabled} onChange={(e) => update('enabled', e.target.checked)} />
        <span className="font-medium text-ink">每天简报完成后发送邮件</span>
      </label>
      <p className="mt-1.5 text-[10.5px] leading-relaxed text-ink-3">
        用你自己的 SMTP（Gmail 应用专用密码、QQ 邮箱授权码、企业邮箱都可以）。密码走系统加密，只存在本机。
      </p>

      <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_100px_auto]">
        <input
          value={config.host}
          onChange={(e) => update('host', e.target.value)}
          placeholder="SMTP 主机，例如 smtp.gmail.com"
          className="rounded-lg border border-cream bg-white px-3 py-1.5 text-[11.5px] outline-none focus:border-accent"
        />
        <input
          type="number"
          min={1}
          max={65535}
          value={config.port}
          onChange={(e) => update('port', Number(e.target.value))}
          placeholder="587"
          className="rounded-lg border border-cream bg-white px-3 py-1.5 text-[11.5px] outline-none focus:border-accent"
        />
        <label className="flex items-center gap-1.5 text-[10.5px] text-ink-2">
          <input type="checkbox" checked={config.secure} onChange={(e) => update('secure', e.target.checked)} />
          SSL/TLS（465）
        </label>
      </div>

      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <input
          value={config.user}
          onChange={(e) => update('user', e.target.value)}
          placeholder="SMTP 用户名"
          className="rounded-lg border border-cream bg-white px-3 py-1.5 text-[11.5px] outline-none focus:border-accent"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={state?.hasPassword ? '密码已保存，留空不修改' : 'SMTP 密码 / 授权码'}
          className="rounded-lg border border-cream bg-white px-3 py-1.5 text-[11.5px] outline-none focus:border-accent"
        />
      </div>

      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <input
          value={config.from}
          onChange={(e) => update('from', e.target.value)}
          placeholder="发件人（留空用 SMTP 用户名）"
          className="rounded-lg border border-cream bg-white px-3 py-1.5 text-[11.5px] outline-none focus:border-accent"
        />
        <input
          value={config.to}
          onChange={(e) => update('to', e.target.value)}
          placeholder="收件人邮箱"
          className="rounded-lg border border-cream bg-white px-3 py-1.5 text-[11.5px] outline-none focus:border-accent"
        />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          onClick={() => void save()}
          className="rounded-lg border border-cream px-2.5 py-1 text-[11px] text-ink-2 hover:border-accent"
        >
          保存
        </button>
        <button
          onClick={() => void test()}
          disabled={busy || !config.host.trim() || !config.to.trim()}
          className="rounded-lg bg-ink px-2.5 py-1 text-[11px] text-paper disabled:opacity-40"
        >
          {busy ? '发送中…' : '发送测试邮件'}
        </button>
        {msg && <span className="text-[10.5px] text-ink-3">{msg}</span>}
      </div>

      {state?.lastAt && (
        <p className="mt-2 text-[10.5px] text-ink-3">
          上次尝试：{new Date(state.lastAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}
          {state.lastError ? ` · 失败：${state.lastError}` : ' · 成功'}
        </p>
      )}
    </div>
  )
}
